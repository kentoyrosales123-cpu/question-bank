const mongoose = require("mongoose");

const rubricTemplateCriterionSchema = new mongoose.Schema(
  {
    criterion: { type: String, required: true, trim: true },
    excellent: { type: String, default: "", trim: true },
    good: { type: String, default: "", trim: true },
    fair: { type: String, default: "", trim: true },
    needsImprovement: { type: String, default: "", trim: true },
    maxPoints: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const rubricTemplateSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
    criteria: [rubricTemplateCriterionSchema],
    isSystem: { type: Boolean, default: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

module.exports = mongoose.model("RubricTemplate", rubricTemplateSchema);
