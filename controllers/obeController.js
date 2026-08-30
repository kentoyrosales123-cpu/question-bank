const { Readable } = require("stream");
const ExcelJS = require("exceljs");
const CourseOutcome = require("../models/CourseOutcome");
const StudentOutcome = require("../models/StudentOutcome");
const ProgramEducationalObjective = require("../models/ProgramEducationalObjective");
const CurriculumMapCourse = require("../models/CurriculumMapCourse");
const Question = require("../models/Question");
const Exam = require("../models/Exam");
const RubricAssessment = require("../models/RubricAssessment");
const RubricTemplate = require("../models/RubricTemplate");
const ObeEvidence = require("../models/ObeEvidence");
const ObeAttainmentSnapshot = require("../models/ObeAttainmentSnapshot");
const { getObeSettings, saveObeSettings } = require("../services/obeSettingsService");
const { calculateReportsPayload } = require("./dashboardController");
const {
  normalizeAssessmentMethod,
} = require("../utils/assessmentMethods");
const {
  normalizeAssessmentPhase,
} = require("../utils/assessmentPhases");
const {
  attachStudentOutcomeIndicators,
  parsePerformanceIndicators,
} = require("../utils/studentOutcomeIndicators");
const {
  weightedPhaseAttainment,
} = require("../utils/phaseAttainment");
const { getSubjectAccessFilter, isSuperAdmin } = require("../utils/roles");

const BLOOM_LEVELS = [
  "Remember",
  "Understand",
  "Apply",
  "Analyze",
  "Evaluate",
  "Create",
];

const normalizeBloomLevel = (value = "") => {
  const normalized = String(value || "").trim().toLowerCase();
  const match = BLOOM_LEVELS.find(
    (level) => level.toLowerCase() === normalized,
  );

  return match || "";
};

const normalizePeoCode = (value = "") => {
  const normalized = String(value || "")
    .trim()
    .replace(/^PEO[-\s]*/i, "");

  return normalized ? `PEO${normalized}`.toUpperCase() : "";
};

const normalizePeoLinks = (value = "") =>
  String(value || "")
    .split(/[,\s]+/)
    .map(normalizePeoCode)
    .filter(Boolean)
    .join(", ");

const normalizeStudentOutcomeLink = (value = "") =>
  String(value || "")
    .split(/[,\s]+/)
    .map((item) =>
      item
        .replace(/^SO[-\s]*/i, "")
        .trim()
        .toLowerCase(),
    )
    .filter((item) => /^[a-z]$/.test(item))
    .filter(Boolean)
    .join(", ");

const toTrimmedString = (value = "") => String(value || "").trim();

const CURRICULUM_ALIGNMENT_LEVELS = Object.freeze({
  I: "Introductory",
  E: "Enabling",
  D: "Demonstrative",
});

const normalizeCurriculumAlignmentLevel = (value = "") => {
  const level = String(value || "").trim().toUpperCase();

  return CURRICULUM_ALIGNMENT_LEVELS[level] ? level : "";
};

const normalizeCurriculumCourseAlignments = (alignments = []) =>
  parseJsonArray(alignments)
    .map((alignment) => ({
      studentOutcome: normalizeStudentOutcomeLink(
        alignment.studentOutcome || alignment.so || alignment.code,
      ),
      level: normalizeCurriculumAlignmentLevel(alignment.level),
    }))
    .filter((alignment) => alignment.studentOutcome && alignment.level)
    .filter(
      (alignment, index, rows) =>
        rows.findIndex(
          (row) => row.studentOutcome === alignment.studentOutcome,
        ) === index,
    );

const normalizePerformanceIndicatorDetails = (
  performanceIndicatorDetails = [],
) =>
  parseJsonArray(performanceIndicatorDetails, [])
    .map((item, index) => ({
      piNumber: Math.max(1, toNumber(item.piNumber, index + 1)),
      description: toTrimmedString(item.description),
      weight: Math.max(0, toNumber(item.weight, 1)),
    }))
    .filter((item) => item.description);

const formatSubjectScopedCourseOutcome = (subject = "", courseOutcome = "") => {
  const code = toTrimmedString(courseOutcome);
  const subjectName = toTrimmedString(subject);

  if (!code) return "Unmapped CLO";
  if (!subjectName || /^unmapped/i.test(code)) return code;

  const normalizedCode = code.toLowerCase();
  const normalizedSubject = subjectName.toLowerCase();
  if (
    normalizedCode === normalizedSubject ||
    normalizedCode.startsWith(`${normalizedSubject} - `) ||
    normalizedCode.startsWith(`${normalizedSubject}:`) ||
    normalizedCode.startsWith(`${normalizedSubject} | `)
  ) {
    return code;
  }

  return `${subjectName} - ${code}`;
};

const toNumber = (value, fallback = 0) => {
  const number = Number(value);

  return Number.isFinite(number) ? number : fallback;
};

const parseJsonArray = (value, fallback = []) => {
  if (Array.isArray(value)) return value;
  if (!value) return fallback;

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch (error) {
    return fallback;
  }
};

const getCellText = (row, index) => {
  const value = row.getCell(index).value;

  if (value && typeof value === "object" && "text" in value) {
    return toTrimmedString(value.text);
  }

  if (value && typeof value === "object" && "result" in value) {
    return toTrimmedString(value.result);
  }

  return toTrimmedString(value);
};

const readWorkbook = async (file) => {
  const workbook = new ExcelJS.Workbook();
  const isCsv =
    file.originalname.toLowerCase().endsWith(".csv") ||
    String(file.mimetype || "").includes("csv");

  if (isCsv) {
    await workbook.csv.read(Readable.from(file.buffer.toString("utf8")));
  } else {
    await workbook.xlsx.load(file.buffer);
  }

  return workbook;
};

const parseRubricItemNo = (label = "") => {
  const match = String(label || "").match(/(?:item|problem)\s*(\d+)/i);
  return match ? Math.max(0, toNumber(match[1])) : 0;
};

const RUBRIC_TEMPLATE_PRESETS = {
  "problem-solving": {
    name: "General Problem Solving",
    title: "Problem-Solving Rubric",
    assessmentMethod: "Major Exam",
    label: (itemNo) => `Item ${itemNo}`,
    studentOutcome: "a",
    bloomLevel: "Apply",
  },
  "engineering-calculation": {
    name: "Engineering Calculation",
    title: "Engineering Calculation Rubric",
    assessmentMethod: "Major Exam",
    label: (itemNo) => `Item ${itemNo} Calculation`,
    studentOutcome: "a",
    bloomLevel: "Analyze",
  },
  "design-solution": {
    name: "Design Solution",
    title: "Design Solution Rubric",
    assessmentMethod: "Project",
    label: (itemNo) => `Item ${itemNo} Design Solution`,
    studentOutcome: "c",
    bloomLevel: "Create",
  },
  "laboratory-analysis": {
    name: "Laboratory Analysis",
    title: "Laboratory Analysis Rubric",
    assessmentMethod: "Laboratory",
    label: (itemNo) => `Item ${itemNo} Laboratory Analysis`,
    studentOutcome: "b",
    bloomLevel: "Evaluate",
  },
};

const getRubricTemplatePreset = (value) =>
  RUBRIC_TEMPLATE_PRESETS[value] || RUBRIC_TEMPLATE_PRESETS["problem-solving"];

const DEFAULT_PROBLEM_SOLVING_RUBRIC = {
  key: "problem-solving-standard",
  name: "Standard Problem-Solving Rubric",
  description: "Four-criterion, 10-point rubric for problem-solving exam items.",
  isSystem: true,
  criteria: [
    {
      criterion: "Understanding of the Problem",
      excellent:
        "Clearly identifies all given information, requirements, and what is being asked.",
      good: "Identifies most relevant information with minor omissions.",
      fair: "Shows partial understanding of the problem.",
      needsImprovement:
        "Misinterprets or fails to identify key information.",
      maxPoints: 2,
    },
    {
      criterion: "Approach / Method",
      excellent:
        "Selects the correct principle, formula, or method and applies it logically.",
      good: "Uses an appropriate method with minor errors in procedure.",
      fair: "Uses a partially correct method but with significant procedural errors.",
      needsImprovement: "Uses an incorrect or irrelevant method.",
      maxPoints: 3,
    },
    {
      criterion: "Solution / Computation",
      excellent: "Computations are complete, accurate, and logically organized.",
      good: "Minor computational error but the overall process is correct.",
      fair: "Several computational errors are present.",
      needsImprovement: "Computation is largely incorrect or incomplete.",
      maxPoints: 3,
    },
    {
      criterion: "Final Answer and Interpretation",
      excellent:
        "Final answer is correct, clearly stated, with appropriate units or interpretation.",
      good:
        "Final answer is mostly correct with minor omission in units or interpretation.",
      fair: "Final answer is partially correct or poorly stated.",
      needsImprovement: "Final answer is incorrect, missing, or unsupported.",
      maxPoints: 2,
    },
  ],
};

