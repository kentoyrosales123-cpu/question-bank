const mongoose = require("mongoose");

const obeAttainmentSnapshotSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    engineeringProgram: { type: String, default: "", trim: true },
    subject: { type: String, default: "", trim: true },
    section: { type: String, default: "", trim: true },
    semester: { type: String, default: "", trim: true },
    schoolYear: { type: String, default: "", trim: true },
    assessmentMethod: { type: String, default: "", trim: true },
    filterSummary: { type: String, default: "", trim: true },
    summary: {
      assessedClos: { type: Number, default: 0 },
      attainedClos: { type: Number, default: 0 },
      assessedSos: { type: Number, default: 0 },
      attainedSos: { type: Number, default: 0 },
      overallAttainmentRate: { type: Number, default: 0 },
      targetRate: { type: Number, default: 75 },
      status: { type: String, default: "No Evidence" },
    },
    courseOutcomes: { type: [mongoose.Schema.Types.Mixed], default: [] },
    studentOutcomes: { type: [mongoose.Schema.Types.Mixed], default: [] },
    evidenceTraceabilityMatrix: { type: [mongoose.Schema.Types.Mixed], default: [] },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

module.exports = mongoose.model(
  "ObeAttainmentSnapshot",
  obeAttainmentSnapshotSchema,
);
