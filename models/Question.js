const mongoose = require("mongoose");

const questionSchema = new mongoose.Schema(
  {
    subject: {
      type: String,
      required: true,
      trim: true,
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
  },
  { timestamps: true },
);

module.exports = mongoose.model("Question", questionSchema);
