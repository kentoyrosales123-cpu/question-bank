const ExcelJS = require("exceljs");
const User = require("../models/User");
const Question = require("../models/Question");
const Exam = require("../models/Exam");
const ActivityLog = require("../models/ActivityLog");
const ItemAnalysisExam = require("../models/ItemAnalysisExam");
const ItemAnalysisStudentResult = require("../models/ItemAnalysisStudentResult");
const CqiInterventionPlan = require("../models/CqiInterventionPlan");
const CourseOutcome = require("../models/CourseOutcome");
const StudentOutcome = require("../models/StudentOutcome");
const ProgramEducationalObjective = require("../models/ProgramEducationalObjective");
const RubricAssessment = require("../models/RubricAssessment");
const ObeEvidence = require("../models/ObeEvidence");
const { getObeSettings } = require("../services/obeSettingsService");
const {
  ASSESSMENT_METHODS,
  DEFAULT_ASSESSMENT_METHOD,
} = require("../utils/assessmentMethods");
const {
  GENERAL_ENGINEERING_PROGRAM,
  getQuestionProgramMatch,
} = require("../utils/engineeringPrograms");
const {
  attachStudentOutcomeIndicators,
} = require("../utils/studentOutcomeIndicators");
const {
  weightedPhaseAttainment,
} = require("../utils/phaseAttainment");

const OBE_SUBMISSION_ROLES = Object.freeze([
  "super_admin",
  "admin",
  "cee_cac_coordinator",
  "exam_creator",
  "exam_requestor",
  "professor",
  "user",
  "student",
]);

const getActivityAction = (activityOrAction) =>
  typeof activityOrAction === "string" ? activityOrAction : activityOrAction?.action;

const isTosDownloadActivity = (activityOrAction) =>
  getActivityAction(activityOrAction) === "download_tos" ||
  activityOrAction?.metadata?.documentType === "tos";

const formatActivityAction = (activityOrAction) => {
  const action = getActivityAction(activityOrAction);

  return isTosDownloadActivity(activityOrAction)
    ? "Downloaded TOS"
    : action === "generate_exam" || action === "created_exam"
    ? "Generated Exam"
    : action === "approve_exam"
    ? "Approved Exam"
    : action === "reject_exam"
    ? "Rejected Exam"
    : action === "download_exam"
    ? "Downloaded Exam"
    : action === "login"
    ? "Logged In"
    : String(action || "activity")
        .replace(/[_-]+/g, " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
};

const getActivityDateRange = (query = {}) => {
  const filter = {};
  const startValue = String(query.startDate || "").trim();
  const endValue = String(query.endDate || "").trim();
  const parseDateOnly = (value, endOfDay = false) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return null;
    }

    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(
      year,
      month - 1,
      day,
      endOfDay ? 23 : 0,
      endOfDay ? 59 : 0,
      endOfDay ? 59 : 0,
      endOfDay ? 999 : 0,
    );

    if (
      Number.isNaN(date.getTime()) ||
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      return null;
    }

    return date;
  };

  if (startValue || endValue) {
    filter.createdAt = {};
  }

  if (startValue) {
    const startDate = parseDateOnly(startValue);

    if (!startDate) {
      throw new Error("Start date is invalid.");
    }

    filter.createdAt.$gte = startDate;
  }

  if (endValue) {
    const endDate = parseDateOnly(endValue, true);

    if (!endDate) {
      throw new Error("End date is invalid.");
    }

    filter.createdAt.$lte = endDate;
  }

  if (
    filter.createdAt?.$gte &&
    filter.createdAt?.$lte &&
    filter.createdAt.$gte > filter.createdAt.$lte
  ) {
    throw new Error("Start date cannot be after end date.");
  }

  return filter;
};

const buildActivityWorkbook = async (activities) => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Activity Monitor");

  sheet.columns = [
    { header: "User Name", key: "userName", width: 24 },
    { header: "Email", key: "email", width: 28 },
    { header: "Role", key: "role", width: 16 },
    { header: "Activity", key: "activity", width: 18 },
    { header: "Details", key: "details", width: 42 },
    { header: "Date", key: "date", width: 14 },
    { header: "Time", key: "time", width: 14 },
    { header: "IP Address", key: "ipAddress", width: 18 },
    { header: "Browser", key: "browser", width: 60 },
  ];

  sheet.addRows(
    activities.map((activity) => {
      const activityDate = new Date(activity.createdAt);
      const user = activity.user || {};

      return {
        userName: user.name || "Unknown user",
        email: user.email || "",
        role: user.role || "",
        activity: formatActivityAction(activity),
        details: activity.description,
        date: activityDate.toLocaleDateString(),
        time: activityDate.toLocaleTimeString(),
        ipAddress: activity.ipAddress,
        browser: activity.userAgent,
      };
    }),
  );

  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF860012" },
  };
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  return workbook.xlsx.writeBuffer();
};

const formatExportDate = (value) => {
  if (!value) return "";
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
};

const styleWorksheetHeader = (sheet) => {
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF860012" },
  };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: sheet.columnCount },
  };
};

const addRowsWorksheet = (workbook, title, columns, rows) => {
  const sheet = workbook.addWorksheet(title);

  sheet.columns = columns;
  sheet.addRows(rows);
  styleWorksheetHeader(sheet);

  return sheet;
};

const toOutcomeKey = (value, fallback) => String(value || fallback).trim();
const MIN_OUTCOME_QUESTION_COVERAGE = 3;

const normalizeOutcomeCode = (value = "") =>
  String(value || "")
    .trim()
    .replace(/^(CO|CLO|SO)[-\s]*/i, "")
    .toLowerCase();

const parseOutcomeLinks = (value = "") =>
  String(value || "")
    .split(/[,\s]+/)
    .map(normalizeOutcomeCode)
    .filter(Boolean);

const createCoverageAlert = ({
  severity = "Medium",
  area,
  item,
  issue,
  action,
  evidenceCount = "",
}) => ({
  severity,
  area,
  item,
  issue,
  action,
  evidenceCount,
});

const OBE_TERM_OPTIONS = Object.freeze([
  "1st Sem 1st Term",
  "1st Sem 2nd Term",
  "2nd Sem 1st Term",
  "2nd Sem 2nd Term",
  "Summer",
]);

const escapeRegExp = (value = "") =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const exactTextFilter = (value) => {
  const text = String(value || "").trim();

  return text ? new RegExp(`^${escapeRegExp(text)}$`, "i") : null;
};

const getObeReportFilters = (query = {}) => {
  const filters = {
    engineeringProgram: String(query.engineeringProgram || "").trim(),
    subject: String(query.subject || "").trim(),
    section: String(query.section || "").trim(),
    semester: String(query.semester || "").trim(),
    schoolYear: String(query.schoolYear || "").trim(),
    assessmentMethod: String(query.assessmentMethod || "").trim(),
  };

  return Object.fromEntries(
    Object.entries(filters).filter(([, value]) => Boolean(value)),
  );
};

const buildQuestionFilter = (filters = {}) => {
  const filter = {};

  if (filters.engineeringProgram) {
    filter.engineeringProgram = getQuestionProgramMatch(filters.engineeringProgram);
  }
  if (filters.subject) {
    filter.subject = exactTextFilter(filters.subject);
  }

  return filter;
};

const buildExamFilter = (filters = {}) => {
  const filter = {};

  if (filters.engineeringProgram) {
    filter.engineeringProgram = filters.engineeringProgram;
  }
  if (filters.subject) {
    filter.subject = exactTextFilter(filters.subject);
  }
  if (filters.section) {
    filter.section = exactTextFilter(filters.section);
  }
  if (filters.semester) {
    filter.semester = exactTextFilter(filters.semester);
  }
  if (filters.schoolYear) {
    filter.schoolYear = exactTextFilter(filters.schoolYear);
  }
  if (filters.assessmentMethod) {
    filter.assessmentMethod = filters.assessmentMethod;
  }

  return filter;
};

const buildItemAnalysisFilter = (filters = {}) => {
  const filter = {};

  if (filters.subject) {
    filter.subject = exactTextFilter(filters.subject);
  }
  if (filters.section) {
    filter.section = exactTextFilter(filters.section);
  }
  if (filters.semester) {
    filter.semester = exactTextFilter(filters.semester);
  }
  if (filters.schoolYear) {
    filter.schoolYear = exactTextFilter(filters.schoolYear);
  }
  if (filters.assessmentMethod) {
    filter.assessmentMethod = filters.assessmentMethod;
  }

  return filter;
};

const buildEvidenceFilter = (filters = {}) => {
  const filter = {};

  if (filters.engineeringProgram) {
    filter.engineeringProgram = filters.engineeringProgram;
  }
  if (filters.subject) {
    filter.subject = exactTextFilter(filters.subject);
  }
  if (filters.section) {
    filter.section = exactTextFilter(filters.section);
  }
  if (filters.semester) {
    filter.semester = exactTextFilter(filters.semester);
  }
  if (filters.schoolYear) {
    filter.schoolYear = exactTextFilter(filters.schoolYear);
  }

  return filter;
};

const questionMatchesObeFilters = (question = {}, filters = {}) => {
  if (
    filters.engineeringProgram &&
    question.engineeringProgram !== filters.engineeringProgram &&
    question.engineeringProgram !== GENERAL_ENGINEERING_PROGRAM
  ) {
    return false;
  }

  if (
    filters.subject &&
    String(question.subject || "").toLowerCase() !== filters.subject.toLowerCase()
  ) {
    return false;
  }

  return true;
};

const formatFilterSummary = (filters = {}) =>
  [
    filters.engineeringProgram ? `Program: ${filters.engineeringProgram}` : "",
    filters.subject ? `Subject: ${filters.subject}` : "",
    filters.section ? `Section: ${filters.section}` : "",
    filters.semester ? `Term: ${filters.semester}` : "",
    filters.schoolYear ? `School Year: ${filters.schoolYear}` : "",
    filters.assessmentMethod ? `Assessment: ${filters.assessmentMethod}` : "",
  ]
    .filter(Boolean)
    .join(" | ") || "All records";

const createOutcomeBucket = (code, targetRate) => ({
  code,
  programs: new Set(),
  studentScores: new Map(),
  targetRate,
  questionCount: 0,
  assessedItems: 0,
  correctItems: 0,
  possibleWeight: 0,
  attainedWeight: 0,
  attainmentRate: 0,
  assessedStudents: 0,
  attainedStudents: 0,
  piBuckets: new Map(),
  phaseBuckets: new Map(),
});

const CEP_LEVELS = Object.freeze([
  "Routine Engineering Problem",
  "Moderately Complex Engineering Problem",
  "Complex Engineering Problem",
]);

const getQuestionCepLevel = (question = {}) => {
  const level = String(question.complexityLevel || "").trim();

  if (CEP_LEVELS.includes(level)) {
    return level;
  }

  return question.isComplexEngineeringProblem
    ? "Complex Engineering Problem"
    : "Routine Engineering Problem";
};

const createCepBuckets = (targetRate) =>
  new Map(
    CEP_LEVELS.map((level) => [
      level,
      createOutcomeBucket(level, targetRate),
    ]),
  );

const getTraceabilityKey = (courseOutcome, programOutcome) =>
  `${courseOutcome}|||${programOutcome}`;

const ensureTraceabilityBucket = (
  matrix,
  courseOutcome,
  programOutcome,
  settings,
) => {
  const key = getTraceabilityKey(courseOutcome, programOutcome);

  if (!matrix.has(key)) {
    matrix.set(key, {
      courseOutcome,
      programOutcome,
      programs: new Set(),
      subjects: new Set(),
      questionIds: new Set(),
      assessmentMethods: new Set(),
      evidenceSources: new Set(),
      studentScores: new Map(),
      assessedItems: 0,
      correctItems: 0,
      possibleWeight: 0,
      attainedWeight: 0,
      assessedStudents: 0,
      attainedStudents: 0,
      targetRate: Math.min(
        Number(settings.courseOutcomeTarget ?? 75),
        Number(settings.studentOutcomeTarget ?? 75),
      ),
      attainmentRate: 0,
      status: "No Evidence",
      cqiStatus: "No CQI Required",
    });
  }

  return matrix.get(key);
};

const recordTraceabilityQuestion = (bucket, question = {}) => {
  if (question._id) {
    bucket.questionIds.add(question._id.toString());
  }
  if (question.engineeringProgram) {
    bucket.programs.add(question.engineeringProgram);
  }
  if (question.subject) {
    bucket.subjects.add(question.subject);
  }
};

