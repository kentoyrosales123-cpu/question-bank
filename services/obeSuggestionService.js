const CourseOutcome = require("../models/CourseOutcome");

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
const TOKEN_ALIASES = {
  index: ["indices", "exponent", "exponents", "power", "powers"],
  indices: ["index", "exponent", "exponents", "power", "powers"],
  exponent: ["index", "indices", "exponents", "power", "powers"],
  exponents: ["index", "indices", "exponent", "power", "powers"],
  law: ["laws", "rule", "rules"],
  laws: ["law", "rule", "rules"],
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

const scoreOutcome = (question, outcome) => {
  const questionTokens = tokenize(
    [
      question.subject,
      question.topic,
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
  const topicTokens = tokenize(question.topic);
  const bloomHint = getBloomHint(question.questionText);
  const topicOverlap = intersectionSize(topicTokens, outcomeTokens);
  const questionOutcomeOverlap = intersectionSize(questionTokens, outcomeTokens);
  const keywordOverlap = intersectionSize(questionTokens, keywordTokens);
  let score = 0;

  if (subjectMatches) score += 15;
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
    query.department = new RegExp(`^${department.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
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

  return {
    code: best.outcome.code,
    description: best.outcome.description,
    subject: best.outcome.subject,
    programOutcome: best.outcome.programOutcome || "",
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
