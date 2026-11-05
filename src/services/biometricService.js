const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { once } = require("node:events");
const { finished } = require("node:stream/promises");

class UploadError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = "UploadError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function rejectUpload(request, statusCode, code, message) {
  // Drain the request body when rejecting before file processing.
  request.resume();
  throw new UploadError(statusCode, code, message);
}

function validateFileName(fileName) {
  if (
    typeof fileName !== "string" ||
    fileName.length === 0 ||
    fileName.length > 120 ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(fileName) ||
    fileName.includes("..")
  ) {
    throw new UploadError(
      400,
      "INVALID_FILE_NAME",
      "Invalid file name"
    );
  }

  return fileName;
}

function validateSha256(value) {
  if (
    typeof value !== "string" ||
    !/^[a-f0-9]{64}$/i.test(value)
  ) {
    throw new UploadError(
      400,
      "INVALID_SHA256",
      "A valid SHA-256 header is required"
    );
  }

  return value.toLowerCase();
}

async function receiveAndVerifyUpload({
  request,
  uploadDir,
  maxFileSize
}) {
  const contentType = (
    request.headers["content-type"] || ""
  ).split(";")[0].trim().toLowerCase();

  if (contentType !== "application/octet-stream") {
    rejectUpload(
      request,
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "Content-Type must be application/octet-stream"
    );
  }

  let fileName;
let expectedSha256;

try {
  fileName = validateFileName(
    request.headers["x-file-name"]
  );

  expectedSha256 = validateSha256(
    request.headers["x-file-sha256"]
  );
} catch (error) {
  request.resume();
  throw error;
}

  const limit = Number(maxFileSize);

  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new Error("Invalid MAX_FILE_SIZE configuration");
  }

  const contentLengthHeader = request.headers["content-length"];

  if (contentLengthHeader !== undefined) {
    const contentLength = Number(contentLengthHeader);

    if (
      !Number.isSafeInteger(contentLength) ||
      contentLength < 0
    ) {
      rejectUpload(
        request,
        400,
        "INVALID_CONTENT_LENGTH",
        "Invalid Content-Length header"
      );
    }

    if (contentLength > limit) {
      rejectUpload(
        request,
        413,
        "FILE_TOO_LARGE",
        "Uploaded file exceeds the configured size limit"
      );
    }

    if (contentLength === 0) {
      rejectUpload(
        request,
        400,
        "EMPTY_FILE",
        "Empty files are not accepted"
      );
    }
  }

  await fsp.mkdir(uploadDir, { recursive: true });

  const uploadId = crypto.randomUUID();

  const temporaryPath = path.join(
    uploadDir,
    `.upload-${uploadId}.tmp`
  );

  // Never use the sender's filename as a filesystem path.
  // A unique ID prevents accidental filename collisions.
  const storedFileName = `${uploadId}-${fileName}`;

  const finalPath = path.join(uploadDir, storedFileName);

  const output = fs.createWriteStream(temporaryPath, {
    flags: "wx"
  });

  const outputFinished = finished(output);

  // Attach a rejection handler immediately. We await the original
  // promise below to detect filesystem write errors.
  outputFinished.catch(() => {});

  const hash = crypto.createHash("sha256");

  let bytesReceived = 0;
  let tooLarge = false;

  try {
    // Process incoming binary data incrementally.
    for await (const chunk of request) {
      bytesReceived += chunk.length;

      if (bytesReceived > limit) {
        tooLarge = true;
        continue;
      }

      hash.update(chunk);

      // Respect filesystem backpressure.
      // This avoids writing unlimited buffered data into memory.
      if (!output.write(chunk)) {
        await once(output, "drain");
      }
    }

    if (!request.complete) {
      throw new UploadError(
        400,
        "INCOMPLETE_UPLOAD",
        "The upload was interrupted"
      );
    }

    if (tooLarge) {
      output.destroy();
      await outputFinished.catch(() => {});

      throw new UploadError(
        413,
        "FILE_TOO_LARGE",
        "Uploaded file exceeds the configured size limit"
      );
    }

    if (bytesReceived === 0) {
      output.end();
      await outputFinished;

      throw new UploadError(
        400,
        "EMPTY_FILE",
        "Empty files are not accepted"
      );
    }

    // Wait until all received bytes have been written to disk.
    output.end();
    await outputFinished;

    const actualSha256 = hash.digest("hex");

    const expectedBuffer = Buffer.from(expectedSha256, "hex");
    const actualBuffer = Buffer.from(actualSha256, "hex");

    const integrityPassed = crypto.timingSafeEqual(
      expectedBuffer,
      actualBuffer
    );

    if (!integrityPassed) {
      throw new UploadError(
        422,
        "INTEGRITY_MISMATCH",
        "Received file does not match the sender's SHA-256 hash"
      );
    }

    // Rename only after successful integrity verification.
    await fsp.rename(temporaryPath, finalPath);

    return {
      fileName,
      storedFileName,
      bytesReceived,
      sha256: actualSha256,
      integrity: "passed"
    };

  } catch (error) {
    if (!output.destroyed && !output.writableFinished) {
      output.destroy();
    }

    await outputFinished.catch(() => {});

    await fsp.rm(temporaryPath, {
      force: true
    }).catch(() => {});

    if (error instanceof UploadError) {
      throw error;
    }

    if (request.aborted || !request.complete) {
      throw new UploadError(
        400,
        "UPLOAD_ABORTED",
        "The upload did not complete"
      );
    }

    throw new UploadError(
      500,
      "UPLOAD_STORAGE_ERROR",
      "The server could not store the uploaded file"
    );
  }
}

module.exports = {
  receiveAndVerifyUpload,
  validateFileName,
  validateSha256,
  UploadError
};