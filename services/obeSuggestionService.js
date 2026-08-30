const CourseOutcome = require("../models/CourseOutcome");
const StudentOutcome = require("../models/StudentOutcome");
const { getProgramDepartmentLabel } = require("../utils/engineeringPrograms");
const {
  normalizeIndicatorRows,
  normalizeSoCode,
} = require("../utils/studentOutcomeIndicators");
const {
  normalizeProgramOutcomes,
} = require("../utils/obeValidation");

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "basic",
  "principle",
  "principles",
  "apply",
  "using",
  "given",
  "problem",
  "engineering",
  "correct",
  "answer",
]);
const MIN_AUTO_APPLY_CONFIDENCE = 60;
const MIN_PI_CONFIDENCE = 50;
const TOKEN_ALIASES = {
  algebra: ["math", "mathematics"],
  index: ["indices", "exponent", "exponents", "power", "powers"],
  indices: ["index", "exponent", "exponents", "power", "powers"],
  exponent: ["index", "indices", "exponents", "power", "powers"],
  exponents: ["index", "indices", "exponent", "power", "powers"],
  functions: ["math", "mathematics"],
  law: ["laws", "rule", "rules"],
  laws: ["law", "rule", "rules"],
  math: ["mathematics"],
  mathematics: ["math"],
  trigonometry: ["math", "mathematics"],
  simplify: ["simplification"],
  simplification: ["simplify"],
};

const normalize = (value = "") =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const expandToken = (token) => {
  const tokens = [token];

  if (token.endsWith("s") && token.length > 3) {
    tokens.push(token.slice(0, -1));
  }

  if (TOKEN_ALIASES[token]) {
    tokens.push(...TOKEN_ALIASES[token]);
  }

  return tokens;
};

const tokenize = (value = "") => {
  const tokens = normalize(value)
    .split(" ")
    .filter((token) => token.length > 2 && !STOPWORDS.has(token))
    .flatMap(expandToken);

  return new Set(tokens);
};

const intersectionSize = (left, right) => {
  let count = 0;

  left.forEach((token) => {
    if (right.has(token)) {
      count++;
    }
  });

  return count;
};

const getBloomHint = (questionText = "") => {
  const text = normalize(questionText);

  if (/\b(design|create|develop|construct|formulate)\b/.test(text)) {
    return "Create";
  }
  if (/\b(evaluate|justify|critique|assess|recommend)\b/.test(text)) {
    return "Evaluate";
  }
  if (/\b(analyze|compare|differentiate|examine|troubleshoot)\b/.test(text)) {
    return "Analyze";
  }
  if (/\b(apply|solve|calculate|compute|determine|use)\b/.test(text)) {
    return "Apply";
  }
  if (/\b(explain|describe|discuss|classify|summarize)\b/.test(text)) {
    return "Understand";
  }
  if (/\b(define|identify|list|state|name|recall)\b/.test(text)) {
    return "Remember";
  }

  return "";
};

const BLOOM_SLO_VERBS = {
  Remember: "Identify",
  Understand: "Explain",
  Apply: "Apply",
  Analyze: "Analyze",
  Evaluate: "Evaluate",
  Create: "Design",
};

const titleCase = (value = "") =>
  String(value || "")
    .toLowerCase()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());

