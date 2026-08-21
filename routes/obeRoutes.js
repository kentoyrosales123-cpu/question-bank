const express = require("express");
const router = express.Router();

const {
  createCourseOutcome,
  createAttainmentSnapshot,
  createEvidence,
  createProgramEducationalObjective,
  createRubricAssessment,
  createStudentOutcome,
  deleteAttainmentSnapshot,
  deleteCourseOutcome,
  deleteEvidence,
  deleteProgramEducationalObjective,
  deleteRubricAssessment,
  deleteStudentOutcome,
  downloadRubricTemplate,
  importRubricAssessment,
  listAttainmentSnapshots,
  listEvidence,
  listRubricAssessments,
  listRubricTemplates,
  getCourseOutcomes,
  getCurriculumMap,
  getProgramEducationalObjectives,
  getSettings,
  getStudentOutcomes,
  importCourseOutcomes,
  importProgramEducationalObjectives,
  importStudentOutcomes,
  updateCourseOutcome,
  updateSettings,
  updateRubricTemplate,
} = require("../controllers/obeController");
const { protect, superAdminOnly } = require("../middleware/authMiddleware");
const { canUseTeacherObe } = require("../utils/roles");
const upload = require("../middleware/uploadMiddleware");
const spreadsheetUpload = require("../middleware/itemAnalysisUploadMiddleware");

const teacherObeOnly = (req, res, next) => {
  if (!canUseTeacherObe(req.user)) {
    return res.status(403).json({
      success: false,
      message: "OBE workspace access is for exam users only.",
    });
  }

  next();
};

router.get("/settings", protect, superAdminOnly, getSettings);
router.put("/settings", protect, superAdminOnly, updateSettings);
router.get("/curriculum-map", protect, superAdminOnly, getCurriculumMap);

router.get("/peos", protect, superAdminOnly, getProgramEducationalObjectives);
router.post("/peos", protect, superAdminOnly, createProgramEducationalObjective);
router.post(
  "/peos/import",
  protect,
  superAdminOnly,
  importProgramEducationalObjectives,
);
router.delete(
  "/peos/:id",
  protect,
  superAdminOnly,
  deleteProgramEducationalObjective,
);

router.get("/course-outcomes", protect, superAdminOnly, getCourseOutcomes);
router.post("/course-outcomes", protect, superAdminOnly, createCourseOutcome);
router.put(
  "/course-outcomes/:id",
  protect,
  superAdminOnly,
  updateCourseOutcome,
);
router.post(
  "/course-outcomes/import",
  protect,
  superAdminOnly,
  importCourseOutcomes,
);
router.delete(
  "/course-outcomes/:id",
  protect,
  superAdminOnly,
  deleteCourseOutcome,
);

router.get("/student-outcomes", protect, getStudentOutcomes);
router.post("/student-outcomes", protect, superAdminOnly, createStudentOutcome);
router.post(
  "/student-outcomes/import",
  protect,
  superAdminOnly,
  importStudentOutcomes,
);
router.delete(
  "/student-outcomes/:id",
  protect,
  superAdminOnly,
  deleteStudentOutcome,
);

router.get("/rubrics", protect, teacherObeOnly, listRubricAssessments);
router.get("/rubric-templates", protect, teacherObeOnly, listRubricTemplates);
router.put(
  "/rubric-templates/:id",
  protect,
  teacherObeOnly,
  updateRubricTemplate,
);
router.get("/rubrics/template", protect, teacherObeOnly, downloadRubricTemplate);
router.post("/rubrics", protect, teacherObeOnly, createRubricAssessment);
router.post(
  "/rubrics/import",
  protect,
  teacherObeOnly,
  spreadsheetUpload.single("rubricFile"),
  importRubricAssessment,
);
router.delete("/rubrics/:id", protect, teacherObeOnly, deleteRubricAssessment);

router.get("/evidence", protect, teacherObeOnly, listEvidence);
router.post(
  "/evidence",
  protect,
  teacherObeOnly,
  upload.single("file"),
  createEvidence,
);
router.delete("/evidence/:id", protect, teacherObeOnly, deleteEvidence);

router.get("/attainment-snapshots", protect, superAdminOnly, listAttainmentSnapshots);
router.post(
  "/attainment-snapshots",
  protect,
  superAdminOnly,
  createAttainmentSnapshot,
);
router.delete(
  "/attainment-snapshots/:id",
  protect,
  superAdminOnly,
  deleteAttainmentSnapshot,
);

module.exports = router;
