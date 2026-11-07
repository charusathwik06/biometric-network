const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const { sha256File, sha256Buffer, hashesMatch } = require("../src/utils/hash");
const { scanDataset, collectDatasetFiles } = require("../src/utils/dataset");
const { runBenchmark } = require("../experiments/benchmark");

async function makeTempDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "biometric-member3-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test("streaming SHA-256 matches Node crypto and validates digest comparisons", async (t) => {
  const directory = await makeTempDirectory(t);
  const file = path.join(directory, "sample.bin");
  const data = Buffer.from([0, 1, 2, 255, 128, 10]);
  await fs.writeFile(file, data);

  const expected = crypto.createHash("sha256").update(data).digest("hex");
  const actual = await sha256File(file);

  assert.equal(actual, expected);
  assert.equal(sha256Buffer(data), expected);
  assert.equal(hashesMatch(expected, actual.toUpperCase()), true);
  assert.equal(hashesMatch("invalid", actual), false);
});

test("dataset scan aggregates extensions and bytes without exposing paths", async (t) => {
  const directory = await makeTempDirectory(t);
  await fs.mkdir(path.join(directory, "private-subject", "right-hand"), { recursive: true });
  await fs.writeFile(path.join(directory, "private-subject", "right-hand", "one.JPG"), Buffer.alloc(12));
  await fs.writeFile(path.join(directory, "private-subject", "right-hand", "two.jpg"), Buffer.alloc(8));
  await fs.writeFile(path.join(directory, "video.MP4"), Buffer.alloc(100));

  const report = await scanDataset(directory);
  const files = await collectDatasetFiles(directory);
  const serialized = JSON.stringify(report);

  assert.equal(report.totalFiles, 3);
  assert.equal(report.totalBytes, 120);
  assert.deepEqual(report.filesByType[".jpg"], { files: 2, bytes: 20 });
  assert.deepEqual(report.filesByType[".mp4"], { files: 1, bytes: 100 });
  assert.equal(files.length, 3);
  assert.equal(serialized.includes("private-subject"), false);
  assert.equal(serialized.includes("right-hand"), false);
  assert.equal(serialized.includes("one.JPG"), false);
});

test("benchmark reports verified and failed uploads without source filenames", async (t) => {
  const directory = await makeTempDirectory(t);
  const first = Buffer.from("synthetic sample one");
  const second = Buffer.from("synthetic sample two");
  await fs.writeFile(path.join(directory, "person-A-secret.jpg"), first);
  await fs.writeFile(path.join(directory, "person-B-secret.png"), second);

  const received = [];
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const digest = crypto.createHash("sha256").update(body).digest("hex");
    const filename = request.headers["x-file-name"];
    received.push(filename);

    if (digest !== request.headers["x-file-sha256"]) {
      response.writeHead(422, { "content-type": "application/json" });
      response.end(JSON.stringify({ success: false, integrity: "failed" }));
      return;
    }

    response.writeHead(201, { "content-type": "application/json" });
    response.end(JSON.stringify({
      success: true,
      integrity: filename.endsWith("000002.bin") ? "failed" : "passed"
    }));
  });

  server.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const port = server.address().port;
  const report = await runBenchmark({
    directory,
    mode: "both",
    concurrency: 2,
    timeoutMs: 5000,
    serverUrl: `http://127.0.0.1:${port}`
  });

  assert.equal(report.networkScope, "localhost/loopback");
  assert.equal(report.runs.length, 2);
  for (const run of report.runs) {
    assert.equal(run.attemptedFiles, 2);
    assert.equal(run.successfulFiles, 1);
    assert.equal(run.failedFiles, 1);
    assert.equal(run.successRatePercent, 50);
    assert.equal(run.totalBytes, first.length + second.length);
    assert.equal(JSON.stringify(run).includes("person-A-secret"), false);
    assert.equal(JSON.stringify(run).includes("person-B-secret"), false);
  }
  assert.deepEqual(received, [
    "capture-000001.bin", "capture-000002.bin",
    "capture-000001.bin", "capture-000002.bin"
  ]);
});

test("dataset scanner refuses a non-directory path", async (t) => {
  const directory = await makeTempDirectory(t);
  const file = path.join(directory, "not-a-folder.txt");
  await fs.writeFile(file, "x");

  await assert.rejects(scanDataset(file), /must point to a directory/);
});
