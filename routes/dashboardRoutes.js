const express = require("express");
const router = express.Router();

const {
  getDashboardStats,
  downloadActivityLog,
  downloadAccreditationObeReport,
  getReportsSummary,
  getMyObeDashboard,
} = require("../controllers/dashboardController");
const { protect, adminOnly } = require("../middleware/authMiddleware");
const { canUseTeacherObe } = require("../utils/roles");

const teacherObeOnly = (req, res, next) => {
  if (!canUseTeacherObe(req.user)) {
    return res.status(403).json({
      success: false,
      message: "Teacher OBE dashboard is for exam users only.",
    });
  }

  next();
};

router.get("/stats", protect, adminOnly, getDashboardStats);
router.get("/my-obe", protect, teacherObeOnly, getMyObeDashboard);
router.get("/reports", protect, adminOnly, getReportsSummary);
router.get("/obe/export", protect, adminOnly, downloadAccreditationObeReport);
router.get("/activity/download", protect, adminOnly, downloadActivityLog);

module.exports = router;
