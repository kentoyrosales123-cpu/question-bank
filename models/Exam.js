const mongoose = require("mongoose");

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

    topic: {
      type: String,
      default: "",
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
  },
  { timestamps: true },
);

module.exports = mongoose.model("Exam", examSchema);