const getQuestionFocus = (question = {}) => {
  const topic = String(question.topic || "").trim();

  if (topic) {
    return topic;
  }

  const text = normalize(question.questionText)
    .replace(
      /\b(what|which|when|where|why|how|following|correct|best|most|least|value|find|determine|calculate|compute|solve|identify|explain|describe|analyze|evaluate|design)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();

  const focus = text
    .split(" ")
    .filter((token) => token.length > 2)
    .slice(0, 8)
    .join(" ");

  return focus ? titleCase(focus) : "the assessed concept";
};

const suggestStudentLearningOutcome = (question = {}, bloomLevel = "") => {
  const level = bloomLevel || getBloomHint(question.questionText) || "Apply";
  const verb = BLOOM_SLO_VERBS[level] || "Apply";
  const focus = getQuestionFocus(question);

  return `${verb} ${focus} in an engineering problem.`;
};

const exactTextRegex = (value = "") =>
  new RegExp(`^${String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");

const scoreOutcome = (question, outcome) => {
  const questionTokens = tokenize(
    [
      question.subject,
      question.topic,
      question.courseOutcome,
      question.courseOutcomeDescription,
      question.programOutcome,
      question.studentOutcomeDescription,
      question.questionText,
      Object.values(question.choices || {}).join(" "),
    ].join(" "),
  );
  const outcomeTokens = tokenize(
    [outcome.code, outcome.description, outcome.keywords].join(" "),
  );
  const keywordTokens = tokenize(outcome.keywords);
  const subjectMatches =
    normalize(question.subject) &&
    normalize(question.subject) === normalize(outcome.subject);
  const programDepartment = getProgramDepartmentLabel(question.engineeringProgram);
  const departmentMatches =
    programDepartment &&
    normalize(programDepartment) === normalize(outcome.department);
  const departmentConflicts =
    programDepartment &&
    outcome.department &&
    normalize(programDepartment) !== normalize(outcome.department);
  const topicTokens = tokenize(question.topic);
  const bloomHint = getBloomHint(question.questionText);
  const topicOverlap = intersectionSize(topicTokens, outcomeTokens);
  const questionOutcomeOverlap = intersectionSize(questionTokens, outcomeTokens);
  const keywordOverlap = intersectionSize(questionTokens, keywordTokens);
  let score = 0;

  if (subjectMatches) score += 15;
  if (departmentMatches) score += 25;
  if (departmentConflicts) score -= 15;
  score += Math.min(30, questionOutcomeOverlap * 8);
  score += Math.min(25, keywordOverlap * 10);
  score += Math.min(20, topicOverlap * 10);

  if (bloomHint && bloomHint === outcome.bloomLevel) {
    score += 5;
  }

  return {
    confidence: Math.min(100, score),
    hasSemanticOverlap:
      topicOverlap > 0 || questionOutcomeOverlap > 0 || keywordOverlap > 0,
    overlapCount: topicOverlap + questionOutcomeOverlap + keywordOverlap,
  };
};

const scorePerformanceIndicator = (question, indicator) => {
  const questionTokens = tokenize(
    [
      question.subject,
      question.topic,
      question.questionText,
      Object.values(question.choices || {}).join(" "),
    ].join(" "),
  );
  const indicatorTokens = tokenize(
    [indicator.label, indicator.description].join(" "),
  );
  const topicTokens = tokenize(question.topic);
  const topicOverlap = intersectionSize(topicTokens, indicatorTokens);
  const indicatorOverlap = intersectionSize(questionTokens, indicatorTokens);
  let score = 0;

  score += Math.min(55, indicatorOverlap * 11);
  score += Math.min(30, topicOverlap * 15);

  if (indicator.weight > 0) {
    score += Math.min(10, Math.round(Number(indicator.normalizedWeight || 0) * 10));
  }

  return {
    confidence: Math.min(100, score),
    hasSemanticOverlap: topicOverlap > 0 || indicatorOverlap > 0,
    overlapCount: topicOverlap + indicatorOverlap,
  };
};

const findStudentOutcomeForQuestion = async (question, programOutcome = "") => {
  const code = normalizeSoCode(programOutcome);
  const department = getProgramDepartmentLabel(question.engineeringProgram);

  if (!code) return null;

  const departmentCandidates = department
    ? await StudentOutcome.find({ department: exactTextRegex(department) }).lean()
    : [];
  let outcome = departmentCandidates.find(
    (item) => normalizeSoCode(item.code) === code,
  );

  if (!outcome) {
    const candidates = await StudentOutcome.find().lean();
    outcome = candidates.find((item) => normalizeSoCode(item.code) === code);
  }

  return outcome;
};

const suggestPerformanceIndicator = async (question, programOutcome = "") => {
  const fallback = {
    performanceIndicator: "",
    performanceIndicators: [],
    performanceIndicatorDescription: "",
    performanceIndicatorConfidence: 0,
    performanceIndicatorMessage:
      "No Student Outcome PI rows found for this Engineering Program and SO.",
  };

  const outcomeCodes = normalizeProgramOutcomes(programOutcome);
  const outcomeRows = (
    await Promise.all(
      outcomeCodes.map((code) => findStudentOutcomeForQuestion(question, code)),
    )
  ).filter(Boolean);

  if (outcomeRows.length === 0) return fallback;

  const scoredIndicators = outcomeRows.flatMap((outcome) => {
    const so = normalizeSoCode(outcome.code);

    return normalizeIndicatorRows(outcome).map((indicator) => ({
      so,
      outcome,
      indicator,
      match: scorePerformanceIndicator(
        {
          ...question,
          studentOutcomeDescription: outcome.description,
        },
        indicator,
      ),
    }));
  });

  if (scoredIndicators.length === 0) {
    return {
      ...fallback,
      performanceIndicatorMessage:
        "The matched Student Outcome has no encoded Performance Indicators yet.",
    };
  }

  const ranked = scoredIndicators.sort((a, b) => b.match.confidence - a.match.confidence);
  const confidentRanked = ranked.filter(
    (item) =>
      item.match.hasSemanticOverlap &&
      item.match.confidence > MIN_PI_CONFIDENCE,
  );
  const topIndicators = confidentRanked.slice(0, 3).map(({ so, indicator, match }, index) => ({
    so,
    label: indicator.label,
    description: indicator.description,
    confidence: match.confidence,
    primary: index === 0,
  }));

  if (confidentRanked.length === 0) {
    return {
      ...fallback,
      performanceIndicatorMessage:
        "No PI exceeded the 50% confidence threshold.",
    };
  }

  const best = confidentRanked[0];

  return {
    performanceIndicator: best.indicator.label,
    performanceIndicators: topIndicators,
    performanceIndicatorDescription: best.indicator.description,
    performanceIndicatorConfidence: best.match.confidence,
    performanceIndicatorMessage: "",
  };
};

const suggestCourseOutcome = async (question) => {
  const subject = String(question.subject || "").trim();
  const department = String(question.department || "").trim();
  const query = {};
  const fallbackBloomLevel = getBloomHint(question.questionText);
  const fallbackSuggestion = {
    code: "",
    description: "No CO/CLO match",
    subject,
    programOutcome: "",
    programOutcomes: [],
    performanceIndicator: "",
    performanceIndicators: [],
    performanceIndicatorDescription: "",
    performanceIndicatorConfidence: 0,
    performanceIndicatorMessage: "",
    bloomLevel: fallbackBloomLevel || "",
    studentLearningOutcome: suggestStudentLearningOutcome(
      question,
      fallbackBloomLevel,
    ),
    confidence: 0,
  };

  if (subject) {
    query.$or = [
      { subject: new RegExp(`^${subject.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
      { subject: "" },
    ];
  }

  if (department) {
    query.department = exactTextRegex(department);
  }
  const outcomes = await CourseOutcome.find(query).lean();

  if (outcomes.length === 0) {
    return fallbackSuggestion;
  }

  const ranked = outcomes
    .map((outcome) => ({
      outcome,
      match: scoreOutcome(question, outcome),
    }))
    .filter(
      (item) =>
        item.match.hasSemanticOverlap &&
        item.match.confidence >= MIN_AUTO_APPLY_CONFIDENCE,
    )
    .sort((a, b) => b.match.confidence - a.match.confidence);

  if (ranked.length === 0) {
    return fallbackSuggestion;
  }

  const best = ranked[0];
  const bloomLevel = best.outcome.bloomLevel || getBloomHint(question.questionText);
  const programOutcomes = normalizeProgramOutcomes(best.outcome.programOutcome);
  const piSuggestion = await suggestPerformanceIndicator(
    {
      ...question,
      courseOutcome: best.outcome.code,
      courseOutcomeDescription: best.outcome.description,
      programOutcome: best.outcome.programOutcome,
    },
    best.outcome.programOutcome,
  );

  return {
    code: best.outcome.code,
    description: best.outcome.description,
    subject: best.outcome.subject,
    programOutcome:
      piSuggestion.performanceIndicators.find((item) => item.primary)?.so ||
      programOutcomes[0] ||
      best.outcome.programOutcome ||
      "",
    programOutcomes,
    ...piSuggestion,
    bloomLevel: bloomLevel || "",
    studentLearningOutcome: suggestStudentLearningOutcome(question, bloomLevel),
    confidence: best.match.confidence,
  };
};

const suggestCourseOutcomes = async (questions = []) =>
  Promise.all(questions.map((question) => suggestCourseOutcome(question)));

module.exports = {
  suggestCourseOutcome,
  suggestCourseOutcomes,
};
