const mongoose = require("mongoose");

const itemResultSchema = new mongoose.Schema(
  {
    itemNo: {
      type: Number,
      required: true,
    },
    value: {
      type: String,
      default: "",
    },
    isCorrect: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false },
);

const itemAnalysisStudentResultSchema = new mongoose.Schema(
  {
    analysisExamId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ItemAnalysisExam",
      required: true,
    },
    studentName: {
      type: String,
      required: true,
      trim: true,
    },
    studentId: {
      type: String,
      required: true,
      trim: true,
    },
    section: {
      type: String,
      required: true,
      trim: true,
    },
    itemResults: [itemResultSchema],
    totalScore: {
      type: Number,
      required: true,
      min: 0,
    },
    scanMetadata: {
      type: mongoose.Schema.Types.Mixed,
      default: undefined,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model(
  "ItemAnalysisStudentResult",
  itemAnalysisStudentResultSchema,
);
