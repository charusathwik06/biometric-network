const { sendFile } = require("./upload");

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: node sender/client.js <file-path>");
    process.exitCode = 1;
    return;
  }

  try {
    const result = await sendFile(filePath);
    console.log("Upload successful.");
    console.log(`Bytes sent: ${result.bytes}`);
    console.log(`Integrity: ${result.integrity}`);
    console.log(`HTTP status: ${result.statusCode}`);
  } catch (error) {
    console.error("Upload failed:", error.response?.data || error.message);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { main };
