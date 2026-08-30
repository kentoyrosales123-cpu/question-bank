const PROBLEM_SOLVING_TERMS = [
  "calculate",
  "compute",
  "determine",
  "derive",
  "evaluate",
  "find",
  "solve",
  "simplify",
  "prove",
  "design",
  "analyze",
  "what is the value",
  "how many",
];

const ENGINEERING_UNITS_PATTERN =
  /\b(?:v|a|ohm|Ω|w|kw|mw|hz|khz|mhz|n|kn|pa|kpa|mpa|j|kj|c|f|h|m|cm|mm|kg|g|s|ms|rad|rpm|db)\b/i;
const EQUATION_PATTERN = /(?:[a-z]\s*=|\d+\s*[+\-*/^]\s*\d+|[a-z]\^[\-\d]+|√|∫|Σ|=)/i;
const NUMERIC_PATTERN = /(?:\d+(?:\.\d+)?\s*(?:%|[a-zΩ]+)?)/gi;

const normalizeText = (value = "") =>
  String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const hasChoiceSet = (choices = {}) =>
  Object.values(choices || {}).filter((choice) => String(choice || "").trim())
    .length >= 2;

const detectQuestionType = ({
  questionText = "",
  choices = {},
  correctAnswer = "",
  solutionAnswer = "",
  explanation = "",
} = {}) => {
  if (hasChoiceSet(choices) || /^[A-D]$/i.test(String(correctAnswer || ""))) {
    return "Multiple Choice";
  }

  const text = normalizeText(
    [questionText, solutionAnswer, explanation].filter(Boolean).join(" "),
  );

  if (!text) return "Multiple Choice";

  let score = 0;

  if (solutionAnswer) score += 3;
  if (/^(?:problem|ps)\b/i.test(String(questionText || "").trim())) score += 2;
  if (PROBLEM_SOLVING_TERMS.some((term) => text.includes(term))) score += 2;
  if (EQUATION_PATTERN.test(text)) score += 2;
  if (ENGINEERING_UNITS_PATTERN.test(text)) score += 1;

  const numericMatches = text.match(NUMERIC_PATTERN) || [];
  if (numericMatches.length >= 2) score += 1;
  if (numericMatches.length >= 4) score += 1;
  if (text.length > 160 && numericMatches.length > 0) score += 1;

  return score >= 3 ? "Problem Solving" : "Multiple Choice";
};

const isDetectedProblemSolvingQuestion = (input = {}) =>
  detectQuestionType(input) === "Problem Solving";

module.exports = {
  detectQuestionType,
  isDetectedProblemSolvingQuestion,
};
