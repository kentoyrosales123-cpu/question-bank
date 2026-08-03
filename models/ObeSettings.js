const mongoose = require("mongoose");

const obeSettingsSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      default: "global",
      unique: true,
      immutable: true,
    },
    courseOutcomeTarget: {
      type: Number,
      default: 75,
      min: 0,
      max: 100,
    },
    studentOutcomeTarget: {
      type: Number,
      default: 75,
      min: 0,
      max: 100,
    },
    attainmentMethod: {
      type: String,
      enum: ["response_based", "student_based"],
      default: "response_based",
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("ObeSettings", obeSettingsSchema);