const recordTraceabilityEvidence = (
  bucket,
  { itemResult, weight, studentKey, assessmentMethod, evidenceSource },
) => {
  bucket.assessedItems++;
  bucket.possibleWeight += weight;

  if (assessmentMethod) {
    bucket.assessmentMethods.add(assessmentMethod);
  }
  if (evidenceSource) {
    bucket.evidenceSources.add(evidenceSource);
  }
  if (itemResult?.isCorrect) {
    bucket.correctItems++;
    bucket.attainedWeight += weight;
  }
  if (studentKey) {
    const score = bucket.studentScores.get(studentKey) || {
      possibleWeight: 0,
      attainedWeight: 0,
    };

    score.possibleWeight += weight;
    if (itemResult?.isCorrect) {
      score.attainedWeight += weight;
    }
    bucket.studentScores.set(studentKey, score);
  }
};

const finalizeTraceabilityRows = (matrix, settings) =>
  Array.from(matrix.values())
    .map((bucket) => {
      const studentScores = Array.from(bucket.studentScores.values()).filter(
        (score) => Number(score.possibleWeight || 0) > 0,
      );
      const attainedStudents = studentScores.filter((score) => {
        const rate =
          Number(score.possibleWeight || 0) > 0
            ? (Number(score.attainedWeight || 0) /
                Number(score.possibleWeight || 0)) *
              100
            : 0;

        return rate >= Number(bucket.targetRate ?? 75);
      }).length;
      const responseAttainmentRate =
        bucket.possibleWeight > 0
          ? Math.round((bucket.attainedWeight / bucket.possibleWeight) * 1000) /
            10
          : 0;
      const studentAttainmentRate =
        studentScores.length > 0
          ? Math.round((attainedStudents / studentScores.length) * 1000) / 10
          : 0;
      const attainmentRate =
        settings.attainmentMethod === "student_based"
          ? studentAttainmentRate
          : responseAttainmentRate;

      return {
        program: Array.from(bucket.programs).sort().join(", ") || "Not set",
        subject: Array.from(bucket.subjects).sort().join(", ") || "Not set",
        courseOutcome: bucket.courseOutcome,
        programOutcome: bucket.programOutcome,
        questionCount: bucket.questionIds.size,
        assessmentMethods:
          Array.from(bucket.assessmentMethods).sort().join(", ") || "No evidence",
        evidenceSources:
          Array.from(bucket.evidenceSources).sort().join("; ") || "No evidence",
        assessedItems: bucket.assessedItems,
        correctItems: bucket.correctItems,
        assessedStudents: studentScores.length,
        attainedStudents,
        responseAttainmentRate,
        attainmentRate,
        targetRate: bucket.targetRate,
        status:
          bucket.assessedItems <= 0
            ? "No Evidence"
            : attainmentRate >= Number(bucket.targetRate ?? 75)
              ? "Attained"
              : "Not Attained",
        cqiStatus: bucket.cqiStatus,
      };
    })
    .sort(
      (a, b) =>
        a.courseOutcome.localeCompare(b.courseOutcome) ||
        a.programOutcome.localeCompare(b.programOutcome),
    );

const getAttainmentMethodLabel = (method) =>
  method === "student_based" ? "Student-based" : "Response-based";

const getAttainmentFormula = (method) =>
  method === "student_based"
    ? "Students who reached the outcome target / Students assessed; SO phase rollup uses Formative 30% + Summative 70% when phase evidence exists"
    : "Correct mapped responses / Total mapped responses; SO phase rollup uses Formative 30% + Summative 70% when phase evidence exists";

const averageRates = (rows = []) => {
  const assessedRows = rows.filter((row) => Number(row.assessedItems || 0) > 0);

  if (assessedRows.length === 0) {
    return 0;
  }

  return (
    Math.round(
      (assessedRows.reduce(
        (sum, row) => sum + Number(row.attainmentRate || 0),
        0,
      ) /
        assessedRows.length) *
        10,
    ) / 10
  );
};

const countAttainedOutcomes = (rows = []) =>
  rows.filter(
    (row) =>
      Number(row.assessedItems || 0) > 0 &&
      Number(row.attainmentRate || 0) >= Number(row.targetRate ?? 75),
  ).length;

const countAssessedOutcomes = (rows = []) =>
  rows.filter((row) => Number(row.assessedItems || 0) > 0).length;

const getCourseLevelStatus = ({
  assessedOutcomes,
  attainedOutcomes,
  overallAttainmentRate,
  minimumTarget,
}) => {
  if (assessedOutcomes <= 0) {
    return "No Evidence";
  }

  if (
    attainedOutcomes >= assessedOutcomes &&
    overallAttainmentRate >= minimumTarget
  ) {
    return "Attained";
  }

  if (attainedOutcomes > 0 || overallAttainmentRate >= minimumTarget * (2 / 3)) {
    return "Partially Attained";
  }

  return "Not Attained";
};

const buildCourseLevelSummary = (filters = {}, obeReport = {}) => {
  const courseOutcomes = obeReport.courseOutcomes || [];
  const studentOutcomes = obeReport.programOutcomes || [];
  const assessedClos = countAssessedOutcomes(courseOutcomes);
  const assessedSos = countAssessedOutcomes(studentOutcomes);
  const attainedClos = countAttainedOutcomes(courseOutcomes);
  const attainedSos = countAttainedOutcomes(studentOutcomes);
  const cloAverage = averageRates(courseOutcomes);
  const soAverage = averageRates(studentOutcomes);
  const availableAverages = [
    assessedClos > 0 ? cloAverage : null,
    assessedSos > 0 ? soAverage : null,
  ].filter((value) => value !== null);
  const overallAttainmentRate =
    availableAverages.length > 0
      ? Math.round(
          (availableAverages.reduce((sum, value) => sum + value, 0) /
            availableAverages.length) *
            10,
        ) / 10
      : 0;
  const minimumTarget = Math.min(
    Number(obeReport.settings?.courseOutcomeTarget ?? 75),
    Number(obeReport.settings?.studentOutcomeTarget ?? 75),
  );
  const assessedOutcomes = assessedClos + assessedSos;
  const attainedOutcomes = attainedClos + attainedSos;

  return {
    subject: filters.subject || "All subjects",
    section: filters.section || "All sections",
    semester: filters.semester || "All terms",
    schoolYear: filters.schoolYear || "All school years",
    program: filters.engineeringProgram || "All programs",
    assessmentMethod: filters.assessmentMethod || "All methods",
    cloSummary: `${attainedClos} / ${assessedClos}`,
    soSummary: `${attainedSos} / ${assessedSos}`,
    assessedClos,
    attainedClos,
    assessedSos,
    attainedSos,
    assessedOutcomes,
    attainedOutcomes,
    cloAverage,
    soAverage,
    overallAttainmentRate,
    targetRate: minimumTarget,
    status: getCourseLevelStatus({
      assessedOutcomes,
      attainedOutcomes,
      overallAttainmentRate,
      minimumTarget,
    }),
  };
};

const recordOutcomeResponse = (bucket, itemResult, weight, studentKey, phase = "") => {
  bucket.assessedItems++;
  bucket.possibleWeight += weight;

  if (itemResult?.isCorrect) {
    bucket.correctItems++;
    bucket.attainedWeight += weight;
  }

  if (studentKey) {
    const score = bucket.studentScores.get(studentKey) || {
      possibleWeight: 0,
      attainedWeight: 0,
    };

    score.possibleWeight += weight;
    if (itemResult?.isCorrect) {
      score.attainedWeight += weight;
    }
    bucket.studentScores.set(studentKey, score);
  }

  if (phase) {
    recordOutcomeResponse(
      ensureOutcomeBucket(bucket.phaseBuckets, phase, bucket.targetRate),
      itemResult,
      weight,
      studentKey,
    );
  }
};

const recordOutcomeScore = (bucket, score, maxScore, studentKey, targetScore, phase = "") => {
  bucket.assessedItems++;
  bucket.possibleWeight += maxScore;
  bucket.attainedWeight += score;

  if (score >= targetScore) {
    bucket.correctItems++;
  }

  if (studentKey) {
    const studentScore = bucket.studentScores.get(studentKey) || {
      possibleWeight: 0,
      attainedWeight: 0,
    };

    studentScore.possibleWeight += maxScore;
    studentScore.attainedWeight += score;
    bucket.studentScores.set(studentKey, studentScore);
  }

  if (phase) {
    recordOutcomeScore(
      ensureOutcomeBucket(bucket.phaseBuckets, phase, bucket.targetRate),
      score,
      maxScore,
      studentKey,
      targetScore,
    );
  }
};

const ensureOutcomeBucket = (map, code, targetRate) => {
  if (!map.has(code)) {
    map.set(code, createOutcomeBucket(code, targetRate));
  }

  return map.get(code);
};

