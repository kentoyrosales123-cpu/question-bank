const CourseOutcome = require("../models/CourseOutcome");

const normalize = (value = "") =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokenize = (value = "") =>
  new Set(
    normalize(value)
      .split(" ")
      .filter((token) => token.length > 2),
  );

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
  let score = 0;

  if (subjectMatches) score += 35;
  score += Math.min(30, intersectionSize(questionTokens, outcomeTokens) * 6);
  score += Math.min(20, intersectionSize(questionTokens, keywordTokens) * 8);
  score += Math.min(10, intersectionSize(topicTokens, outcomeTokens) * 5);

  if (bloomHint && bloomHint === outcome.bloomLevel) {
    score += 5;
  }

  return Math.min(100, score);
};

const suggestCourseOutcome = async (question) => {
  const subject = String(question.subject || "").trim();
  const department = String(question.department || "").trim();
  const query = {};

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
    return null;
  }

  const ranked = outcomes
    .map((outcome) => ({
      outcome,
      confidence: scoreOutcome(question, outcome),
    }))
    .filter((item) => item.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence);

  if (ranked.length === 0) {
    return null;
  }

  const best = ranked[0];

  return {
    code: best.outcome.code,
    description: best.outcome.description,
    subject: best.outcome.subject,
    programOutcome: best.outcome.programOutcome || "",
    bloomLevel: best.outcome.bloomLevel || "",
    confidence: best.confidence,
  };
};

const suggestCourseOutcomes = async (questions = []) =>
  Promise.all(questions.map((question) => suggestCourseOutcome(question)));

module.exports = {
  suggestCourseOutcome,
  suggestCourseOutcomes,
};
