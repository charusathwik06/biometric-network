try { require("dotenv").config(); } catch (error) {
  if (error.code !== "MODULE_NOT_FOUND") throw error;
}

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");
const https = require("node:https");
const { performance } = require("node:perf_hooks");
const { collectDatasetFiles } = require("../src/utils/dataset");
const { sha256File } = require("../src/utils/hash");

const DEFAULT_SERVER_URL = "http://127.0.0.1:5000";
const UPLOAD_PATH = "/api/biometric/upload";
const MAX_RESPONSE_BYTES = 64 * 1024;

function parseArguments(args) {
  const positional = args.find((arg) => !arg.startsWith("--"));
  const value = (name, fallback) => {
    const entry = args.find((arg) => arg.startsWith(`--${name}=`));
    return entry ? entry.slice(name.length + 3) : fallback;
  };

  const directory = positional || process.env.DATASET_DIR || "./dataset";
  const mode = value("mode", "both");
  const concurrency = Number(value("concurrency", "2"));
  const timeoutMs = Number(value("timeout-ms", "120000"));
  const serverUrl = value(
    "url",
    process.env.SERVER_URL || DEFAULT_SERVER_URL
  );
  const output = value("output", null);

  if (!["both", "sequential", "parallel"].includes(mode)) {
    throw new Error("--mode must be both, sequential or parallel");
  }
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) {
    throw new Error("--concurrency must be an integer from 1 to 32");
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000) {
    throw new Error("--timeout-ms must be an integer of at least 1000");
  }

  const parsedUrl = new URL(serverUrl);
  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error("The server URL must use HTTP or HTTPS");
  }

  return { directory, mode, concurrency, timeoutMs, serverUrl, output };
}

function requestUpload(file, fileIndex, endpoint, timeoutMs) {
  const transport = endpoint.protocol === "https:" ? https : http;
  const safeFileName = `capture-${String(fileIndex + 1).padStart(6, "0")}.bin`;
  const startedAt = performance.now();

  return new Promise((resolve) => {
    let settled = false;
    let input;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve({
        fileIndex: fileIndex + 1,
        bytes: file.size,
        durationMs: Number((performance.now() - startedAt).toFixed(2)),
        ...result
      });
    };

    const request = transport.request(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": file.size,
        "X-File-Name": safeFileName,
        "X-File-SHA256": ""
      }
    }, (response) => {
      const chunks = [];
      let receivedBytes = 0;

      response.on("data", (chunk) => {
        receivedBytes += chunk.length;
        if (receivedBytes <= MAX_RESPONSE_BYTES) chunks.push(chunk);
        else request.destroy(new Error("Receiver response was too large"));
      });

      response.once("end", () => {
        let payload = null;
        try {
          payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          // A non-JSON response is treated as a failed transfer.
        }

        const integrity = payload && typeof payload.integrity === "string"
          ? payload.integrity
          : "unknown";
        const success = response.statusCode >= 200 &&
          response.statusCode < 300 &&
          payload?.success === true &&
          integrity === "passed";

        finish({
          success,
          statusCode: response.statusCode || null,
          integrity,
          errorCode: success ? null : (payload?.error?.code || "UPLOAD_REJECTED")
        });
      });
    });

    request.setTimeout(timeoutMs, () => {
      const error = new Error("Upload timed out");
      error.code = "ETIMEDOUT";
      input?.destroy();
      request.destroy(error);
    });

    request.once("error", (error) => {
      finish({
        success: false,
        statusCode: null,
        integrity: "unknown",
        errorCode: error.code || "NETWORK_ERROR"
      });
    });

    // Hash before sending. Use a generated filename so private subject/capture
    // names are never transmitted as request metadata or included in reports.
    (async () => {
      const digest = await sha256File(file.path);
      if (settled) return;
      request.setHeader("X-File-SHA256", digest);
      input = fs.createReadStream(file.path);
      input.once("error", (error) => request.destroy(error));
      input.pipe(request);
    })().catch((error) => {
      request.destroy(error);
    });
  });
}

