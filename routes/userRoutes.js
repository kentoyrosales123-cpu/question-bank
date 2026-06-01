const express = require("express");
const router = express.Router();

const User = require("../models/User");
const Exam = require("../models/Exam");
const { protect, adminOnly } = require("../middleware/authMiddleware");

router.get("/", protect, adminOnly, async (req, res) => {
  try {
    const users = await User.find().select("-password").sort({ createdAt: -1 });

    res.json({
      success: true,
      users,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

router.get("/:id/exams", protect, adminOnly, async (req, res) => {
  try {
    const exams = await Exam.find({ user: req.params.id })
      .populate("user", "name email role")
      .populate("questions", "questionText difficulty")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      exams,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

module.exports = router;
