const CourseOutcome = require("../models/CourseOutcome");
const { suggestCourseOutcomes } = require("./obeSuggestionService");
const {
  classifyComplexEngineeringProblem,
} = require("../utils/complexEngineeringProblem");
const { isValidEngineeringProgram } = require("../utils/engineeringPrograms");

const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";
const DEFAULT_OLLAMA_MODEL = "qwen3:14b";
const DIFFICULTIES = ["Easy", "Average", "Difficult"];
const BLOOM_LEVELS = [
  "",
  "Remember",
  "Understand",
  "Apply",
  "Analyze",
  "Evaluate",
  "Create",
];
const MAX_OLLAMA_BATCH_SIZE = 2;

const clampItemCount = (value) => Math.min(20, Math.max(1, Number(value || 1)));

const escapeRegex = (value) =>
  String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeChoiceText = (value) => {
  if (value && typeof value === "object") {
    return String(
      value.text ||
        value.value ||
        value.answer ||
        value.choice ||
        value.content ||
        "",
    ).trim();
  }

  return String(value || "").trim();
};

const stripThinkBlocks = (value) =>
  String(value || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .trim();

const extractJsonCandidate = (value) => {
  const text = String(value || "").trim();
  const firstObject = text.indexOf("{");
  const firstArray = text.indexOf("[");
  const starts = [firstObject, firstArray].filter((index) => index >= 0);

  if (!starts.length) return text;

  const start = Math.min(...starts);
  const opening = text[start];
  const closing = opening === "{" ? "}" : "]";
  const end = text.lastIndexOf(closing);

  return end > start ? text.slice(start, end + 1) : text.slice(start);
};

const repairJsonText = (value) =>
  String(value || "")
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/}\s*{/g, "},{")
    .replace(/]\s*\[/g, "],[")
    .replace(/"\s*\n\s*"/g, '",\n"')
    .trim();

const parseJsonObject = (text) => {
  const raw = extractJsonCandidate(stripThinkBlocks(text));

  if (!raw) {
    throw new Error("AI response did not include generated question data.");
  }

  const candidates = [raw, repairJsonText(raw)];

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (error) {
      // Try the next repaired candidate before reporting a clean message.
    }
  }

  throw new Error("AI response was not valid JSON. Try fewer items or generate again.");
};

const getOutcomeContext = async ({ department, subject }) => {
  const query = {};

  if (subject) {
    query.subject = new RegExp(`^${escapeRegex(subject)}$`, "i");
  }

  if (department) {
    query.department = new RegExp(`^${escapeRegex(department)}$`, "i");
  }

  const outcomes = await CourseOutcome.find(query)
    .select("code description programOutcome bloomLevel keywords subject department")
    .sort({ code: 1 })
    .limit(30)
    .lean();

  return outcomes.map((outcome) => ({
    code: outcome.code,
    description: outcome.description,
    so: outcome.programOutcome || "",
    bloomLevel: outcome.bloomLevel || "",
    keywords: outcome.keywords || "",
  }));
};

const buildPrompt = ({ engineeringProgram, subject, topic, difficulty, bloomLevel, count, outcomes }) => `
Generate ${count} original multiple-choice engineering questions.

Context:
- Engineering program: ${engineeringProgram}
- Subject: ${subject}
- Topic: ${topic}
- Difficulty: ${difficulty}
- Preferred Bloom level: ${bloomLevel || "Choose the best fit"}
- Available CO/CLO to SO mapping: ${JSON.stringify(outcomes)}

Rules:
- Produce original, technically correct classroom assessment questions.
- Use four choices labelled A, B, C, and D.
- Exactly one choice must be correct.
- Avoid "all of the above" and "none of the above".
- Prefer numerical or applied engineering questions when the topic supports it.
- Include a concise explanation.
- Select the most fitting CO/CLO code from the provided mappings when possible.
- Select the matching SO letter from the CO/CLO mapping when possible.
- Include the specific student learning outcome as studentLearningOutcome when known.
- If no mapping fits, leave courseOutcome, studentOutcome, and studentLearningOutcome blank.
- Return only a JSON object. Do not include markdown, commentary, or extra text.
- Do not include <think> tags.

Required JSON shape:
{
  "questions": [
    {
      "questionText": "Question text",
      "choices": { "A": "Choice A", "B": "Choice B", "C": "Choice C", "D": "Choice D" },
      "correctAnswer": "A",
      "difficulty": "${difficulty}",
      "bloomLevel": "Remember|Understand|Apply|Analyze|Evaluate|Create",
      "courseOutcome": "CO1",
      "studentOutcome": "a",
      "studentLearningOutcome": "SLO1",
      "explanation": "Short explanation"
    }
  ]
}
`;