async function runMode(files, endpoint, { concurrency, timeoutMs, mode }) {
  let nextIndex = 0;
  const results = new Array(files.length);
  const startedAt = new Date().toISOString();
  const timerStart = performance.now();

  async function worker() {
    while (true) {
      const index = nextIndex++;
      if (index >= files.length) return;
      results[index] = await requestUpload(files[index], index, endpoint, timeoutMs);
    }
  }

  const workerCount = Math.min(concurrency, files.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  const durationMs = performance.now() - timerStart;
  const endedAt = new Date().toISOString();
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const successfulResults = results.filter((result) => result.success);
  const successful = successfulResults.length;
  const failed = results.length - successful;
  const successfulBytes = successfulResults.reduce((sum, result) => sum + result.bytes, 0);
  const elapsedSeconds = durationMs / 1000;
  const bytesPerSecond = elapsedSeconds > 0 ? successfulBytes / elapsedSeconds : 0;

  return {
    mode,
    concurrency: workerCount,
    startedAt,
    endedAt,
    attemptedFiles: files.length,
    totalBytes,
    successfulBytes,
    successfulFiles: successful,
    failedFiles: failed,
    successRatePercent: Number(((successful / files.length) * 100).toFixed(2)),
    durationMs: Number(durationMs.toFixed(2)),
    throughputMBps: Number((bytesPerSecond / 1_000_000).toFixed(3)),
    throughputMbps: Number(((bytesPerSecond * 8) / 1_000_000).toFixed(3)),
    // Per-file results intentionally contain no source filenames or directories.
    fileResults: results
  };
}

async function runBenchmark(options) {
  const files = await collectDatasetFiles(options.directory);
  if (files.length === 0) {
    throw new Error("The selected dataset directory contains no regular files");
  }

  const endpoint = new URL(UPLOAD_PATH, options.serverUrl);
  const isLoopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(
    endpoint.hostname.toLowerCase()
  );
  const plans = options.mode === "both"
    ? [
        { mode: "sequential", concurrency: 1 },
        { mode: "parallel", concurrency: options.concurrency }
      ]
    : [{
        mode: options.mode,
        concurrency: options.mode === "sequential" ? 1 : options.concurrency
      }];

  const runs = [];
  for (const plan of plans) {
    runs.push(await runMode(files, endpoint, {
      ...plan,
      timeoutMs: options.timeoutMs
    }));
  }

  return {
    generatedAt: new Date().toISOString(),
    networkScope: isLoopback ? "localhost/loopback" : "remote host (confirm LAN/Wi-Fi separately)",
    endpointPath: UPLOAD_PATH,
    measurement: "Elapsed wall-clock time includes per-file SHA-256 calculation and upload/receiver response; throughput uses total input bytes divided by that elapsed time.",
    runs
  };
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
    const report = await runBenchmark(options);
    const serialized = `${JSON.stringify(report, null, 2)}\n`;

    if (options.output) {
      const outputPath = path.resolve(options.output);
      await fsp.mkdir(path.dirname(outputPath), { recursive: true });
      await fsp.writeFile(outputPath, serialized, { mode: 0o600 });
      console.log("Aggregate benchmark summary saved (source filenames omitted).");
    }

    console.log(`Network scope: ${report.networkScope}`);
    console.log(`Endpoint: ${report.endpointPath}`);
    console.log("Timing includes SHA-256 calculation and upload/receiver response.");

    for (const run of report.runs) {
      console.log(`\n${run.mode.toUpperCase()} (${run.concurrency} concurrent upload(s))`);
      console.log(`Attempted: ${run.attemptedFiles}`);
      console.log(`Successful: ${run.successfulFiles}`);
      console.log(`Failed: ${run.failedFiles}`);
      console.log(`Success rate: ${run.successRatePercent}%`);
      console.log(`Duration: ${run.durationMs} ms`);
      console.log(`Throughput: ${run.throughputMBps} MB/s (${run.throughputMbps} Mbps)`);
    }

    if (report.runs.some((run) => run.failedFiles > 0)) process.exitCode = 1;
  } catch (error) {
    console.error(`Benchmark failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  parseArguments,
  runBenchmark,
  requestUpload,
  runMode
};
