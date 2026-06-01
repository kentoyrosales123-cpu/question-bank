const express = require("express");
const router = express.Router();

const {
  getDashboardStats,
  downloadActivityLog,
  getReportsSummary,
} = require("../controllers/dashboardController");
const { protect, adminOnly } = require("../middleware/authMiddleware");

router.get("/stats", protect, adminOnly, getDashboardStats);
router.get("/reports", protect, adminOnly, getReportsSummary);
router.get("/activity/download", protect, adminOnly, downloadActivityLog);

module.exports = router;
