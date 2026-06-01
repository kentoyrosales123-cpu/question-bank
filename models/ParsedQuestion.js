const mongoose = require("mongoose");

const parsedQuestionSchema = new mongoose.Schema(
  {
    upload: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Upload",
      required: true,
    },
    subject: { type: String, default: "" },
    topic: { type: String, default: "" },
    questionText: { type: String, required: true },
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
    difficulty: {
      type: String,
      enum: ["Easy", "Average", "Difficult"],
      default: "Average",
    },
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
