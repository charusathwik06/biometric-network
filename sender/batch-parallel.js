const { listFiles } = require("./batch");
const { sendFile } = require("./upload");

const MAX_UPLOADS = Number(process.env.MAX_UPLOADS || 2);

async function sendFolderParallel(directory, concurrency = MAX_UPLOADS) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) {
    throw new Error("Concurrency must be an integer from 1 to 32");
  }

  const files = await listFiles(directory);
  if (files.length === 0) throw new Error("No regular files found in the selected folder");

  let nextIndex = 0;
  let successful = 0;
  let failed = 0;
  let totalBytes = 0;

  async function worker() {
    while (true) {
      const index = nextIndex++;
      if (index >= files.length) return;

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
  }

  const workerCount = Math.min(concurrency, files.length);
  console.log(`Limited-concurrency upload: ${files.length} file(s), ${workerCount} worker(s)`);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  console.log("\n--- Parallel Batch Summary ---");
  console.log(`Attempted: ${files.length}`);
  console.log(`Successful: ${successful}`);
  console.log(`Failed: ${failed}`);
  console.log(`Successfully transferred bytes: ${totalBytes}`);
  if (failed > 0) process.exitCode = 1;

  return { attempted: files.length, successful, failed, totalBytes, concurrency: workerCount };
}

async function main() {
  const directory = process.argv[2];
  if (!directory) {
    console.error("Usage: node sender/batch-parallel.js <folder-path>");
    process.exitCode = 1;
    return;
  }

  try {
    await sendFolderParallel(directory);
  } catch (error) {
    console.error("Parallel batch upload failed:", error.message);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { sendFolderParallel, main };
