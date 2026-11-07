const fs = require("node:fs/promises");
const path = require("node:path");

function fileType(fileName) {
  const extension = path.extname(fileName).toLowerCase();
  return extension || "[no extension]";
}

/**
 * Walk a dataset without following symbolic links. Returned paths are only
 * for internal use by the uploader; do not print or publish them.
 */
async function collectDatasetFiles(rootDirectory) {
  const root = path.resolve(rootDirectory);
  let rootStats;

  try {
    rootStats = await fs.stat(root);
  } catch {
    throw new Error("Dataset directory does not exist or cannot be accessed");
  }

  if (!rootStats.isDirectory()) {
    throw new Error("Dataset path must point to a directory");
  }

  const pending = [root];
  const files = [];

  while (pending.length > 0) {
    const currentDirectory = pending.pop();
    let entries;

    try {
      entries = await fs.readdir(currentDirectory, { withFileTypes: true });
    } catch {
      throw new Error("A dataset directory could not be read");
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const absolutePath = path.join(currentDirectory, entry.name);

      // Do not follow symbolic links: they may point outside the dataset root.
      if (entry.isSymbolicLink()) continue;

      if (entry.isDirectory()) {
        pending.push(absolutePath);
      } else if (entry.isFile()) {
        let stats;
        try {
          stats = await fs.stat(absolutePath);
        } catch {
          throw new Error("A dataset file could not be inspected");
        }

        if (!Number.isSafeInteger(stats.size) || stats.size < 0) {
          throw new Error("A dataset file has an unsupported size");
        }

        files.push({ path: absolutePath, size: stats.size });
      }
    }
  }

  return files;
}

/**
 * Return an aggregate inventory only. No directory names or filenames are
 * included in the result, so it is safe to use as a sanitised summary.
 */
async function scanDataset(rootDirectory) {
  const files = await collectDatasetFiles(rootDirectory);
  const aggregate = new Map();
  let totalBytes = 0;

  for (const file of files) {
    totalBytes += file.size;
    const extension = fileType(file.path);
    const current = aggregate.get(extension) || { files: 0, bytes: 0 };
    current.files += 1;
    current.bytes += file.size;
    aggregate.set(extension, current);
  }

  const filesByType = Object.fromEntries(
    [...aggregate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([extension, values]) => [extension, values])
  );

  return {
    totalFiles: files.length,
    totalBytes,
    totalMiB: Number((totalBytes / (1024 * 1024)).toFixed(3)),
    filesByType
  };
}

module.exports = {
  collectDatasetFiles,
  scanDataset,
  fileType
};
