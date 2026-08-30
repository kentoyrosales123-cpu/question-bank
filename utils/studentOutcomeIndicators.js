const StudentOutcome = require("../models/StudentOutcome");

const normalizeSoCode = (value = "") =>
  String(value || "")
    .replace(/^SO[-\s]*/i, "")
    .trim()
    .toLowerCase();

const normalizeDepartment = (value = "") =>
  String(value || "").trim().toLowerCase();

const getDepartmentSoKey = (department = "", code = "") =>
  `${normalizeDepartment(department)}|||${normalizeSoCode(code)}`;

const normalizePerformanceIndicator = (value = "") => {
  const raw = String(value || "").trim();
  const match = raw.match(/(\d+)/);

  return match ? `PI ${Number(match[1])}` : raw;
};

const parsePerformanceIndicators = (value = "") =>
  String(value || "")
    .split(/\r?\n|;/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const match = line.match(/^(\d+)[.)]?\s*(.+)$/);

      return {
        piNumber: match ? Number(match[1]) : index + 1,
        description: match ? match[2].trim() : line,
        label: match ? `PI ${match[1]}` : `PI ${index + 1}`,
      };
    });

const normalizeIndicatorRows = (outcome = {}) => {
  const structured = Array.isArray(outcome.performanceIndicatorDetails)
    ? outcome.performanceIndicatorDetails
    : [];

  if (structured.length > 0) {
    const totalWeight = structured.reduce(
      (sum, item) => sum + Math.max(0, Number(item.weight || 0)),
      0,
    );

    return structured
      .filter((item) => item.description)
      .map((item, index) => {
        const piNumber = Number(item.piNumber || index + 1);
        const weight = Math.max(0, Number(item.weight || 1));

        return {
          piNumber,
          description: item.description,
          weight,
          normalizedWeight:
            totalWeight > 0 ? weight / totalWeight : 1 / structured.length,
          label: `PI ${piNumber}`,
        };
      });
  }

  const parsed = parsePerformanceIndicators(outcome.performanceIndicators);
  const equalWeight = parsed.length > 0 ? 1 / parsed.length : 0;

  return parsed.map((item) => ({
    ...item,
    weight: 1,
    normalizedWeight: equalWeight,
  }));
};

const buildStudentOutcomeIndicatorMap = async () => {
  const outcomes = await StudentOutcome.find()
    .select("department code performanceIndicators performanceIndicatorDetails")
    .lean();

  const indicatorsByCode = new Map();

  outcomes.forEach((outcome) => {
    const code = normalizeSoCode(outcome.code);
    if (!code) return;

    const rows = normalizeIndicatorRows(outcome);
    const indicators = {
      performanceIndicators:
        outcome.performanceIndicators ||
        rows
          .map((item) => `${item.piNumber}. ${item.description}`)
          .join("\n"),
      performanceIndicatorRows: rows,
    };

    indicatorsByCode.set(getDepartmentSoKey(outcome.department, outcome.code), indicators);

    if (!indicatorsByCode.has(code)) {
      indicatorsByCode.set(code, indicators);
    }
  });

  return indicatorsByCode;
};

const attachStudentOutcomeIndicators = async (rows = [], codeKey = "code") => {
  const indicatorsByCode = await buildStudentOutcomeIndicatorMap();

  return rows.map((row) => {
    const ownIndicatorRows = normalizeIndicatorRows(row);
    const ownPerformanceIndicators =
      row.performanceIndicators ||
      ownIndicatorRows
        .map((item) => `${item.piNumber}. ${item.description}`)
        .join("\n");

    if (ownIndicatorRows.length > 0 || ownPerformanceIndicators) {
      return {
        ...row,
        performanceIndicators: ownPerformanceIndicators,
        performanceIndicatorRows: ownIndicatorRows,
      };
    }

    const indicators =
      indicatorsByCode.get(getDepartmentSoKey(row.department, row[codeKey])) ||
      indicatorsByCode.get(normalizeSoCode(row[codeKey])) || {};

    return {
      ...row,
      performanceIndicators: indicators.performanceIndicators || "",
      performanceIndicatorRows: indicators.performanceIndicatorRows || [],
    };
  });
};

module.exports = {
  attachStudentOutcomeIndicators,
  buildStudentOutcomeIndicatorMap,
  normalizeIndicatorRows,
  normalizePerformanceIndicator,
  normalizeSoCode,
  parsePerformanceIndicators,
};
