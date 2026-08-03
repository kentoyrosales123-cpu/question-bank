const { Readable } = require("stream");
const ExcelJS = require("exceljs");
const CourseOutcome = require("../models/CourseOutcome");
const StudentOutcome = require("../models/StudentOutcome");
const ProgramEducationalObjective = require("../models/ProgramEducationalObjective");
const Question = require("../models/Question");
const RubricAssessment = require("../models/RubricAssessment");
const ObeEvidence = require("../models/ObeEvidence");
const ObeAttainmentSnapshot = require("../models/ObeAttainmentSnapshot");
const { getObeSettings, saveObeSettings } = require("../services/obeSettingsService");
const { calculateReportsPayload } = require("./dashboardController");
const {
  normalizeAssessmentMethod,
} = require("../utils/assessmentMethods");
const { isSuperAdmin } = require("../utils/roles");

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

const calculateRubricAttainment = (assessment, settings) => {
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
      });
    }

    return map.get(key);
  };

  criteria.forEach((criterion) => {
    ensureBucket(
      courseOutcomes,
      criterion.courseOutcome || "Unmapped CLO",
      settings.courseOutcomeTarget,
    ).criteriaCount += 1;
    ensureBucket(
      studentOutcomes,
      criterion.programOutcome || "Unmapped SO",
      settings.studentOutcomeTarget,
    ).criteriaCount += 1;
  });

  const scoreByCriterion = (student, criterion, index) => {
    const match = (student.criterionScores || []).find(
      (item) =>
        String(item.criterionId || "") === String(criterion._id) ||
        Number(item.criterionIndex) === index,
    );

    return Math.max(0, Math.min(toNumber(match?.score), toNumber(criterion.maxScore)));
  };

  const recordScore = (bucket, score, maxScore, studentPassed) => {
    bucket.totalScore += maxScore;
    bucket.earnedScore += score;
    bucket.assessedStudents += 1;
    if (studentPassed) bucket.attainedStudents += 1;
  };

  scores.forEach((student) => {
    criteria.forEach((criterion, index) => {
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
          criterion.courseOutcome || "Unmapped CLO",
          settings.courseOutcomeTarget,
        ),
        score,
        maxScore,
        studentPassed,
      );
      recordScore(
        ensureBucket(
          studentOutcomes,
          criterion.programOutcome || "Unmapped SO",
          settings.studentOutcomeTarget,
        ),
        score,
        maxScore,
        studentPassed,
      );
    });
  });

  const finalize = (bucket) => {
    const attainmentRate =
      bucket.totalScore > 0
        ? Math.round((bucket.earnedScore / bucket.totalScore) * 1000) / 10
        : 0;

    return {
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
  };

  return {
    courseOutcomes: Array.from(courseOutcomes.values()).map(finalize),
    studentOutcomes: Array.from(studentOutcomes.values()).map(finalize),
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
    .filter((part, index) => index < 4 || part);

  return {
    code: parts[0] || "",
    description: parts[1] || "",
    graduateAttributes: parts[2] || "",
    peoLinks: normalizePeoLinks(parts[3]),
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
      .sort({ department: 1, code: 1 });

    res.json({
      success: true,
      studentOutcomes,
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
    const { department, code, description, graduateAttributes, peoLinks } =
      req.body;

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
          "No valid rows found. Use: SO a | Description | GA links | PEO links",
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
      courseOutcome: toTrimmedString(criterion.courseOutcome),
      programOutcome: normalizeStudentOutcomeLink(criterion.programOutcome),
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

    res.json({
      success: true,
      assessments: assessments.map((assessment) => ({
        ...assessment,
        attainment: calculateRubricAttainment(assessment, settings),
      })),
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

exports.downloadRubricTemplate = async (req, res) => {
  try {
    const workbook = new ExcelJS.Workbook();
    const infoSheet = workbook.addWorksheet("Assessment Info");
    const scoreSheet = workbook.addWorksheet("Rubric Scores");
    const instructionSheet = workbook.addWorksheet("Instructions");

    infoSheet.columns = [
      { header: "Field", key: "field", width: 24 },
      { header: "Value", key: "value", width: 36 },
    ];
    infoSheet.addRows([
      { field: "Title", value: "Design Project Rubric" },
      { field: "Subject", value: "Circuits 1" },
      { field: "Program", value: "ECE" },
      { field: "Section", value: "BSECE 3A" },
      { field: "Term", value: "1st Sem 1st Term" },
      { field: "School Year", value: "2025-2026" },
      { field: "Assessment Method", value: "Project" },
    ]);

    scoreSheet.columns = [
      { header: "Student Name", key: "studentName", width: 24 },
      { header: "Student ID", key: "studentId", width: 18 },
      {
        header: "Analysis | CO1 | a | Apply | 20 | 15",
        key: "criterion1",
        width: 34,
      },
      {
        header: "Prototype Output | CO2 | b | Create | 30 | 22.5",
        key: "criterion2",
        width: 42,
      },
      {
        header: "Documentation | CO3 | d | Evaluate | 10 | 7.5",
        key: "criterion3",
        width: 42,
      },
    ];
    scoreSheet.addRows([
      {
        studentName: "Juan Dela Cruz",
        studentId: "2025-001",
        criterion1: 18,
        criterion2: 25,
        criterion3: 9,
      },
      {
        studentName: "Maria Santos",
        studentId: "2025-002",
        criterion1: 15,
        criterion2: 28,
        criterion3: 8,
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
          "Criterion headers must use: Criterion | CO/CLO | SO | Bloom | Max Score | Target Score",
      },
      {
        instruction:
          "Scores under each criterion are the student's raw score for that criterion.",
      },
      {
        instruction:
          "Accepted assessment methods: Major Exam, Quiz, Assignment, Project, Laboratory, Recitation, Practical Exam, Other.",
      },
    ]);

    [infoSheet, scoreSheet, instructionSheet].forEach((sheet) => {
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
      'attachment; filename="rubric-assessment-template.xlsx"',
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

      const parts = header.split("|").map((part) => part.trim());
      const criterion = {
        label: parts[0] || "",
        courseOutcome: parts[1] || "",
        programOutcome: normalizeStudentOutcomeLink(parts[2] || ""),
        bloomLevel: normalizeBloomLevel(parts[3] || ""),
        maxScore: Math.max(0, toNumber(parts[4])),
        targetScore: Math.max(0, toNumber(parts[5])),
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
          "No rubric criteria found. Use headers like: Analysis | CO1 | a | Apply | 20 | 15",
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
