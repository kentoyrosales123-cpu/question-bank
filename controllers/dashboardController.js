const User = require("../models/User");
const Question = require("../models/Question");
const Exam = require("../models/Exam");

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
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
