const fs = require("node:fs/promises");
const path = require("node:path");
const { sendFile } = require("./upload");

async function listFiles(directory) {
  const absoluteDirectory = path.resolve(directory);
  const stats = await fs.stat(absoluteDirectory);
  if (!stats.isDirectory()) throw new Error("The selected path is not a directory");

  const entries = await fs.readdir(absoluteDirectory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(absoluteDirectory, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

async function sendFolder(directory) {
  const files = await listFiles(directory);
  if (files.length === 0) throw new Error("No regular files found in the selected folder");

  let successful = 0;
  let failed = 0;
  let totalBytes = 0;

  console.log(`Sequential upload: ${files.length} file(s)`);
  for (let index = 0; index < files.length; index++) {
    try {
      const result = await sendFile(files[index]);
      successful++;
      totalBytes += result.bytes;
      console.log(`File ${index + 1}/${files.length}: SUCCESS (${result.bytes} bytes)`);
    } catch (error) {
      failed++;
      console.error(`File ${index + 1}/${files.length}: FAILED (${error.response?.data?.error?.code || error.code || "UPLOAD_ERROR"})`);
    }
  }

  console.log("\n--- Sequential Batch Summary ---");
  console.log(`Attempted: ${files.length}`);
  console.log(`Successful: ${successful}`);
  console.log(`Failed: ${failed}`);
  console.log(`Successfully transferred bytes: ${totalBytes}`);
  if (failed > 0) process.exitCode = 1;

  return { attempted: files.length, successful, failed, totalBytes };
}

async function main() {
  const directory = process.argv[2];
  if (!directory) {
    console.error("Usage: node sender/batch.js <folder-path>");
    process.exitCode = 1;
    return;
  }

  try {
    await sendFolder(directory);
  } catch (error) {
    console.error("Batch upload failed:", error.message);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { listFiles, sendFolder, main };
