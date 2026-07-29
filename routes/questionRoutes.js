const express = require("express");
const router = express.Router();

const {
  createQuestion,
  getQuestions,
  getQuestion,
  getQuestionImage,
  getQuestionHistory,
  getQuestionAnalytics,
  updateQuestion,
  deleteQuestion,
  filterQuestions,
} = require("../controllers/questionController");

const { protect } = require("../middleware/authMiddleware");
const imageUpload = require("../middleware/imageUploadMiddleware");
const { canCreateContent } = require("../utils/roles");

const contentManagerOnly = (req, res, next) => {
  if (!canCreateContent(req.user)) {
    return res.status(403).json({
      message: "Question bank access denied.",
    });
  }

  next();
};

// Question routes
router.get("/", protect, contentManagerOnly, getQuestions);

router.get("/filter", protect, contentManagerOnly, filterQuestions);

// Question details
router.get("/:id/image", protect, getQuestionImage);

router.get("/:id/history", protect, contentManagerOnly, getQuestionHistory);

router.get(
  "/:id/analytics",
  protect,
  contentManagerOnly,
  getQuestionAnalytics,
);

router.get("/:id", protect, contentManagerOnly, getQuestion);

// Create question
router.post(
  "/",
  protect,
  contentManagerOnly,
  imageUpload.single("image"),
  createQuestion,
);

// Update question
router.put(
  "/:id",
  protect,
  contentManagerOnly,
  imageUpload.single("image"),
  updateQuestion,
);

// Delete question
router.delete("/:id", protect, contentManagerOnly, deleteQuestion);

module.exports = router;
