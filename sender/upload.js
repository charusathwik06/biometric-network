require("dotenv").config();

const fs = require("node:fs/promises");
const path = require("node:path");
const fsStream = require("node:fs");
const axios = require("axios");
const { sha256File } = require("../src/utils/hash");

const BASE_URL = process.env.SERVER_URL || "http://127.0.0.1:5000";
const UPLOAD_URL = new URL("/api/biometric/upload", BASE_URL).toString();
const UPLOAD_TIMEOUT_MS = Number(process.env.UPLOAD_TIMEOUT_MS || 120000);
const MAX_FILE_SIZE = Number(process.env.MAX_FILE_SIZE || 524288000);

function validateFileName(fileName) {
  return typeof fileName === "string" &&
    fileName.length > 0 &&
    fileName.length <= 120 &&
    /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(fileName) &&
    !fileName.includes("..");
}

async function sendFile(filePath) {
  const absolutePath = path.resolve(filePath);
  const stats = await fs.stat(absolutePath);

  if (!stats.isFile()) throw new Error("The selected path is not a regular file");
  if (stats.size === 0) throw new Error("Empty files are not accepted");
  if (!Number.isSafeInteger(MAX_FILE_SIZE) || MAX_FILE_SIZE <= 0) {
    throw new Error("MAX_FILE_SIZE must be a positive integer");
  }
  if (stats.size > MAX_FILE_SIZE) throw new Error("File exceeds the configured MAX_FILE_SIZE");

  const fileName = path.basename(absolutePath);
  if (!validateFileName(fileName)) {
    throw new Error("Invalid filename; use letters, numbers, dot, underscore or hyphen");
  }
  if (!Number.isSafeInteger(UPLOAD_TIMEOUT_MS) || UPLOAD_TIMEOUT_MS < 1000) {
    throw new Error("UPLOAD_TIMEOUT_MS must be an integer of at least 1000");
  }

  const sha256 = await sha256File(absolutePath);
  const response = await axios.post(
    UPLOAD_URL,
    fsStream.createReadStream(absolutePath),
    {
      headers: {
        "Content-Type": "application/octet-stream",
        "X-File-Name": fileName,
        "X-File-SHA256": sha256,
        "Content-Length": stats.size
      },
      maxBodyLength: Infinity,
      timeout: UPLOAD_TIMEOUT_MS
    }
  );

  if (
    response.data?.success !== true ||
    response.data?.integrity !== "passed"
  ) {
    throw new Error("Receiver did not confirm successful integrity verification");
  }

  return {
    bytes: stats.size,
    integrity: response.data.integrity,
    statusCode: response.status
  };
}

module.exports = {
  sendFile,
  validateFileName,
  UPLOAD_URL
};
