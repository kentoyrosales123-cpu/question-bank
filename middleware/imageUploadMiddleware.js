const multer = require("multer");

const imageUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter(req, file, cb) {
    const allowedTypes = ["image/jpeg", "image/png", "image/jpg", "image/webp"];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only JPG, PNG, and WEBP images are allowed."));
    }
  },
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

module.exports = imageUpload;
