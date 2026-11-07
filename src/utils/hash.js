const crypto = require("node:crypto");
const fs = require("node:fs");

/**
 * Calculate a file's SHA-256 digest using a read stream.
 * The file is never loaded completely into memory.
 * @param {string} filePath
 * @returns {Promise<string>} Lowercase hexadecimal SHA-256 digest.
 */
function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const input = fs.createReadStream(filePath);

    input.on("data", (chunk) => hash.update(chunk));
    input.once("error", reject);
    input.once("end", () => resolve(hash.digest("hex")));
  });
}

function sha256Buffer(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

/** Compare two hexadecimal SHA-256 values without an early-exit string check. */
function hashesMatch(expected, actual) {
  if (!isSha256(expected) || !isSha256(actual)) return false;

  return crypto.timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(actual, "hex")
  );
}

module.exports = {
  sha256File,
  sha256Buffer,
  isSha256,
  hashesMatch
};
