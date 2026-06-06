const express = require("express");
const router = express.Router();

const {
  generateExam,
  getExamOptions,
  getExam,
  getMyExamSummary,
  downloadExamDocx,
  downloadAnswerKeyDocx,
  approveExam,
  rejectExam,
} = require("../controllers/examController");

const { protect } = require("../middleware/authMiddleware");

router.post("/generate", protect, generateExam);
router.get("/my/summary", protect, getMyExamSummary);
router.get("/options", protect, getExamOptions);
router.post("/:id/approve", protect, approveExam);
router.post("/:id/reject", protect, rejectExam);
router.get("/:id/download-docx", protect, downloadExamDocx);
router.get("/:id/download-answer-key-docx", protect, downloadAnswerKeyDocx);
router.get("/:id", protect, getExam);

module.exports = router;
