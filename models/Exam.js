const mongoose = require("mongoose");
const {
  ASSESSMENT_METHODS,
  DEFAULT_ASSESSMENT_METHOD,
} = require("../utils/assessmentMethods");

const examSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      default: "Generated Exam",
    },

    subject: {
      type: String,
      required: true,
    },

    engineeringProgram: {
      type: String,
      enum: ["", "ECE", "CE", "EE", "ME", "CpE", "CHE"],
      default: "",
    },

    topic: {
      type: String,
      default: "",
    },

    section: {
      type: String,
      default: "",
      trim: true,
    },

    semester: {
      type: String,
      default: "",
      trim: true,
    },

    schoolYear: {
      type: String,
      default: "",
      trim: true,
    },

    assessmentMethod: {
      type: String,
      enum: ASSESSMENT_METHODS,
      default: DEFAULT_ASSESSMENT_METHOD,
      trim: true,
    },

    totalItems: {
      type: Number,
      required: true,
    },

    easyCount: {
      type: Number,
      default: 0,
    },

    averageCount: {
      type: Number,
      default: 0,
    },

    difficultCount: {
      type: Number,
      default: 0,
    },

    questions: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Question",
      },
    ],

    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    answers: [
      {
        question: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Question",
        },
        selectedAnswer: String,
        isCorrect: Boolean,
      },
    ],

    score: {
      type: Number,
      default: 0,
    },

    submitted: {
      type: Boolean,
      default: false,
    },

    approvalStatus: {
      type: String,
      enum: ["Pending", "Approved", "Rejected"],
      default: "Approved",
    },

    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    approvedAt: Date,

    rejectedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    rejectedAt: Date,
  },
  { timestamps: true },
);

module.exports = mongoose.model("Exam", examSchema);
