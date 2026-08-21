const ASSESSMENT_PHASES = ["Formative", "Summative"];
const DEFAULT_ASSESSMENT_PHASE = "Summative";

const ASSESSMENT_PHASE_WEIGHTS = Object.freeze({
  Formative: 0.3,
  Summative: 0.7,
});

const normalizeAssessmentPhase = (value = "") => {
  const phase = String(value || "").trim().toLowerCase();

  return (
    ASSESSMENT_PHASES.find((item) => item.toLowerCase() === phase) ||
    DEFAULT_ASSESSMENT_PHASE
  );
};

module.exports = {
  ASSESSMENT_PHASES,
  ASSESSMENT_PHASE_WEIGHTS,
  DEFAULT_ASSESSMENT_PHASE,
  normalizeAssessmentPhase,
};
