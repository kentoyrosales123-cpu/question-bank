const express = require("express");
const router = express.Router();

const {
  generateExam,
  submitExam,
  getExam,
  downloadExamDocx,
} = require("../controllers/examController");

const { protect } = require("../middleware/authMiddleware");

router.post("/generate", protect, generateExam);
router.post("/submit", protect, submitExam);
router.get("/:id/download-docx", protect, downloadExamDocx);
router.get("/:id", protect, getExam);

module.exports = router;
