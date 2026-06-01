const ActivityLog = require("../models/ActivityLog");

const logActivity = async (req, { user, action, description, metadata = {} }) => {
  try {
    if (!user || !user._id) {
      return;
    }

    await ActivityLog.create({
      user: user._id,
      action,
      description,
      metadata,
      ipAddress: req.ip || req.socket?.remoteAddress || "",
      userAgent: req.get("user-agent") || "",
    });
  } catch (error) {
    console.error("Activity log failed:", error.message);
  }
};

module.exports = { logActivity };
