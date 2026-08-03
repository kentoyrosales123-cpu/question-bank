const mongoose = require("mongoose");
const {
  ASSESSMENT_METHODS,
  DEFAULT_ASSESSMENT_METHOD,
} = require("../utils/assessmentMethods");

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
    numberOfItems: {
      type: Number,
      required: true,
      min: 1,
    },
    answerKey: [
      {
        itemNo: Number,
        answer: String,
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
