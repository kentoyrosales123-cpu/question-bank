const mongoose = require("mongoose");

const courseOutcomeSchema = new mongoose.Schema(
  {
    subject: {
      type: String,
      required: true,
      trim: true,
    },
    department: {
      type: String,
      default: "",
      trim: true,
    },
    code: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    programOutcome: {
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
    keywords: {
      type: String,
      default: "",
      trim: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true },
);

courseOutcomeSchema.index({ department: 1, subject: 1, code: 1 }, { unique: true });

module.exports = mongoose.model("CourseOutcome", courseOutcomeSchema);
