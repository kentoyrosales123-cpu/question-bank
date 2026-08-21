const { ASSESSMENT_PHASE_WEIGHTS } = require("./assessmentPhases");

const getPhaseWeight = (phase = "") =>
  ASSESSMENT_PHASE_WEIGHTS[phase] ?? ASSESSMENT_PHASE_WEIGHTS.Summative;

const weightedPhaseAttainment = (
  phaseBreakdown = [],
  { rateKey = "attainmentRate", evidenceKey = "totalWeight" } = {},
) => {
  const assessed = phaseBreakdown.filter(
    (phase) => Number(phase[evidenceKey] || 0) > 0,
  );

  if (assessed.length === 0) {
    return null;
  }

  const weightedRate = assessed.reduce(
    (sum, phase) =>
      sum + Number(phase[rateKey] || 0) * getPhaseWeight(phase.phase),
    0,
  );

  return Math.round(weightedRate * 10) / 10;
};

module.exports = {
  getPhaseWeight,
  weightedPhaseAttainment,
};
