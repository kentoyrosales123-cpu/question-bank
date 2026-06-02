const express = require("express");
const router = express.Router();

const {
  createQuestion,
  getQuestions,
  getQuestion,
  getQuestionImage,
  updateQuestion,
  deleteQuestion,
  filterQuestions,
} = require("../controllers/questionController");

const { protect, adminOnly } = require("../middleware/authMiddleware");
const imageUpload = require("../middleware/imageUploadMiddleware");

router.get("/", protect, adminOnly, getQuestions);
router.get("/filter", protect, adminOnly, filterQuestions);
router.get("/:id/image", getQuestionImage);
router.get("/:id", protect, adminOnly, getQuestion);

router.post(
  "/",
  protect,
  adminOnly,
  imageUpload.single("image"),
  createQuestion,
);
router.put(
  "/:id",
  protect,
  adminOnly,
  imageUpload.single("image"),
  updateQuestion,
);
router.delete("/:id", protect, adminOnly, deleteQuestion);

module.exports = router;