const calculateObeReport = async (filters = {}) => {
  const questionFilter = buildQuestionFilter(filters);
  const submittedExamFilter = {
    submitted: true,
    ...buildExamFilter(filters),
  };
  const itemAnalysisFilter = buildItemAnalysisFilter(filters);
  const [settings, questions, submittedExams, analysisExams, rubricAssessments] = await Promise.all([
    getObeSettings(),
    Question.find()
      .where(questionFilter)
      .select("engineeringProgram courseOutcome programOutcome performanceIndicator bloomLevel outcomeWeight isComplexEngineeringProblem complexityLevel")
      .lean(),
    Exam.find(submittedExamFilter)
      .select("title subject section semester schoolYear assessmentMethod assessmentPhase answers questions user")
      .populate({
        path: "questions",
        select: "subject engineeringProgram courseOutcome programOutcome performanceIndicator bloomLevel outcomeWeight isComplexEngineeringProblem complexityLevel",
      })
        .lean(),
    ItemAnalysisExam.find({
      generatedExamId: { $ne: null },
      includeInObe: { $ne: false },
      ...itemAnalysisFilter,
    })
      .select("title generatedExamId subject section semester schoolYear assessmentMethod assessmentPhase")
      .populate({
        path: "generatedExamId",
        select: "title engineeringProgram subject assessmentMethod assessmentPhase questions",
        populate: {
          path: "questions",
          select:
            "subject engineeringProgram courseOutcome programOutcome performanceIndicator bloomLevel outcomeWeight isComplexEngineeringProblem complexityLevel",
        },
      })
      .lean(),
    RubricAssessment.find(buildExamFilter(filters)).lean(),
  ]);
  const analysisResults = await ItemAnalysisStudentResult.find({
    analysisExamId: { $in: analysisExams.map((exam) => exam._id) },
  })
    .select("analysisExamId itemResults")
    .lean();

  const courseOutcomes = new Map();
  const programOutcomes = new Map();
  const bloomLevels = new Map();
  const cepAttainment = createCepBuckets(settings.courseOutcomeTarget);
  const traceabilityMatrix = new Map();
  const analysisResultsByExam = new Map();
  let alignedQuestions = 0;

  analysisResults.forEach((result) => {
    const key = result.analysisExamId.toString();
    const rows = analysisResultsByExam.get(key) || [];

    rows.push(result);
    analysisResultsByExam.set(key, rows);
  });

  questions.forEach((question) => {
    const courseOutcome = toOutcomeKey(question.courseOutcome, "Unmapped CLO");
    const programOutcome = toOutcomeKey(question.programOutcome, "Unmapped SO");
    const performanceIndicator = toOutcomeKey(
      question.performanceIndicator,
      "",
    );
    const bloomLevel = toOutcomeKey(question.bloomLevel, "Unmapped Bloom");
    const cepLevel = getQuestionCepLevel(question);

    if (question.courseOutcome && question.programOutcome) {
      alignedQuestions++;
    }

    if (!courseOutcomes.has(courseOutcome)) {
      courseOutcomes.set(
        courseOutcome,
        createOutcomeBucket(courseOutcome, settings.courseOutcomeTarget),
      );
    }
    const soBucket = ensureOutcomeBucket(
      programOutcomes,
      programOutcome,
      settings.studentOutcomeTarget,
    );
    if (!bloomLevels.has(bloomLevel)) {
      bloomLevels.set(bloomLevel, { level: bloomLevel, questionCount: 0 });
    }
    recordTraceabilityQuestion(
      ensureTraceabilityBucket(
        traceabilityMatrix,
        courseOutcome,
        programOutcome,
        settings,
      ),
      question,
    );

    courseOutcomes.get(courseOutcome).questionCount++;
    if (question.engineeringProgram) {
      courseOutcomes.get(courseOutcome).programs.add(question.engineeringProgram);
      cepAttainment.get(cepLevel)?.programs.add(question.engineeringProgram);
    }
    programOutcomes.get(programOutcome).questionCount++;
    if (performanceIndicator) {
      ensureOutcomeBucket(
        soBucket.piBuckets,
        performanceIndicator,
        settings.studentOutcomeTarget,
      ).questionCount++;
    }
    bloomLevels.get(bloomLevel).questionCount++;
    cepAttainment.get(cepLevel).questionCount++;
  });

  submittedExams.forEach((exam) => {
    const questionsById = new Map(
      (exam.questions || [])
        .filter((question) => questionMatchesObeFilters(question, filters))
        .map((question) => [question._id.toString(), question]),
    );

    (exam.answers || []).forEach((answer) => {
      const question = questionsById.get(answer.question?.toString());

      if (!question) {
        return;
      }

      const courseOutcome = toOutcomeKey(question.courseOutcome, "Unmapped CLO");
      const programOutcome = toOutcomeKey(question.programOutcome, "Unmapped SO");
      const performanceIndicator = toOutcomeKey(
        question.performanceIndicator,
        "",
      );
      const cepLevel = getQuestionCepLevel(question);
      const weight = Math.max(0, Number(question.outcomeWeight || 1));
      const studentKey = `exam:${exam.user || exam._id}`;
      const assessmentPhase = exam.assessmentPhase || "Summative";
      const traceBucket = ensureTraceabilityBucket(
        traceabilityMatrix,
        courseOutcome,
        programOutcome,
        settings,
      );

      if (!courseOutcomes.has(courseOutcome)) {
        courseOutcomes.set(
          courseOutcome,
          createOutcomeBucket(courseOutcome, settings.courseOutcomeTarget),
        );
      }
      const soBucket = ensureOutcomeBucket(
        programOutcomes,
        programOutcome,
        settings.studentOutcomeTarget,
      );
      recordTraceabilityQuestion(traceBucket, question);
      recordTraceabilityEvidence(traceBucket, {
        itemResult: answer,
        weight,
        studentKey,
        assessmentMethod: exam.assessmentMethod || DEFAULT_ASSESSMENT_METHOD,
        evidenceSource: `Online Exam: ${exam.title || "Generated Exam"}`,
      });

      [courseOutcomes.get(courseOutcome), programOutcomes.get(programOutcome)].forEach(
        (bucket) => {
          recordOutcomeResponse(
            bucket,
            answer,
            weight,
            studentKey,
            bucket === programOutcomes.get(programOutcome) ? assessmentPhase : "",
          );

          if (bucket === courseOutcomes.get(courseOutcome) && question.engineeringProgram) {
            bucket.programs.add(question.engineeringProgram);
          }
        },
      );
      if (performanceIndicator) {
        recordOutcomeResponse(
          ensureOutcomeBucket(
            soBucket.piBuckets,
            performanceIndicator,
              settings.studentOutcomeTarget,
            ),
            answer,
            weight,
            studentKey,
            assessmentPhase,
          );
      }
      recordOutcomeResponse(
        cepAttainment.get(cepLevel),
        answer,
        weight,
        studentKey,
      );
    });
  });

  analysisExams.forEach((analysisExam) => {
    const generatedQuestions = (analysisExam.generatedExamId?.questions || []).filter(
      (question) => questionMatchesObeFilters(question, filters),
    );
    const examResults = analysisResultsByExam.get(analysisExam._id.toString()) || [];

    generatedQuestions.forEach((question, index) => {
      const itemNo = index + 1;
      const courseOutcome = toOutcomeKey(question.courseOutcome, "Unmapped CLO");
      const programOutcome = toOutcomeKey(question.programOutcome, "Unmapped SO");
      const performanceIndicator = toOutcomeKey(
        question.performanceIndicator,
        "",
      );
      const cepLevel = getQuestionCepLevel(question);
      const weight = Math.max(0, Number(question.outcomeWeight || 1));
      const assessmentPhase =
        analysisExam.assessmentPhase ||
        analysisExam.generatedExamId?.assessmentPhase ||
        "Summative";
      const traceBucket = ensureTraceabilityBucket(
        traceabilityMatrix,
        courseOutcome,
        programOutcome,
        settings,
      );

      recordTraceabilityQuestion(traceBucket, question);

      if (!courseOutcomes.has(courseOutcome)) {
        courseOutcomes.set(
          courseOutcome,
          createOutcomeBucket(courseOutcome, settings.courseOutcomeTarget),
        );
      }
      const soBucket = ensureOutcomeBucket(
        programOutcomes,
        programOutcome,
        settings.studentOutcomeTarget,
      );

      examResults.forEach((result) => {
        const itemResult =
          (result.itemResults || []).find((item) => Number(item.itemNo) === itemNo) ||
          result.itemResults?.[index];
        const studentKey = `item-analysis:${result.studentId || result._id}`;

        recordTraceabilityEvidence(traceBucket, {
          itemResult,
          weight,
          studentKey,
          assessmentMethod:
            analysisExam.assessmentMethod ||
            analysisExam.generatedExamId?.assessmentMethod ||
            DEFAULT_ASSESSMENT_METHOD,
          evidenceSource: `Item Analysis: ${analysisExam.title || analysisExam.generatedExamId?.title || "Linked Exam"}`,
        });

        [courseOutcomes.get(courseOutcome), programOutcomes.get(programOutcome)].forEach(
          (bucket) => {
            recordOutcomeResponse(
              bucket,
              itemResult,
              weight,
              studentKey,
              bucket === programOutcomes.get(programOutcome) ? assessmentPhase : "",
            );

            if (
              bucket === courseOutcomes.get(courseOutcome) &&
              question.engineeringProgram
            ) {
              bucket.programs.add(question.engineeringProgram);
            }
          },
        );
        if (performanceIndicator) {
          recordOutcomeResponse(
            ensureOutcomeBucket(
              soBucket.piBuckets,
              performanceIndicator,
              settings.studentOutcomeTarget,
            ),
            itemResult,
            weight,
            studentKey,
            assessmentPhase,
          );
        }
        recordOutcomeResponse(
          cepAttainment.get(cepLevel),
          itemResult,
          weight,
          studentKey,
        );
      });
    });
  });

  rubricAssessments.forEach((assessment) => {
    (assessment.criteria || []).forEach((criterion, criterionIndex) => {
      const courseOutcome = toOutcomeKey(criterion.courseOutcome, "Unmapped CLO");
      const programOutcome = toOutcomeKey(criterion.programOutcome, "Unmapped SO");
      const performanceIndicator = toOutcomeKey(
        criterion.performanceIndicator,
        "",
      );
      const assessmentPhase = assessment.assessmentPhase || "Summative";
      const maxScore =
        Math.max(0, Number(criterion.maxScore || 0)) *
        Math.max(0, Number(criterion.weight || 1));
      const targetScore =
        Number(criterion.targetScore || 0) > 0
          ? Number(criterion.targetScore) * Math.max(0, Number(criterion.weight || 1))
          : maxScore * (Number(settings.courseOutcomeTarget ?? 75) / 100);
      const traceBucket = ensureTraceabilityBucket(
        traceabilityMatrix,
        courseOutcome,
        programOutcome,
        settings,
      );

      if (maxScore <= 0) {
        return;
      }

      if (!courseOutcomes.has(courseOutcome)) {
        courseOutcomes.set(
          courseOutcome,
          createOutcomeBucket(courseOutcome, settings.courseOutcomeTarget),
        );
      }
      const soBucket = ensureOutcomeBucket(
        programOutcomes,
        programOutcome,
        settings.studentOutcomeTarget,
      );
      if (assessment.engineeringProgram) {
        courseOutcomes.get(courseOutcome).programs.add(assessment.engineeringProgram);
        traceBucket.programs.add(assessment.engineeringProgram);
      }
      if (assessment.subject) {
        traceBucket.subjects.add(assessment.subject);
      }
      traceBucket.assessmentMethods.add(
        assessment.assessmentMethod || DEFAULT_ASSESSMENT_METHOD,
      );
      traceBucket.evidenceSources.add(`Rubric: ${assessment.title}`);

      (assessment.studentScores || []).forEach((student) => {
        const scoreRow = (student.criterionScores || []).find(
          (item) =>
            String(item.criterionId || "") === String(criterion._id) ||
            Number(item.criterionIndex) === criterionIndex,
        );
        const rawScore = Math.max(0, Number(scoreRow?.score || 0));
        const weightedScore =
          Math.min(rawScore, Number(criterion.maxScore || 0)) *
          Math.max(0, Number(criterion.weight || 1));
        const studentKey = `rubric:${assessment._id}:${student.studentId || student.studentName}`;

        recordOutcomeScore(
          courseOutcomes.get(courseOutcome),
          weightedScore,
          maxScore,
          studentKey,
          targetScore,
        );
        recordOutcomeScore(
          programOutcomes.get(programOutcome),
          weightedScore,
          maxScore,
          studentKey,
          targetScore,
          assessmentPhase,
        );
        if (performanceIndicator) {
          recordOutcomeScore(
            ensureOutcomeBucket(
              soBucket.piBuckets,
              performanceIndicator,
              settings.studentOutcomeTarget,
            ),
            weightedScore,
            maxScore,
            studentKey,
            targetScore,
            assessmentPhase,
          );
        }
        recordTraceabilityEvidence(traceBucket, {
          itemResult: { isCorrect: weightedScore >= targetScore },
          weight: maxScore,
          studentKey,
          assessmentMethod: assessment.assessmentMethod || DEFAULT_ASSESSMENT_METHOD,
          evidenceSource: `Rubric: ${assessment.title}`,
        });
        traceBucket.attainedWeight -= weightedScore >= targetScore ? maxScore : 0;
        traceBucket.attainedWeight += weightedScore;
      });
    });
  });

  const finalizeSingleBucket = (bucket) => {
        const studentScores = Array.from(bucket.studentScores?.values() || [])
          .filter((score) => Number(score.possibleWeight || 0) > 0);
        const attainedStudents = studentScores.filter((score) => {
          const rate =
            Number(score.possibleWeight || 0) > 0
              ? (Number(score.attainedWeight || 0) /
                  Number(score.possibleWeight || 0)) *
                100
              : 0;

          return rate >= Number(bucket.targetRate ?? 75);
        }).length;
        const responseAttainmentRate =
          bucket.possibleWeight > 0
            ? Math.round((bucket.attainedWeight / bucket.possibleWeight) * 1000) /
              10
            : 0;
        const studentAttainmentRate =
          studentScores.length > 0
            ? Math.round((attainedStudents / studentScores.length) * 1000) / 10
            : 0;

        const finalized = {
          ...bucket,
          programs: Array.from(bucket.programs || []).sort().join(", "),
          studentScores: undefined,
          assessedStudents: studentScores.length,
          attainedStudents,
          responseAttainmentRate,
          attainmentRate:
            settings.attainmentMethod === "student_based"
              ? studentAttainmentRate
              : responseAttainmentRate,
        };

        delete finalized.piBuckets;
        delete finalized.phaseBuckets;

        return finalized;
      };
  const finalizeBuckets = (buckets) =>
    Array.from(buckets.values())
      .map(finalizeSingleBucket)
      .sort((a, b) => a.code.localeCompare(b.code));
  const finalizeStudentOutcomeBuckets = (buckets) =>
    Array.from(buckets.values())
      .map((bucket) => {
        const finalized = finalizeSingleBucket(bucket);
        const piBreakdown = finalizeBuckets(bucket.piBuckets || new Map());
        const phaseBreakdown = finalizeBuckets(bucket.phaseBuckets || new Map())
          .map((phase) => ({
            ...phase,
            phase: phase.code,
          }));
        const phaseWeightedRate = weightedPhaseAttainment(phaseBreakdown, {
          evidenceKey: "possibleWeight",
        });
        const assessedPis = piBreakdown.filter(
          (pi) => Number(pi.assessedItems || 0) > 0,
        );

        if (phaseWeightedRate !== null) {
          finalized.attainmentRate = phaseWeightedRate;
        } else if (assessedPis.length > 0) {
          finalized.attainmentRate =
            Math.round(
              (assessedPis.reduce(
                (sum, pi) => sum + Number(pi.attainmentRate || 0),
                0,
              ) /
                assessedPis.length) *
                10,
            ) / 10;
        }

        finalized.piBreakdown = piBreakdown;
        finalized.phaseBreakdown = phaseBreakdown;

        return finalized;
      })
      .sort((a, b) => a.code.localeCompare(b.code));

  const courseOutcomeRows = finalizeBuckets(courseOutcomes);
  const programOutcomeRows = await attachStudentOutcomeIndicators(
    finalizeStudentOutcomeBuckets(programOutcomes),
  );
  const cepAttainmentRows = finalizeBuckets(cepAttainment).sort(
    (a, b) => CEP_LEVELS.indexOf(a.code) - CEP_LEVELS.indexOf(b.code),
  );
  const report = {
    settings,
    attainmentMethod: settings.attainmentMethod,
    attainmentMethodLabel: getAttainmentMethodLabel(settings.attainmentMethod),
    attainmentFormula: getAttainmentFormula(settings.attainmentMethod),
    alignedQuestions,
    unmappedQuestions: questions.length - alignedQuestions,
    alignmentRate:
      questions.length > 0
        ? Math.round((alignedQuestions / questions.length) * 1000) / 10
        : 0,
    courseOutcomes: courseOutcomeRows,
    programOutcomes: programOutcomeRows,
    cepAttainment: cepAttainmentRows,
    evidenceTraceabilityMatrix: finalizeTraceabilityRows(
      traceabilityMatrix,
      settings,
    ),
    bloomLevels: Array.from(bloomLevels.values()).sort((a, b) =>
      a.level.localeCompare(b.level),
    ),
  };

  report.courseLevelSummary = buildCourseLevelSummary(filters, report);

  return report;
};

