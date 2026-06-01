const express = require("express");
const router = express.Router();

const {
  register,
  verifyEmail,
  resendVerification,
  login,
  me,
} = require("../controllers/authController");

const { protect } = require("../middleware/authMiddleware");

router.post("/register", register);
router.post("/verify-email", verifyEmail);
router.post("/resend-verification", resendVerification);
router.post("/login", login);
router.get("/me", protect, me);

module.exports = router;
