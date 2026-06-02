const express = require("express");
const router = express.Router();

const {
  verifyEmail,
  resendVerification,
  forgotPassword,
  resetPassword,
  login,
  me,
} = require("../controllers/authController");

const { protect } = require("../middleware/authMiddleware");

router.post("/verify-email", verifyEmail);
router.post("/resend-verification", resendVerification);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.post("/login", login);
router.get("/me", protect, me);

module.exports = router;