const createTeacherSubmissionBucket = (user) => ({
  teacherId: user._id.toString(),
  teacherName: user.name || "Unnamed user",
  email: user.email || "",
  role: user.role || "",
  generatedExams: 0,
  linkedItemAnalysis: 0,
  itemAnalysisWithResults: 0,
  rubricAssessments: 0,
  evidenceRecords: 0,
  cqiPlans: 0,
  completedCqiPlans: 0,
  coSoAttainmentAvailable: false,
  status: "Missing Assessment Evidence",
});

const calculateTeacherObeSubmissionStatus = async (filters = {}) => {
  const users = await User.find({
    role: { $in: [...OBE_SUBMISSION_ROLES] },
    accountStatus: { $ne: "pending" },
  })
    .select("name email role")
    .sort({ name: 1, email: 1 })
    .lean();
  const userIds = users.map((user) => user._id);
  const buckets = new Map(
    users.map((user) => [user._id.toString(), createTeacherSubmissionBucket(user)]),
  );
  const examFilter = buildExamFilter(filters);
  const itemAnalysisFilter = buildItemAnalysisFilter(filters);
  const evidenceFilter = buildEvidenceFilter(filters);
  const [
    generatedExams,
    analysisExams,
    rubricAssessments,
    evidenceRecords,
    cqiPlans,
  ] = await Promise.all([
    Exam.find({ user: { $in: userIds }, ...examFilter })
      .select("user")
      .lean(),
    ItemAnalysisExam.find({
      uploadedBy: { $in: userIds },
      generatedExamId: { $ne: null },
      includeInObe: { $ne: false },
      ...itemAnalysisFilter,
    })
      .select("uploadedBy")
      .lean(),
    RubricAssessment.find({ createdBy: { $in: userIds }, ...examFilter })
      .select("createdBy")
      .lean(),
    ObeEvidence.find({ uploadedBy: { $in: userIds }, ...evidenceFilter })
      .select("uploadedBy")
      .lean(),
    CqiInterventionPlan.find({ createdBy: { $in: userIds } })
      .select("createdBy status")
      .lean(),
  ]);
  const analysisExamIds = analysisExams.map((exam) => exam._id);
  const analysisIdsWithResults = new Set(
    (
      analysisExamIds.length
        ? await ItemAnalysisStudentResult.distinct("analysisExamId", {
            analysisExamId: { $in: analysisExamIds },
          })
        : []
    ).map((id) => id.toString()),
  );

  generatedExams.forEach((exam) => {
    const bucket = buckets.get(exam.user?.toString());
    if (bucket) bucket.generatedExams++;
  });

  analysisExams.forEach((exam) => {
    const bucket = buckets.get(exam.uploadedBy?.toString());
    if (!bucket) return;

    bucket.linkedItemAnalysis++;
    if (analysisIdsWithResults.has(exam._id.toString())) {
      bucket.itemAnalysisWithResults++;
      bucket.coSoAttainmentAvailable = true;
    }
  });

  rubricAssessments.forEach((assessment) => {
    const bucket = buckets.get(assessment.createdBy?.toString());
    if (bucket) bucket.rubricAssessments++;
  });

  evidenceRecords.forEach((evidence) => {
    const bucket = buckets.get(evidence.uploadedBy?.toString());
    if (bucket) bucket.evidenceRecords++;
  });

  cqiPlans.forEach((plan) => {
    const bucket = buckets.get(plan.createdBy?.toString());
    if (!bucket) return;

    bucket.cqiPlans++;
    if (["Completed", "Verified"].includes(plan.status)) {
      bucket.completedCqiPlans++;
    }
  });

  buckets.forEach((bucket) => {
    if (bucket.generatedExams <= 0) {
      bucket.status = "No Generated Exam";
    } else if (bucket.linkedItemAnalysis <= 0 && bucket.rubricAssessments <= 0) {
      bucket.status = "Missing Assessment Evidence";
    } else if (!bucket.coSoAttainmentAvailable && bucket.rubricAssessments <= 0) {
      bucket.status = "Missing CO/SO Attainment";
    } else if (bucket.evidenceRecords <= 0) {
      bucket.status = "Missing Evidence Files";
    } else if (bucket.cqiPlans > 0 && bucket.completedCqiPlans < bucket.cqiPlans) {
      bucket.status = "CQI In Progress";
    } else {
      bucket.status = "Ready for Review";
    }
  });

  return Array.from(buckets.values()).sort(
    (a, b) =>
      a.status.localeCompare(b.status) ||
      a.teacherName.localeCompare(b.teacherName),
  );
};

const createCqiBucket = (code, targetRate) => ({
  code,
  targetRate,
  itemCount: 0,
  responseCount: 0,
  correctCount: 0,
  totalWeight: 0,
  earnedWeight: 0,
});

const ensureCqiBucket = (map, code, targetRate) => {
  if (!map.has(code)) {
    map.set(code, createCqiBucket(code, targetRate));
  }

  return map.get(code);
};

const finalizeCqiBucket = (bucket) => {
  const totalWeight = Number(bucket.totalWeight || 0);
  const attainmentRate =
    totalWeight > 0 ? Math.round((bucket.earnedWeight / totalWeight) * 100) : 0;

  return {
    ...bucket,
    totalWeight: Math.round(totalWeight * 100) / 100,
    earnedWeight: Math.round(Number(bucket.earnedWeight || 0) * 100) / 100,
    attainmentRate,
    status:
      totalWeight <= 0
        ? "Not assessed"
        : attainmentRate >= Number(bucket.targetRate ?? 75)
          ? "Attained"
          : "Not attained",
  };
};

const buildAutomaticCqiRecommendation = (bucket = {}, outcomeType = "CO") => {
  const targetRate = Number(bucket.targetRate ?? 75);
  const attainmentRate = Number(bucket.attainmentRate || 0);
  const gap = Math.max(0, targetRate - attainmentRate);
  const itemCount = Number(bucket.itemCount || 0);
  const responseCount = Number(bucket.responseCount || 0);
  const priority = gap >= 25 ? "High" : gap >= 10 ? "Medium" : "Low";
  const outcomeLabel = outcomeType === "SO" ? "student outcome" : "course outcome";
  const coverageConcern =
    itemCount < 3
      ? "limited assessment coverage"
      : responseCount < 10
        ? "limited student response evidence"
        : "low attainment against the target";

  if (itemCount < 3) {
    return {
      recommendationPriority: priority,
      recommendedRootCause: `Possible ${coverageConcern} for this ${outcomeLabel}.`,
      recommendedIntervention:
        "Add more mapped assessment items before the next evaluation cycle and verify that each item directly measures the outcome.",
      recommendedEvidence:
        "Updated TOS, mapped questions, generated exam, and item analysis result after reassessment.",
      recommendedAction:
        "Increase outcome coverage, then reassess with item analysis evidence.",
    };
  }

  if (gap >= 25) {
    return {
      recommendationPriority: priority,
      recommendedRootCause:
        "Major attainment gap suggests prerequisite or concept mastery issues.",
      recommendedIntervention:
        "Conduct targeted remediation, provide worked examples and practice items, then run a short reassessment focused on the weak outcome.",
      recommendedEvidence:
        "Remediation attendance, revised learning materials, reassessment scores, and comparison of pre/post item analysis.",
      recommendedAction:
        "Start a high-priority remediation plan and reassess the outcome.",
    };
  }

  if (gap >= 10) {
    return {
      recommendationPriority: priority,
      recommendedRootCause:
        "Moderate gap suggests item-level misconceptions or insufficient guided practice.",
      recommendedIntervention:
        "Review the weakest items with the class, add guided practice, and adjust the next assessment to include equivalent outcome-mapped items.",
      recommendedEvidence:
        "Class intervention notes, revised practice activity, and next item analysis report.",
      recommendedAction:
        "Review weak items and add guided practice before the next assessment.",
    };
  }

  return {
    recommendationPriority: priority,
    recommendedRootCause:
      "Outcome is slightly below target and should be monitored in the next cycle.",
    recommendedIntervention:
      "Provide quick feedback on missed concepts and keep the outcome mapped in the next assessment.",
    recommendedEvidence:
      "Feedback record and follow-up item analysis for the same outcome.",
    recommendedAction:
      "Monitor the outcome and collect follow-up evidence in the next assessment.",
  };
};

