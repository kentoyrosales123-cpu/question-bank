const mongoose = require("mongoose");

const cqiInterventionPlanSchema = new mongoose.Schema(
  {
    analysisExamId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ItemAnalysisExam",
      required: true,
    },
    outcomeType: {
      type: String,
      enum: ["CO", "SO"],
      required: true,
    },
    outcomeCode: {
      type: String,
      required: true,
      trim: true,
    },
    rootCause: {
      type: String,
      default: "",
      trim: true,
    },
    intervention: {
      type: String,
      required: true,
      trim: true,
    },
    responsiblePerson: {
      type: String,
      required: true,
      trim: true,
    },
    targetDate: Date,
    evidence: {
      type: String,
      default: "",
      trim: true,
    },
    remarks: {
      type: String,
      default: "",
      trim: true,
    },
    implementationDate: Date,
    reassessmentResult: {
      type: String,
      default: "",
      trim: true,
    },
    verificationRemarks: {
      type: String,
      default: "",
      trim: true,
    },
    followUpDecision: {
      type: String,
      enum: ["", "Closed", "Needs Further Action", "Reassess Next Cycle"],
      default: "",
    },
    verifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    verifiedAt: Date,
    status: {
      type: String,
      enum: ["Planned", "In Progress", "Completed", "Verified"],
      default: "Planned",
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true },
);

cqiInterventionPlanSchema.index(
  { analysisExamId: 1, outcomeType: 1, outcomeCode: 1 },
  { unique: true },
);

module.exports = mongoose.model("CqiInterventionPlan", cqiInterventionPlanSchema);
