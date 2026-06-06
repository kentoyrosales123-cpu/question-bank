const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");

const Notification = require("../models/Notification");
const User = require("../models/User");
const { protect } = require("../middleware/authMiddleware");

const getNotificationPayload = async (userId) => {
  const [notifications, unreadCount] = await Promise.all([
    Notification.find({ recipient: userId })
      .populate("actor", "name email role")
      .sort({ createdAt: -1 })
      .limit(40)
      .lean(),
    Notification.countDocuments({
      recipient: userId,
      readAt: { $exists: false },
    }),
  ]);

  return {
    success: true,
    unreadCount,
    notifications,
  };
};

router.get("/", protect, async (req, res) => {
  try {
    const payload = await getNotificationPayload(req.user._id);

    res.json(payload);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

router.get("/stream", async (req, res) => {
  try {
    const token = String(req.query.token || "");

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Not authorized. No token provided.",
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select("_id");

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User not found.",
      });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const sendPayload = async () => {
      const payload = await getNotificationPayload(user._id);
      res.write(`event: notifications\n`);
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    await sendPayload();
    const interval = setInterval(() => {
      sendPayload().catch(() => {});
    }, 5000);

    req.on("close", () => {
      clearInterval(interval);
      res.end();
    });
  } catch (error) {
    res.status(401).json({
      success: false,
      message: "Invalid or expired token.",
    });
  }
});

router.patch("/read-all", protect, async (req, res) => {
  try {
    await Notification.updateMany(
      {
        recipient: req.user._id,
        readAt: { $exists: false },
      },
      { readAt: new Date() },
    );

    res.json({
      success: true,
      message: "All notifications marked as read.",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

router.patch("/:id/read", protect, async (req, res) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      {
        _id: req.params.id,
        recipient: req.user._id,
      },
      { readAt: new Date() },
      { new: true },
    );

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: "Notification not found.",
      });
    }

    res.json({
      success: true,
      message: "Notification marked as read.",
      notification,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

module.exports = router;
