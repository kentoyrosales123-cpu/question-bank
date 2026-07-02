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

// Allow Admin + Super Admin
const adminOrSuperAdminOnly = (req, res, next) => {
  const allowedRoles = ["admin", "super_admin", "Admin", "Super Admin"];

  if (!req.user || !allowedRoles.includes(req.user.role)) {
    return res.status(403).json({
      message: "Admin or Super Admin access only.",
    });
  }

  next();
};

// Question routes
router.get("/", protect, adminOrSuperAdminOnly, getQuestions);

router.get("/filter", protect, adminOrSuperAdminOnly, filterQuestions);

// Question details
router.get("/:id/image", getQuestionImage);

router.get("/:id/history", protect, adminOrSuperAdminOnly, getQuestionHistory);

router.get(
  "/:id/analytics",
  protect,
  adminOrSuperAdminOnly,
  getQuestionAnalytics,
);

router.get("/:id", protect, adminOrSuperAdminOnly, getQuestion);

// Create question
router.post(
  "/",
  protect,
  adminOrSuperAdminOnly,
  imageUpload.single("image"),
  createQuestion,
);

// Update question
router.put(
  "/:id",
  protect,
  adminOrSuperAdminOnly,
  imageUpload.single("image"),
  updateQuestion,
);

// Delete question
router.delete("/:id", protect, adminOrSuperAdminOnly, deleteQuestion);

module.exports = router;
