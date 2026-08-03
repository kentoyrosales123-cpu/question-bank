const fs = require("fs");
const path = require("path");
const mammoth = require("mammoth");
const pdfParse = require("pdf-parse");
const AdmZip = require("adm-zip");
const { createWorker } = require("tesseract.js");

const Upload = require("../models/Upload");
const Question = require("../models/Question");
const ParsedQuestion = require("../models/ParsedQuestion");
const { suggestCourseOutcomes } = require("../services/obeSuggestionService");
const {
  canAccessSubject,
  canApproveQuestionBank,
  canCreateContent,
  isAdmin,
} = require("../utils/roles");
const {
  formatObeMappingError,
  getMissingObeMappingFields,
} = require("../utils/obeValidation");

const isAdminUser = (user) => isAdmin(user);
const ENGINEERING_PROGRAMS = ["ECE", "CE", "EE", "ME", "CpE", "CHE"];

const isUploadOwner = (upload, user) =>
  Boolean(
    upload?.uploadedBy &&
    user?._id &&
    upload.uploadedBy.toString() === user._id.toString(),
  );

const isGeneratedOwner = (parsed, user) =>
  Boolean(
    parsed?.generatedBy &&
      user?._id &&
      parsed.generatedBy.toString() === user._id.toString(),
  );

const getAccessibleUploadIds = async (user) => {
  if (isAdminUser(user)) {
    return null;
  }

  const uploads = await Upload.find({ uploadedBy: user._id })
    .select("_id")
    .lean();
  return uploads.map((upload) => upload._id);
};

const getParsedQuestionForUser = async (parsedQuestionId, user) => {
  const parsed = await ParsedQuestion.findById(parsedQuestionId).populate(
    "upload",
    "originalName uploadedBy",
  );

  if (!parsed) {
    return { parsed: null, hasAccess: false };
  }

  return {
    parsed,
    hasAccess:
      isAdminUser(user) ||
      isUploadOwner(parsed.upload, user) ||
      isGeneratedOwner(parsed, user) ||
      (canApproveQuestionBank(user) && canAccessSubject(user, parsed.subject)),
  };
};

const getParsedQuestionUpdates = (body = {}) => {
  const updates = {};
  const fields = [
    "subject",
    "engineeringProgram",
    "topic",
    "questionText",
    "correctAnswer",
    "difficulty",
    "courseOutcome",
    "programOutcome",
    "bloomLevel",
    "explanation",
  ];

  fields.forEach((field) => {
    if (body[field] !== undefined) {
      updates[field] = body[field];
    }
  });

  if (body.choices && typeof body.choices === "object") {
    updates.choices = {
      A: body.choices.A || "",
      B: body.choices.B || "",
      C: body.choices.C || "",
      D: body.choices.D || "",
    };
  }

  if (body.outcomeWeight !== undefined) {
    updates.outcomeWeight = Number(body.outcomeWeight || 1);
  }

  return updates;
};

const normalizeQuestionForDuplicateCheck = (value = "") =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const getTokenSet = (value = "") =>
  new Set(
    normalizeQuestionForDuplicateCheck(value)
      .split(" ")
      .filter((token) => token.length > 2),
  );

const getSimilarityScore = (left = "", right = "") => {
  const leftTokens = getTokenSet(left);
  const rightTokens = getTokenSet(right);

  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }

  let intersection = 0;

  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) {
      intersection++;
    }
  });

  const union = new Set([...leftTokens, ...rightTokens]).size;

  return union > 0 ? intersection / union : 0;
};

