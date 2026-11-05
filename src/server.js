require("dotenv").config();

const express = require("express");
const path = require("node:path");

const createBiometricRouter = require("./routes/biometricRoutes");

function createApp(options = {}) {
  const uploadDir = path.resolve(
    options.uploadDir ||
    process.env.UPLOAD_DIR ||
    "./received"
  );

  const maxFileSize = Number(
    options.maxFileSize ??
    process.env.MAX_FILE_SIZE ??
    524288000
  );

  if (!Number.isSafeInteger(maxFileSize) || maxFileSize <= 0) {
    throw new Error("MAX_FILE_SIZE must be a positive integer");
  }

  const app = express();

  // Hide Express's technology-identifying response header.
  app.disable("x-powered-by");

  // Health-check endpoint.
  app.get("/health", (req, res) => {
    return res.status(200).json({
      success: true,
      status: "running"
    });
  });

  // Biometric upload API.
  app.use(
    "/api/biometric",
    createBiometricRouter({
      uploadDir,
      maxFileSize
    })
  );

  // Handle unknown endpoints.
  app.use((req, res) => {
    return res.status(404).json({
      success: false,
      error: {
        code: "ROUTE_NOT_FOUND",
        message: "Requested endpoint does not exist"
      }
    });
  });

  return app;
}

function startServer() {
  const port = Number(process.env.PORT || 5000);
  const host = process.env.HOST || "127.0.0.1";

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be between 1 and 65535");
  }

  const app = createApp();

  const server = app.listen(port, host, () => {
    console.log("-----------------------------------");
    console.log("BIOMETRIC RECEIVER SERVER");
    console.log("-----------------------------------");
    console.log(`Host: ${host}`);
    console.log(`Port: ${port}`);
    console.log(`URL: http://${host}:${port}`);
    console.log(`Upload: /api/biometric/upload`);
    console.log("-----------------------------------");
  });

  server.on("error", (error) => {
    console.error("Server startup failed:", error.message);
  });

  return server;
}

// Start listening only when this file is executed directly.
// Tests can import createApp() without starting another server.
if (require.main === module) {
  startServer();
}

module.exports = {
  createApp,
  startServer
};