const express = require("express");
const router = express.Router();

const {
  generateAiQuestions,
  getAiQuestionJob,
} = require("../controllers/aiQuestionController");
const { protect, superAdminOnly } = require("../middleware/authMiddleware");

router.post("/generate", protect, superAdminOnly, generateAiQuestions);
router.get("/jobs/:id", protect, superAdminOnly, getAiQuestionJob);

module.exports = router;
