const CourseOutcome = require("../models/CourseOutcome");
const StudentOutcome = require("../models/StudentOutcome");

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

const normalizePeoLinks = (value = "") =>
  String(value || "")
    .split(/[,\s]+/)
    .map((item) => item.replace(/^PEO/i, "").trim())
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
