const mongoose = require("mongoose");

const programEducationalObjectiveSchema = new mongoose.Schema(
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
    performanceIndicators: {
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

programEducationalObjectiveSchema.index(
  { department: 1, code: 1 },
  { unique: true },
);

module.exports = mongoose.model(
  "ProgramEducationalObjective",
  programEducationalObjectiveSchema,
);
