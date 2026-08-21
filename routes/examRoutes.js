const express = require("express");
const router = express.Router();

const {
  generateExam,
  getGenerationJobStatus,
  getExamOptions,
  getExamAvailability,
  getExam,
  getMyExamSummary,
  downloadExamDocx,
  downloadAnswerKeyDocx,
  downloadTosDocx,
  approveExam,
  rejectExam,
} = require("../controllers/examController");

const { protect } = require("../middleware/authMiddleware");

router.post("/generate", protect, generateExam);
router.get("/generate/jobs/:id", protect, getGenerationJobStatus);
router.get("/my/summary", protect, getMyExamSummary);
router.get("/options", protect, getExamOptions);
router.get("/availability", protect, getExamAvailability);
router.post("/:id/approve", protect, approveExam);
router.post("/:id/reject", protect, rejectExam);
router.get("/:id/download-docx", protect, downloadExamDocx);
router.get("/:id/download-answer-key-docx", protect, downloadAnswerKeyDocx);
router.get("/:id/download-tos-docx", protect, downloadTosDocx);
router.get("/:id", protect, getExam);

module.exports = router;
