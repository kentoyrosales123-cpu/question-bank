const ASSESSMENT_METHODS = [
  "Quiz",
  "Major Exam",
  "Assignment",
  "Laboratory",
  "Project",
  "Recitation",
  "Practical Exam",
  "Other",
];

const DEFAULT_ASSESSMENT_METHOD = "Major Exam";

const normalizeAssessmentMethod = (value) => {
  const method = String(value || "").trim();

  return ASSESSMENT_METHODS.includes(method)
    ? method
    : DEFAULT_ASSESSMENT_METHOD;
};

module.exports = {
  ASSESSMENT_METHODS,
  DEFAULT_ASSESSMENT_METHOD,
  normalizeAssessmentMethod,
};
