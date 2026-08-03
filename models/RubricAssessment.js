const mongoose = require("mongoose");
const {
  ASSESSMENT_METHODS,
  DEFAULT_ASSESSMENT_METHOD,
} = require("../utils/assessmentMethods");

const rubricCriterionSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true },
    courseOutcome: { type: String, default: "", trim: true },
    programOutcome: { type: String, default: "", trim: true },
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
    maxScore: { type: Number, required: true, min: 0 },
    targetScore: { type: Number, default: 0, min: 0 },
    weight: { type: Number, default: 1, min: 0 },
  },
  { _id: true },
);

const rubricScoreSchema = new mongoose.Schema(
  {
    studentName: { type: String, required: true, trim: true },
    studentId: { type: String, default: "", trim: true },
    criterionScores: [
      {
        criterionId: { type: mongoose.Schema.Types.ObjectId },
        criterionIndex: { type: Number, default: 0, min: 0 },
        score: { type: Number, default: 0, min: 0 },
      },
    ],
  },
  { _id: false },
);

const rubricAssessmentSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    subject: { type: String, required: true, trim: true },
    engineeringProgram: {
      type: String,
      enum: ["", "ECE", "CE", "EE", "ME", "CpE", "CHE"],
      default: "",
    },
    section: { type: String, default: "", trim: true },
    semester: { type: String, default: "", trim: true },
    schoolYear: { type: String, default: "", trim: true },
    assessmentMethod: {
      type: String,
      enum: ASSESSMENT_METHODS,
      default: DEFAULT_ASSESSMENT_METHOD,
      trim: true,
    },
    criteria: [rubricCriterionSchema],
    studentScores: [rubricScoreSchema],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

module.exports = mongoose.model("RubricAssessment", rubricAssessmentSchema);