const findDuplicateCandidates = (question, existingQuestions = []) => {
  const normalizedText = normalizeQuestionForDuplicateCheck(
    question.questionText,
  );

  return existingQuestions
    .map((existing) => {
      const existingText = normalizeQuestionForDuplicateCheck(
        existing.questionText,
      );
      const sameSubject =
        normalizeQuestionForDuplicateCheck(existing.subject) ===
        normalizeQuestionForDuplicateCheck(question.subject);
      const sameTopic =
        normalizeQuestionForDuplicateCheck(existing.topic) ===
        normalizeQuestionForDuplicateCheck(question.topic);
      const sameEngineeringProgram =
        normalizeQuestionForDuplicateCheck(existing.engineeringProgram) ===
        normalizeQuestionForDuplicateCheck(question.engineeringProgram);
      const exactText = normalizedText && normalizedText === existingText;
      const sameDuplicateContext = sameSubject && sameTopic && sameEngineeringProgram;
      const score = exactText && sameDuplicateContext ? 1 : 0;

      return {
        questionId: existing._id,
        questionText: existing.questionText,
        subject: existing.subject,
        engineeringProgram: existing.engineeringProgram,
        topic: existing.topic,
        difficulty: existing.difficulty,
        score: Math.min(1, Math.round(score * 1000) / 1000),
        exactText,
        sameSubject,
        sameTopic,
        sameEngineeringProgram,
        sameDuplicateContext,
      };
    })
    .filter((candidate) => candidate.exactText && candidate.sameDuplicateContext)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
};

const OCR_LANG_PATH = path.join(
  path.dirname(require.resolve("@tesseract.js-data/eng")),
  "4.0.0",
);

function detectDifficulty(text) {
  const lower = text.toLowerCase();

  let score = 0;

  // EASY QUESTIONS
  const easyKeywords = [
    "what is",
    "define",
    "identify",
    "state",
    "which of the following",
    "true or false",
  ];

  easyKeywords.forEach((word) => {
    if (lower.includes(word)) {
      score += 1;
    }
  });

  // AVERAGE QUESTIONS
  const averageKeywords = [
    "determine",
    "find",
    "compute",
    "calculate",
    "solve",
    "obtain",
  ];

  averageKeywords.forEach((word) => {
    if (lower.includes(word)) {
      score += 2;
    }
  });

  // DIFFICULT QUESTIONS
  const difficultKeywords = [
    "derive",
    "prove",
    "analyze",
    "evaluate",
    "design",
    "justify",
    "compare",
    "troubleshoot",
  ];

  difficultKeywords.forEach((word) => {
    if (lower.includes(word)) {
      score += 3;
    }
  });

  // LONG QUESTIONS = HARDER
  if (lower.length > 150) score += 2;
  if (lower.length > 250) score += 3;

  // MANY NUMBERS = COMPUTATION
  const numbers = lower.match(/\d+/g);

  if (numbers && numbers.length >= 3) {
    score += 2;
  }

  // FIGURES/TABLES/CIRCUITS
  const technicalKeywords = [
    "figure",
    "diagram",
    "table",
    "graph",
    "circuit",
    "waveform",
    "network",
  ];

  technicalKeywords.forEach((word) => {
    if (lower.includes(word)) {
      score += 2;
    }
  });

  // FINAL DECISION
  if (score <= 2) {
    return "Easy";
  }

  if (score <= 6) {
    return "Average";
  }

  return "Difficult";
}

function extractDocxImages(filePath) {
  const zip = new AdmZip(filePath);
  const entries = zip.getEntries();

  const images = [];

  console.log("TOTAL DOCX ENTRIES:", entries.length);

  entries.forEach((entry) => {
    if (entry.entryName.startsWith("word/media/")) {
      const ext = path.extname(entry.entryName).toLowerCase();

      let contentType = "image/png";

      if (ext === ".jpg" || ext === ".jpeg") {
        contentType = "image/jpeg";
      }

      if (ext === ".png") {
        contentType = "image/png";
      }

      if (ext === ".webp") {
        contentType = "image/webp";
      }

      // FIX: convert to Node Buffer
      const imageBuffer = Buffer.from(entry.getData());

      console.log("FOUND IMAGE:", entry.entryName);

      console.log("BUFFER SIZE:", imageBuffer.length);

      // skip empty images
      if (imageBuffer.length > 100) {
        images.push({
          data: imageBuffer,
          contentType,
        });
      }
    }
  });

  console.log("TOTAL VALID IMAGES:", images.length);

  return images;
}

