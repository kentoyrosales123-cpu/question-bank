const express = require("express");
const router = express.Router();

const {
  parseUploadedQuestionnaire,
  getParsedQuestions,
  approveParsedQuestion,
  updateParsedQuestion,
  rejectParsedQuestion,
} = require("../controllers/parserController");

const { protect, adminOnly } = require("../middleware/authMiddleware");

router.post("/parse", protect, adminOnly, parseUploadedQuestionnaire);
router.get("/", protect, adminOnly, getParsedQuestions);
router.put("/:id", protect, adminOnly, updateParsedQuestion);
router.post("/:id/approve", protect, adminOnly, approveParsedQuestion);
router.post("/:id/reject", protect, adminOnly, rejectParsedQuestion);

module.exports = router;
