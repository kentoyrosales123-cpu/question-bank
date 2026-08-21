const mongoose = require("mongoose");

const questionSchema = new mongoose.Schema(
  {
    subject: {
      type: String,
      required: true,
      trim: true,
    },

    engineeringProgram: {
      type: String,
      enum: ["", "GE", "ECE", "CE", "EE", "ME", "CpE", "CHE"],
      default: "",
    },

    topic: {
      type: String,
      required: true,
      trim: true,
    },

    questionText: {
      type: String,
      required: true,
    },

    questionType: {
      type: String,
      enum: ["Multiple Choice", "Problem Solving"],
      default: "Multiple Choice",
    },

    choices: {
      A: { type: String, default: "" },
      B: { type: String, default: "" },
      C: { type: String, default: "" },
      D: { type: String, default: "" },
    },

    correctAnswer: {
      type: String,
      enum: ["A", "B", "C", "D", ""],
      default: "",
    },

    solutionAnswer: {
      type: String,
      default: "",
      trim: true,
    },

    difficulty: {
      type: String,
      enum: ["Easy", "Average", "Difficult"],
      default: "Average",
    },

    courseOutcome: {
      type: String,
      default: "",
      trim: true,
    },

    programOutcome: {
      type: String,
      default: "",
      trim: true,
    },

    performanceIndicator: {
      type: String,
      default: "",
      trim: true,
    },

    studentLearningOutcome: {
      type: String,
      default: "",
      trim: true,
    },

    bloomLevel: {
      type: String,
      enum: [
        "",
        "Remember",
        "Understand",
        "Apply",
        "Analyze",
        "Evaluate",
        "Create",
      ],
      default: "",
    },

    outcomeWeight: {
      type: Number,
      default: 1,
      min: 0,
    },

    isComplexEngineeringProblem: {
      type: Boolean,
      default: false,
    },

    complexityScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },

    complexityLevel: {
      type: String,
      default: "Routine Engineering Problem",
      trim: true,
    },

    complexityReasons: {
      type: [String],
      default: [],
    },

    explanation: {
      type: String,
      default: "",
    },

    image: {
      data: Buffer,
      contentType: String,
    },

    tableData: {
      type: String,
      default: "",
    },

    tables: [
      {
        rows: [[String]],
      },
    ],

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    versionHistory: [
      {
        editedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        editedAt: {
          type: Date,
          default: Date.now,
        },
        before: mongoose.Schema.Types.Mixed,
        after: mongoose.Schema.Types.Mixed,
        changedFields: [String],
      },
    ],
  },
  { timestamps: true },
);

module.exports = mongoose.model("Question", questionSchema);
