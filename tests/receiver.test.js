const test = require("node:test");
const assert = require("node:assert/strict");

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");

const { createApp } = require("../src/server");

function calculateHash(buffer) {
  return crypto
    .createHash("sha256")
    .update(buffer)
    .digest("hex");
}

async function startTestServer(t, maxFileSize = 1024 * 1024) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "biometric-receiver-")
  );

  const uploadDir = path.join(root, "received");

  const app = createApp({
    uploadDir,
    maxFileSize
  });

  const server = app.listen(0, "127.0.0.1");

  await once(server, "listening");

  t.after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });

    await fs.rm(root, {
      recursive: true,
      force: true
    });
  });

  const port = server.address().port;

  return {
    url: `http://127.0.0.1:${port}`,
    uploadDir
  };
}

async function sendFile(url, data, options = {}) {
  const headers = {
    "Content-Type":
      options.contentType || "application/octet-stream",

    "X-File-Name":
      options.fileName || "sample.bin",

    "X-File-SHA256":
      options.hash || calculateHash(data)
  };

  return fetch(`${url}/api/biometric/upload`, {
    method: "POST",
    headers,
    body: data
  });
}


test("receives and reconstructs a valid binary file", async (t) => {
  const { url, uploadDir } = await startTestServer(t);

  const originalData = Buffer.from([
    0, 1, 2, 3, 255, 254, 253, 128, 0, 99
  ]);

  const response = await sendFile(url, originalData);

  const result = await response.json();

  assert.equal(response.status, 201);
  assert.equal(result.success, true);
  assert.equal(result.integrity, "passed");
  assert.equal(result.bytesReceived, originalData.length);

  const savedData = await fs.readFile(
    path.join(uploadDir, result.storedFileName)
  );

  assert.deepEqual(savedData, originalData);
});


test("rejects a file with an incorrect SHA-256 hash", async (t) => {
  const { url, uploadDir } = await startTestServer(t);

  const data = Buffer.from("original biometric test data");

  const response = await sendFile(url, data, {
    hash: "0".repeat(64)
  });

  const result = await response.json();

  assert.equal(response.status, 422);
  assert.equal(result.success, false);
  assert.equal(result.integrity, "failed");

  const files = await fs.readdir(uploadDir);

  assert.equal(files.length, 0);
});


test("rejects unsafe filenames", async (t) => {
  const { url } = await startTestServer(t);

  const data = Buffer.from("test data");

  const response = await sendFile(url, data, {
    fileName: "../unsafe.txt"
  });

  const result = await response.json();

  assert.equal(response.status, 400);
  assert.equal(result.success, false);
  assert.equal(result.error.code, "INVALID_FILE_NAME");
});


test("rejects unsupported content types", async (t) => {
  const { url } = await startTestServer(t);

  const data = Buffer.from("test data");

  const response = await sendFile(url, data, {
    contentType: "application/json"
  });

  const result = await response.json();

  assert.equal(response.status, 415);
  assert.equal(result.error.code, "UNSUPPORTED_MEDIA_TYPE");
});


test("rejects files exceeding the configured size limit", async (t) => {
  const { url } = await startTestServer(t, 4);

  const data = Buffer.from("12345678");

  const response = await sendFile(url, data);

  const result = await response.json();

  assert.equal(response.status, 413);
  assert.equal(result.error.code, "FILE_TOO_LARGE");
});


test("rejects empty files", async (t) => {
  const { url } = await startTestServer(t);

  const data = Buffer.alloc(0);

  const response = await sendFile(url, data);

  const result = await response.json();

  assert.equal(response.status, 400);
  assert.equal(result.error.code, "EMPTY_FILE");
});


test("health endpoint reports that the server is running", async (t) => {
  const { url } = await startTestServer(t);

  const response = await fetch(`${url}/health`);
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.status, "running");
});
test("handles concurrent uploads with the same filename", async (t) => {
  const { url, uploadDir } = await startTestServer(t);

  const firstData = Buffer.from("first synthetic file");
  const secondData = Buffer.from("second synthetic file");

  const [firstResponse, secondResponse] = await Promise.all([
    sendFile(url, firstData, { fileName: "same.bin" }),
    sendFile(url, secondData, { fileName: "same.bin" })
  ]);

  assert.equal(firstResponse.status, 201);
  assert.equal(secondResponse.status, 201);

  const firstResult = await firstResponse.json();
  const secondResult = await secondResponse.json();

  assert.notEqual(
    firstResult.storedFileName,
    secondResult.storedFileName
  );

  const firstSaved = await fs.readFile(
    path.join(uploadDir, firstResult.storedFileName)
  );

  const secondSaved = await fs.readFile(
    path.join(uploadDir, secondResult.storedFileName)
  );

  assert.deepEqual(firstSaved, firstData);
  assert.deepEqual(secondSaved, secondData);
});


test("rejects malformed SHA-256 headers", async (t) => {
  const { url } = await startTestServer(t);

  const data = Buffer.from("synthetic test file");

  const response = await sendFile(url, data, {
    hash: "not-a-valid-hash"
  });

  const result = await response.json();

  assert.equal(response.status, 400);
  assert.equal(result.success, false);
  assert.equal(result.error.code, "INVALID_SHA256");
});


test("rejects oversized chunked uploads without Content-Length", async (t) => {
  const { url, uploadDir } = await startTestServer(t, 4);

  const data = Buffer.from("12345678");

  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(Buffer.from("1234"));
      controller.enqueue(Buffer.from("5678"));
      controller.close();
    }
  });

  const response = await fetch(
    `${url}/api/biometric/upload`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-File-Name": "chunked.bin",
        "X-File-SHA256": calculateHash(data)
      },
      body,
      duplex: "half"
    }
  );

  const result = await response.json();

  assert.equal(response.status, 413);
  assert.equal(result.error.code, "FILE_TOO_LARGE");

  const files = await fs.readdir(uploadDir);

  assert.equal(files.length, 0);
});