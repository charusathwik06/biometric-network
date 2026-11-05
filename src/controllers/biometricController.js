const {
  receiveAndVerifyUpload
} = require("../services/biometricService");

async function uploadBiometric(req, res, config) {
  try {
    const result = await receiveAndVerifyUpload({
      request: req,
      uploadDir: config.uploadDir,
      maxFileSize: config.maxFileSize
    });

    return res.status(201).json({
      success: true,
      fileName: result.fileName,
      storedFileName: result.storedFileName,
      bytesReceived: result.bytesReceived,
      integrity: result.integrity,
      sha256: result.sha256
    });

  } catch (error) {
    const statusCode = error.statusCode || 500;

    const response = {
      success: false,
      error: {
        code: error.code || "INTERNAL_SERVER_ERROR",
        message: statusCode >= 500
          ? "The server could not complete the upload"
          : error.message
      }
    };

    if (error.code === "INTEGRITY_MISMATCH") {
      response.integrity = "failed";
    }

    return res.status(statusCode).json(response);
  }
}

module.exports = {
  uploadBiometric
};