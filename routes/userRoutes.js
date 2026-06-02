const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");

const User = require("../models/User");
const Exam = require("../models/Exam");
const { normalizeEmail } = require("../config/loginAccess");
const { protect, adminOnly } = require("../middleware/authMiddleware");
const imageUpload = require("../middleware/imageUploadMiddleware");

const allowedRoles = ["user", "admin", "super_admin", "professor", "student"];

router.get("/", protect, adminOnly, async (req, res) => {
  try {
    const users = await User.find()
      .select("-password -profileImage.data")
      .sort({ createdAt: -1 });

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

router.post("/", protect, adminOnly, async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");
    const role = req.body.role || "user";

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Name, email, and password are required.",
      });
    }

    if (!allowedRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        message: "Role must be user, professor, student, admin, or super admin.",
      });
    }

    const existingUser = await User.findOne({ email });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "Email already registered.",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({
      name,
      email,
      password: hashedPassword,
      role,
      isEmailVerified: true,
    });

    const createdUser = await User.findById(user._id).select(
      "-password -profileImage.data",
    );

    res.status(201).json({
      success: true,
      message: "Account created successfully.",
      user: createdUser,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

router.get("/me/profile", protect, async (req, res) => {
  try {
    const [totalExams, submittedExams, recentExams] = await Promise.all([
      Exam.countDocuments({ user: req.user._id }),
      Exam.countDocuments({ user: req.user._id, submitted: true }),
      Exam.find({ user: req.user._id })
        .select("title totalItems submitted createdAt")
        .sort({ createdAt: -1 })
        .limit(4),
    ]);

    res.json({
      success: true,
      user: req.user,
      stats: {
        totalExams,
        submittedExams,
        pendingExams: totalExams - submittedExams,
        recentExams,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

router.get("/me/profile-image", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select(
      "+profileImage.data profileImage.contentType",
    );

    if (!user || !user.profileImage || !user.profileImage.data) {
      return res.status(404).send("Profile image not found");
    }

    res.set("Content-Type", user.profileImage.contentType);
    res.send(user.profileImage.data);
  } catch (error) {
    res.status(500).send("Failed to load profile image");
  }
});

router.get("/me/activity", protect, async (req, res) => {
  try {
    const exams = await Exam.find({ user: req.user._id })
      .select("title subject topic totalItems submitted score createdAt")
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

router.get("/:id/profile-image", protect, adminOnly, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select(
      "+profileImage.data profileImage.contentType",
    );

    if (!user || !user.profileImage || !user.profileImage.data) {
      return res.status(404).send("Profile image not found");
    }

    res.set("Content-Type", user.profileImage.contentType);
    res.send(user.profileImage.data);
  } catch (error) {
    res.status(500).send("Failed to load profile image");
  }
});

router.patch(
  "/me/profile-image",
  protect,
  imageUpload.single("profileImage"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "Profile image is required.",
        });
      }

      const user = await User.findByIdAndUpdate(
        req.user._id,
        {
          profileImage: {
            data: req.file.buffer,
            contentType: req.file.mimetype,
            uploadedAt: new Date(),
          },
        },
        { new: true },
      ).select("-password -profileImage.data");

      res.json({
        success: true,
        message: "Profile picture updated.",
        user,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  },
);

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

router.patch("/:id/role", protect, adminOnly, async (req, res) => {
  try {
    const { role } = req.body;

    if (!allowedRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        message: "Role must be user, professor, student, admin, or super admin.",
      });
    }

    if (
      req.params.id === req.user._id.toString() &&
      !["admin", "super_admin"].includes(role)
    ) {
      return res.status(400).json({
        success: false,
        message: "You cannot remove your own admin role.",
      });
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { role },
      { new: true, runValidators: true },
    ).select("-password");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    res.json({
      success: true,
      message: "User role updated.",
      user,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

router.delete("/:id", protect, adminOnly, async (req, res) => {
  try {
    if (req.params.id === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: "You cannot delete your own account while logged in.",
      });
    }

    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    await Exam.deleteMany({ user: user._id });
    await user.deleteOne();

    res.json({
      success: true,
      message: "User deleted successfully.",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

module.exports = router;
