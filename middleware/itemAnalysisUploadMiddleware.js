const multer = require("multer");

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const isCsv = file.originalname.toLowerCase().endsWith(".csv");
  const isXlsx = file.originalname.toLowerCase().endsWith(".xlsx");

  if (isCsv || isXlsx) {
    cb(null, true);
    return;
  }

  cb(new Error("Only XLSX and CSV files are allowed."));
};

module.exports = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
});
