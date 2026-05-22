const express = require("express");
const router = express.Router();

const {
  parseUploadedQuestionnaire,
  getParsedQuestions,
  approveParsedQuestion,
  updateParsedQuestion,
  rejectParsedQuestion,
  getParsedQuestionImage,
} = require("../controllers/parserController");

const { protect, adminOnly } = require("../middleware/authMiddleware");

router.post("/parse", protect, adminOnly, parseUploadedQuestionnaire);
router.get("/", protect, adminOnly, getParsedQuestions);

// image route must be before /:id routes and before module.exports
router.get("/:id/image", getParsedQuestionImage);

router.put("/:id", protect, adminOnly, updateParsedQuestion);
router.post("/:id/approve", protect, adminOnly, approveParsedQuestion);
router.post("/:id/reject", protect, adminOnly, rejectParsedQuestion);

module.exports = router;
