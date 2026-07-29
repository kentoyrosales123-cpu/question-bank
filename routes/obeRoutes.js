const express = require("express");
const router = express.Router();

const {
  createCourseOutcome,
  createStudentOutcome,
  deleteCourseOutcome,
  deleteStudentOutcome,
  getCourseOutcomes,
  getStudentOutcomes,
  importCourseOutcomes,
  importStudentOutcomes,
} = require("../controllers/obeController");
const { protect, superAdminOnly } = require("../middleware/authMiddleware");

router.get("/course-outcomes", protect, superAdminOnly, getCourseOutcomes);
router.post("/course-outcomes", protect, superAdminOnly, createCourseOutcome);
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

router.get("/student-outcomes", protect, superAdminOnly, getStudentOutcomes);
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

module.exports = router;
