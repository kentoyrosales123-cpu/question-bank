const express = require("express");
const router = express.Router();

const {
  uploadQuestionnaire,
  getUploads,
  deleteUpload,
} = require("../controllers/uploadController");

const { protect, adminOnly } = require("../middleware/authMiddleware");
const upload = require("../middleware/uploadMiddleware");

router.post(
  "/questionnaire",
  protect,
  upload.single("questionnaire"),
  uploadQuestionnaire,
);

router.get("/", protect, getUploads);
router.delete("/:id", protect, deleteUpload);

module.exports = router;
