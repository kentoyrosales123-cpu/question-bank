const express = require("express");
const router = express.Router();

const {
  listItemAnalysisExams,
  createItemAnalysisExam,
  createItemAnalysisFromGeneratedExam,
  downloadTemplate,
  downloadOmrTemplate,
  uploadItemAnalysis,
  saveScannedResult,
  getItemAnalysis,
  listItemAnalysisResults,
  exportItemAnalysis,
  upsertCqiInterventionPlan,
  updateCqiPlanStatus,
} = require("../controllers/itemAnalysisController");

const { protect } = require("../middleware/authMiddleware");
const { itemAnalysisAccess } = require("../middleware/itemAnalysisAccess");
const upload = require("../middleware/itemAnalysisUploadMiddleware");

router.get("/template", protect, itemAnalysisAccess, downloadTemplate);
router.get("/omr-template", protect, itemAnalysisAccess, downloadOmrTemplate);
router.get("/exams", protect, itemAnalysisAccess, listItemAnalysisExams);
router.post("/exams", protect, itemAnalysisAccess, createItemAnalysisExam);
router.post(
  "/from-generated-exam/:examId",
  protect,
  itemAnalysisAccess,
  createItemAnalysisFromGeneratedExam,
);

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

router.post("/:id/scanned-result", protect, itemAnalysisAccess, saveScannedResult);
router.patch(
  "/:id/cqi-plan/status",
  protect,
  itemAnalysisAccess,
  updateCqiPlanStatus,
);
router.put("/:id/cqi-plan", protect, itemAnalysisAccess, upsertCqiInterventionPlan);
router.get("/:id/results", protect, itemAnalysisAccess, listItemAnalysisResults);
router.get("/:id/export", protect, itemAnalysisAccess, exportItemAnalysis);
router.get("/:id", protect, itemAnalysisAccess, getItemAnalysis);

module.exports = router;
