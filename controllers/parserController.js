const fs = require("fs");
const path = require("path");
const mammoth = require("mammoth");
const pdfParse = require("pdf-parse");
const AdmZip = require("adm-zip");

const Upload = require("../models/Upload");
const Question = require("../models/Question");
const ParsedQuestion = require("../models/ParsedQuestion");

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

function parseQuestionsFromText(text) {
  const cleaned = text
    .replace(/\r/g, "")
    .replace(/\t/g, " ")
    .replace(/[ ]{2,}/g, " ");

  const blocks = cleaned.split(/\n(?=\d+[\).\s])/g);

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
      .replace(/^\d+[\).\s]*/, "")
      .trim();

    if (!questionOnly || !choiceA || !choiceB || !choiceC || !choiceD) {
      continue;
    }

    parsed.push({
      questionText: questionOnly,
      choices: {
        A: choiceA[1].trim(),
        B: choiceB[1].trim(),
        C: choiceC[1].trim(),
        D: choiceD[1].trim(),
      },
      correctAnswer: answer ? answer[1].toUpperCase() : "",
      difficulty: detectDifficulty(questionOnly),
      explanation: "",
    });
  }

  return parsed;
}

exports.parseUploadedQuestionnaire = async (req, res) => {
  try {
    const { uploadId, subject, topic } = req.body;

    const upload = await Upload.findById(uploadId);

    if (!upload) {
      return res.status(404).json({
        success: false,
        message: "Uploaded file not found.",
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

    if (upload.fileType.includes("wordprocessingml.document")) {
      const result = await mammoth.extractRawText({
        path: fullPath,
      });

      extractedText = result.value;

      extractedImages = extractDocxImages(fullPath);
    } else if (upload.fileType.includes("pdf")) {
      const buffer = fs.readFileSync(fullPath);
      const result = await pdfParse(buffer);
      extractedText = result.text;
    } else {
      return res.status(400).json({
        success: false,
        message:
          "Image OCR is not included yet. Use DOCX or PDF for auto parsing.",
      });
    }

    const parsedQuestions = parseQuestionsFromText(extractedText);

    if (parsedQuestions.length === 0) {
      return res.status(400).json({
        success: false,
        message:
          "No valid multiple-choice questions detected. Make sure the file uses A. B. C. D. format.",
      });
    }

    let imageIndex = 0;

    const saved = await ParsedQuestion.insertMany(
      parsedQuestions.map((q) => {
        const lowerText = q.questionText.toLowerCase();

        const needsFigure =
          lowerText.includes("figure") ||
          lowerText.includes("diagram") ||
          lowerText.includes("shown below") ||
          lowerText.includes("refer to") ||
          lowerText.includes("see figure");

        let image = undefined;

        if (needsFigure && extractedImages[imageIndex]) {
          image = extractedImages[imageIndex];
          imageIndex++;
        }

        return {
          upload: upload._id,
          subject,
          topic,
          questionText: q.questionText,
          choices: q.choices,
          correctAnswer: q.correctAnswer,
          difficulty: q.difficulty,
          explanation: q.explanation,
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
    const parsedQuestions = await ParsedQuestion.find()
      .populate("upload", "originalName")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      parsedQuestions,
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
    const parsed = await ParsedQuestion.findById(req.params.id);

    if (!parsed) {
      return res.status(404).json({
        success: false,
        message: "Parsed question not found.",
      });
    }

    if (!parsed.correctAnswer) {
      return res.status(400).json({
        success: false,
        message: "Please set the correct answer before approving.",
      });
    }

    const question = await Question.create({
      subject: parsed.subject,
      topic: parsed.topic,
      questionText: parsed.questionText,
      choices: parsed.choices,
      correctAnswer: parsed.correctAnswer,
      difficulty: parsed.difficulty,
      explanation: parsed.explanation,

      image: parsed.image,

      createdBy: req.user._id,
    });

    parsed.status = "Approved";
    await parsed.save();

    res.json({
      success: true,
      message: "Question approved and saved to question bank.",
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
    const updated = await ParsedQuestion.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true },
    );

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
    const parsed = await ParsedQuestion.findById(req.params.id);

    if (!parsed) {
      return res.status(404).json({
        success: false,
        message: "Parsed question not found.",
      });
    }

    parsed.status = "Rejected";
    await parsed.save();

    res.json({
      success: true,
      message: "Parsed question rejected.",
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