const calculateCqiMonitoringReport = async (filters = {}) => {
  const itemAnalysisFilter = buildItemAnalysisFilter(filters);
  const [settings, plans, analysisExams] = await Promise.all([
    getObeSettings(),
    CqiInterventionPlan.find()
      .populate("analysisExamId", "title subject section semester schoolYear")
      .populate("updatedBy", "name email")
      .sort({ updatedAt: -1 })
      .lean(),
    ItemAnalysisExam.find({
      generatedExamId: { $ne: null },
      includeInObe: { $ne: false },
      ...itemAnalysisFilter,
    })
      .select("title subject section semester schoolYear generatedExamId")
      .populate({
        path: "generatedExamId",
        select: "engineeringProgram subject questions",
        populate: {
          path: "questions",
          select: "subject engineeringProgram courseOutcome programOutcome performanceIndicator outcomeWeight",
        },
      })
      .sort({ updatedAt: -1 })
      .lean(),
  ]);
  const filteredAnalysisExamIds = new Set(
    analysisExams.map((exam) => exam._id.toString()),
  );
  const filteredPlans = plans.filter(
    (plan) =>
      !plan.analysisExamId ||
      filteredAnalysisExamIds.has(String(plan.analysisExamId?._id || plan.analysisExamId)),
  );
  const results = await ItemAnalysisStudentResult.find({
    analysisExamId: { $in: analysisExams.map((exam) => exam._id) },
  })
    .select("analysisExamId itemResults")
    .lean();
  const resultsByExam = new Map();

  results.forEach((result) => {
    const key = result.analysisExamId.toString();
    const rows = resultsByExam.get(key) || [];

    rows.push(result);
    resultsByExam.set(key, rows);
  });

  const planKeys = new Set(
    filteredPlans.map(
      (plan) =>
        `${plan.analysisExamId?._id || plan.analysisExamId}|||${plan.outcomeType}|||${plan.outcomeCode}`,
    ),
  );
  const neededPlans = [];

  analysisExams.forEach((analysisExam) => {
    const generatedQuestions = (analysisExam.generatedExamId?.questions || []).filter(
      (question) => questionMatchesObeFilters(question, filters),
    );
    const examResults = resultsByExam.get(analysisExam._id.toString()) || [];
    const courseOutcomes = new Map();
    const studentOutcomes = new Map();
    const performanceIndicators = new Map();

    generatedQuestions.forEach((question, index) => {
      const itemNo = index + 1;
      const weight = Math.max(0, Number(question.outcomeWeight || 1));
      const courseOutcome = question.courseOutcome || "Unmapped CLO";
      const studentOutcome = question.programOutcome || "Unmapped SO";
      const performanceIndicator = question.performanceIndicator
        ? `${studentOutcome} - ${question.performanceIndicator}`
        : "";

      ensureCqiBucket(
        courseOutcomes,
        courseOutcome,
        settings.courseOutcomeTarget,
      ).itemCount += 1;
      ensureCqiBucket(
        studentOutcomes,
        studentOutcome,
        settings.studentOutcomeTarget,
      ).itemCount += 1;
      if (performanceIndicator) {
        ensureCqiBucket(
          performanceIndicators,
          performanceIndicator,
          settings.studentOutcomeTarget,
        ).itemCount += 1;
      }

      examResults.forEach((result) => {
        const itemResult =
          (result.itemResults || []).find((item) => Number(item.itemNo) === itemNo) ||
          result.itemResults?.[index];

        const buckets = [
          ensureCqiBucket(
            courseOutcomes,
            courseOutcome,
            settings.courseOutcomeTarget,
          ),
          ensureCqiBucket(
            studentOutcomes,
            studentOutcome,
            settings.studentOutcomeTarget,
          ),
        ];

        if (performanceIndicator) {
          buckets.push(
            ensureCqiBucket(
              performanceIndicators,
              performanceIndicator,
              settings.studentOutcomeTarget,
            ),
          );
        }

        buckets.forEach((bucket) => {
          bucket.responseCount += 1;
          bucket.totalWeight += weight;

          if (itemResult?.isCorrect) {
            bucket.correctCount += 1;
            bucket.earnedWeight += weight;
          }
        });
      });
    });

    [
      ["CO", courseOutcomes],
      ["SO", studentOutcomes],
      ["PI", performanceIndicators],
    ].forEach(([outcomeType, buckets]) => {
      Array.from(buckets.values())
        .map(finalizeCqiBucket)
        .filter((bucket) => bucket.status === "Not attained")
        .forEach((bucket) => {
          const key = `${analysisExam._id}|||${outcomeType}|||${bucket.code}`;

          if (!planKeys.has(key)) {
            const recommendation = buildAutomaticCqiRecommendation(
              bucket,
              outcomeType,
            );

            neededPlans.push({
              analysisExamId: analysisExam._id,
              examTitle: analysisExam.title,
              subject: analysisExam.subject,
              section: analysisExam.section,
              semester: analysisExam.semester,
              schoolYear: analysisExam.schoolYear,
              outcomeType,
              outcomeCode: bucket.code,
              targetRate: bucket.targetRate,
              attainmentRate: bucket.attainmentRate,
              gap: Math.max(0, bucket.targetRate - bucket.attainmentRate),
              itemCount: bucket.itemCount,
              responseCount: bucket.responseCount,
              correctCount: bucket.correctCount,
              ...recommendation,
            });
          }
        });
    });
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const statusCounts = filteredPlans.reduce((counts, plan) => {
    counts[plan.status] = (counts[plan.status] || 0) + 1;
    return counts;
  }, {});
  const isOpenPlan = (plan) => !["Completed", "Verified"].includes(plan.status);
  const overduePlans = filteredPlans.filter(
    (plan) => plan.targetDate && isOpenPlan(plan) && new Date(plan.targetDate) < today,
  );
  const dueSoonDate = new Date(today);
  dueSoonDate.setDate(dueSoonDate.getDate() + 7);
  const dueSoonPlans = filteredPlans.filter((plan) => {
    if (!plan.targetDate || !isOpenPlan(plan)) return false;
    const targetDate = new Date(plan.targetDate);

    return targetDate >= today && targetDate <= dueSoonDate;
  });

  const sortedNeededPlans = neededPlans.sort((a, b) => b.gap - a.gap);

  return {
    totalPlans: filteredPlans.length,
    openPlans: filteredPlans.filter(isOpenPlan).length,
    completedPlans: statusCounts.Completed || 0,
    verifiedPlans: statusCounts.Verified || 0,
    overduePlans: overduePlans.length,
    dueSoonPlans: dueSoonPlans.length,
    neededPlans: neededPlans.length,
    statusCounts: {
      planned: statusCounts.Planned || 0,
      inProgress: statusCounts["In Progress"] || 0,
      completed: statusCounts.Completed || 0,
      verified: statusCounts.Verified || 0,
    },
    neededPlanRows: sortedNeededPlans.slice(0, 10),
    neededPlanRowsAll: sortedNeededPlans,
    recommendationRows: sortedNeededPlans.slice(0, 10),
    overduePlanRows: overduePlans.slice(0, 10),
    recentPlans: filteredPlans.slice(0, 10),
    allPlans: filteredPlans,
  };
};

const createAssessmentMethodRows = (generatedCounts, evidenceCounts) =>
  ASSESSMENT_METHODS.map((method) => {
    const generatedExams = generatedCounts.get(method) || 0;
    const itemAnalysisEvidence = evidenceCounts.get(method) || 0;

    return {
      method,
      generatedExams,
      itemAnalysisEvidence,
      totalEvidence: generatedExams + itemAnalysisEvidence,
    };
  });

const countByAssessmentMethod = (rows) =>
  rows.reduce((counts, row) => {
    const method = row.assessmentMethod || DEFAULT_ASSESSMENT_METHOD;
    counts.set(method, (counts.get(method) || 0) + 1);
    return counts;
  }, new Map());

const calculateAssessmentMethodReport = async (filters = {}) => {
  const examFilter = buildExamFilter(filters);
  const itemAnalysisFilter = buildItemAnalysisFilter(filters);
  const [exams, itemAnalysisExams] = await Promise.all([
    Exam.find(examFilter).select("assessmentMethod").lean(),
    ItemAnalysisExam.find(itemAnalysisFilter).select("assessmentMethod").lean(),
  ]);
  const generatedCounts = countByAssessmentMethod(exams);
  const evidenceCounts = countByAssessmentMethod(itemAnalysisExams);
  const rows = createAssessmentMethodRows(generatedCounts, evidenceCounts);
  const totalGeneratedExams = exams.length;
  const totalItemAnalysisEvidence = itemAnalysisExams.length;
  const methodsUsed = rows.filter((row) => row.totalEvidence > 0).length;

  return {
    rows,
    methodsUsed,
    totalMethods: ASSESSMENT_METHODS.length,
    totalGeneratedExams,
    totalItemAnalysisEvidence,
    examOnly:
      totalItemAnalysisEvidence > 0
        ? Math.round(
            ((evidenceCounts.get("Major Exam") || 0) /
              totalItemAnalysisEvidence) *
              100,
          )
        : 0,
  };
};

const getCqiMatrixKey = (outcomeType, outcomeCode) =>
  `${String(outcomeType || "").toUpperCase()}|||${String(outcomeCode || "").trim().toLowerCase()}`;

const applyCqiStatusToTraceabilityMatrix = (rows = [], cqiReport = {}) => {
  const planStatuses = new Map();
  const neededStatuses = new Set();

  (cqiReport.allPlans || []).forEach((plan) => {
    const key = getCqiMatrixKey(plan.outcomeType, plan.outcomeCode);
    const status = plan.status || "Planned";

    if (key.trim() !== "|||") {
      planStatuses.set(key, status);
    }
  });

  (cqiReport.neededPlanRowsAll || cqiReport.neededPlanRows || []).forEach(
    (plan) => {
      neededStatuses.add(getCqiMatrixKey(plan.outcomeType, plan.outcomeCode));
    },
  );

  return rows.map((row) => {
    const coKey = getCqiMatrixKey("CO", row.courseOutcome);
    const soKey = getCqiMatrixKey("SO", row.programOutcome);
    const statuses = [
      planStatuses.has(coKey)
        ? `CO: ${planStatuses.get(coKey)}`
        : neededStatuses.has(coKey)
          ? "CO: Needs CQI"
          : "",
      planStatuses.has(soKey)
        ? `SO: ${planStatuses.get(soKey)}`
        : neededStatuses.has(soKey)
          ? "SO: Needs CQI"
          : "",
    ].filter(Boolean);

    return {
      ...row,
      cqiStatus:
        statuses.length > 0
          ? statuses.join(" | ")
          : row.status === "Not Attained"
            ? "Needs CQI"
            : "No CQI Required",
    };
  });
};

const calculateCurriculumMapExport = async (filters = {}) => {
  const courseFilter = {};
  const questionMatch = buildQuestionFilter(filters);

  if (filters.subject) {
    courseFilter.subject = exactTextFilter(filters.subject);
  }

  const [peos, studentOutcomes, courseOutcomes, questionCoverage] =
    await Promise.all([
      ProgramEducationalObjective.find()
        .select("department code description performanceIndicators")
        .sort({ department: 1, code: 1 })
        .lean(),
      StudentOutcome.find()
        .select("department code description graduateAttributes peoLinks")
        .sort({ department: 1, code: 1 })
        .lean(),
      CourseOutcome.find(courseFilter)
        .select("department subject code description programOutcome bloomLevel keywords")
        .sort({ department: 1, subject: 1, code: 1 })
        .lean(),
      Question.aggregate([
        { $match: questionMatch },
        {
          $group: {
            _id: {
              subject: "$subject",
              courseOutcome: "$courseOutcome",
            },
            questionCount: { $sum: 1 },
            bloomLevels: { $addToSet: "$bloomLevel" },
          },
        },
      ]),
    ]);
  const coverageByCourse = new Map();

  questionCoverage.forEach((item) => {
    coverageByCourse.set(`${item._id.subject}|||${item._id.courseOutcome}`, {
      questionCount: item.questionCount,
      bloomLevels: (item.bloomLevels || []).filter(Boolean).sort().join(", "),
    });
  });

  return {
    peos,
    studentOutcomes,
    courseOutcomes: courseOutcomes.map((outcome) => {
      const coverage =
        coverageByCourse.get(`${outcome.subject}|||${outcome.code}`) || {};

      return {
        ...outcome,
        questionCount: coverage.questionCount || 0,
        coveredBloomLevels: coverage.bloomLevels || "",
      };
    }),
  };
};

const calculateOutcomeCoverageAlerts = async (
  obeReport = {},
  cqiReport = {},
  filters = {},
) => {
  const courseFilter = {};
  const questionMatch = buildQuestionFilter(filters);

  if (filters.subject) {
    courseFilter.subject = exactTextFilter(filters.subject);
  }

  const [courseOutcomes, studentOutcomes, questionCoverage] = await Promise.all([
    CourseOutcome.find(courseFilter)
      .select("department subject code description programOutcome bloomLevel")
      .lean(),
    StudentOutcome.find()
      .select("department code description peoLinks")
      .lean(),
    Question.aggregate([
      { $match: questionMatch },
      {
        $group: {
          _id: {
            subject: "$subject",
            courseOutcome: "$courseOutcome",
          },
          questionCount: { $sum: 1 },
          bloomLevels: { $addToSet: "$bloomLevel" },
        },
      },
    ]),
  ]);
  const alerts = [];
  const assessedCloByCode = new Map(
    (obeReport.courseOutcomes || []).map((row) => [
      normalizeOutcomeCode(row.code),
      row,
    ]),
  );
  const assessedSoByCode = new Map(
    (obeReport.programOutcomes || []).map((row) => [
      normalizeOutcomeCode(row.code),
      row,
    ]),
  );
  const questionCoverageByCourse = new Map();
  const linkedStudentOutcomes = new Set();
  const unmappedBloomCount =
    (obeReport.bloomLevels || []).find((row) => row.level === "Unmapped Bloom")
      ?.questionCount || 0;

  questionCoverage.forEach((item) => {
    questionCoverageByCourse.set(
      `${item._id.subject}|||${item._id.courseOutcome}`,
      {
        questionCount: item.questionCount,
        bloomLevels: (item.bloomLevels || []).filter(Boolean),
      },
    );
  });

  if (Number(obeReport.unmappedQuestions || 0) > 0) {
    alerts.push(
      createCoverageAlert({
        severity: "High",
        area: "Question Mapping",
        item: "Question Bank",
        issue: `${obeReport.unmappedQuestions} question(s) are missing complete CLO/SO mapping.`,
        action: "Complete CLO and SO tags before using these items as OBE evidence.",
        evidenceCount: obeReport.unmappedQuestions,
      }),
    );
  }

  if (unmappedBloomCount > 0) {
    alerts.push(
      createCoverageAlert({
        severity: "Medium",
        area: "Bloom Mapping",
        item: "Question Bank",
        issue: `${unmappedBloomCount} question(s) are missing Bloom level tags.`,
        action: "Assign Bloom levels so cognitive coverage can be defended in reports.",
        evidenceCount: unmappedBloomCount,
      }),
    );
  }

  courseOutcomes.forEach((outcome) => {
    const coverage =
      questionCoverageByCourse.get(`${outcome.subject}|||${outcome.code}`) || {};
    const questionCount = Number(coverage.questionCount || 0);
    const assessed = assessedCloByCode.get(normalizeOutcomeCode(outcome.code));
    const label = `${outcome.subject || "No subject"} - ${outcome.code}`;

    parseOutcomeLinks(outcome.programOutcome).forEach((code) => {
      linkedStudentOutcomes.add(`${String(outcome.department || "").toLowerCase()}|||${code}`);
      linkedStudentOutcomes.add(`*|||${code}`);
    });

    if (questionCount <= 0) {
      alerts.push(
        createCoverageAlert({
          severity: "High",
          area: "CLO Coverage",
          item: label,
          issue: "This CLO has no question-bank items.",
          action: "Add or map assessment items to this CLO.",
          evidenceCount: 0,
        }),
      );
      return;
    }

    if (questionCount < MIN_OUTCOME_QUESTION_COVERAGE) {
      alerts.push(
        createCoverageAlert({
          severity: "Medium",
          area: "CLO Coverage",
          item: label,
          issue: `This CLO has only ${questionCount} question-bank item(s).`,
          action: `Prepare at least ${MIN_OUTCOME_QUESTION_COVERAGE} mapped items for stronger evidence.`,
          evidenceCount: questionCount,
        }),
      );
    }

    if (!assessed || Number(assessed.assessedItems || 0) <= 0) {
      alerts.push(
        createCoverageAlert({
          severity: "Medium",
          area: "CLO Evidence",
          item: label,
          issue: "This CLO has mapped items but no assessed responses yet.",
          action: "Use the mapped items in an exam and submit/item-analyze results.",
          evidenceCount: questionCount,
        }),
      );
    }
  });

  studentOutcomes.forEach((outcome) => {
    const normalizedCode = normalizeOutcomeCode(outcome.code);
    const departmentKey = `${String(outcome.department || "").toLowerCase()}|||${normalizedCode}`;
    const assessed = assessedSoByCode.get(normalizedCode);
    const label = `${outcome.department || "No department"} - ${outcome.code}`;

    if (
      !linkedStudentOutcomes.has(departmentKey) &&
      !linkedStudentOutcomes.has(`*|||${normalizedCode}`)
    ) {
      alerts.push(
        createCoverageAlert({
          severity: "High",
          area: "SO Linkage",
          item: label,
          issue: "This SO has no linked CLO.",
          action: "Map at least one CLO to this SO in OBE Management.",
          evidenceCount: 0,
        }),
      );
    }

    if (!assessed || Number(assessed.questionCount || 0) <= 0) {
      alerts.push(
        createCoverageAlert({
          severity: "High",
          area: "SO Coverage",
          item: label,
          issue: "This SO has no question-bank evidence.",
          action: "Map CLOs/questions that measure this SO.",
          evidenceCount: 0,
        }),
      );
      return;
    }

    if (Number(assessed.assessedItems || 0) <= 0) {
      alerts.push(
        createCoverageAlert({
          severity: "Medium",
          area: "SO Evidence",
          item: label,
          issue: "This SO has mapped questions but no assessed responses yet.",
          action: "Use these mapped items in an assessment and encode results.",
          evidenceCount: assessed.questionCount,
        }),
      );
    }
  });

  (cqiReport.neededPlanRowsAll || cqiReport.neededPlanRows || []).forEach((row) => {
    alerts.push(
      createCoverageAlert({
        severity: "Critical",
        area: "CQI",
        item: `${row.outcomeType} ${row.outcomeCode}`,
        issue: `${row.examTitle || "Assessment"} did not meet the ${row.targetRate}% target and has no CQI plan.`,
        action: "Create a CQI intervention plan and record follow-up evidence.",
        evidenceCount: `${row.attainmentRate}%`,
      }),
    );
  });

  if (Number(cqiReport.overduePlans || 0) > 0) {
    alerts.push(
      createCoverageAlert({
        severity: "High",
        area: "CQI",
        item: "Overdue Plans",
        issue: `${cqiReport.overduePlans} CQI plan(s) are past the target date.`,
        action: "Update implementation status, reassessment result, or target date.",
        evidenceCount: cqiReport.overduePlans,
      }),
    );
  }

  const severityOrder = { Critical: 0, High: 1, Medium: 2, Low: 3 };
  const sortedAlerts = alerts.sort(
    (a, b) =>
      (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9) ||
      a.area.localeCompare(b.area) ||
      a.item.localeCompare(b.item),
  );

  return {
    totalAlerts: sortedAlerts.length,
    criticalAlerts: sortedAlerts.filter((alert) => alert.severity === "Critical")
      .length,
    highAlerts: sortedAlerts.filter((alert) => alert.severity === "High").length,
    mediumAlerts: sortedAlerts.filter((alert) => alert.severity === "Medium")
      .length,
    minimumQuestionCoverage: MIN_OUTCOME_QUESTION_COVERAGE,
    alerts: sortedAlerts,
  };
};

const buildAccreditationObeWorkbook = async (report) => {
  const workbook = new ExcelJS.Workbook();
  const generatedAt = new Date();
  const filters = report.filters || {};
  const curriculumMap = await calculateCurriculumMapExport(filters);
  const obeReport = report.obeReport || {};
  const cqiReport = report.cqiReport || {};
  const assessmentMethodReport = report.assessmentMethodReport || {};
  const outcomeCoverageAlerts = report.outcomeCoverageAlerts || {};

  workbook.creator = "Question Bank System";
  workbook.created = generatedAt;
  workbook.modified = generatedAt;

  addRowsWorksheet(
    workbook,
    "Report Summary",
    [
      { header: "Metric", key: "metric", width: 34 },
      { header: "Value", key: "value", width: 24 },
      { header: "Notes", key: "notes", width: 56 },
    ],
    [
      {
        metric: "Report Type",
        value: "Accreditation OBE Report",
        notes: "Combined OBE alignment, attainment, CQI, and curriculum mapping evidence.",
      },
      {
        metric: "Generated At",
        value: generatedAt.toLocaleString(),
        notes: "Generated from current system records.",
      },
      {
        metric: "Report Filters",
        value: formatFilterSummary(filters),
        notes: "Filters applied to OBE evidence and export tables.",
      },
      {
        metric: "Total Questions",
        value: report.totalQuestions,
        notes: "Approved question-bank items.",
      },
      {
        metric: "Aligned Questions",
        value: obeReport.alignedQuestions || 0,
        notes: `${obeReport.alignmentRate || 0}% have both CLO and SO mapping.`,
      },
      {
        metric: "Unmapped Questions",
        value: obeReport.unmappedQuestions || 0,
        notes: "Questions needing complete OBE tags.",
      },
      {
        metric: "Generated Exams",
        value: report.totalExams,
        notes: `${report.submittedExams} submitted, ${report.pendingExams} pending.`,
      },
      {
        metric: "CLO Target",
        value: `${obeReport.settings?.courseOutcomeTarget ?? 75}%`,
        notes: "Configured OBE setting.",
      },
      {
        metric: "SO Target",
        value: `${obeReport.settings?.studentOutcomeTarget ?? 75}%`,
        notes: "Configured OBE setting.",
      },
      {
        metric: "Attainment Method",
        value: obeReport.attainmentMethodLabel || "Response-based",
        notes:
          obeReport.attainmentFormula ||
          "Correct mapped responses / Total mapped responses",
      },
      {
        metric: "Course-Level OBE Status",
        value: obeReport.courseLevelSummary?.status || "No Evidence",
        notes: `${obeReport.courseLevelSummary?.overallAttainmentRate || 0}% overall attainment for ${obeReport.courseLevelSummary?.subject || "selected records"}.`,
      },
      {
        metric: "CQI Plans Needed",
        value: cqiReport.neededPlans || 0,
        notes: "Not-attained outcomes without recorded CQI plans.",
      },
      {
        metric: "Outcome Coverage Alerts",
        value: outcomeCoverageAlerts.totalAlerts || 0,
        notes: `${outcomeCoverageAlerts.criticalAlerts || 0} critical, ${outcomeCoverageAlerts.highAlerts || 0} high, ${outcomeCoverageAlerts.mediumAlerts || 0} medium.`,
      },
      {
        metric: "Open CQI Plans",
        value: cqiReport.openPlans || 0,
        notes: "Planned or in-progress interventions.",
      },
      {
        metric: "Verified CQI Plans",
        value: cqiReport.verifiedPlans || 0,
        notes: "Closed-loop interventions.",
      },
    ],
  );

  addRowsWorksheet(
    workbook,
    "Course OBE Summary",
    [
      { header: "Program", key: "program", width: 18 },
      { header: "Subject", key: "subject", width: 24 },
      { header: "Section", key: "section", width: 18 },
      { header: "Term", key: "semester", width: 20 },
      { header: "School Year", key: "schoolYear", width: 18 },
      { header: "Assessment Method", key: "assessmentMethod", width: 20 },
      { header: "CLO Attained", key: "cloSummary", width: 16 },
      { header: "CLO Average %", key: "cloAverage", width: 16 },
      { header: "SO Attained", key: "soSummary", width: 16 },
      { header: "SO Average %", key: "soAverage", width: 16 },
      { header: "Overall Attainment %", key: "overallAttainmentRate", width: 22 },
      { header: "Target %", key: "targetRate", width: 12 },
      { header: "Status", key: "status", width: 20 },
    ],
    obeReport.courseLevelSummary ? [obeReport.courseLevelSummary] : [],
  );

  addRowsWorksheet(
    workbook,
    "Evidence Traceability",
    [
      { header: "Program", key: "program", width: 18 },
      { header: "Subject", key: "subject", width: 24 },
      { header: "CLO", key: "courseOutcome", width: 16 },
      { header: "SO", key: "programOutcome", width: 16 },
      { header: "Question Bank Items", key: "questionCount", width: 22 },
      { header: "Assessment Method", key: "assessmentMethods", width: 24 },
      { header: "Evidence Source", key: "evidenceSources", width: 48 },
      { header: "Assessed Responses", key: "assessedItems", width: 22 },
      { header: "Correct Responses", key: "correctItems", width: 22 },
      { header: "Students Assessed", key: "assessedStudents", width: 20 },
      { header: "Students Attained", key: "attainedStudents", width: 20 },
      { header: "Response Attainment %", key: "responseAttainmentRate", width: 24 },
      { header: "Target %", key: "targetRate", width: 14 },
      { header: "Attainment %", key: "attainmentRate", width: 16 },
      { header: "Attainment Status", key: "status", width: 20 },
      { header: "CQI Status", key: "cqiStatus", width: 28 },
    ],
    obeReport.evidenceTraceabilityMatrix || [],
  );

  addRowsWorksheet(
    workbook,
    "CLO Attainment",
    [
      { header: "CLO", key: "code", width: 18 },
      { header: "Program", key: "programs", width: 18 },
      { header: "Question Bank Items", key: "questionCount", width: 22 },
      { header: "Assessed Responses", key: "assessedItems", width: 22 },
      { header: "Correct Responses", key: "correctItems", width: 22 },
      { header: "Students Assessed", key: "assessedStudents", width: 20 },
      { header: "Students Attained", key: "attainedStudents", width: 20 },
      { header: "Possible Weight", key: "possibleWeight", width: 18 },
      { header: "Attained Weight", key: "attainedWeight", width: 18 },
      { header: "Response Attainment %", key: "responseAttainmentRate", width: 24 },
      { header: "Target %", key: "targetRate", width: 14 },
      { header: "Attainment %", key: "attainmentRate", width: 16 },
      { header: "Status", key: "status", width: 16 },
    ],
    (obeReport.courseOutcomes || []).map((row) => ({
      ...row,
      status:
        Number(row.attainmentRate || 0) >= Number(row.targetRate ?? 75)
          ? "Attained"
          : "Not attained",
    })),
  );

  addRowsWorksheet(
    workbook,
    "SO Attainment",
    [
      { header: "SO", key: "code", width: 18 },
      { header: "Performance Indicators", key: "performanceIndicators", width: 46 },
      { header: "Phase Breakdown", key: "phaseBreakdownText", width: 34 },
      { header: "PI Attainment Breakdown", key: "piBreakdownText", width: 46 },
      { header: "Question Bank Items", key: "questionCount", width: 22 },
      { header: "Assessed Responses", key: "assessedItems", width: 22 },
      { header: "Correct Responses", key: "correctItems", width: 22 },
      { header: "Students Assessed", key: "assessedStudents", width: 20 },
      { header: "Students Attained", key: "attainedStudents", width: 20 },
      { header: "Possible Weight", key: "possibleWeight", width: 18 },
      { header: "Attained Weight", key: "attainedWeight", width: 18 },
      { header: "Response Attainment %", key: "responseAttainmentRate", width: 24 },
      { header: "Target %", key: "targetRate", width: 14 },
      { header: "Attainment %", key: "attainmentRate", width: 16 },
      { header: "Status", key: "status", width: 16 },
    ],
    (obeReport.programOutcomes || []).map((row) => ({
      ...row,
      piBreakdownText: (row.piBreakdown || [])
        .map(
          (pi) =>
            `${pi.code}: ${pi.attainmentRate || 0}% (${pi.status || "No Evidence"})`,
        )
        .join("\n"),
      phaseBreakdownText: (row.phaseBreakdown || [])
        .map((phase) => `${phase.phase || phase.code}: ${phase.attainmentRate || 0}%`)
        .join("\n"),
      status:
        Number(row.attainmentRate || 0) >= Number(row.targetRate ?? 75)
          ? "Attained"
          : "Not attained",
    })),
  );

  addRowsWorksheet(
    workbook,
    "Bloom Distribution",
    [
      { header: "Bloom Level", key: "level", width: 22 },
      { header: "Question Bank Items", key: "questionCount", width: 24 },
    ],
    obeReport.bloomLevels || [],
  );

  addRowsWorksheet(
    workbook,
    "Outcome Coverage Alerts",
    [
      { header: "Severity", key: "severity", width: 16 },
      { header: "Area", key: "area", width: 22 },
      { header: "Item", key: "item", width: 32 },
      { header: "Issue", key: "issue", width: 58 },
      { header: "Recommended Action", key: "action", width: 58 },
      { header: "Evidence Count", key: "evidenceCount", width: 18 },
    ],
    outcomeCoverageAlerts.alerts || [],
  );

  addRowsWorksheet(
    workbook,
    "Assessment Methods",
    [
      { header: "Assessment Method", key: "method", width: 26 },
      { header: "Generated Assessments", key: "generatedExams", width: 24 },
      { header: "Analyzed Evidence", key: "itemAnalysisEvidence", width: 22 },
      { header: "Total Evidence", key: "totalEvidence", width: 18 },
    ],
    assessmentMethodReport.rows || [],
  );

  addRowsWorksheet(
    workbook,
    "CQI Needed",
    [
      { header: "Exam", key: "examTitle", width: 30 },
      { header: "Subject", key: "subject", width: 24 },
      { header: "Section", key: "section", width: 18 },
      { header: "Semester", key: "semester", width: 18 },
      { header: "School Year", key: "schoolYear", width: 18 },
      { header: "Outcome Type", key: "outcomeType", width: 16 },
      { header: "Outcome Code", key: "outcomeCode", width: 18 },
      { header: "Target %", key: "targetRate", width: 14 },
      { header: "Attainment %", key: "attainmentRate", width: 16 },
      { header: "Gap %", key: "gap", width: 12 },
      { header: "Recommendation Priority", key: "recommendationPriority", width: 24 },
      { header: "Probable Root Cause", key: "recommendedRootCause", width: 42 },
      { header: "Recommended Action", key: "recommendedAction", width: 44 },
      { header: "Recommended Intervention", key: "recommendedIntervention", width: 58 },
      { header: "Evidence to Collect", key: "recommendedEvidence", width: 52 },
    ],
    cqiReport.neededPlanRowsAll || cqiReport.neededPlanRows || [],
  );

  addRowsWorksheet(
    workbook,
    "CQI Plans",
    [
      { header: "Exam", key: "examTitle", width: 30 },
      { header: "Subject", key: "subject", width: 22 },
      { header: "Section", key: "section", width: 16 },
      { header: "Outcome Type", key: "outcomeType", width: 16 },
      { header: "Outcome Code", key: "outcomeCode", width: 18 },
      { header: "Status", key: "status", width: 16 },
      { header: "Root Cause", key: "rootCause", width: 32 },
      { header: "Intervention", key: "intervention", width: 42 },
      { header: "Responsible Person", key: "responsiblePerson", width: 24 },
      { header: "Target Date", key: "targetDate", width: 16 },
      { header: "Evidence", key: "evidence", width: 32 },
      { header: "Implementation Date", key: "implementationDate", width: 22 },
      { header: "Reassessment Result", key: "reassessmentResult", width: 36 },
      { header: "Follow-up Decision", key: "followUpDecision", width: 22 },
      { header: "Verified Date", key: "verifiedAt", width: 16 },
      { header: "Updated By", key: "updatedBy", width: 28 },
    ],
    (cqiReport.allPlans || cqiReport.recentPlans || []).map((plan) => ({
      examTitle: plan.analysisExamId?.title || "",
      subject: plan.analysisExamId?.subject || "",
      section: plan.analysisExamId?.section || "",
      outcomeType: plan.outcomeType,
      outcomeCode: plan.outcomeCode,
      status: plan.status,
      rootCause: plan.rootCause,
      intervention: plan.intervention,
      responsiblePerson: plan.responsiblePerson,
      targetDate: formatExportDate(plan.targetDate),
      evidence: plan.evidence,
      implementationDate: formatExportDate(plan.implementationDate),
      reassessmentResult: plan.reassessmentResult,
      followUpDecision: plan.followUpDecision,
      verifiedAt: formatExportDate(plan.verifiedAt),
      updatedBy:
        [plan.updatedBy?.name, plan.updatedBy?.email].filter(Boolean).join(" / ") ||
        "",
    })),
  );

  addRowsWorksheet(
    workbook,
    "Curriculum Map",
    [
      { header: "Department", key: "department", width: 20 },
      { header: "Subject", key: "subject", width: 24 },
      { header: "CLO", key: "code", width: 14 },
      { header: "CLO Description", key: "description", width: 48 },
      { header: "Linked SO", key: "programOutcome", width: 18 },
      { header: "Bloom Level", key: "bloomLevel", width: 18 },
      { header: "Keywords", key: "keywords", width: 28 },
      { header: "Question Coverage", key: "questionCount", width: 20 },
      { header: "Covered Bloom Levels", key: "coveredBloomLevels", width: 28 },
    ],
    curriculumMap.courseOutcomes,
  );

  addRowsWorksheet(
    workbook,
    "Student Outcomes",
    [
      { header: "Department", key: "department", width: 20 },
      { header: "SO", key: "code", width: 14 },
      { header: "Description", key: "description", width: 52 },
      { header: "Graduate Attributes", key: "graduateAttributes", width: 30 },
      { header: "Linked PEO", key: "peoLinks", width: 20 },
    ],
    curriculumMap.studentOutcomes,
  );

  addRowsWorksheet(
    workbook,
    "PEO",
    [
      { header: "Department", key: "department", width: 20 },
      { header: "PEO", key: "code", width: 14 },
      { header: "Description", key: "description", width: 54 },
      { header: "Performance Indicators", key: "performanceIndicators", width: 42 },
    ],
    curriculumMap.peos,
  );

  workbook.eachSheet((sheet) => {
    sheet.eachRow((row) => {
      row.alignment = { vertical: "top", wrapText: true };
    });
  });

  return workbook.xlsx.writeBuffer();
};

const calculateReportsPayload = async (rawFilters = {}) => {
  const filters = getObeReportFilters(rawFilters);
  const questionFilter = buildQuestionFilter(filters);
  const examFilter = buildExamFilter(filters);
  const [
    totalUsers,
    totalQuestions,
    totalExams,
    submittedExams,
    easyQuestions,
    averageQuestions,
    difficultQuestions,
    obeReport,
    cqiReport,
    assessmentMethodReport,
    teacherSubmissionStatus,
    recentActivity,
  ] = await Promise.all([
    User.countDocuments(),
    Question.countDocuments(questionFilter),
    Exam.countDocuments(examFilter),
    Exam.countDocuments({ submitted: true, ...examFilter }),
    Question.countDocuments({ difficulty: "Easy", ...questionFilter }),
    Question.countDocuments({ difficulty: "Average", ...questionFilter }),
    Question.countDocuments({ difficulty: "Difficult", ...questionFilter }),
    calculateObeReport(filters),
    calculateCqiMonitoringReport(filters),
    calculateAssessmentMethodReport(filters),
    calculateTeacherObeSubmissionStatus(filters),
    ActivityLog.find()
      .populate("user", "name email role")
      .sort({ createdAt: -1 })
      .limit(10),
  ]);

  const activityCounts = await ActivityLog.aggregate([
    {
      $group: {
        _id: "$action",
        count: { $sum: 1 },
      },
    },
  ]);
  const totalActivityCount = activityCounts.reduce(
    (total, item) => total + item.count,
    0,
  );
  const generatedExamCount = activityCounts
    .filter((item) => item._id === "generate_exam" || item._id === "created_exam")
    .reduce((total, item) => total + item.count, 0);
  const outcomeCoverageAlerts = await calculateOutcomeCoverageAlerts(
    obeReport,
    cqiReport,
    filters,
  );
  obeReport.evidenceTraceabilityMatrix = applyCqiStatusToTraceabilityMatrix(
    obeReport.evidenceTraceabilityMatrix || [],
    cqiReport,
  );

  return {
    filters,
    filterSummary: formatFilterSummary(filters),
    termOptions: OBE_TERM_OPTIONS,
    totalUsers,
    totalQuestions,
    totalExams,
    submittedExams,
    pendingExams: totalExams - submittedExams,
    easyQuestions,
    averageQuestions,
    difficultQuestions,
    obeReport,
    cqiReport,
    assessmentMethodReport,
    teacherSubmissionStatus,
    outcomeCoverageAlerts,
    loginCount: activityCounts.find((item) => item._id === "login")?.count || 0,
    generatedExamCount,
    downloadedTosCount:
      activityCounts.find((item) => item._id === "download_tos")?.count || 0,
    activityCount: totalActivityCount,
    recentActivity,
  };
};

exports.calculateReportsPayload = calculateReportsPayload;

const classKeyFor = (record = {}) =>
  [
    record.subject || "No subject",
    record.section || "No section",
    record.semester || "No term",
    record.schoolYear || "No school year",
  ].join("|||");

const ensureSubmissionBucket = (map, record = {}) => {
  const key = classKeyFor(record);

  if (!map.has(key)) {
    map.set(key, {
      subject: record.subject || "No subject",
      section: record.section || "No section",
      semester: record.semester || "No term",
      schoolYear: record.schoolYear || "No school year",
      generatedExams: 0,
      linkedItemAnalysis: 0,
      rubricAssessments: 0,
      evidenceRecords: 0,
      notAttainedOutcomes: 0,
      cqiPlans: 0,
      status: "Missing Evidence",
    });
  }

  return map.get(key);
};

const finalizeTeacherBucket = (bucket, settings) => {
      const studentScores = Array.from(bucket.studentScores?.values() || []).filter(
        (score) => Number(score.possibleWeight || 0) > 0,
      );
      const attainedStudents = studentScores.filter((score) => {
        const rate =
          Number(score.possibleWeight || 0) > 0
            ? (Number(score.attainedWeight || 0) /
                Number(score.possibleWeight || 0)) *
              100
            : 0;

        return rate >= Number(bucket.targetRate ?? 75);
      }).length;
      const responseAttainmentRate =
        bucket.possibleWeight > 0
          ? Math.round((bucket.attainedWeight / bucket.possibleWeight) * 1000) /
            10
          : 0;
      const studentAttainmentRate =
        studentScores.length > 0
          ? Math.round((attainedStudents / studentScores.length) * 1000) / 10
          : 0;
      const attainmentRate =
        settings.attainmentMethod === "student_based"
          ? studentAttainmentRate
          : responseAttainmentRate;

      const finalized = {
        ...bucket,
        programs: Array.from(bucket.programs || []).sort().join(", "),
        studentScores: undefined,
        assessedStudents: studentScores.length,
        attainedStudents,
        responseAttainmentRate,
        attainmentRate,
        status:
          bucket.assessedItems <= 0
            ? "No Evidence"
            : attainmentRate >= Number(bucket.targetRate ?? 75)
              ? "Attained"
              : "Not Attained",
      };

      delete finalized.piBuckets;
      delete finalized.phaseBuckets;

      return finalized;
    };

const finalizeTeacherBuckets = (buckets, settings) =>
  Array.from(buckets.values())
    .map((bucket) => finalizeTeacherBucket(bucket, settings))
    .sort((a, b) => a.code.localeCompare(b.code));

const finalizeTeacherStudentOutcomeBuckets = (buckets, settings) =>
  Array.from(buckets.values())
    .map((bucket) => {
      const finalized = finalizeTeacherBucket(bucket, settings);
      const piBreakdown = finalizeTeacherBuckets(bucket.piBuckets || new Map(), settings);
      const phaseBreakdown = finalizeTeacherBuckets(
        bucket.phaseBuckets || new Map(),
        settings,
      ).map((phase) => ({
        ...phase,
        phase: phase.code,
      }));
      const phaseWeightedRate = weightedPhaseAttainment(phaseBreakdown, {
        evidenceKey: "possibleWeight",
      });
      const assessedPis = piBreakdown.filter(
        (pi) => Number(pi.assessedItems || 0) > 0,
      );

      if (phaseWeightedRate !== null) {
        finalized.attainmentRate = phaseWeightedRate;
        finalized.status =
          finalized.attainmentRate >= Number(finalized.targetRate ?? 75)
            ? "Attained"
            : "Not Attained";
      } else if (assessedPis.length > 0) {
        finalized.attainmentRate =
          Math.round(
            (assessedPis.reduce(
              (sum, pi) => sum + Number(pi.attainmentRate || 0),
              0,
            ) /
              assessedPis.length) *
              10,
          ) / 10;
        finalized.status =
          finalized.attainmentRate >= Number(finalized.targetRate ?? 75)
            ? "Attained"
            : "Not Attained";
      }

      finalized.piBreakdown = piBreakdown;
      finalized.phaseBreakdown = phaseBreakdown;
      return finalized;
    })
    .sort((a, b) => a.code.localeCompare(b.code));

exports.getMyObeDashboard = async (req, res) => {
  try {
    const [
      settings,
      generatedExams,
      analysisExams,
      rubricAssessments,
      evidenceRecords,
    ] = await Promise.all([
      getObeSettings(),
      Exam.find({ user: req.user._id })
        .select("title subject section semester schoolYear engineeringProgram totalItems questions approvalStatus createdAt")
        .populate({
          path: "questions",
          select:
            "subject engineeringProgram courseOutcome programOutcome performanceIndicator bloomLevel outcomeWeight isComplexEngineeringProblem complexityLevel",
        })
        .lean(),
      ItemAnalysisExam.find({
        uploadedBy: req.user._id,
        generatedExamId: { $ne: null },
        includeInObe: { $ne: false },
      })
        .select("title subject section semester schoolYear generatedExamId assessmentMethod assessmentPhase")
        .populate({
          path: "generatedExamId",
          select: "title engineeringProgram subject assessmentMethod assessmentPhase questions",
          populate: {
            path: "questions",
            select:
              "subject engineeringProgram courseOutcome programOutcome performanceIndicator bloomLevel outcomeWeight isComplexEngineeringProblem complexityLevel",
          },
        })
        .lean(),
      RubricAssessment.find({ createdBy: req.user._id }).lean(),
      ObeEvidence.find({ uploadedBy: req.user._id })
        .select("title evidenceType subject section semester schoolYear courseOutcome programOutcome filePath createdAt")
        .sort({ createdAt: -1 })
        .limit(12)
        .lean(),
    ]);
    const analysisResults = await ItemAnalysisStudentResult.find({
      analysisExamId: { $in: analysisExams.map((exam) => exam._id) },
    })
      .select("analysisExamId studentId itemResults")
      .lean();
    const cqiPlans = await CqiInterventionPlan.find({
      analysisExamId: { $in: analysisExams.map((exam) => exam._id) },
    })
      .select("analysisExamId outcomeType outcomeCode status")
      .lean();
    const resultsByExam = new Map();
    const submissionMap = new Map();
    const courseOutcomes = new Map();
    const studentOutcomes = new Map();
    const cepAttainment = createCepBuckets(settings.courseOutcomeTarget);

    analysisResults.forEach((result) => {
      const key = result.analysisExamId.toString();
      const rows = resultsByExam.get(key) || [];
      rows.push(result);
      resultsByExam.set(key, rows);
    });

    generatedExams.forEach((exam) => {
      ensureSubmissionBucket(submissionMap, exam).generatedExams++;
    });
    evidenceRecords.forEach((evidence) => {
      ensureSubmissionBucket(submissionMap, evidence).evidenceRecords++;
    });
    rubricAssessments.forEach((assessment) => {
      ensureSubmissionBucket(submissionMap, assessment).rubricAssessments++;
    });

    analysisExams.forEach((analysisExam) => {
      ensureSubmissionBucket(submissionMap, analysisExam).linkedItemAnalysis++;
      const generatedQuestions = analysisExam.generatedExamId?.questions || [];
      const examResults = resultsByExam.get(analysisExam._id.toString()) || [];

      generatedQuestions.forEach((question, index) => {
        const itemNo = index + 1;
        const courseOutcome = toOutcomeKey(question.courseOutcome, "Unmapped CLO");
        const programOutcome = toOutcomeKey(question.programOutcome, "Unmapped SO");
        const performanceIndicator = toOutcomeKey(
          question.performanceIndicator,
          "",
        );
        const cepLevel = getQuestionCepLevel(question);
        const weight = Math.max(0, Number(question.outcomeWeight || 1));
        const assessmentPhase =
          analysisExam.assessmentPhase ||
          analysisExam.generatedExamId?.assessmentPhase ||
          "Summative";

        if (!courseOutcomes.has(courseOutcome)) {
          courseOutcomes.set(
            courseOutcome,
            createOutcomeBucket(courseOutcome, settings.courseOutcomeTarget),
          );
        }
        const soBucket = ensureOutcomeBucket(
          studentOutcomes,
          programOutcome,
          settings.studentOutcomeTarget,
        );
        if (question.engineeringProgram) {
          courseOutcomes.get(courseOutcome).programs.add(question.engineeringProgram);
          cepAttainment.get(cepLevel)?.programs.add(question.engineeringProgram);
        }
        cepAttainment.get(cepLevel).questionCount++;

        examResults.forEach((result) => {
          const itemResult =
            (result.itemResults || []).find((item) => Number(item.itemNo) === itemNo) ||
            result.itemResults?.[index];
          const studentKey = `item-analysis:${result.studentId || result._id}`;

          recordOutcomeResponse(
            courseOutcomes.get(courseOutcome),
            itemResult,
            weight,
            studentKey,
          );
          recordOutcomeResponse(
            studentOutcomes.get(programOutcome),
            itemResult,
            weight,
            studentKey,
            assessmentPhase,
          );
          if (performanceIndicator) {
            recordOutcomeResponse(
              ensureOutcomeBucket(
                soBucket.piBuckets,
                performanceIndicator,
                settings.studentOutcomeTarget,
              ),
              itemResult,
              weight,
              studentKey,
              assessmentPhase,
            );
          }
          recordOutcomeResponse(
            cepAttainment.get(cepLevel),
            itemResult,
            weight,
            studentKey,
          );
        });
      });
    });

    rubricAssessments.forEach((assessment) => {
      (assessment.criteria || []).forEach((criterion, criterionIndex) => {
        const courseOutcome = toOutcomeKey(criterion.courseOutcome, "Unmapped CLO");
        const programOutcome = toOutcomeKey(criterion.programOutcome, "Unmapped SO");
        const performanceIndicator = toOutcomeKey(
          criterion.performanceIndicator,
          "",
        );
        const assessmentPhase = assessment.assessmentPhase || "Summative";
        const maxScore =
          Math.max(0, Number(criterion.maxScore || 0)) *
          Math.max(0, Number(criterion.weight || 1));
        const targetScore =
          Number(criterion.targetScore || 0) > 0
            ? Number(criterion.targetScore) * Math.max(0, Number(criterion.weight || 1))
            : maxScore * (Number(settings.courseOutcomeTarget ?? 75) / 100);

        if (maxScore <= 0) return;

        if (!courseOutcomes.has(courseOutcome)) {
          courseOutcomes.set(
            courseOutcome,
            createOutcomeBucket(courseOutcome, settings.courseOutcomeTarget),
          );
        }
        const soBucket = ensureOutcomeBucket(
          studentOutcomes,
          programOutcome,
          settings.studentOutcomeTarget,
        );
        if (assessment.engineeringProgram) {
          courseOutcomes.get(courseOutcome).programs.add(assessment.engineeringProgram);
        }

        (assessment.studentScores || []).forEach((student) => {
          const scoreRow = (student.criterionScores || []).find(
            (item) =>
              String(item.criterionId || "") === String(criterion._id) ||
              Number(item.criterionIndex) === criterionIndex,
          );
          const rawScore = Math.max(0, Number(scoreRow?.score || 0));
          const weightedScore =
            Math.min(rawScore, Number(criterion.maxScore || 0)) *
            Math.max(0, Number(criterion.weight || 1));
          const studentKey = `rubric:${assessment._id}:${student.studentId || student.studentName}`;

          recordOutcomeScore(
            courseOutcomes.get(courseOutcome),
            weightedScore,
            maxScore,
            studentKey,
            targetScore,
          );
          recordOutcomeScore(
            studentOutcomes.get(programOutcome),
            weightedScore,
            maxScore,
            studentKey,
            targetScore,
            assessmentPhase,
          );
          if (performanceIndicator) {
            recordOutcomeScore(
              ensureOutcomeBucket(
                soBucket.piBuckets,
                performanceIndicator,
                settings.studentOutcomeTarget,
              ),
              weightedScore,
              maxScore,
              studentKey,
              targetScore,
              assessmentPhase,
            );
          }
        });
      });
    });

    const courseOutcomeRows = finalizeTeacherBuckets(courseOutcomes, settings);
    const studentOutcomeRows = await attachStudentOutcomeIndicators(
      finalizeTeacherStudentOutcomeBuckets(studentOutcomes, settings),
    );
    const cepAttainmentRows = finalizeTeacherBuckets(cepAttainment, settings).sort(
      (a, b) => CEP_LEVELS.indexOf(a.code) - CEP_LEVELS.indexOf(b.code),
    );
    const notAttainedCodes = new Set(
      [...courseOutcomeRows, ...studentOutcomeRows]
        .filter((row) => row.status === "Not Attained")
        .map((row) => row.code),
    );
    const cqiPlanKeys = new Set(
      cqiPlans.map((plan) => `${plan.outcomeType}:${plan.outcomeCode}`),
    );
    const notAttainedWithoutCqi = [...courseOutcomeRows]
      .filter((row) => row.status === "Not Attained" && !cqiPlanKeys.has(`CO:${row.code}`))
      .length +
      [...studentOutcomeRows].filter(
        (row) => row.status === "Not Attained" && !cqiPlanKeys.has(`SO:${row.code}`),
      ).length;

    submissionMap.forEach((bucket) => {
      bucket.cqiPlans = cqiPlans.length;
      bucket.notAttainedOutcomes = notAttainedCodes.size;
      bucket.status =
        bucket.linkedItemAnalysis + bucket.rubricAssessments <= 0
          ? "Missing Assessment Evidence"
          : bucket.evidenceRecords <= 0
            ? "Missing Evidence Files"
            : notAttainedWithoutCqi > 0
              ? "Needs CQI"
              : "Ready for Review";
    });

    res.json({
      success: true,
      dashboard: {
        settings,
        summary: {
          generatedExams: generatedExams.length,
          linkedItemAnalysis: analysisExams.length,
          rubricAssessments: rubricAssessments.length,
          evidenceRecords: evidenceRecords.length,
          cqiPlans: cqiPlans.length,
          notAttainedOutcomes: notAttainedCodes.size,
          notAttainedWithoutCqi,
        },
        courseOutcomes: courseOutcomeRows,
        studentOutcomes: studentOutcomeRows,
        cepAttainment: cepAttainmentRows,
        submissionStatus: Array.from(submissionMap.values()).sort((a, b) =>
          a.subject.localeCompare(b.subject),
        ),
        recentEvidence: evidenceRecords,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getDashboardStats = async (req, res) => {
  try {
    const [
      totalUsers,
      totalQuestions,
      difficultyCounts,
      recentQuestions,
      recentExams,
      registeredUsers,
      recentActivity,
    ] = await Promise.all([
      User.countDocuments(),
      Question.countDocuments(),
      Question.aggregate([
        {
          $group: {
            _id: "$difficulty",
            count: { $sum: 1 },
          },
        },
      ]),
      Question.find()
        .select("subject topic difficulty createdAt")
        .sort({ createdAt: -1 })
        .limit(30)
        .lean(),
      Exam.find()
        .select("title engineeringProgram totalItems approvalStatus user createdAt")
        .populate("user", "name email role")
        .sort({ approvalStatus: -1, createdAt: -1 })
        .limit(50)
        .lean(),
      User.find()
        .select("name email role createdAt")
        .sort({ createdAt: -1 })
        .limit(50)
        .lean(),
      ActivityLog.find()
        .populate("user", "name email role")
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),
    ]);

    const difficultyMap = difficultyCounts.reduce((counts, item) => {
      counts[item._id] = item.count;
      return counts;
    }, {});

    const easyQuestions = difficultyMap.Easy || 0;
    const averageQuestions = difficultyMap.Average || 0;
    const difficultQuestions = difficultyMap.Difficult || 0;

    res.json({
      success: true,
      stats: {
        totalUsers,
        totalQuestions,
        easyQuestions,
        averageQuestions,
        difficultQuestions,
        recentQuestions,
        recentExams,
        registeredUsers,
        recentActivity,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.downloadActivityLog = async (req, res) => {
  try {
    const filter = getActivityDateRange(req.query);
    const activities = await ActivityLog.find(filter)
      .populate("user", "name email role")
      .sort({ createdAt: -1 });

    const buffer = await buildActivityWorkbook(activities);
    const today = new Date().toISOString().slice(0, 10);
    const rangeSuffix =
      req.query.startDate || req.query.endDate
        ? `-${req.query.startDate || "start"}-to-${req.query.endDate || today}`
        : "";

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="activity-log${rangeSuffix}-${today}.xlsx"`,
    );

    res.send(Buffer.from(buffer));
  } catch (error) {
    const statusCode = /date/i.test(error.message) ? 400 : 500;

    res.status(statusCode).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getReportsSummary = async (req, res) => {
  try {
    const report = await calculateReportsPayload(req.query);

    res.json({
      success: true,
      report,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.downloadAccreditationObeReport = async (req, res) => {
  try {
    const report = await calculateReportsPayload(req.query);
    const buffer = await buildAccreditationObeWorkbook(report);
    const today = new Date().toISOString().slice(0, 10);

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="accreditation-obe-report-${today}.xlsx"`,
    );

    res.send(Buffer.from(buffer));
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
