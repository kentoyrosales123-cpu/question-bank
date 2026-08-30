const normalizeProgramOutcomes = (value, primary = "") => {
  const rawItems = Array.isArray(value)
    ? value
    : String(value || "")
        .split(/[,;\n\s]+/)
        .map((item) => item.trim());
  const primaryValue = String(primary || "").trim();
  const seen = new Set();

  return [primaryValue, ...rawItems]
    .map((item) =>
      String(item || "")
        .replace(/^SO[-\s]*/i, "")
        .trim()
        .toLowerCase(),
    )
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase();

      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const normalizePerformanceIndicators = (value, primary = "") => {
  const rawItems = Array.isArray(value)
    ? value
    : String(value || "")
        .split(/[,;\n]/)
        .map((item) => item.trim());
  const primaryValue = String(primary || "").trim();
  const seen = new Set();

  return [primaryValue, ...rawItems]
    .map((item) => String(item?.label || item || "").trim())
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase();

      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const normalizePerformanceIndicatorMappings = (
  value,
  primary = "",
  primarySo = "",
) => {
  const rawItems = Array.isArray(value)
    ? value
    : String(value || "")
        .split(/[,;\n]/)
        .map((item) => item.trim());
  const primaryValue = String(primary || "").trim();
  const primarySoValue = normalizeProgramOutcomes("", primarySo)[0] || "";
  const seen = new Set();
  const rows = [
    primaryValue
      ? { so: primarySoValue, label: primaryValue, primary: true }
      : null,
    ...rawItems,
  ].filter(Boolean);

  return rows
    .map((item) => {
      if (typeof item === "object") {
        const so = normalizeProgramOutcomes("", item.so || item.programOutcome)[0] || "";
        const label = String(item.label || item.performanceIndicator || "").trim();

        return {
          so,
          label,
          description: String(item.description || "").trim(),
          confidence: Math.max(0, Math.min(100, Number(item.confidence || 0))),
          primary: Boolean(item.primary),
        };
      }

      return {
        so: primarySoValue,
        label: String(item || "").trim(),
        description: "",
        confidence: 0,
        primary: false,
      };
    })
    .filter((item) => item.label)
    .filter((item) => {
      const key = `${item.so.toLowerCase()}|||${item.label.toLowerCase()}`;

      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

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
  if (!String(item.studentLearningOutcome || "").trim()) {
    missing.push("SLO");
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
  normalizePerformanceIndicatorMappings,
  normalizePerformanceIndicators,
  normalizeProgramOutcomes,
};
