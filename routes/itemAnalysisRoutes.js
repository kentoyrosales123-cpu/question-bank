const express = require("express");
const router = express.Router();

const {
  downloadTemplate,
  uploadItemAnalysis,
  getItemAnalysis,
  exportItemAnalysis,
} = require("../controllers/itemAnalysisController");

const { protect } = require("../middleware/authMiddleware");
const { itemAnalysisAccess } = require("../middleware/itemAnalysisAccess");
const upload = require("../middleware/itemAnalysisUploadMiddleware");

router.get("/template", protect, itemAnalysisAccess, downloadTemplate);

router.post(
  "/upload",
  protect,
  itemAnalysisAccess,
  upload.fields([
    { name: "resultFile", maxCount: 1 },
    { name: "answerKeyFile", maxCount: 1 },
  ]),
  uploadItemAnalysis,
);

router.get("/:id/export", protect, itemAnalysisAccess, exportItemAnalysis);
router.get("/:id", protect, itemAnalysisAccess, getItemAnalysis);

module.exports = router;
