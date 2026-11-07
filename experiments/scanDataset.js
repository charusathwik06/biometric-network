try { require("dotenv").config(); } catch (error) {
  if (error.code !== "MODULE_NOT_FOUND") throw error;
}

const fs = require("node:fs/promises");
const path = require("node:path");
const { scanDataset } = require("../src/utils/dataset");

function readArguments(args) {
  const positional = args.find((arg) => !arg.startsWith("--"));
  const json = args.includes("--json");
  const outputArg = args.find((arg) => arg.startsWith("--output="));

  return {
    directory: positional || process.env.DATASET_DIR || "./dataset",
    json,
    output: outputArg ? outputArg.slice("--output=".length) : null
  };
}

async function main() {
  const options = readArguments(process.argv.slice(2));

  try {
    const report = await scanDataset(options.directory);
    const serialized = `${JSON.stringify(report, null, 2)}\n`;

    if (options.output) {
      const outputPath = path.resolve(options.output);
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, serialized, { mode: 0o600 });
      console.log("Sanitised aggregate inventory saved.");
    }

    if (options.json) {
      process.stdout.write(serialized);
      return;
    }

    console.log("Dataset inventory (directory names and filenames omitted)");
    console.log(`Total files: ${report.totalFiles}`);
    console.log(`Total bytes: ${report.totalBytes}`);
    console.log(`Total MiB: ${report.totalMiB}`);
    console.log("\nFiles by extension:");

    const entries = Object.entries(report.filesByType);
    if (entries.length === 0) console.log("(no files found)");

    for (const [extension, values] of entries) {
      console.log(
        `${extension.padEnd(16)} ${String(values.files).padStart(8)} files  ${values.bytes} bytes`
      );
    }
  } catch (error) {
    console.error(`Dataset scan failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { readArguments, main };
