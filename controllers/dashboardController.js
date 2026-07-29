const ExcelJS = require("exceljs");
const User = require("../models/User");
const Question = require("../models/Question");
const Exam = require("../models/Exam");
const ActivityLog = require("../models/ActivityLog");

const getActivityAction = (activityOrAction) =>
  typeof activityOrAction === "string" ? activityOrAction : activityOrAction?.action;

const isTosDownloadActivity = (activityOrAction) =>
  getActivityAction(activityOrAction) === "download_tos" ||
  activityOrAction?.metadata?.documentType === "tos";

const formatActivityAction = (activityOrAction) => {
  const action = getActivityAction(activityOrAction);

  return isTosDownloadActivity(activityOrAction)
    ? "Downloaded TOS"
    : action === "generate_exam"
    ? "Generated Exam"
    : action === "approve_exam"
    ? "Approved Exam"
    : action === "reject_exam"
    ? "Rejected Exam"
    : action === "download_exam"
    ? "Downloaded Exam"
    : "Logged In";
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

const toOutcomeKey = (value, fallback) => String(value || fallback).trim();

const createOutcomeBucket = (code) => ({
  code,
  questionCount: 0,
  assessedItems: 0,
  correctItems: 0,
  possibleWeight: 0,
  attainedWeight: 0,
  attainmentRate: 0,
});

const calculateObeReport = async () => {
  const [questions, submittedExams] = await Promise.all([
    Question.find()
      .select("courseOutcome programOutcome bloomLevel outcomeWeight")
      .lean(),
    Exam.find({ submitted: true })
      .select("answers questions")
      .populate({
        path: "questions",
        select: "courseOutcome programOutcome bloomLevel outcomeWeight",
      })
      .lean(),
  ]);

  const courseOutcomes = new Map();
  const programOutcomes = new Map();
  const bloomLevels = new Map();
  let alignedQuestions = 0;

  questions.forEach((question) => {
    const courseOutcome = toOutcomeKey(question.courseOutcome, "Unmapped CLO");
    const programOutcome = toOutcomeKey(question.programOutcome, "Unmapped PLO");
    const bloomLevel = toOutcomeKey(question.bloomLevel, "Unmapped Bloom");

    if (question.courseOutcome && question.programOutcome) {
      alignedQuestions++;
    }

    if (!courseOutcomes.has(courseOutcome)) {
      courseOutcomes.set(courseOutcome, createOutcomeBucket(courseOutcome));
    }
    if (!programOutcomes.has(programOutcome)) {
      programOutcomes.set(programOutcome, createOutcomeBucket(programOutcome));
    }
    if (!bloomLevels.has(bloomLevel)) {
      bloomLevels.set(bloomLevel, { level: bloomLevel, questionCount: 0 });
    }

    courseOutcomes.get(courseOutcome).questionCount++;
    programOutcomes.get(programOutcome).questionCount++;
    bloomLevels.get(bloomLevel).questionCount++;
  });

  submittedExams.forEach((exam) => {
    const questionsById = new Map(
      (exam.questions || []).map((question) => [
        question._id.toString(),
        question,
      ]),
    );

    (exam.answers || []).forEach((answer) => {
      const question = questionsById.get(answer.question?.toString());

      if (!question) {
        return;
      }

      const courseOutcome = toOutcomeKey(question.courseOutcome, "Unmapped CLO");
      const programOutcome = toOutcomeKey(question.programOutcome, "Unmapped PLO");
      const weight = Math.max(0, Number(question.outcomeWeight || 1));

      if (!courseOutcomes.has(courseOutcome)) {
        courseOutcomes.set(courseOutcome, createOutcomeBucket(courseOutcome));
      }
      if (!programOutcomes.has(programOutcome)) {
        programOutcomes.set(programOutcome, createOutcomeBucket(programOutcome));
      }

      [courseOutcomes.get(courseOutcome), programOutcomes.get(programOutcome)].forEach(
        (bucket) => {
          bucket.assessedItems++;
          bucket.possibleWeight += weight;

          if (answer.isCorrect) {
            bucket.correctItems++;
            bucket.attainedWeight += weight;
          }
        },
      );
    });
  });

  const finalizeBuckets = (buckets) =>
    Array.from(buckets.values())
      .map((bucket) => ({
        ...bucket,
        attainmentRate:
          bucket.possibleWeight > 0
            ? Math.round((bucket.attainedWeight / bucket.possibleWeight) * 1000) /
              10
            : 0,
      }))
      .sort((a, b) => a.code.localeCompare(b.code));

  return {
    alignedQuestions,
    unmappedQuestions: questions.length - alignedQuestions,
    alignmentRate:
      questions.length > 0
        ? Math.round((alignedQuestions / questions.length) * 1000) / 10
        : 0,
    courseOutcomes: finalizeBuckets(courseOutcomes),
    programOutcomes: finalizeBuckets(programOutcomes),
    bloomLevels: Array.from(bloomLevels.values()).sort((a, b) =>
      a.level.localeCompare(b.level),
    ),
  };
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
        .select("title totalItems approvalStatus user createdAt")
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
    const [
      totalUsers,
      totalQuestions,
      totalExams,
      submittedExams,
      easyQuestions,
      averageQuestions,
      difficultQuestions,
      obeReport,
      recentActivity,
    ] = await Promise.all([
      User.countDocuments(),
      Question.countDocuments(),
      Exam.countDocuments(),
      Exam.countDocuments({ submitted: true }),
      Question.countDocuments({ difficulty: "Easy" }),
      Question.countDocuments({ difficulty: "Average" }),
      Question.countDocuments({ difficulty: "Difficult" }),
      calculateObeReport(),
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

    res.json({
      success: true,
      report: {
        totalUsers,
        totalQuestions,
        totalExams,
        submittedExams,
        pendingExams: totalExams - submittedExams,
        easyQuestions,
        averageQuestions,
        difficultQuestions,
        obeReport,
        loginCount:
          activityCounts.find((item) => item._id === "login")?.count || 0,
        generatedExamCount:
          activityCounts.find((item) => item._id === "generate_exam")?.count ||
          0,
        downloadedTosCount:
          activityCounts.find((item) => item._id === "download_tos")?.count ||
          0,
        activityCount: totalActivityCount,
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
