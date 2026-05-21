const express = require("express");
const router = express.Router();

const {
  createQuestion,
  getQuestions,
  getQuestion,
  updateQuestion,
  deleteQuestion,
  filterQuestions,
} = require("../controllers/questionController");

const { protect, adminOnly } = require("../middleware/authMiddleware");
const upload = require("../middleware/uploadMiddleware");

router.get("/", protect, getQuestions);
router.get("/filter", protect, filterQuestions);
router.get("/:id", protect, getQuestion);

router.post("/", protect, adminOnly, upload.single("image"), createQuestion);
router.put("/:id", protect, adminOnly, upload.single("image"), updateQuestion);
router.delete("/:id", protect, adminOnly, deleteQuestion);

module.exports = router;
