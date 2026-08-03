const mongoose = require("mongoose");

const obeEvidenceSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    evidenceType: {
      type: String,
      enum: [
        "Syllabus",
        "TOS",
        "Exam",
        "Answer Key",
        "Item Analysis",
        "Rubric",
        "Student Output",
        "CQI",
        "Other",
      ],
      default: "Other",
    },
    subject: { type: String, default: "", trim: true },
    engineeringProgram: {
      type: String,
      enum: ["", "ECE", "CE", "EE", "ME", "CpE", "CHE"],
      default: "",
    },
    section: { type: String, default: "", trim: true },
    semester: { type: String, default: "", trim: true },
    schoolYear: { type: String, default: "", trim: true },
    courseOutcome: { type: String, default: "", trim: true },
    programOutcome: { type: String, default: "", trim: true },
    description: { type: String, default: "", trim: true },
    fileName: { type: String, default: "", trim: true },
    originalName: { type: String, default: "", trim: true },
    mimeType: { type: String, default: "", trim: true },
    filePath: { type: String, default: "", trim: true },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

module.exports = mongoose.model("ObeEvidence", obeEvidenceSchema);
