const User = require("../models/User");
const Question = require("../models/Question");
const Exam = require("../models/Exam");
const ActivityLog = require("../models/ActivityLog");

const csvCell = (value) => {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
};

const formatActivityAction = (action) =>
  action === "generate_exam" ? "Generated Exam" : "Logged In";

const buildActivityCsv = (activities) => {
  const headers = [
    "User Name",
    "Email",
    "Role",
    "Activity",
    "Details",
    "Date",
    "Time",
    "IP Address",
    "Browser",
  ];

  const rows = activities.map((activity) => {
    const activityDate = new Date(activity.createdAt);
    const user = activity.user || {};

    return [
      user.name || "Unknown user",
      user.email || "",
      user.role || "",
      formatActivityAction(activity.action),
      activity.description,
      activityDate.toLocaleDateString(),
      activityDate.toLocaleTimeString(),
      activity.ipAddress,
      activity.userAgent,
    ];
  });

  return [headers, ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
};

exports.getDashboardStats = async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalQuestions = await Question.countDocuments();

    const easyQuestions = await Question.countDocuments({
      difficulty: "Easy",
    });

    const averageQuestions = await Question.countDocuments({
      difficulty: "Average",
    });

    const difficultQuestions = await Question.countDocuments({
      difficulty: "Difficult",
    });

    const recentQuestions = await Question.find()
      .sort({ createdAt: -1 })
      .limit(5);

    const recentExams = await Exam.find()
      .populate("user", "name email")
      .sort({ createdAt: -1 })
      .limit(5);

    const registeredUsers = await User.find()
      .select("name email role createdAt")
      .sort({ createdAt: -1 })
      .limit(20);

    const recentActivity = await ActivityLog.find()
      .populate("user", "name email role")
      .sort({ createdAt: -1 })
      .limit(20);

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
    const activities = await ActivityLog.find()
      .populate("user", "name email role")
      .sort({ createdAt: -1 });

    const csv = buildActivityCsv(activities);
    const today = new Date().toISOString().slice(0, 10);

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="activity-log-${today}.csv"`,
    );

    res.send(`\uFEFF${csv}`);
  } catch (error) {
    res.status(500).json({
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
        .limit(25),
    ]);

    const activityCounts = await ActivityLog.aggregate([
      {
        $group: {
          _id: "$action",
          count: { $sum: 1 },
        },
      },
    ]);

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
