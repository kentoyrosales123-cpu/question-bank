const mongoose = require("mongoose");

const studentOutcomeSchema = new mongoose.Schema(
  {
    department: {
      type: String,
      required: true,
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
    graduateAttributes: {
      type: String,
      default: "",
      trim: true,
    },
    peoLinks: {
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

studentOutcomeSchema.index({ department: 1, code: 1 }, { unique: true });

module.exports = mongoose.model("StudentOutcome", studentOutcomeSchema);