const callOllama = async ({ prompt }) => {
  const baseUrl = String(
    process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL,
  ).replace(/\/+$/, "");
  const model = process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL;

  const response = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      stream: false,
      format: "json",
      prompt: [
        "/no_think",
        "You generate exam-ready engineering assessment items.",
        "Return only valid JSON matching the requested shape.",
        prompt,
      ].join("\n\n"),
      think: false,
      options: {
        temperature: 0.35,
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      payload.error || `Ollama request failed with ${response.status}.`,
    );
  }

  return parseJsonObject(payload.response);
};

const getFirstValue = (object, keys) => {
  for (const key of keys) {
    if (object?.[key] !== undefined && object[key] !== null) {
      return object[key];
    }
  }

  return "";
};

const normalizeChoices = (question) => {
  const source = question.choices || question.options || question.answers || {};

  if (Array.isArray(source)) {
    const choices = { A: "", B: "", C: "", D: "" };

    source.forEach((item, index) => {
      const label = String(item?.label || item?.key || item?.letter || "")
        .trim()
        .toUpperCase();
      const fallbackLabel = ["A", "B", "C", "D"][index];
      const choiceKey = ["A", "B", "C", "D"].includes(label)
        ? label
        : fallbackLabel;

      if (choiceKey) {
        choices[choiceKey] = normalizeChoiceText(item);
      }
    });

    return choices;
  }

  return {
    A: normalizeChoiceText(
      source.A || source.a || source.optionA || source.choiceA || question.A || question.a,
    ),
    B: normalizeChoiceText(
      source.B || source.b || source.optionB || source.choiceB || question.B || question.b,
    ),
    C: normalizeChoiceText(
      source.C || source.c || source.optionC || source.choiceC || question.C || question.c,
    ),
    D: normalizeChoiceText(
      source.D || source.d || source.optionD || source.choiceD || question.D || question.d,
    ),
  };
};

const normalizeAnswer = (question, choices) => {
  const choiceSource = question.choices || question.options || question.answers || [];

  if (Array.isArray(choiceSource)) {
    const correctIndex = choiceSource.findIndex(
      (item) =>
        item?.correct === true ||
        item?.isCorrect === true ||
        String(item?.status || "").toLowerCase() === "correct",
    );

    if (correctIndex >= 0 && correctIndex < 4) {
      return ["A", "B", "C", "D"][correctIndex];
    }
  }

  const answer = String(
    getFirstValue(question, ["correctAnswer", "answer", "correct", "key"]),
  )
    .trim()
    .toUpperCase();
  const match = answer.match(/[ABCD]/);

  if (match) return match[0];

  const answerText = answer.toLowerCase();
  const matchingChoice = Object.entries(choices).find(
    ([, value]) => value && value.toLowerCase() === answerText,
  );

  return matchingChoice ? matchingChoice[0] : "";
};

const normalizeBloomLevel = (value, fallback) => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  const match = BLOOM_LEVELS.find(
    (level) => level && level.toLowerCase() === normalized,
  );

  return match || fallback || "";
};

const looksLikeGeneratedQuestion = (item) =>
  Boolean(
    item &&
      typeof item === "object" &&
      (item.questionText || item.question || item.stem || item.text),
  );

const normalizeGeneratedQuestion = (question, defaults) => {
  const choices = normalizeChoices(question);

  const normalizedQuestion = {
    engineeringProgram: defaults.engineeringProgram,
    department: defaults.department,
    subject: defaults.subject,
    topic: defaults.topic,
    questionText: String(
      getFirstValue(question, ["questionText", "question", "stem", "text"]),
    ).trim(),
    choices,
    correctAnswer: normalizeAnswer(question, choices),
    difficulty: DIFFICULTIES.includes(question.difficulty)
      ? question.difficulty
      : defaults.difficulty,
    courseOutcome: String(
      getFirstValue(question, ["courseOutcome", "co", "clo", "CO", "CLO"]),
    ).trim(),
    programOutcome: String(
      getFirstValue(question, ["studentOutcome", "so", "SO", "programOutcome"]),
    ).trim(),
    performanceIndicator: String(
      getFirstValue(question, ["performanceIndicator", "pi", "PI"]),
    ).trim(),
    studentLearningOutcome: String(
      getFirstValue(question, [
        "studentLearningOutcome",
        "slo",
        "SLO",
        "learningOutcome",
      ]),
    ).trim(),
    bloomLevel: normalizeBloomLevel(question.bloomLevel || question.bloom, defaults.bloomLevel),
    outcomeWeight: 1,
    explanation: String(question.explanation || question.rationale || "").trim(),
    tables: [],
  };
  const complexity = classifyComplexEngineeringProblem(normalizedQuestion);

  return {
    ...normalizedQuestion,
    ...complexity,
  };
};

