const express = require("express");
const router = express.Router();

const {
  getDashboardStats,
  downloadActivityLog,
} = require("../controllers/dashboardController");
const { protect, adminOnly } = require("../middleware/authMiddleware");

router.get("/stats", protect, adminOnly, getDashboardStats);
router.get("/activity/download", protect, adminOnly, downloadActivityLog);

module.exports = router;