function decodeXml(value = "") {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function normalizeDocxText(value = "") {
  return value
    .replace(/\r/g, "")
    .replace(/\t/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function extractParagraphText(xml) {
  const textParts = [];
  const textRegex = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g;
  let match;

  while ((match = textRegex.exec(xml))) {
    textParts.push(decodeXml(match[1]));
  }

  return normalizeDocxText(
    textParts
      .join("")
      .replace(/<w:tab\b[^>]*\/>/g, " ")
      .replace(/<w:br\b[^>]*\/>/g, "\n"),
  );
}

function extractTableRows(xml) {
  const rows = [];
  const rowRegex = /<w:tr\b[\s\S]*?<\/w:tr>/g;
  let rowMatch;

  while ((rowMatch = rowRegex.exec(xml))) {
    const rowXml = rowMatch[0];
    const row = [];
    const cellRegex = /<w:tc\b[\s\S]*?<\/w:tc>/g;
    let cellMatch;

    while ((cellMatch = cellRegex.exec(rowXml))) {
      const cellText = extractParagraphText(cellMatch[0])
        .replace(/\n/g, " ")
        .replace(/[ ]{2,}/g, " ")
        .trim();

      row.push(cellText);
    }

    if (row.some(Boolean)) {
      rows.push(row);
    }
  }

  const maxColumns = rows.reduce((max, row) => Math.max(max, row.length), 0);

  if (rows.length === 0 || maxColumns < 2) {
    return [];
  }

  return rows;
}

function getDocxImageContentType(fileName) {
  const ext = path.extname(fileName).toLowerCase();

  if (ext === ".jpg" || ext === ".jpeg") {
    return "image/jpeg";
  }

  if (ext === ".webp") {
    return "image/webp";
  }

  return "image/png";
}

function getDocxRelationships(zip) {
  const rels = {};
  const relsEntry = zip.getEntry("word/_rels/document.xml.rels");

  if (!relsEntry) {
    return rels;
  }

  const relsXml = relsEntry.getData().toString("utf8");
  const relRegex =
    /<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*>/g;
  let match;

  while ((match = relRegex.exec(relsXml))) {
    const [, id, target] = match;
    const normalizedTarget = target.startsWith("/")
      ? target.replace(/^\//, "")
      : `word/${target}`.replace(/\/[^/]+\/\.\.\//g, "/");

    rels[id] = normalizedTarget;
  }

  return rels;
}

function getDocxImageMap(zip) {
  const rels = getDocxRelationships(zip);
  const imagesByRelId = {};

  Object.entries(rels).forEach(([relId, target]) => {
    if (!target.startsWith("word/media/")) {
      return;
    }

    const entry = zip.getEntry(target);

    if (!entry) {
      return;
    }

    const imageBuffer = Buffer.from(entry.getData());

    if (imageBuffer.length <= 100) {
      return;
    }

    imagesByRelId[relId] = {
      data: imageBuffer,
      contentType: getDocxImageContentType(target),
    };
  });

  return imagesByRelId;
}

function extractParagraphImage(xml, imagesByRelId) {
  const imageMatch = xml.match(/r:embed="([^"]+)"/);

  if (!imageMatch) {
    return undefined;
  }

  return imagesByRelId[imageMatch[1]];
}

function extractDocxBodyBlocks(filePath) {
  const zip = new AdmZip(filePath);
  const documentEntry = zip.getEntry("word/document.xml");

  if (!documentEntry) {
    return { blocks: [], fallbackImages: [] };
  }

  const documentXml = documentEntry.getData().toString("utf8");
  const bodyMatch = documentXml.match(/<w:body\b[^>]*>([\s\S]*?)<\/w:body>/);

  if (!bodyMatch) {
    return { blocks: [], fallbackImages: [] };
  }

  const bodyXml = bodyMatch[1];
  const blocks = [];
  const tagRegex = /<(\/?)w:(p|tbl)\b[^>]*?>/g;
  const stack = [];
  let blockStart = -1;
  let blockType = "";
  let match;

  while ((match = tagRegex.exec(bodyXml))) {
    const isClosing = match[1] === "/";
    const tagName = match[2];

    if (!isClosing) {
      if (stack.length === 0) {
        blockStart = match.index;
        blockType = tagName === "p" ? "paragraph" : "table";
      }

      stack.push(tagName);
      continue;
    }

    if (stack.length === 0) {
      continue;
    }

    stack.pop();

    if (stack.length === 0 && blockStart >= 0) {
      blocks.push({
        type: blockType,
        xml: bodyXml.slice(blockStart, tagRegex.lastIndex),
      });
      blockStart = -1;
      blockType = "";
    }
  }

  const imagesByRelId = getDocxImageMap(zip);

  return {
    blocks: blocks.map((block) => {
      if (block.type === "paragraph") {
        return {
          type: block.type,
          text: extractParagraphText(block.xml),
          image: extractParagraphImage(block.xml, imagesByRelId),
        };
      }

      return {
        type: block.type,
        rows: extractTableRows(block.xml),
      };
    }),
    fallbackImages: extractDocxImages(filePath),
  };
}

function isImageFile(fileType) {
  return ["image/jpeg", "image/png", "image/jpg", "image/webp"].includes(
    fileType,
  );
}

async function extractTextFromImage(filePath) {
  const worker = await createWorker("eng", 1, {
    langPath: OCR_LANG_PATH,
  });

  try {
    const {
      data: { text },
    } = await worker.recognize(filePath);

    return text;
  } finally {
    await worker.terminate();
  }
}

function parseQuestionsFromText(text) {
  const cleaned = text
    .replace(/\r/g, "")
    .replace(/\t/g, " ")
    .replace(/[ ]{2,}/g, " ");

  const blocks = cleaned.split(/\n(?=(?:QUESTION\s*)?\d+[:).\s])/gi);

  const parsed = [];

  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) continue;

    const joined = lines.join("\n");

    const choiceA = joined.match(/A[\).]\s*(.*?)(?=\n?B[\).])/is);
    const choiceB = joined.match(/B[\).]\s*(.*?)(?=\n?C[\).])/is);
    const choiceC = joined.match(/C[\).]\s*(.*?)(?=\n?D[\).])/is);
    const choiceD = joined.match(
      /D[\).]\s*(.*?)(?=\n?(Answer|Ans\.|Correct|$))/is,
    );
    const answer = joined.match(
      /(?:Answer|Ans\.|Correct Answer)[:\s]+([A-D])/i,
    );

    const questionOnly = joined
      .replace(/A[\).][\s\S]*/i, "")
      .replace(/^(?:QUESTION\s*)?\d+[:).\s]*/i, "")
      .trim();

    if (!questionOnly || (!choiceA && !choiceB)) {
      continue;
    }

    parsed.push({
      questionText: questionOnly,
      choices: {
        A: choiceA ? choiceA[1].trim() : "",
        B: choiceB ? choiceB[1].trim() : "",
        C: choiceC ? choiceC[1].trim() : "",
        D: choiceD ? choiceD[1].trim() : "",
      },
      correctAnswer: answer ? answer[1].toUpperCase() : "",
      difficulty: detectDifficulty(questionOnly),
      explanation: "",
      tables: [],
    });
  }

  return parsed;
}

