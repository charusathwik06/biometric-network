const express = require("express");

const {
  uploadBiometric
} = require("../controllers/biometricController");

function createBiometricRouter(config) {
  const router = express.Router();

  router.post("/upload", (req, res) => {
    return uploadBiometric(req, res, config);
  });

  return router;
}

module.exports = createBiometricRouter;