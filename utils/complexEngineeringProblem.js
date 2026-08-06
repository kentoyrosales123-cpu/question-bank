const normalize = (value = "") =>
  String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const countMatches = (text, patterns) =>
  patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);

const getChoiceText = (choices = {}) =>
  Array.isArray(choices)
    ? choices.join(" ")
    : Object.values(choices || {}).join(" ");

const clampCategoryScore = (matches, weight) => {
  if (matches <= 0) return 0;
  if (matches === 1) return Math.ceil(weight * 0.65);
  return weight;
};

const getComplexityLevel = (score) => {
  if (score <= 30) return "Routine Engineering Problem";
  if (score <= 60) return "Moderately Complex Engineering Problem";
  return "Complex Engineering Problem";
};

const classifyComplexEngineeringProblem = (question = {}) => {
  const text = normalize(
    [
      question.subject,
      question.topic,
      question.questionText,
      getChoiceText(question.choices),
      question.explanation,
      question.tableData,
    ].join(" "),
  );
  const bloomLevel = String(question.bloomLevel || "").trim();
  const reasons = [];
  const categoryScores = {};
  let score = 0;

  const bloomScore = ["Analyze", "Evaluate", "Create"].includes(bloomLevel)
    ? bloomLevel === "Create"
      ? 15
      : 12
    : 0;
  if (bloomScore > 0) {
    categoryScores.bloomLevel = bloomScore;
    score += bloomScore;
    reasons.push(`Bloom level is ${bloomLevel}.`);
  }

  const designSignals = countMatches(text, [
    /\bdesign\b/,
    /\bdevelop\b/,
    /\bformulate\b/,
    /\boptimi[sz]e\b/,
    /\bpropose\b/,
    /\brecommend\b/,
    /\bselect\b/,
    /\bsynthesi[sz]e\b/,
  ]);
  if (designSignals > 0) {
    const categoryScore = clampCategoryScore(designSignals, 20);
    categoryScores.designSynthesis = categoryScore;
    score += categoryScore;
    reasons.push("Requires engineering design, synthesis, or optimization.");
  }

  const tradeoffSignals = countMatches(text, [
    /\btrade[- ]?off\b/,
    /\bbalance\b/,
    /\bwhile minimizing\b/,
    /\bwhile maxim[iz]ing\b/,
    /\bsubject to\b/,
    /\bunder constraints\b/,
    /\bhowever\b/,
    /\bcompromise\b/,
  ]);
  const constraintSignals = countMatches(text, [
    /\bconstraint\b/,
    /\blimit\b/,
    /\brequirement\b/,
    /\bcost\b/,
    /\bbudget\b/,
    /\befficien/,
    /\breliability\b/,
    /\blatency\b/,
    /\bbandwidth\b/,
    /\bweight\b/,
    /\bspace\b/,
    /\btemperature\b/,
    /\btime\b/,
    /\bpower\b/,
  ]);
  const constraintTradeoffScore = Math.min(
    20,
    clampCategoryScore(constraintSignals, 10) +
      clampCategoryScore(tradeoffSignals, 10),
  );
  if (constraintTradeoffScore > 0) {
    categoryScores.constraintsTradeoffs = constraintTradeoffScore;
    score += constraintTradeoffScore;
    reasons.push("Includes constraints or trade-off analysis.");
  }

  const judgmentSignals = countMatches(text, [
    /\banaly[sz]e\b/,
    /\bevaluate\b/,
    /\bjustify\b/,
    /\bcompare\b/,
    /\btroubleshoot\b/,
    /\bderive\b/,
    /\binvestigate\b/,
    /\bdecide\b/,
    /\bassess\b/,
    /\bvalidate\b/,
  ]);
  if (judgmentSignals > 0) {
    const categoryScore = clampCategoryScore(judgmentSignals, 15);
    categoryScores.engineeringJudgment = categoryScore;
    score += categoryScore;
    reasons.push("Requires engineering judgment, justification, or evaluation.");
  }

  const systemSignals = countMatches(text, [
    /\bsystem\b/,
    /\bnetwork\b/,
    /\bpower system\b/,
    /\bcontrol system\b/,
    /\bcommunication system\b/,
    /\bembedded system\b/,
    /\bmanufacturing\b/,
    /\bcircuit\b/,
    /\bprocess\b/,
    /\bplant\b/,
    /\binfrastructure\b/,
    /\bbridge\b/,
    /\bantenna\b/,
    /\brobot\b/,
    /\bprototype\b/,
  ]);
  if (systemSignals > 0) {
    const categoryScore = clampCategoryScore(systemSignals, 15);
    categoryScores.systemContext = categoryScore;
    score += categoryScore;
    reasons.push("Involves a real engineering system or context.");
  }

  const conceptSignals = countMatches(text, [
    /\band\b/,
    /\bcombined\b/,
    /\bintegrat/,
    /\bthermal\b/,
    /\belectrical\b/,
    /\bmechanical\b/,
    /\bstructural\b/,
    /\bfluid\b/,
    /\bmaterials?\b/,
    /\bcontrols?\b/,
    /\bcommunication\b/,
  ]);
  if (conceptSignals >= 2) {
    categoryScores.multipleEngineeringConcepts = 10;
    score += 10;
    reasons.push("Integrates multiple engineering concepts or variables.");
  }

  const dataSignals = countMatches(text, [
    /\bfigure\b/,
    /\bdiagram\b/,
    /\btable\b/,
    /\bgraph\b/,
    /\bdata\b/,
    /\bshown below\b/,
  ]);
  if (dataSignals > 0) {
    categoryScores.dataInterpretation = 5;
    score += 5;
    reasons.push("Uses external data, figures, tables, or diagrams.");
  }

  const standardsSafetySignals = countMatches(text, [
    /\bstandard\b/,
    /\bcode\b/,
    /\bsafety\b/,
    /\benvironment/,
    /\beconomic\b/,
    /\bmaintenance\b/,
    /\bethic/,
    /\bsustainab/,
  ]);
  if (standardsSafetySignals > 0) {
    categoryScores.standardsSafetyEnvironment = 5;
    score += 5;
    reasons.push("Considers standards, safety, environmental, or economic factors.");
  }

  const openEndedSignals = countMatches(text, [
    /\brecommend\b/,
    /\bjustify\b/,
    /\bpropose\b/,
    /\bselect the best\b/,
    /\bdevelop\b/,
    /\bdesign\b/,
    /\boptimi[sz]e\b/,
    /\bno single\b/,
  ]);
  if (openEndedSignals > 0) {
    const categoryScore = clampCategoryScore(openEndedSignals, 10);
    categoryScores.openEndedSolution = categoryScore;
    score += categoryScore;
    reasons.push("Suggests an open-ended solution or decision.");
  }

  const numbers = text.match(/\d+(?:\.\d+)?/g) || [];
  if (numbers.length >= 4) {
    categoryScores.multipleParameters = 5;
    score += 5;
    reasons.push("Contains multiple numerical parameters.");
  }

  const actionSignals = countMatches(text, [
    /\banaly[sz]e\b/,
    /\bdesign\b/,
    /\bevaluate\b/,
    /\brecommend\b/,
    /\bjustify\b/,
    /\bselect\b/,
    /\bcalculate\b/,
    /\bdetermine\b/,
  ]);
  if (actionSignals >= 3 && !categoryScores.multipleEngineeringConcepts) {
    categoryScores.multipleEngineeringConcepts = 5;
    score += 5;
    reasons.push("Requires multiple engineering actions.");
  }

  if (question.difficulty === "Difficult" && score > 0) {
    score = Math.min(100, score + 3);
  }

  const uniqueReasons = [...new Set(reasons)];
  const boundedScore = Math.min(100, score);
  const complexityLevel = getComplexityLevel(boundedScore);

  return {
    isComplexEngineeringProblem: boundedScore > 60,
    complexityScore: boundedScore,
    complexityLevel,
    complexityReasons: uniqueReasons.slice(0, 5),
    complexityCategoryScores: categoryScores,
  };
};

module.exports = {
  classifyComplexEngineeringProblem,
};