function choiceCount(question) {
  return Object.values(question.choices || {}).filter(Boolean).length;
}

function shouldSaveParsedQuestion(question) {
  return Boolean(
    question && question.questionText && choiceCount(question) >= 2,
  );
}

function parseDocxQuestions(filePath) {
  const { blocks, fallbackImages } = extractDocxBodyBlocks(filePath);
  const parsed = [];
  let currentQuestion = null;

  const saveCurrentQuestion = () => {
    if (shouldSaveParsedQuestion(currentQuestion)) {
      parsed.push(currentQuestion);
    }
  };

  blocks.forEach((block) => {
    if (block.type === "table") {
      if (
        currentQuestion &&
        choiceCount(currentQuestion) < 4 &&
        block.rows.length > 0
      ) {
        currentQuestion.tables.push({ rows: block.rows });
      }

      return;
    }

    if (block.image && currentQuestion && !currentQuestion.image) {
      currentQuestion.image = block.image;
    }

    if (!block.text) {
      return;
    }

    const questionMatch = block.text.match(/^(?:QUESTION\s*)?\d+[:).\s]+(.+)/i);

    if (questionMatch) {
      saveCurrentQuestion();
      currentQuestion = {
        questionText: questionMatch[1].trim(),
        choices: {
          A: "",
          B: "",
          C: "",
          D: "",
        },
        correctAnswer: "",
        difficulty: detectDifficulty(questionMatch[1].trim()),
        explanation: "",
        tables: [],
        image: block.image,
      };
      return;
    }

    const choiceMatch = block.text.match(/^([a-d])[\).]\s*(.+)/i);

    if (choiceMatch && currentQuestion) {
      currentQuestion.choices[choiceMatch[1].toUpperCase()] =
        choiceMatch[2].trim();
      return;
    }

    const answerMatch = block.text.match(
      /^(?:Answer|Ans\.|Correct Answer)[:\s]+([A-D])/i,
    );

    if (answerMatch && currentQuestion) {
      currentQuestion.correctAnswer = answerMatch[1].toUpperCase();
      return;
    }

    if (currentQuestion && choiceCount(currentQuestion) === 0) {
      currentQuestion.questionText = `${currentQuestion.questionText}\n${block.text}`;
      currentQuestion.difficulty = detectDifficulty(
        currentQuestion.questionText,
      );
    }
  });

  saveCurrentQuestion();

  const inlineImageCount = parsed.filter((question) => question.image).length;

  if (
    inlineImageCount === 0 &&
    fallbackImages.length > 0 &&
    fallbackImages.length === parsed.length
  ) {
    parsed.forEach((question, index) => {
      question.image = fallbackImages[index];
    });
  }

  return parsed;
}

