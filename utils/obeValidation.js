const getMissingObeMappingFields = (item = {}) => {
  const missing = [];

  if (!String(item.engineeringProgram || "").trim()) {
    missing.push("engineering program");
  }
  if (!String(item.courseOutcome || "").trim()) {
    missing.push("CO/CLO");
  }
  if (!String(item.programOutcome || "").trim()) {
    missing.push("SO");
  }
  if (!String(item.bloomLevel || "").trim()) {
    missing.push("Bloom level");
  }
  if (!Number.isFinite(Number(item.outcomeWeight)) || Number(item.outcomeWeight) <= 0) {
    missing.push("positive outcome weight");
  }

  return missing;
};

const hasCompleteObeMapping = (item = {}) =>
  getMissingObeMappingFields(item).length === 0;

const formatObeMappingError = (missingFields) =>
  `Complete OBE mapping is required before this question can be used. Missing: ${missingFields.join(", ")}.`;

module.exports = {
  formatObeMappingError,
  getMissingObeMappingFields,
  hasCompleteObeMapping,
};