const ensureDefaultRubricTemplates = async () => {
  await RubricTemplate.findOneAndUpdate(
    { key: DEFAULT_PROBLEM_SOLVING_RUBRIC.key },
    { $setOnInsert: DEFAULT_PROBLEM_SOLVING_RUBRIC },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
};

const normalizeRubricTemplateCriteria = (criteria = []) =>
  parseJsonArray(criteria)
    .map((criterion) => ({
      criterion: toTrimmedString(criterion.criterion || criterion.label),
      excellent: toTrimmedString(criterion.excellent),
      good: toTrimmedString(criterion.good),
      fair: toTrimmedString(criterion.fair),
      needsImprovement: toTrimmedString(
        criterion.needsImprovement || criterion.needs_improvement,
      ),
      maxPoints: Math.max(0, toNumber(criterion.maxPoints)),
    }))
    .filter((criterion) => criterion.criterion && criterion.maxPoints > 0);

const calculateRubricAttainment = async (assessment, settings) => {
  const courseOutcomes = new Map();
  const studentOutcomes = new Map();
  const criteria = assessment.criteria || [];
  const scores = assessment.studentScores || [];

  const ensureBucket = (map, code, targetRate) => {
    const key = toTrimmedString(code) || "Unmapped";

    if (!map.has(key)) {
      map.set(key, {
        code: key,
        criteriaCount: 0,
        assessedStudents: 0,
        attainedStudents: 0,
        totalScore: 0,
        earnedScore: 0,
        targetRate,
        attainmentRate: 0,
        status: "Not assessed",
        piBuckets: new Map(),
        phaseBuckets: new Map(),
      });
    }

    return map.get(key);
  };

  criteria.forEach((criterion) => {
    const courseOutcomeCode = formatSubjectScopedCourseOutcome(
      assessment.subject,
      criterion.courseOutcome,
    );
    const studentOutcomeCode = criterion.programOutcome || "Unmapped SO";

    ensureBucket(
      courseOutcomes,
      courseOutcomeCode,
      settings.courseOutcomeTarget,
    ).criteriaCount += 1;
    ensureBucket(
      studentOutcomes,
      studentOutcomeCode,
      settings.studentOutcomeTarget,
    ).criteriaCount += 1;
    if (criterion.performanceIndicator) {
      ensureBucket(
        studentOutcomes.get(studentOutcomeCode).piBuckets,
        criterion.performanceIndicator,
        settings.studentOutcomeTarget,
      ).criteriaCount += 1;
    }
  });

  const scoreByCriterion = (student, criterion, index) => {
    const match = (student.criterionScores || []).find(
      (item) =>
        String(item.criterionId || "") === String(criterion._id) ||
        Number(item.criterionIndex) === index,
    );

    return Math.max(0, Math.min(toNumber(match?.score), toNumber(criterion.maxScore)));
  };

  const recordScore = (bucket, score, maxScore, studentPassed, phase = "") => {
    bucket.totalScore += maxScore;
    bucket.earnedScore += score;
    bucket.assessedStudents += 1;
    if (studentPassed) bucket.attainedStudents += 1;

    if (phase) {
      recordScore(
        ensureBucket(bucket.phaseBuckets, phase, bucket.targetRate),
        score,
        maxScore,
        studentPassed,
      );
    }
  };

  scores.forEach((student) => {
    criteria.forEach((criterion, index) => {
      const courseOutcomeCode = formatSubjectScopedCourseOutcome(
        assessment.subject,
        criterion.courseOutcome,
      );
      const studentOutcomeCode = criterion.programOutcome || "Unmapped SO";
      const maxScore = Math.max(0, toNumber(criterion.maxScore));
      if (maxScore <= 0) return;

      const score = scoreByCriterion(student, criterion, index);
      const targetScore =
        toNumber(criterion.targetScore) > 0
          ? toNumber(criterion.targetScore)
          : maxScore * (Number(settings.courseOutcomeTarget ?? 75) / 100);
      const studentPassed = score >= targetScore;

      recordScore(
        ensureBucket(
          courseOutcomes,
          courseOutcomeCode,
          settings.courseOutcomeTarget,
        ),
        score,
        maxScore,
        studentPassed,
      );
      recordScore(
        ensureBucket(
          studentOutcomes,
          studentOutcomeCode,
          settings.studentOutcomeTarget,
        ),
        score,
        maxScore,
        studentPassed,
        assessment.assessmentPhase || "Summative",
      );
      if (criterion.performanceIndicator) {
        recordScore(
          ensureBucket(
            studentOutcomes.get(studentOutcomeCode).piBuckets,
            criterion.performanceIndicator,
            settings.studentOutcomeTarget,
          ),
          score,
          maxScore,
          studentPassed,
          assessment.assessmentPhase || "Summative",
        );
      }
    });
  });

  const finalize = (bucket) => {
    const attainmentRate =
      bucket.totalScore > 0
        ? Math.round((bucket.earnedScore / bucket.totalScore) * 1000) / 10
        : 0;

    const finalized = {
      ...bucket,
      totalScore: Math.round(bucket.totalScore * 100) / 100,
      earnedScore: Math.round(bucket.earnedScore * 100) / 100,
      attainmentRate,
      status:
        bucket.totalScore <= 0
          ? "Not assessed"
          : attainmentRate >= Number(bucket.targetRate ?? 75)
            ? "Attained"
            : "Not attained",
    };

    delete finalized.piBuckets;
    delete finalized.phaseBuckets;

    return finalized;
  };

  const finalizeStudentOutcomeBucket = (bucket) => {
    const finalized = finalize(bucket);
    const piBreakdown = Array.from(bucket.piBuckets?.values?.() || [])
      .map(finalize)
      .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
    const phaseBreakdown = Array.from(bucket.phaseBuckets?.values?.() || [])
      .map((phaseBucket) => ({
        ...finalize(phaseBucket),
        phase: phaseBucket.code,
      }))
      .sort((a, b) => a.code.localeCompare(b.code));
    const phaseWeightedRate = weightedPhaseAttainment(phaseBreakdown, {
      evidenceKey: "totalScore",
    });
    const assessedPis = piBreakdown.filter((pi) => Number(pi.totalScore || 0) > 0);

    if (phaseWeightedRate !== null) {
      finalized.attainmentRate = phaseWeightedRate;
      finalized.status =
        phaseWeightedRate >= Number(finalized.targetRate ?? 75)
          ? "Attained"
          : "Not attained";
    } else if (assessedPis.length > 0) {
      const attainmentRate =
        Math.round(
          (assessedPis.reduce(
            (sum, pi) => sum + Number(pi.attainmentRate || 0),
            0,
          ) /
            assessedPis.length) *
            10,
        ) / 10;

      finalized.attainmentRate = attainmentRate;
      finalized.status =
        attainmentRate >= Number(finalized.targetRate ?? 75)
          ? "Attained"
          : "Not attained";
    }

    finalized.piBreakdown = piBreakdown;
    finalized.phaseBreakdown = phaseBreakdown;

    return finalized;
  };

  const studentOutcomeRows = await attachStudentOutcomeIndicators(
    Array.from(studentOutcomes.values()).map(finalizeStudentOutcomeBucket),
  );

  return {
    courseOutcomes: Array.from(courseOutcomes.values()).map(finalize),
    studentOutcomes: studentOutcomeRows,
  };
};

const parseBulkOutcomeLine = (line) => {
  const parts = line
    .split("|")
    .map((part) => part.trim())
    .filter((part, index) => index < 5 || part);

  return {
    code: parts[0] || "",
    description: parts[1] || "",
    programOutcome: normalizeStudentOutcomeLink(parts[2]),
    bloomLevel: normalizeBloomLevel(parts[3]),
    keywords: parts[4] || "",
  };
};

const parseBulkStudentOutcomeLine = (line) => {
  const parts = line
    .split("|")
    .map((part) => part.trim())
    .filter((part, index) => index < 5 || part);

  const performanceIndicators = parts[4] || "";

  return {
    code: parts[0] || "",
    description: parts[1] || "",
    graduateAttributes: parts[2] || "",
    peoLinks: normalizePeoLinks(parts[3]),
    performanceIndicators,
    performanceIndicatorDetails:
      parsePerformanceIndicators(performanceIndicators).map((item) => ({
        piNumber: item.piNumber,
        description: item.description,
        weight: 1,
      })),
  };
};

const parseBulkPeoLine = (line) => {
  const parts = line
    .split("|")
    .map((part) => part.trim())
    .filter((part, index) => index < 3 || part);

  return {
    code: normalizePeoCode(parts[0]),
    description: parts[1] || "",
    performanceIndicators: parts[2] || "",
  };
};

exports.getProgramEducationalObjectives = async (req, res) => {
  try {
    const filter = {};

    if (req.query.department) {
      filter.department = new RegExp(
        String(req.query.department).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i",
      );
    }

    const peos = await ProgramEducationalObjective.find(filter)
      .populate("createdBy", "name email")
      .sort({ department: 1, code: 1 });

    res.json({
      success: true,
      peos,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.createProgramEducationalObjective = async (req, res) => {
  try {
    const department = String(req.body.department || "").trim();
    const code = normalizePeoCode(req.body.code);
    const description = String(req.body.description || "").trim();
    const performanceIndicators = String(
      req.body.performanceIndicators || "",
    ).trim();

    if (!department || !code || !description) {
      return res.status(400).json({
        success: false,
        message: "Department, PEO code, and description are required.",
      });
    }

    const peo = await ProgramEducationalObjective.findOneAndUpdate(
      { department, code },
      {
        department,
        code,
        description,
        performanceIndicators,
        createdBy: req.user._id,
      },
      { new: true, upsert: true, runValidators: true },
    );

    res.status(201).json({
      success: true,
      message: "Program Educational Objective saved.",
      peo,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.importProgramEducationalObjectives = async (req, res) => {
  try {
    const department = String(req.body.department || "").trim();
    const lines = String(req.body.bulkText || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (!department || lines.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Department and bulk PEO text are required.",
      });
    }

    const parsed = lines
      .map(parseBulkPeoLine)
      .filter((item) => item.code && item.description);

    if (parsed.length === 0) {
      return res.status(400).json({
        success: false,
        message:
          "No valid rows found. Use: PEO1 | Description | Performance indicators",
      });
    }

    for (const item of parsed) {
      await ProgramEducationalObjective.findOneAndUpdate(
        { department, code: item.code },
        {
          department,
          ...item,
          createdBy: req.user._id,
        },
        { upsert: true, runValidators: true },
      );
    }

    res.json({
      success: true,
      message: `${parsed.length} PEO row${parsed.length === 1 ? "" : "s"} imported.`,
      importedCount: parsed.length,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.deleteProgramEducationalObjective = async (req, res) => {
  try {
    const peo = await ProgramEducationalObjective.findByIdAndDelete(
      req.params.id,
    );

    if (!peo) {
      return res.status(404).json({
        success: false,
        message: "Program Educational Objective not found.",
      });
    }

    res.json({
      success: true,
      message: "Program Educational Objective deleted.",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getStudentOutcomes = async (req, res) => {
  try {
    const filter = {};

    if (req.query.department) {
      filter.department = new RegExp(
        String(req.query.department).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i",
      );
    }

    const studentOutcomes = await StudentOutcome.find(filter)
      .populate("createdBy", "name email")
      .sort({ department: 1, code: 1 })
      .lean();
    const studentOutcomesWithIndicators =
      await attachStudentOutcomeIndicators(studentOutcomes);

    res.json({
      success: true,
      studentOutcomes: studentOutcomesWithIndicators,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.createStudentOutcome = async (req, res) => {
  try {
    const {
      department,
      code,
      description,
      graduateAttributes,
      performanceIndicators,
      performanceIndicatorDetails,
      peoLinks,
    } = req.body;
    const parsedIndicatorDetails = normalizePerformanceIndicatorDetails(
      performanceIndicatorDetails,
    );
    const fallbackIndicatorDetails =
      parsedIndicatorDetails.length > 0
        ? parsedIndicatorDetails
        : parsePerformanceIndicators(performanceIndicators).map((item) => ({
            piNumber: item.piNumber,
            description: item.description,
            weight: 1,
          }));

    if (!department || !code || !description) {
      return res.status(400).json({
        success: false,
        message: "Department, SO code, and description are required.",
      });
    }

    const studentOutcome = await StudentOutcome.findOneAndUpdate(
      { department: department.trim(), code: code.trim() },
      {
        department,
        code,
        description,
        graduateAttributes,
        performanceIndicators,
        performanceIndicatorDetails: fallbackIndicatorDetails,
        peoLinks: normalizePeoLinks(peoLinks),
        createdBy: req.user._id,
      },
      { new: true, upsert: true, runValidators: true },
    );

    res.status(201).json({
      success: true,
      message: "Student Outcome saved.",
      studentOutcome,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.updateStudentOutcomePerformanceIndicators = async (req, res) => {
  try {
    const performanceIndicatorDetails = normalizePerformanceIndicatorDetails(
      req.body.performanceIndicatorDetails,
    );

    if (performanceIndicatorDetails.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Enter at least one PI description before saving.",
      });
    }

    const performanceIndicators = performanceIndicatorDetails
      .map((item) => `${item.piNumber}. ${item.description}`)
      .join("\n");
    const studentOutcome = await StudentOutcome.findByIdAndUpdate(
      req.params.id,
      {
        performanceIndicators,
        performanceIndicatorDetails,
      },
      { new: true, runValidators: true },
    );

    if (!studentOutcome) {
      return res.status(404).json({
        success: false,
        message: "Student Outcome not found.",
      });
    }

    res.json({
      success: true,
      message: "Performance indicators saved.",
      studentOutcome,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.importStudentOutcomes = async (req, res) => {
  try {
    const department = String(req.body.department || "").trim();
    const lines = String(req.body.bulkText || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (!department || lines.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Department and bulk SO text are required.",
      });
    }

    const parsed = lines.map(parseBulkStudentOutcomeLine).filter(
      (item) => item.code && item.description,
    );

    if (parsed.length === 0) {
      return res.status(400).json({
        success: false,
        message:
          "No valid rows found. Use: SO a | Description | GA links | PEO links | Performance indicators",
      });
    }

    for (const item of parsed) {
      await StudentOutcome.findOneAndUpdate(
        { department, code: item.code },
        {
          department,
          ...item,
          createdBy: req.user._id,
        },
        { upsert: true, runValidators: true },
      );
    }

    res.json({
      success: true,
      message: `${parsed.length} SO row${parsed.length === 1 ? "" : "s"} imported.`,
      importedCount: parsed.length,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.deleteStudentOutcome = async (req, res) => {
  try {
    const studentOutcome = await StudentOutcome.findByIdAndDelete(
      req.params.id,
    );

    if (!studentOutcome) {
      return res.status(404).json({
        success: false,
        message: "Student Outcome not found.",
      });
    }

    res.json({
      success: true,
      message: "Student Outcome deleted.",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getCourseOutcomes = async (req, res) => {
  try {
    const filter = {};

    if (req.query.subject) {
      filter.subject = new RegExp(
        String(req.query.subject).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i",
      );
    }

    if (req.query.department) {
      filter.department = new RegExp(
        String(req.query.department).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i",
      );
    }

    const outcomes = await CourseOutcome.find(filter)
      .populate("createdBy", "name email")
      .sort({ subject: 1, code: 1 });

    res.json({
      success: true,
      outcomes,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getCourseOutcomeSubjects = async (req, res) => {
  try {
    const subjects = await CourseOutcome.distinct("subject", getSubjectAccessFilter(req.user));
    const visibleSubjects = subjects
      .map((subject) => String(subject || "").trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    res.json({
      success: true,
      subjects: visibleSubjects,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.createCourseOutcome = async (req, res) => {
  try {
    const {
      department,
      subject,
      code,
      description,
      programOutcome,
      bloomLevel,
      keywords,
    } = req.body;

    if (!subject || !code || !description) {
      return res.status(400).json({
        success: false,
        message: "Subject, CO/CLO code, and description are required.",
      });
    }

    const outcome = await CourseOutcome.findOneAndUpdate(
      {
        department: String(department || "").trim(),
        subject: subject.trim(),
        code: code.trim(),
      },
      {
        department,
        subject,
        code,
        description,
        programOutcome: normalizeStudentOutcomeLink(programOutcome),
        bloomLevel: normalizeBloomLevel(bloomLevel),
        keywords,
        createdBy: req.user._id,
      },
      { new: true, upsert: true, runValidators: true },
    );

    res.status(201).json({
      success: true,
      message: "CO/CLO saved.",
      outcome,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.updateCourseOutcome = async (req, res) => {
  try {
    const {
      department,
      subject,
      code,
      description,
      programOutcome,
      bloomLevel,
      keywords,
    } = req.body;

    if (!subject || !code || !description) {
      return res.status(400).json({
        success: false,
        message: "Subject, CO/CLO code, and description are required.",
      });
    }

    const outcome = await CourseOutcome.findByIdAndUpdate(
      req.params.id,
      {
        department: String(department || "").trim(),
        subject: String(subject || "").trim(),
        code: String(code || "").trim(),
        description: String(description || "").trim(),
        programOutcome: normalizeStudentOutcomeLink(programOutcome),
        bloomLevel: normalizeBloomLevel(bloomLevel),
        keywords: String(keywords || "").trim(),
      },
      { new: true, runValidators: true },
    );

    if (!outcome) {
      return res.status(404).json({
        success: false,
        message: "CO/CLO not found.",
      });
    }

    res.json({
      success: true,
      message: "CO/CLO updated.",
      outcome,
    });
  } catch (error) {
    const duplicateCode = Number(error?.code) === 11000;

    res.status(duplicateCode ? 409 : 500).json({
      success: false,
      message: duplicateCode
        ? "A CO/CLO with the same department, subject, and code already exists."
        : error.message,
    });
  }
};

exports.importCourseOutcomes = async (req, res) => {
  try {
    const subject = String(req.body.subject || "").trim();
    const department = String(req.body.department || "").trim();
    const lines = String(req.body.bulkText || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (!subject || lines.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Subject and bulk CO/CLO text are required.",
      });
    }

    const parsed = lines.map(parseBulkOutcomeLine).filter(
      (item) => item.code && item.description && item.programOutcome,
    );

    if (parsed.length === 0) {
      return res.status(400).json({
        success: false,
        message:
          "No valid rows found. Use an SO letter: CO1 | Description | a | Apply | keywords",
      });
    }

    for (const item of parsed) {
      await CourseOutcome.findOneAndUpdate(
        { department, subject, code: item.code },
        {
          department,
          subject,
          ...item,
          createdBy: req.user._id,
        },
        { upsert: true, runValidators: true },
      );
    }

    res.json({
      success: true,
      message: `${parsed.length} CO/CLO row${parsed.length === 1 ? "" : "s"} imported.`,
      importedCount: parsed.length,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.deleteCourseOutcome = async (req, res) => {
  try {
    const outcome = await CourseOutcome.findByIdAndDelete(req.params.id);

    if (!outcome) {
      return res.status(404).json({
        success: false,
        message: "CO/CLO not found.",
      });
    }

    res.json({
      success: true,
      message: "CO/CLO deleted.",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getSettings = async (req, res) => {
  try {
    const settings = await getObeSettings();

    res.json({
      success: true,
      settings,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getCurriculumMap = async (req, res) => {
  try {
    const department = String(req.query.department || "").trim();
    const subject = String(req.query.subject || "").trim();
    const courseFilter = {};
    const studentFilter = {};

    if (department) {
      const departmentRegex = new RegExp(
        department.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i",
      );
      courseFilter.department = departmentRegex;
      studentFilter.department = departmentRegex;
    }

    if (subject) {
      courseFilter.subject = new RegExp(
        subject.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i",
      );
    }

    const [peos, courseOutcomes, studentOutcomes, questionCoverage] =
      await Promise.all([
        ProgramEducationalObjective.find(studentFilter)
          .select("department code description performanceIndicators")
          .sort({ department: 1, code: 1 })
          .lean(),
        CourseOutcome.find(courseFilter)
          .select("department subject code description programOutcome bloomLevel keywords")
          .sort({ department: 1, subject: 1, code: 1 })
          .lean(),
        StudentOutcome.find(studentFilter)
          .select("department code description graduateAttributes peoLinks")
          .sort({ department: 1, code: 1 })
          .lean(),
        Question.aggregate([
          {
            $match: {
              courseOutcome: { $ne: "" },
              subject: subject ? courseFilter.subject : { $ne: "" },
            },
          },
          {
            $group: {
              _id: {
                subject: "$subject",
                courseOutcome: "$courseOutcome",
                engineeringProgram: "$engineeringProgram",
              },
              questionCount: { $sum: 1 },
              bloomLevels: { $addToSet: "$bloomLevel" },
            },
          },
        ]),
      ]);

    const coverageByCourse = new Map();

    questionCoverage.forEach((item) => {
      const key = `${item._id.subject}|||${item._id.courseOutcome}`;
      const existing =
        coverageByCourse.get(key) || {
          questionCount: 0,
          bloomLevels: new Set(),
          programs: [],
        };

      existing.questionCount += item.questionCount;
      item.bloomLevels.filter(Boolean).forEach((level) => {
        existing.bloomLevels.add(level);
      });
      existing.programs.push({
        engineeringProgram: item._id.engineeringProgram || "",
        questionCount: item.questionCount,
      });
      coverageByCourse.set(key, existing);
    });
    const studentOutcomeKey = (departmentValue, codeValue) =>
      `${String(departmentValue || "").toLowerCase()}|||${normalizeStudentOutcomeLink(codeValue)}`;
    const studentOutcomesByKey = new Map(
      studentOutcomes.map((outcome) => [
        studentOutcomeKey(outcome.department, outcome.code),
        outcome,
      ]),
    );
    const peoKey = (departmentValue, codeValue) =>
      `${String(departmentValue || "").toLowerCase()}|||${normalizePeoCode(codeValue)}`;
    const peosByKey = new Map(
      peos.map((peo) => [peoKey(peo.department, peo.code), peo]),
    );
    const orphanStudentOutcomes = new Map(studentOutcomesByKey);
    const mapRows = [];

    courseOutcomes.forEach((outcome) => {
      const linkedCodes = normalizeStudentOutcomeLink(outcome.programOutcome)
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      const coverage = coverageByCourse.get(
        `${outcome.subject}|||${outcome.code}`,
      ) || {
        questionCount: 0,
        bloomLevels: new Set(),
        programs: [],
      };
      const formattedCoverage = {
        questionCount: coverage.questionCount,
        bloomLevels: Array.from(coverage.bloomLevels).sort(),
        programs: coverage.programs.sort((a, b) =>
          a.engineeringProgram.localeCompare(b.engineeringProgram),
        ),
      };

      if (linkedCodes.length === 0) {
        mapRows.push({
          studentOutcome: null,
          courseOutcome: outcome,
          coverage: formattedCoverage,
        });
        return;
      }

      linkedCodes.forEach((code) => {
        const key = studentOutcomeKey(outcome.department, code);
        const studentOutcome = studentOutcomesByKey.get(key) || null;

        if (studentOutcome) {
          orphanStudentOutcomes.delete(key);
        }

        mapRows.push({
          studentOutcome,
          peos:
            studentOutcome?.peoLinks
              ?.split(/[,\s]+/)
              .map((code) => peosByKey.get(peoKey(studentOutcome.department, code)))
              .filter(Boolean) || [],
          courseOutcome: outcome,
          coverage: formattedCoverage,
        });
      });
    });

    res.json({
      success: true,
      curriculumMap: {
        rows: mapRows,
        unmappedStudentOutcomes: Array.from(orphanStudentOutcomes.values()),
        summary: {
          peoCount: peos.length,
          studentOutcomeCount: studentOutcomes.length,
          courseOutcomeCount: courseOutcomes.length,
          mappedCourseOutcomeCount: courseOutcomes.filter((outcome) =>
            normalizeStudentOutcomeLink(outcome.programOutcome),
          ).length,
          questionCoverageCount: questionCoverage.reduce(
            (total, item) => total + item.questionCount,
            0,
          ),
        },
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.listCurriculumMapCourses = async (req, res) => {
  try {
    const department = toTrimmedString(req.query.department);
    const subject = toTrimmedString(req.query.subject);
    const filter = {};

    if (department) {
      filter.department = new RegExp(
        department.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i",
      );
    }

    if (subject) {
      filter.subject = new RegExp(
        subject.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "i",
      );
    }

    const courses = await CurriculumMapCourse.find(filter)
      .populate("createdBy", "name email")
      .sort({ department: 1, courseCode: 1, subject: 1 })
      .lean();

    res.json({
      success: true,
      courses,
      alignmentLevels: CURRICULUM_ALIGNMENT_LEVELS,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.saveCurriculumMapCourse = async (req, res) => {
  try {
    const department = toTrimmedString(req.body.department);
    const courseCode = toTrimmedString(req.body.courseCode);
    const subject = toTrimmedString(req.body.subject);
    const units = Math.max(0, toNumber(req.body.units));
    const description = toTrimmedString(req.body.description);
    const alignments = normalizeCurriculumCourseAlignments(req.body.alignments);

    if (!subject) {
      return res.status(400).json({
        success: false,
        message: "Course subject is required.",
      });
    }

    if (alignments.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Select at least one SO alignment level.",
      });
    }

    const course = await CurriculumMapCourse.findOneAndUpdate(
      { department, courseCode, subject },
      {
        department,
        courseCode,
        subject,
        units,
        description,
        alignments,
        createdBy: req.user._id,
      },
      {
        upsert: true,
        new: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      },
    );

    res.status(201).json({
      success: true,
      message: "Curriculum map course saved.",
      course,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const curriculumMapCourseTitle = (course = {}) =>
  [
    course.subject,
    course.description ? `- ${course.description}` : "",
  ]
    .filter(Boolean)
    .join(" ");

const addCurriculumMapExportSection = (
  sheet,
  department,
  courses,
  studentOutcomes,
  startRow,
) => {
  const alignmentCodes = courses.flatMap((course) =>
    (course.alignments || []).map((alignment) =>
      normalizeStudentOutcomeLink(alignment.studentOutcome),
    ),
  );
  const soCodes = [
    ...new Set([
      ...studentOutcomes.map((outcome) =>
        normalizeStudentOutcomeLink(outcome.code),
      ),
      ...alignmentCodes,
    ]),
  ].filter(Boolean);
  const columnCodes =
    soCodes.length > 0
      ? soCodes
      : "abcdefghijklm".split("");
  const headerRow = startRow + 2;
  const firstSoColumn = 4;

  sheet.mergeCells(startRow, 1, startRow, Math.max(4, columnCodes.length + 3));
  sheet.getCell(startRow, 1).value = `${department || "All Departments"} Curriculum Map`;
  sheet.getCell(startRow, 1).font = { bold: true, size: 14 };
  sheet.getCell(startRow, 1).alignment = { horizontal: "center" };

  sheet.getCell(headerRow, 1).value = "Code";
  sheet.getCell(headerRow, 2).value = "Course";
  sheet.getCell(headerRow, 3).value = "Units";
  columnCodes.forEach((code, index) => {
    sheet.getCell(headerRow, firstSoColumn + index).value = code;
  });

  const header = sheet.getRow(headerRow);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF8A0015" },
  };
  header.alignment = { horizontal: "center", vertical: "middle" };

  const rows = courses.length
    ? courses
    : [{ courseCode: "", subject: "", units: "", alignments: [] }];

  rows.forEach((course, index) => {
    const rowNumber = headerRow + index + 1;
    const alignmentBySo = new Map(
      (course.alignments || []).map((alignment) => [
        normalizeStudentOutcomeLink(alignment.studentOutcome),
        alignment.level,
      ]),
    );

    sheet.getCell(rowNumber, 1).value = course.courseCode || "";
    sheet.getCell(rowNumber, 2).value = curriculumMapCourseTitle(course);
    sheet.getCell(rowNumber, 3).value = Number(course.units || 0) || "";
    columnCodes.forEach((code, soIndex) => {
      sheet.getCell(rowNumber, firstSoColumn + soIndex).value =
        alignmentBySo.get(code) || "";
    });
  });

  const endRow = headerRow + rows.length;
  const endColumn = Math.max(4, columnCodes.length + 3);

  for (let rowIndex = startRow; rowIndex <= endRow; rowIndex += 1) {
    for (let columnIndex = 1; columnIndex <= endColumn; columnIndex += 1) {
      const cell = sheet.getCell(rowIndex, columnIndex);
      cell.border = {
        top: { style: "thin", color: { argb: "FFD9D9D9" } },
        left: { style: "thin", color: { argb: "FFD9D9D9" } },
        bottom: { style: "thin", color: { argb: "FFD9D9D9" } },
        right: { style: "thin", color: { argb: "FFD9D9D9" } },
      };
      cell.alignment = {
        vertical: "top",
        horizontal: columnIndex >= firstSoColumn ? "center" : "left",
        wrapText: true,
      };
    }
  }

  return endRow + 3;
};

const buildCurriculumMapWorkbook = async () => {
  const [courses, studentOutcomes] = await Promise.all([
    CurriculumMapCourse.find()
      .sort({ department: 1, courseCode: 1, subject: 1 })
      .lean(),
    StudentOutcome.find()
      .select("department code description")
      .sort({ department: 1, code: 1 })
      .lean(),
  ]);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Curriculum Map");
  const legendSheet = workbook.addWorksheet("Legend");
  const departments = [
    ...new Set(
      [
        ...courses.map((course) => course.department || "All Departments"),
        ...studentOutcomes.map(
          (outcome) => outcome.department || "All Departments",
        ),
      ].filter(Boolean),
    ),
  ].sort();
  const exportDepartments =
    departments.length > 0 ? departments : ["All Departments"];

  sheet.views = [{ state: "frozen", ySplit: 3 }];
  sheet.getCell("A1").value = "College of Engineering Education";
  sheet.getCell("A2").value = "Curriculum Map";
  sheet.getCell("A1").font = { bold: true, size: 14 };
  sheet.getCell("A2").font = { bold: true, size: 16 };
  sheet.columns = [
    { width: 16 },
    { width: 54 },
    { width: 10 },
    ...Array.from({ length: 13 }, () => ({ width: 8 })),
  ];

  let nextRow = 4;
  exportDepartments.forEach((department) => {
    const departmentCourses = courses.filter(
      (course) =>
        (course.department || "All Departments") === department,
    );
    const departmentStudentOutcomes = studentOutcomes.filter(
      (outcome) =>
        (outcome.department || "All Departments") === department,
    );
    nextRow = addCurriculumMapExportSection(
      sheet,
      department,
      departmentCourses,
      departmentStudentOutcomes,
      nextRow,
    );
  });

  legendSheet.columns = [{ width: 18 }, { width: 60 }];
  legendSheet.addRows([
    ["Code", "Course Classification"],
    ["M-XX", "Mathematics"],
    ["S-XX", "Natural or Physical Science"],
    ["L-XX", "Laboratory Course"],
    ["E-XX", "Engineering Science"],
    ["A-XX", "Allied"],
    ["P-XX", "Professional"],
    ["N-XX", "Non-Technical"],
    ["I-XX", "Institutional"],
    ["T-XX", "Technical Electives"],
    [],
    ["Code", "Descriptor"],
    ["I", "Introductory Course"],
    ["E", "Enabling Course"],
    ["D", "Demonstrative Course"],
    [],
    ["Code", "Definition"],
    ["I", "An introductory course to an outcome"],
    ["E", "A course that strengthens the outcome"],
    ["D", "A course demonstrating an outcome"],
  ]);
  [1, 12, 17].forEach((rowNumber) => {
    const row = legendSheet.getRow(rowNumber);
    row.font = { bold: true, color: { argb: "FFFFFFFF" } };
    row.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF8A0015" },
    };
  });

  workbook.eachSheet((worksheet) => {
    worksheet.eachRow((row) => {
      row.alignment = { vertical: "top", wrapText: true };
    });
  });

  return workbook.xlsx.writeBuffer();
};

exports.downloadCurriculumMapWorkbook = async (req, res) => {
  try {
    const buffer = await buildCurriculumMapWorkbook();
    const today = new Date().toISOString().slice(0, 10);

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="curriculum-map-${today}.xlsx"`,
    );
    res.send(Buffer.from(buffer));
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.deleteCurriculumMapCourse = async (req, res) => {
  try {
    const course = await CurriculumMapCourse.findByIdAndDelete(req.params.id);

    if (!course) {
      return res.status(404).json({
        success: false,
        message: "Curriculum map course not found.",
      });
    }

    res.json({
      success: true,
      message: "Curriculum map course deleted.",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.updateSettings = async (req, res) => {
  try {
    const settings = await saveObeSettings(req.body, req.user._id);

    res.json({
      success: true,
      message: "OBE attainment targets saved.",
      settings,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.createRubricAssessment = async (req, res) => {
  try {
    const title = toTrimmedString(req.body.title);
    const subject = toTrimmedString(req.body.subject);
    const criteria = parseJsonArray(req.body.criteria).map((criterion) => ({
      label: toTrimmedString(criterion.label),
      itemNo: Math.max(
        0,
        toNumber(criterion.itemNo || parseRubricItemNo(criterion.label)),
      ),
      courseOutcome: toTrimmedString(criterion.courseOutcome),
      programOutcome: normalizeStudentOutcomeLink(criterion.programOutcome),
      performanceIndicator: toTrimmedString(criterion.performanceIndicator),
      bloomLevel: normalizeBloomLevel(criterion.bloomLevel),
      maxScore: Math.max(0, toNumber(criterion.maxScore)),
      targetScore: Math.max(0, toNumber(criterion.targetScore)),
      weight: Math.max(0, toNumber(criterion.weight, 1)),
    }));
    const studentScores = parseJsonArray(req.body.studentScores).map((student) => ({
      studentName: toTrimmedString(student.studentName),
      studentId: toTrimmedString(student.studentId),
      criterionScores: parseJsonArray(student.criterionScores).map((score) => ({
        criterionId: score.criterionId,
        criterionIndex: Math.max(0, toNumber(score.criterionIndex)),
        score: Math.max(0, toNumber(score.score)),
      })),
    }));

    if (!title || !subject) {
      return res.status(400).json({
        success: false,
        message: "Rubric title and subject are required.",
      });
    }

    if (!criteria.length || criteria.some((criterion) => !criterion.label)) {
      return res.status(400).json({
        success: false,
        message: "At least one rubric criterion with a label is required.",
      });
    }

    const assessment = await RubricAssessment.create({
      title,
      subject,
      engineeringProgram: toTrimmedString(req.body.engineeringProgram),
      section: toTrimmedString(req.body.section),
      semester: toTrimmedString(req.body.semester),
      schoolYear: toTrimmedString(req.body.schoolYear),
      assessmentMethod: normalizeAssessmentMethod(req.body.assessmentMethod),
      assessmentPhase: normalizeAssessmentPhase(req.body.assessmentPhase),
      criteria,
      studentScores: studentScores.filter((student) => student.studentName),
      createdBy: req.user._id,
    });

    res.status(201).json({
      success: true,
      message: "Rubric assessment saved.",
      assessment,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

exports.listRubricAssessments = async (req, res) => {
  try {
    const filter = {};

    if (!isSuperAdmin(req.user)) {
      filter.createdBy = req.user._id;
    }

    const assessments = await RubricAssessment.find(filter)
      .populate("createdBy", "name email")
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    const settings = await getObeSettings();

    const assessmentsWithAttainment = await Promise.all(
      assessments.map(async (assessment) => ({
        ...assessment,
        attainment: await calculateRubricAttainment(assessment, settings),
      })),
    );

    res.json({
      success: true,
      assessments: assessmentsWithAttainment,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.deleteRubricAssessment = async (req, res) => {
  try {
    const query = { _id: req.params.id };

    if (!isSuperAdmin(req.user)) {
      query.createdBy = req.user._id;
    }

    const assessment = await RubricAssessment.findOneAndDelete(query);

    if (!assessment) {
      return res.status(404).json({
        success: false,
        message: "Rubric assessment not found.",
      });
    }

    res.json({
      success: true,
      message: "Rubric assessment deleted.",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.listRubricTemplates = async (req, res) => {
  try {
    await ensureDefaultRubricTemplates();
    const templates = await RubricTemplate.find()
      .sort({ isSystem: -1, name: 1 })
      .lean();

    res.json({
      success: true,
      templates,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.updateRubricTemplate = async (req, res) => {
  try {
    await ensureDefaultRubricTemplates();
    const criteria = normalizeRubricTemplateCriteria(req.body.criteria);

    if (!criteria.length) {
      return res.status(400).json({
        success: false,
        message: "At least one rubric criterion with max points is required.",
      });
    }

    const template = await RubricTemplate.findByIdAndUpdate(
      req.params.id,
      {
        name: toTrimmedString(req.body.name),
        description: toTrimmedString(req.body.description),
        criteria,
        updatedBy: req.user._id,
      },
      { new: true, runValidators: true },
    );

    if (!template) {
      return res.status(404).json({
        success: false,
        message: "Rubric template not found.",
      });
    }

    res.json({
      success: true,
      message: "Rubric template saved.",
      template,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

exports.downloadRubricTemplate = async (req, res) => {
  try {
    await ensureDefaultRubricTemplates();
    let itemCount = Math.min(
      50,
      Math.max(1, Number(req.query.items || req.query.itemCount || 3)),
    );
    const maxScore = Math.max(1, toNumber(req.query.maxScore || 10));
    const targetScore = Math.max(
      0,
      toNumber(req.query.targetScore || maxScore * 0.75),
    );
    const rubricType = toTrimmedString(req.query.rubricType || "problem-solving");
    const rubricPreset = getRubricTemplatePreset(rubricType);
    const rubricTemplate =
      (await RubricTemplate.findById(req.query.rubricTemplateId).lean().catch(
        () => null,
      )) ||
      (await RubricTemplate.findOne({
        key: DEFAULT_PROBLEM_SOLVING_RUBRIC.key,
      }).lean());
    const rubricCriteria = rubricTemplate?.criteria?.length
      ? rubricTemplate.criteria
      : DEFAULT_PROBLEM_SOLVING_RUBRIC.criteria;
    const rubricMaxScore = rubricCriteria.reduce(
      (sum, criterion) => sum + Number(criterion.maxPoints || 0),
      0,
    );
    const generatedExamId = toTrimmedString(req.query.generatedExamId);
    let linkedExam = null;

    if (generatedExamId) {
      if (!/^[a-f\d]{24}$/i.test(generatedExamId)) {
        return res.status(400).json({
          success: false,
          message: "Choose a valid generated exam for the rubric template.",
        });
      }

      const examQuery = { _id: generatedExamId };
      if (!isSuperAdmin(req.user)) {
        examQuery.user = req.user._id;
      }

      linkedExam = await Exam.findOne(examQuery)
        .populate({
          path: "questions",
          select:
            "questionText courseOutcome programOutcome performanceIndicator bloomLevel questionType",
        })
        .lean();

      if (!linkedExam) {
        return res.status(404).json({
          success: false,
          message: "Linked generated exam not found.",
        });
      }

      if (linkedExam.examType !== "Problem Solving") {
        return res.status(400).json({
          success: false,
          message:
            "Choose a generated Problem Solving exam before downloading a mapped rubric template.",
        });
      }

      itemCount = Math.min(
        50,
        Math.max(
          1,
          Number(linkedExam.questions?.length || linkedExam.totalItems || itemCount),
        ),
      );
    }

    const itemMappings = Array.from({ length: itemCount }, (_, itemIndex) => {
      const itemNo = itemIndex + 1;
      const question = linkedExam?.questions?.[itemIndex] || {};
      const programOutcome =
        normalizeStudentOutcomeLink(question.programOutcome) ||
        rubricPreset.studentOutcome;

      return {
        itemNo,
        subject: linkedExam?.subject || "Circuits 1",
        questionText: toTrimmedString(question.questionText),
        courseOutcome: toTrimmedString(question.courseOutcome) || `CO${itemNo}`,
        programOutcome,
        performanceIndicator:
          toTrimmedString(question.performanceIndicator) || `PI ${itemNo}`,
        bloomLevel:
          normalizeBloomLevel(question.bloomLevel) || rubricPreset.bloomLevel,
      };
    });

    const workbook = new ExcelJS.Workbook();
    const infoSheet = workbook.addWorksheet("Assessment Info");
    const mappingSheet = workbook.addWorksheet("Item Mapping");
    const scoreSheet = workbook.addWorksheet("Rubric Scores");
    const scaleSheet = workbook.addWorksheet("Rubric Scale");
    const instructionSheet = workbook.addWorksheet("Instructions");

    infoSheet.columns = [
      { header: "Field", key: "field", width: 24 },
      { header: "Value", key: "value", width: 36 },
    ];
    infoSheet.addRows([
      { field: "Title", value: linkedExam?.title || rubricTemplate?.name || rubricPreset.title },
      { field: "Subject", value: linkedExam?.subject || "Circuits 1" },
      { field: "Program", value: linkedExam?.engineeringProgram || "ECE" },
      { field: "Section", value: linkedExam?.section || "BSECE 3A" },
      { field: "Term", value: linkedExam?.semester || "1st Sem 1st Term" },
      { field: "School Year", value: linkedExam?.schoolYear || "2025-2026" },
      { field: "Assessment Method", value: linkedExam?.assessmentMethod || rubricPreset.assessmentMethod },
      { field: "Assessment Phase", value: linkedExam?.assessmentPhase || "Summative" },
      { field: "Rubric Type", value: rubricTemplate?.name || rubricPreset.name },
      { field: "Linked Generated Exam", value: linkedExam?.title || "Manual mapping" },
      { field: "Problem-Solving Items", value: itemCount },
      { field: "Default Max Score", value: rubricMaxScore || maxScore },
    ]);

    mappingSheet.columns = [
      { header: "Item No", key: "itemNo", width: 10 },
      { header: "Subject", key: "subject", width: 24 },
      { header: "Question Text", key: "questionText", width: 70 },
      { header: "CO/CLO", key: "courseOutcome", width: 14 },
      { header: "SO", key: "programOutcome", width: 10 },
      { header: "PI", key: "performanceIndicator", width: 20 },
      { header: "Bloom", key: "bloomLevel", width: 16 },
    ];
    mappingSheet.addRows(
      itemMappings.map((mapping) => ({
        ...mapping,
        questionText:
          mapping.questionText ||
          "Manual item. Edit this row and the matching Rubric Scores headers if needed.",
      })),
    );

    scoreSheet.columns = [
      { header: "Student Name", key: "studentName", width: 24 },
      { header: "Student ID", key: "studentId", width: 18 },
      { header: "Section", key: "section", width: 16 },
      ...Array.from({ length: itemCount }, (_, itemIndex) =>
        rubricCriteria.map((criterion, criterionIndex) => {
          const itemNo = itemIndex + 1;
          const criterionNo = criterionIndex + 1;
          const mapping = itemMappings[itemIndex] || {};
          const criterionMax = Math.max(0, Number(criterion.maxPoints || 0));
          const criterionTarget = Math.round(criterionMax * 0.75 * 100) / 100;

          return {
            header: `${rubricPreset.label(itemNo)} - ${criterion.criterion} | ${
              mapping.courseOutcome || `CO${itemNo}`
            } | ${mapping.programOutcome || rubricPreset.studentOutcome} | ${
              mapping.performanceIndicator || `PI ${itemNo}.${criterionNo}`
            } | ${mapping.bloomLevel || rubricPreset.bloomLevel} | ${criterionMax} | ${criterionTarget}`,
            key: `item${itemNo}Criterion${criterionNo}`,
            width: 58,
          };
        }),
      ).flat(),
    ];
    scoreSheet.addRows([
      {
        studentName: "Juan Dela Cruz",
        studentId: "2025-001",
        section: "BSECE 3A",
        ...Object.fromEntries(
          Array.from({ length: itemCount }, (_, itemIndex) =>
            rubricCriteria.map((criterion, criterionIndex) => [
              `item${itemIndex + 1}Criterion${criterionIndex + 1}`,
              Math.max(0, Number(criterion.maxPoints || 0) - (criterionIndex % 2)),
            ]),
          ).flat(),
        ),
      },
      {
        studentName: "Maria Santos",
        studentId: "2025-002",
        section: "BSECE 3A",
        ...Object.fromEntries(
          Array.from({ length: itemCount }, (_, itemIndex) =>
            rubricCriteria.map((criterion, criterionIndex) => [
              `item${itemIndex + 1}Criterion${criterionIndex + 1}`,
              Math.max(0, Number(criterion.maxPoints || 0) - 1 - (criterionIndex % 2)),
            ]),
          ).flat(),
        ),
      },
    ]);

    scaleSheet.columns = [
      { header: "Criterion", key: "criterion", width: 32 },
      { header: "Excellent", key: "excellent", width: 58 },
      { header: "Good", key: "good", width: 52 },
      { header: "Fair", key: "fair", width: 52 },
      { header: "Needs Improvement", key: "needsImprovement", width: 52 },
      { header: "Max Points", key: "maxPoints", width: 14 },
    ];
    scaleSheet.addRows([
      ...rubricCriteria,
      {
        needsImprovement: "Total",
        maxPoints: rubricMaxScore,
      },
    ]);

    instructionSheet.columns = [
      { header: "Instruction", key: "instruction", width: 110 },
    ];
    instructionSheet.addRows([
      {
        instruction:
          "Fill Assessment Info values, then replace sample rows in Rubric Scores with actual students.",
      },
      {
        instruction:
          "Choose the saved rubric before download. Its criteria and max points become the scoring columns for every problem-solving item.",
      },
      {
        instruction:
          "Choose a generated Problem Solving exam before download to automatically copy each item's CO/CLO, SO, PI, and Bloom level into the template.",
      },
      {
        instruction:
          "Use the Item Mapping sheet to review which subject, CO/CLO, SO, PI, and Bloom level belong to each problem-solving item.",
      },
      {
        instruction:
          "CO/CLO attainment is subject-scoped during import and reporting. For example, Circuits 1 - CO1 is treated differently from Electronics 1 - CO1.",
      },
      {
        instruction:
          "For problem-solving item analysis, keep each scored problem header beginning with Item 1, Item 2, etc. The same Rubric Scores sheet can be uploaded as a Problem Solving item-analysis result file.",
      },
      {
        instruction:
          "Criterion headers must use: Item N or Criterion | CO/CLO | SO | PI | Bloom | Max Score | Target Score.",
      },
      {
        instruction:
          "Scores under each item/criterion are the student's raw earned score for that problem.",
      },
      {
        instruction:
          "Accepted assessment methods: Major Exam, Quiz, Assignment, Project, Laboratory, Recitation, Practical Exam, Other.",
      },
    ]);

    [infoSheet, mappingSheet, scoreSheet, scaleSheet, instructionSheet].forEach((sheet) => {
      sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      sheet.getRow(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF860012" },
      };
      sheet.views = [{ state: "frozen", ySplit: 1 }];
    });

    const buffer = await workbook.xlsx.writeBuffer();

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="rubric-${rubricType}-${itemCount}-items-template.xlsx"`,
    );
    res.send(Buffer.from(buffer));
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.importRubricAssessment = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Rubric Excel or CSV file is required.",
      });
    }

    const workbook = await readWorkbook(req.file);
    const infoSheet =
      workbook.getWorksheet("Assessment Info") || workbook.worksheets[0];
    const scoreSheet =
      workbook.getWorksheet("Rubric Scores") || workbook.worksheets[1];

    if (!infoSheet || !scoreSheet) {
      return res.status(400).json({
        success: false,
        message:
          "The workbook must include Assessment Info and Rubric Scores sheets.",
      });
    }

    const info = {};
    infoSheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const key = getCellText(row, 1).toLowerCase();
      const value = getCellText(row, 2);

      if (key) info[key] = value;
    });

    const headerRow = scoreSheet.getRow(1);
    const criteria = [];
    const criterionColumns = [];

    for (let column = 3; column <= scoreSheet.columnCount; column += 1) {
      const header = getCellText(headerRow, column);
      if (!header) continue;
      if (normalizeHeader(header) === "section") continue;

      const parts = header.split("|").map((part) => part.trim());
      const hasPiColumn = parts.length >= 7;
      const criterion = {
        label: parts[0] || "",
        itemNo: parseRubricItemNo(parts[0] || ""),
        courseOutcome: parts[1] || "",
        programOutcome: normalizeStudentOutcomeLink(parts[2] || ""),
        performanceIndicator: hasPiColumn ? parts[3] || "" : "",
        bloomLevel: normalizeBloomLevel(parts[hasPiColumn ? 4 : 3] || ""),
        maxScore: Math.max(0, toNumber(parts[hasPiColumn ? 5 : 4])),
        targetScore: Math.max(0, toNumber(parts[hasPiColumn ? 6 : 5])),
        weight: 1,
      };

      if (criterion.label && criterion.maxScore > 0) {
        criterionColumns.push({ column, criterionIndex: criteria.length });
        criteria.push(criterion);
      }
    }

    if (!criteria.length) {
      return res.status(400).json({
        success: false,
        message:
          "No rubric criteria found. Use headers like: Analysis | CO1 | a | PI 1 | Apply | 20 | 15",
      });
    }

    const studentScores = [];
    scoreSheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;

      const studentName = getCellText(row, 1);
      if (!studentName) return;

      studentScores.push({
        studentName,
        studentId: getCellText(row, 2),
        criterionScores: criterionColumns.map(({ column, criterionIndex }) => ({
          criterionIndex,
          score: Math.max(0, toNumber(getCellText(row, column))),
        })),
      });
    });

    const title = toTrimmedString(req.body.title) || info.title;
    const subject = toTrimmedString(req.body.subject) || info.subject;

    if (!title || !subject) {
      return res.status(400).json({
        success: false,
        message:
          "Rubric title and subject are required in the Assessment Info sheet.",
      });
    }

    const assessment = await RubricAssessment.create({
      title,
      subject,
      engineeringProgram:
        toTrimmedString(req.body.engineeringProgram) || info.program || "",
      section: toTrimmedString(req.body.section) || info.section || "",
      semester: toTrimmedString(req.body.semester) || info.term || "",
      schoolYear:
        toTrimmedString(req.body.schoolYear) || info["school year"] || "",
      assessmentMethod: normalizeAssessmentMethod(
        req.body.assessmentMethod || info["assessment method"],
      ),
      assessmentPhase: normalizeAssessmentPhase(
        req.body.assessmentPhase || info["assessment phase"],
      ),
      criteria,
      studentScores,
      createdBy: req.user._id,
    });

    res.status(201).json({
      success: true,
      message: `Rubric assessment imported with ${criteria.length} criteria and ${studentScores.length} student rows.`,
      assessment,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

exports.createEvidence = async (req, res) => {
  try {
    const title = toTrimmedString(req.body.title);

    if (!title) {
      return res.status(400).json({
        success: false,
        message: "Evidence title is required.",
      });
    }

    const evidence = await ObeEvidence.create({
      title,
      evidenceType: toTrimmedString(req.body.evidenceType) || "Other",
      subject: toTrimmedString(req.body.subject),
      engineeringProgram: toTrimmedString(req.body.engineeringProgram),
      section: toTrimmedString(req.body.section),
      semester: toTrimmedString(req.body.semester),
      schoolYear: toTrimmedString(req.body.schoolYear),
      assessmentPhase: normalizeAssessmentPhase(req.body.assessmentPhase),
      courseOutcome: toTrimmedString(req.body.courseOutcome),
      programOutcome: normalizeStudentOutcomeLink(req.body.programOutcome),
      description: toTrimmedString(req.body.description),
      fileName: req.file?.filename || "",
      originalName: req.file?.originalname || "",
      mimeType: req.file?.mimetype || "",
      filePath: req.file ? `/uploads/${req.file.filename}` : "",
      uploadedBy: req.user._id,
    });

    res.status(201).json({
      success: true,
      message: "OBE evidence saved.",
      evidence,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

exports.listEvidence = async (req, res) => {
  try {
    const filter = {};

    if (!isSuperAdmin(req.user)) {
      filter.uploadedBy = req.user._id;
    }

    ["subject", "engineeringProgram", "section", "semester", "schoolYear"].forEach(
      (field) => {
        const value = toTrimmedString(req.query[field]);
        if (value) filter[field] = value;
      },
    );

    const evidence = await ObeEvidence.find(filter)
      .populate("uploadedBy", "name email")
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    res.json({
      success: true,
      evidence,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.deleteEvidence = async (req, res) => {
  try {
    const query = { _id: req.params.id };

    if (!isSuperAdmin(req.user)) {
      query.uploadedBy = req.user._id;
    }

    const evidence = await ObeEvidence.findOneAndDelete(query);

    if (!evidence) {
      return res.status(404).json({
        success: false,
        message: "OBE evidence not found.",
      });
    }

    res.json({
      success: true,
      message: "OBE evidence deleted.",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.createAttainmentSnapshot = async (req, res) => {
  try {
    const title = toTrimmedString(req.body.title);

    if (!title) {
      return res.status(400).json({
        success: false,
        message: "Snapshot title is required.",
      });
    }

    const filters = {
      engineeringProgram: toTrimmedString(req.body.engineeringProgram),
      subject: toTrimmedString(req.body.subject),
      section: toTrimmedString(req.body.section),
      semester: toTrimmedString(req.body.semester),
      schoolYear: toTrimmedString(req.body.schoolYear),
      assessmentMethod: toTrimmedString(req.body.assessmentMethod),
    };
    const payload = await calculateReportsPayload(filters);
    const obeReport = payload.obeReport || {};
    const summary = obeReport.courseLevelSummary || {};

    const snapshot = await ObeAttainmentSnapshot.create({
      title,
      ...filters,
      filterSummary: payload.filterSummary,
      summary: {
        assessedClos: summary.assessedClos || 0,
        attainedClos: summary.attainedClos || 0,
        assessedSos: summary.assessedSos || 0,
        attainedSos: summary.attainedSos || 0,
        overallAttainmentRate: summary.overallAttainmentRate || 0,
        targetRate: summary.targetRate || 75,
        status: summary.status || "No Evidence",
      },
      courseOutcomes: obeReport.courseOutcomes || [],
      studentOutcomes: obeReport.programOutcomes || [],
      evidenceTraceabilityMatrix: obeReport.evidenceTraceabilityMatrix || [],
      createdBy: req.user._id,
    });

    res.status(201).json({
      success: true,
      message: "OBE attainment snapshot saved.",
      snapshot,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.listAttainmentSnapshots = async (req, res) => {
  try {
    const snapshots = await ObeAttainmentSnapshot.find()
      .populate("createdBy", "name email")
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    res.json({
      success: true,
      snapshots,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.deleteAttainmentSnapshot = async (req, res) => {
  try {
    const snapshot = await ObeAttainmentSnapshot.findByIdAndDelete(req.params.id);

    if (!snapshot) {
      return res.status(404).json({
        success: false,
        message: "OBE snapshot not found.",
      });
    }

    res.json({
      success: true,
      message: "OBE snapshot deleted.",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
