const mongoose = require("mongoose");

const curriculumMapCourseSchema = new mongoose.Schema(
  {
    department: {
      type: String,
      default: "",
      trim: true,
    },
    courseCode: {
      type: String,
      default: "",
      trim: true,
    },
    subject: {
      type: String,
      required: true,
      trim: true,
    },
    units: {
      type: Number,
      default: 0,
      min: 0,
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
    alignments: [
      {
        studentOutcome: {
          type: String,
          required: true,
          trim: true,
        },
        level: {
          type: String,
          enum: ["I", "E", "D"],
          required: true,
        },
      },
    ],
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true },
);

curriculumMapCourseSchema.index(
  { department: 1, courseCode: 1, subject: 1 },
  { unique: true },
);

module.exports = mongoose.model(
  "CurriculumMapCourse",
  curriculumMapCourseSchema,
);
