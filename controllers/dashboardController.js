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
      recentActivity,
    ] = await Promise.all([
      User.countDocuments(),
      Question.countDocuments(),
      Exam.countDocuments(),
      Exam.countDocuments({ submitted: true }),
      Question.countDocuments({ difficulty: "Easy" }),
      Question.countDocuments({ difficulty: "Average" }),
      Question.countDocuments({ difficulty: "Difficult" }),
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
