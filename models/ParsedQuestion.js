const mongoose = require("mongoose");

const parsedQuestionSchema = new mongoose.Schema(
  {
    upload: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Upload",
    },
    source: {
      type: String,
      enum: ["Upload", "AI"],
      default: "Upload",
    },
    generatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    subject: { type: String, default: "" },
    engineeringProgram: {
      type: String,
      enum: ["", "GE", "ECE", "CE", "EE", "ME", "CpE", "CHE"],
      default: "",
    },
    topic: { type: String, default: "" },
    questionText: { type: String, required: true },
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
    solutionAnswer: { type: String, default: "", trim: true },
    difficulty: {
      type: String,
      enum: ["Easy", "Average", "Difficult"],
      default: "Average",
    },
    courseOutcome: { type: String, default: "", trim: true },
    programOutcome: { type: String, default: "", trim: true },
    performanceIndicator: { type: String, default: "", trim: true },
    studentLearningOutcome: { type: String, default: "", trim: true },
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
    outcomeWeight: { type: Number, default: 1, min: 0 },
    isComplexEngineeringProblem: { type: Boolean, default: false },
    complexityScore: { type: Number, default: 0, min: 0, max: 100 },
    complexityLevel: {
      type: String,
      default: "Routine Engineering Problem",
      trim: true,
    },
    complexityReasons: { type: [String], default: [] },
    explanation: { type: String, default: "" },
    image: {
      data: Buffer,
      contentType: String,
    },
    tables: [
      {
        rows: [[String]],
      },
    ],
    status: {
      type: String,
      enum: ["Pending", "Approved", "Rejected"],
      default: "Pending",
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("ParsedQuestion", parsedQuestionSchema);
