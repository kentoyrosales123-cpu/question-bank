const mongoose = require("mongoose");
const {
  ASSESSMENT_METHODS,
  DEFAULT_ASSESSMENT_METHOD,
} = require("../utils/assessmentMethods");
const {
  ASSESSMENT_PHASES,
  DEFAULT_ASSESSMENT_PHASE,
} = require("../utils/assessmentPhases");

const itemAnalysisExamSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    subject: {
      type: String,
      required: true,
      trim: true,
    },
    section: {
      type: String,
      required: true,
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
    assessmentPhase: {
      type: String,
      enum: ASSESSMENT_PHASES,
      default: DEFAULT_ASSESSMENT_PHASE,
      trim: true,
    },
    analysisType: {
      type: String,
      enum: ["Multiple Choice", "Problem Solving"],
      default: "Multiple Choice",
      trim: true,
    },
    numberOfItems: {
      type: Number,
      required: true,
      min: 1,
    },
    answerKey: [
      {
        itemNo: Number,
        answer: String,
        maxScore: { type: Number, default: 1, min: 0 },
      },
    ],
    itemMappings: [
      {
        itemNo: { type: Number, required: true, min: 1 },
        courseOutcome: { type: String, default: "", trim: true },
        programOutcome: { type: String, default: "", trim: true },
        performanceIndicator: { type: String, default: "", trim: true },
        bloomLevel: { type: String, default: "", trim: true },
        maxScore: { type: Number, default: 0, min: 0 },
      },
    ],
    generatedExamId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Exam",
      default: null,
    },
    includeInObe: {
      type: Boolean,
      default: false,
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    uploadedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("ItemAnalysisExam", itemAnalysisExamSchema);