exports.parseUploadedQuestionnaire = async (req, res) => {
  try {
    if (!canCreateContent(req.user)) {
      return res.status(403).json({
        success: false,
        message: "Only Admins and Exam Creators can parse questionnaires.",
      });
    }

    const { uploadId, engineeringProgram, subject, topic } = req.body;
    const selectedEngineeringProgram = String(
      engineeringProgram || "",
    ).trim();

    if (!selectedEngineeringProgram) {
      return res.status(400).json({
        success: false,
        message: "Select an engineering program before parsing.",
      });
    }

    if (!ENGINEERING_PROGRAMS.includes(selectedEngineeringProgram)) {
      return res.status(400).json({
        success: false,
        message: "Selected engineering program is invalid.",
      });
    }

    if (!canAccessSubject(req.user, subject)) {
      return res.status(403).json({
        success: false,
        message: "You do not have access to parse questions for this subject.",
      });
    }

    const upload = await Upload.findById(uploadId);

    if (!upload) {
      return res.status(404).json({
        success: false,
        message: "Uploaded file not found.",
      });
    }

    const isOwner =
      upload.uploadedBy &&
      upload.uploadedBy.toString() === req.user._id.toString();

    if (!isAdminUser(req.user) && !isOwner) {
      return res.status(403).json({
        success: false,
        message: "You do not have access to this uploaded file.",
      });
    }

    const fullPath = path.join(__dirname, "..", upload.filePath);

    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({
        success: false,
        message: "Physical uploaded file not found.",
      });
    }

    let extractedText = "";

    let extractedImages = [];
    let parsedQuestions = [];

    if (upload.fileType.includes("wordprocessingml.document")) {
      parsedQuestions = parseDocxQuestions(fullPath);
    } else if (upload.fileType.includes("pdf")) {
      const buffer = fs.readFileSync(fullPath);
      const result = await pdfParse(buffer);
      extractedText = result.text;
    } else if (isImageFile(upload.fileType)) {
      extractedText = await extractTextFromImage(fullPath);
    } else {
      return res.status(400).json({
        success: false,
        message:
          "Unsupported file type. Use DOCX, PDF, JPG, PNG, or WEBP for auto parsing.",
      });
    }

    if (parsedQuestions.length === 0 && extractedText) {
      parsedQuestions = parseQuestionsFromText(extractedText);
    }

    if (parsedQuestions.length === 0) {
      return res.status(400).json({
        success: false,
        message:
          "No valid multiple-choice questions detected. Make sure the file uses A. B. C. D. format.",
      });
    }

    let imageIndex = 0;
    const shouldAttachImagesByOrder =
      extractedImages.length > 0 &&
      extractedImages.length === parsedQuestions.length;

    const saved = await ParsedQuestion.insertMany(
      parsedQuestions.map((q) => {
        const lowerText = q.questionText.toLowerCase();

        const needsFigure =
          lowerText.includes("figure") ||
          lowerText.includes("diagram") ||
          lowerText.includes("shown below") ||
          lowerText.includes("refer to") ||
          lowerText.includes("see figure");

        let image = q.image;

        if (
          !image &&
          (needsFigure || shouldAttachImagesByOrder) &&
          extractedImages[imageIndex]
        ) {
          image = extractedImages[imageIndex];
          imageIndex++;
        }

        return {
          upload: upload._id,
          engineeringProgram: selectedEngineeringProgram,
          subject,
          topic,
          questionText: q.questionText,
          choices: q.choices,
          correctAnswer: q.correctAnswer,
          difficulty: q.difficulty,
          courseOutcome: q.courseOutcome || "",
          programOutcome: q.programOutcome || "",
          bloomLevel: q.bloomLevel || "",
          outcomeWeight: Number(q.outcomeWeight || 1),
          explanation: q.explanation,
          tables: q.tables || [],
          image,
        };
      }),
    );

    res.json({
      success: true,
      message: `${saved.length} questions parsed successfully.`,
      parsedQuestions: saved,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getParsedQuestions = async (req, res) => {
  try {
    const requestedUploadId = String(req.query.uploadId || "").trim();
    const accessibleUploadIds = await getAccessibleUploadIds(req.user);
    const query = {};
    let scopedUpload = null;

    if (requestedUploadId) {
      const upload = await Upload.findById(requestedUploadId).select(
        "originalName uploadedBy",
      );

      if (!upload) {
        return res.status(404).json({
          success: false,
          message: "Uploaded file not found.",
        });
      }

      if (!isAdminUser(req.user) && !isUploadOwner(upload, req.user)) {
        return res.status(403).json({
          success: false,
          message: "You do not have access to this uploaded file.",
        });
      }

      query.upload = upload._id;
      scopedUpload = upload;
    } else if (canApproveQuestionBank(req.user)) {
      Object.assign(query, {});
    } else if (accessibleUploadIds) {
      query.$or = [
        { upload: { $in: accessibleUploadIds } },
        { generatedBy: req.user._id },
      ];
    }

    const [parsedQuestions, existingQuestions] = await Promise.all([
      ParsedQuestion.find(query)
        .populate("upload", "originalName uploadedBy")
        .populate("generatedBy", "name email")
        .sort({ createdAt: -1 }),
      Question.find()
        .select("subject engineeringProgram topic questionText difficulty")
        .lean(),
    ]);
    const parsedQuestionsWithDuplicates = parsedQuestions.map((question) => {
      const item = question.toObject();

      item.duplicateCandidates = findDuplicateCandidates(
        item,
        existingQuestions,
      );
      item.duplicateRisk =
        item.duplicateCandidates.length === 0 ? "None" : "High";

      return item;
    }).filter((item) => canAccessSubject(req.user, item.subject));
    const suggestions = await suggestCourseOutcomes(parsedQuestionsWithDuplicates);

    parsedQuestionsWithDuplicates.forEach((item, index) => {
      item.suggestedCourseOutcome = suggestions[index];
    });

    res.json({
      success: true,
      parsedQuestions: parsedQuestionsWithDuplicates,
      upload: scopedUpload
        ? {
            _id: scopedUpload._id,
            originalName: scopedUpload.originalName,
          }
        : null,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.approveParsedQuestion = async (req, res) => {
  try {
    if (!canApproveQuestionBank(req.user)) {
      return res.status(403).json({
        success: false,
        message: "Only Admins and CEE-CAC Coordinators can approve parsed questions.",
      });
    }

    const { parsed, hasAccess } = await getParsedQuestionForUser(
      req.params.id,
      req.user,
    );

    if (!parsed) {
      return res.status(404).json({
        success: false,
        message: "Parsed question not found.",
      });
    }

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: "You do not have access to this parsed question.",
      });
    }

    if (!parsed.correctAnswer) {
      return res.status(400).json({
        success: false,
        message: "Please set the correct answer before approving.",
      });
    }

    const missingObeFields = getMissingObeMappingFields(parsed);

    if (missingObeFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: formatObeMappingError(missingObeFields),
      });
    }

    if (!canAccessSubject(req.user, parsed.subject)) {
      return res.status(403).json({
        success: false,
        message: "You do not have access to approve questions for this subject.",
      });
    }

    const existingQuestions = await Question.find()
      .select("subject engineeringProgram topic questionText difficulty")
      .lean();
    const duplicateCandidates = findDuplicateCandidates(
      parsed,
      existingQuestions,
    );
    const exactDuplicate = duplicateCandidates.find(
      (candidate) => candidate.score === 1,
    );

    if (exactDuplicate && req.body?.force !== true) {
      return res.status(409).json({
        success: false,
        message:
          "High duplicate risk: 100% match detected. Review the duplicate warning before approving this question.",
        duplicateCandidates,
      });
    }

    const question = await Question.create({
      subject: parsed.subject,
      engineeringProgram: parsed.engineeringProgram,
      topic: parsed.topic,
      questionText: parsed.questionText,
      choices: parsed.choices,
      correctAnswer: parsed.correctAnswer,
      difficulty: parsed.difficulty,
      courseOutcome: parsed.courseOutcome,
      programOutcome: parsed.programOutcome,
      bloomLevel: parsed.bloomLevel,
      outcomeWeight: Number(parsed.outcomeWeight || 1),
      explanation: parsed.explanation,
      tables: parsed.tables || [],

      image: parsed.image,

      createdBy: req.user._id,
    });

    await parsed.deleteOne();

    res.json({
      success: true,
      message:
        "Question approved, saved to question bank, and removed from parsed review.",
      question,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.updateParsedQuestion = async (req, res) => {
  try {
    const { parsed, hasAccess } = await getParsedQuestionForUser(
      req.params.id,
      req.user,
    );

    if (!parsed) {
      return res.status(404).json({
        success: false,
        message: "Parsed question not found.",
      });
    }

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: "You do not have access to this parsed question.",
      });
    }

    Object.assign(parsed, getParsedQuestionUpdates(req.body));

    if (!canAccessSubject(req.user, parsed.subject)) {
      return res.status(403).json({
        success: false,
        message: "You do not have access to save questions for this subject.",
      });
    }
    const updated = await parsed.save();

    res.json({
      success: true,
      message: "Parsed question updated.",
      parsedQuestion: updated,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.rejectParsedQuestion = async (req, res) => {
  try {
    if (!canApproveQuestionBank(req.user)) {
      return res.status(403).json({
        success: false,
        message: "Only Admins and CEE-CAC Coordinators can reject parsed questions.",
      });
    }

    const { parsed, hasAccess } = await getParsedQuestionForUser(
      req.params.id,
      req.user,
    );

    if (!parsed) {
      return res.status(404).json({
        success: false,
        message: "Parsed question not found.",
      });
    }

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: "You do not have access to this parsed question.",
      });
    }

    await parsed.deleteOne();

    res.json({
      success: true,
      message: "Parsed question rejected and deleted.",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getParsedQuestionImage = async (req, res) => {
  try {
    const parsed = await ParsedQuestion.findById(req.params.id).select("image");

    if (!parsed || !parsed.image || !parsed.image.data) {
      return res.status(404).send("Image not found");
    }

    res.set("Content-Type", parsed.image.contentType);

    res.send(parsed.image.data);
  } catch (error) {
    res.status(500).send("Failed to load image");
  }
};
