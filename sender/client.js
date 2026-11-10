const { sendFile } = require("./upload");
const { performance } = require("node:perf_hooks");

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: node sender/client.js <file-path>");
    process.exitCode = 1;
    return;
  }

  try {
    const startedAt = performance.now();
    const result = await sendFile(filePath);
    const durationMs = performance.now() - startedAt;
    const durationSeconds = durationMs / 1000;
    const throughputMBps = durationSeconds > 0
      ? result.bytes / durationSeconds / 1_000_000
      : 0;

    console.log("Upload successful.");
    console.log(`Bytes sent: ${result.bytes}`);
    console.log(`Integrity: ${result.integrity}`);
    console.log(`HTTP status: ${result.statusCode}`);
    console.log(`Duration: ${durationMs.toFixed(2)} ms`);
    console.log(`Throughput: ${throughputMBps.toFixed(3)} MB/s (${(throughputMBps * 8).toFixed(3)} Mbps)`);
  } catch (error) {
    console.error("Upload failed:", error.response?.data || error.message);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { main };
