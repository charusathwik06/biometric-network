
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const axios = require("axios");

const SERVER_URL = "http://127.0.0.1:5000/api/biometric/upload";

// Calculate SHA-256
function calculateHash(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash("sha256");
        const stream = fs.createReadStream(filePath);

        stream.on("data", chunk => hash.update(chunk));
        stream.on("end", () => resolve(hash.digest("hex")));
        stream.on("error", reject);
    });
}

// Send one file
async function sendFile(filePath) {
    const stats = fs.statSync(filePath);
    const fileName = path.basename(filePath);

    if (stats.size === 0) {
        throw new Error("Empty file");
    }

    if (
        fileName.length > 120 ||
        !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(fileName) ||
        fileName.includes("..")
    ) {
        throw new Error("Invalid file name");
    }

    const sha256 = await calculateHash(filePath);

    const response = await axios.post(
        SERVER_URL,
        fs.createReadStream(filePath),
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

    if (
        !response.data.success ||
        response.data.integrity !== "passed"
    ) {
        throw new Error("Integrity verification failed");
    }
}

// Send all files one by one
async function sendFolder() {
    const folderPath = process.argv[2];

    if (!folderPath) {
        console.log("Please provide a folder path");
        return;
    }

    const fullPath = path.resolve(folderPath);

    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory()) {
        console.log("Folder does not exist");
        return;
    }

    const files = fs.readdirSync(fullPath)
        .map(name => path.join(fullPath, name))
        .filter(file => fs.statSync(file).isFile());

    if (files.length === 0) {
        console.log("No files found in folder");
        return;
    }

    console.log("Total files:", files.length);

    let successful = 0;
    let failed = 0;

    for (const file of files) {
        console.log("\nSending:", path.basename(file));

        try {
            await sendFile(file);
            console.log("SUCCESS: File transferred and verified");
            successful++;
        } catch (error) {
            console.log("FAILED:", error.message);
            failed++;
        }
    }

    console.log("\n--- Batch Transfer Summary ---");
    console.log("Successful:", successful);
    console.log("Failed:", failed);
}

sendFolder();