const extractGeneratedItems = (aiResult) => {
  if (Array.isArray(aiResult)) return aiResult;
  if (looksLikeGeneratedQuestion(aiResult)) return [aiResult];

  const directItems =
    aiResult?.questions ||
    aiResult?.items ||
    aiResult?.generatedQuestions ||
    aiResult?.generated_questions ||
    aiResult?.data;

  if (Array.isArray(directItems)) return directItems;

  if (directItems && typeof directItems === "object") {
    return Object.values(directItems).filter(
      (item) => item && typeof item === "object",
    );
  }

  return Object.values(aiResult || {}).filter(
    (item) => looksLikeGeneratedQuestion(item),
  );
};

const normalizeCompleteQuestions = ({ aiResult, defaults, limit }) =>
  extractGeneratedItems(aiResult)
    .slice(0, limit)
    .map((question) => normalizeGeneratedQuestion(question, defaults))
    .filter(
      (question) =>
        question.questionText &&
        question.correctAnswer &&
        Object.values(question.choices).every(Boolean),
    );

const generateQuestionBatch = async ({ batchCount, defaults, outcomes, retry = false }) => {
  const prompt = buildPrompt({
    ...defaults,
    count: batchCount,
    outcomes,
  }) + (
    retry
      ? "\nIMPORTANT RETRY: Return compact valid JSON only. Do not use line breaks inside strings. Do not omit commas between array objects."
      : ""
  );
  const aiResult = await callOllama({ prompt });
  const questions = normalizeCompleteQuestions({
    aiResult,
    defaults,
    limit: batchCount,
  });

  if (questions.length === 0) {
    throw new Error("AI did not return any complete questions.");
  }

  return questions;
};

const applyOutcomeSuggestions = async (questions) => {
  const suggestions = await suggestCourseOutcomes(questions);

  return questions.map((question, index) => {
    const suggestion = suggestions[index];

    if (!suggestion) return question;

    return {
      ...question,
      courseOutcome: question.courseOutcome || suggestion.code || "",
      programOutcome: question.programOutcome || suggestion.programOutcome || "",
      performanceIndicator:
        question.performanceIndicator || suggestion.performanceIndicator || "",
      studentLearningOutcome:
        question.studentLearningOutcome ||
        suggestion.studentLearningOutcome ||
        "",
      bloomLevel: question.bloomLevel || suggestion.bloomLevel || "",
    };
  });
};

const generateQuestions = async (options, onProgress = () => {}) => {
  const count = clampItemCount(options.count);
  const defaults = {
    engineeringProgram: String(options.engineeringProgram || "").trim(),
    subject: String(options.subject || "").trim(),
    department: String(options.department || "").trim(),
    topic: String(options.topic || "").trim(),
    difficulty: DIFFICULTIES.includes(options.difficulty)
      ? options.difficulty
      : "Average",
    bloomLevel: BLOOM_LEVELS.includes(options.bloomLevel)
      ? options.bloomLevel
      : "",
  };

  if (!isValidEngineeringProgram(defaults.engineeringProgram)) {
    throw new Error("Selected engineering program is invalid.");
  }

  if (!defaults.subject || !defaults.topic) {
    throw new Error("Subject and topic are required.");
  }

  const outcomes = await getOutcomeContext({
    department: options.department,
    subject: defaults.subject,
  });
  const questions = [];
  let remaining = count;

  onProgress({
    total: count,
    generated: 0,
    remaining,
    batchSize: 0,
  });

  while (remaining > 0) {
    const batchCount = Math.min(MAX_OLLAMA_BATCH_SIZE, remaining);

    try {
      const batchQuestions = await generateQuestionBatch({
        batchCount,
        defaults,
        outcomes,
      });

      questions.push(...batchQuestions);
    } catch (error) {
      if (batchCount === 1) {
        const retryQuestion = await generateQuestionBatch({
          batchCount: 1,
          defaults,
          outcomes,
          retry: true,
        });

        questions.push(...retryQuestion);
      } else {
        const fallbackQuestion = await generateQuestionBatch({
          batchCount: 1,
          defaults,
          outcomes,
          retry: true,
        });

        questions.push(...fallbackQuestion);
      }
    }

    remaining = count - questions.length;
    onProgress({
      total: count,
      generated: Math.min(questions.length, count),
      remaining: Math.max(0, remaining),
      batchSize: batchCount,
    });

    if (questions.length >= count) {
      break;
    }

    if (batchCount === 1 && remaining === count) {
      break;
    }
  }

  if (questions.length === 0) {
    throw new Error("AI did not return any complete questions.");
  }

  return applyOutcomeSuggestions(questions.slice(0, count));
};

module.exports = {
  generateQuestions,
};
