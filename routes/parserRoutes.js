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

const { protect } = require("../middleware/authMiddleware");

router.post("/parse", protect, parseUploadedQuestionnaire);
router.get("/", protect, getParsedQuestions);

// image route must be before /:id routes and before module.exports
router.get("/:id/image", getParsedQuestionImage);

router.put("/:id", protect, updateParsedQuestion);
router.post("/:id/approve", protect, approveParsedQuestion);
router.post("/:id/reject", protect, rejectParsedQuestion);

module.exports = router;
