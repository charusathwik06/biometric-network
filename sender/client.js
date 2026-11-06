
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const axios = require("axios");

const SERVER_URL = "http://127.0.0.1:5000/api/biometric/upload";

// Calculate SHA-256 hash of the file
function calculateHash(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash("sha256");
        const stream = fs.createReadStream(filePath);

        stream.on("data", (chunk) => {
            hash.update(chunk);
        });

        stream.on("end", () => {
            resolve(hash.digest("hex"));
        });

        stream.on("error", reject);
    });
}

// Send file to receiver
async function sendFile() {
    const filePath = process.argv[2];

    if (!filePath) {
        console.log("Please provide a file path");
        return;
    }

    const fullPath = path.resolve(filePath);

    if (!fs.existsSync(fullPath)) {
        console.log("File does not exist");
        return;
    }

    const stats = fs.statSync(fullPath);

    if (!stats.isFile() || stats.size === 0) {
        console.log("Please provide a non-empty file");
        return;
    }

    const fileName = path.basename(fullPath);

    if (
        fileName.length > 120 ||
        !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(fileName) ||
        fileName.includes("..")
    ) {
        console.log("Invalid file name");
        return;
    }

    try {
        console.log("Calculating SHA-256...");
        const sha256 = await calculateHash(fullPath);

        console.log("File Name:", fileName);
        console.log("File Size:", stats.size, "bytes");
        console.log("SHA-256:", sha256);

        console.log("\nSending file...");

        const response = await axios.post(
            SERVER_URL,
            fs.createReadStream(fullPath),
            {
                headers: {
                    "Content-Type": "application/octet-stream",
                    "X-File-Name": fileName,
                    "X-File-SHA256": sha256,
                    "Content-Length": stats.size
                },
                maxBodyLength: Infinity
            }
        );

        console.log("\nUpload Response:");
        console.log(response.data);

        if (response.data.success && response.data.integrity === "passed") {
            console.log("\nSUCCESS: File transferred and verified!");
        } else {
            console.log("\nUpload completed, but integrity was not confirmed.");
        }

    } catch (error) {
        if (error.response) {
            console.log("Receiver Error:", error.response.data);
        } else {
            console.log("Network Error:", error.message);
        }
    }
}

sendFile();
