const Question = require("../models/Question");
const Exam = require("../models/Exam");
const { logActivity } = require("../services/activityLogger");

const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ImageRun,
  Table,
  TableCell,
  TableRow,
  WidthType,
} = require("docx");

const canAccessExam = (exam, user) => {
  if (!exam || !user) return false;
  if (user.role === "admin") return true;

  return exam.user && exam.user.toString() === user._id.toString();
};

const normalizeSelection = (value) => {
  const values = Array.isArray(value) ? value : [value];

  return values
    .flatMap((item) => String(item || "").split(","))
    .map((item) => item.trim())
    .filter(Boolean);
};

const formatSelectionLabel = (values, fallback = "") =>
  values.length > 0 ? values.join(", ") : fallback;

const getRandomQuestions = async (subjects, topics, difficulty, count) => {
  if (Number(count) <= 0) {
    return [];
  }

  const match = {
    difficulty,
  };

  if (subjects.length > 0) {
    match.subject = { $in: subjects };
  }

  if (topics.length > 0) {
    match.topic = { $in: topics };
  }

  return Question.aggregate([
    { $match: match },
    { $sample: { size: Number(count) } },
  ]);
};

const normalizeBlueprint = (blueprint = []) =>
  (Array.isArray(blueprint) ? blueprint : [])
    .map((row) => ({
      subject: String(row.subject || "").trim(),
      topic: String(row.topic || "").trim(),
      easyCount: Number(row.easyCount || 0),
      averageCount: Number(row.averageCount || 0),
      difficultCount: Number(row.difficultCount || 0),
    }))
    .filter(
      (row) =>
        row.subject &&
        row.topic &&
        row.easyCount + row.averageCount + row.difficultCount > 0,
    );

const getBlueprintQuestions = async (blueprint) => {
  const selected = [];

  for (const row of blueprint) {
    const rowQuestions = [
      ...(await getRandomQuestions([row.subject], [row.topic], "Easy", row.easyCount)),
      ...(await getRandomQuestions(
        [row.subject],
        [row.topic],
        "Average",
        row.averageCount,
      )),
      ...(await getRandomQuestions(
        [row.subject],
        [row.topic],
        "Difficult",
        row.difficultCount,
      )),
    ];
    const expected = row.easyCount + row.averageCount + row.difficultCount;

    if (rowQuestions.length < expected) {
      throw new Error(
        `Not enough questions for ${row.subject} / ${row.topic}. Requested ${expected}, found ${rowQuestions.length}.`,
      );
    }

    selected.push(...rowQuestions);
  }

  const unique = [];
  const seen = new Set();

  selected.forEach((question) => {
    const id = question._id.toString();

    if (!seen.has(id)) {
      seen.add(id);
      unique.push(question);
    }
  });

  if (unique.length < selected.length) {
    throw new Error(
      "Blueprint selected duplicate questions across rows. Use more specific topics or lower the requested counts.",
    );
  }

  return unique;
};

exports.getExamOptions = async (req, res) => {
  try {
    const options = await Question.aggregate([
      {
        $group: {
          _id: "$subject",
          topics: { $addToSet: "$topic" },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    res.json({
      success: true,
      subjects: options
        .filter((item) => item._id)
        .map((item) => ({
          subject: item._id,
          topics: item.topics.filter(Boolean).sort(),
        })),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.generateExam = async (req, res) => {
  try {
    const {
      title,
      subject,
      topic,
      totalItems,
      easyCount,
      averageCount,
      difficultCount,
    } = req.body;
    const subjects = normalizeSelection(req.body.subjects || subject);
    const topics = normalizeSelection(req.body.topics || topic);
    const blueprint = normalizeBlueprint(req.body.blueprint);
    const useBlueprint = blueprint.length > 0;

    const total =
      Number(easyCount || 0) +
      Number(averageCount || 0) +
      Number(difficultCount || 0);
    const counts = [
      Number(totalItems),
      Number(easyCount || 0),
      Number(averageCount || 0),
      Number(difficultCount || 0),
    ];

    if (!useBlueprint && (subjects.length === 0 || !totalItems)) {
      return res.status(400).json({
        success: false,
        message: "At least one subject and total items are required.",
      });
    }

    if (
      counts.some((count) => !Number.isInteger(count) || count < 0) ||
      Number(totalItems) < 1
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Item counts must be whole numbers and total items must be at least 1.",
      });
    }

    if (Number(totalItems) !== total) {
      return res.status(400).json({
        success: false,
        message:
          "Total items must be equal to Easy + Average + Difficult count.",
      });
    }

    const blueprintTotals = blueprint.reduce(
      (totals, row) => ({
        easyCount: totals.easyCount + row.easyCount,
        averageCount: totals.averageCount + row.averageCount,
        difficultCount: totals.difficultCount + row.difficultCount,
      }),
      { easyCount: 0, averageCount: 0, difficultCount: 0 },
    );

    if (
      useBlueprint &&
      (blueprintTotals.easyCount !== Number(easyCount || 0) ||
        blueprintTotals.averageCount !== Number(averageCount || 0) ||
        blueprintTotals.difficultCount !== Number(difficultCount || 0))
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Blueprint difficulty totals must match the Easy, Average, and Difficult counts.",
      });
    }

    let allQuestions;

    if (useBlueprint) {
      try {
        allQuestions = (await getBlueprintQuestions(blueprint)).sort(
          () => Math.random() - 0.5,
        );
      } catch (blueprintError) {
        return res.status(400).json({
          success: false,
          message: blueprintError.message,
        });
      }
    } else {
      const easyQuestions = await getRandomQuestions(
        subjects,
        topics,
        "Easy",
        easyCount,
      );

      const averageQuestions = await getRandomQuestions(
        subjects,
        topics,
        "Average",
        averageCount,
      );

      const difficultQuestions = await getRandomQuestions(
        subjects,
        topics,
        "Difficult",
        difficultCount,
      );

      if (
        easyQuestions.length < Number(easyCount) ||
        averageQuestions.length < Number(averageCount) ||
        difficultQuestions.length < Number(difficultCount)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Not enough questions available for the selected difficulty distribution.",
        });
      }

      allQuestions = [
        ...easyQuestions,
        ...averageQuestions,
        ...difficultQuestions,
      ].sort(() => Math.random() - 0.5);
    }

    const exam = await Exam.create({
      title: title || "Generated Exam",
      subject: useBlueprint
        ? formatSelectionLabel([...new Set(blueprint.map((row) => row.subject))])
        : formatSelectionLabel(subjects),
      topic: useBlueprint
        ? formatSelectionLabel([...new Set(blueprint.map((row) => row.topic))])
        : formatSelectionLabel(topics),
      totalItems,
      easyCount,
      averageCount,
      difficultCount,
      questions: allQuestions.map((q) => q._id),
      user: req.user._id,
    });

    const populatedExam = await Exam.findById(exam._id).populate({
      path: "questions",
      select: "-image.data",
    });

    await logActivity(req, {
      user: req.user,
      action: "generate_exam",
      description: `Generated exam: ${exam.title}`,
      metadata: {
        exam: exam._id,
        title: exam.title,
        subjects,
        topics,
        totalItems,
        easyCount,
        averageCount,
        difficultCount,
        blueprint,
      },
    });

    res.status(201).json({
      success: true,
      message: "Exam generated successfully.",
      exam: populatedExam,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.submitExam = async (req, res) => {
  try {
    const { examId, answers } = req.body;

    if (!examId || !Array.isArray(answers)) {
      return res.status(400).json({
        success: false,
        message: "Exam ID and answers are required.",
      });
    }

    const exam = await Exam.findById(examId).populate("questions");

    if (!exam) {
      return res.status(404).json({
        success: false,
        message: "Exam not found.",
      });
    }

    if (!canAccessExam(exam, req.user)) {
      return res.status(403).json({
        success: false,
        message: "You do not have access to this exam.",
      });
    }

    let score = 0;

    const checkedAnswers = exam.questions.map((question) => {
      const userAnswer = answers.find(
        (ans) => ans.questionId === question._id.toString(),
      );

      const selectedAnswer = userAnswer ? userAnswer.selectedAnswer : "";

      const isCorrect = selectedAnswer === question.correctAnswer;

      if (isCorrect) score++;

      return {
        question: question._id,
        selectedAnswer,
        isCorrect,
      };
    });

    exam.answers = checkedAnswers;
    exam.score = score;
    exam.submitted = true;

    await exam.save();

    const result = await Exam.findById(exam._id)
      .populate("questions")
      .populate("answers.question");

    res.json({
      success: true,
      message: "Exam submitted successfully.",
      score,
      totalItems: exam.totalItems,
      result,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getExam = async (req, res) => {
  try {
    const exam = await Exam.findById(req.params.id)
      .populate({
        path: "questions",
        select: "-image.data",
      })
      .populate({
        path: "answers.question",
        select: "-image.data",
      });

    if (!exam) {
      return res.status(404).json({
        success: false,
        message: "Exam not found.",
      });
    }

    if (!canAccessExam(exam, req.user)) {
      return res.status(403).json({
        success: false,
        message: "You do not have access to this exam.",
      });
    }

    res.json({
      success: true,
      exam,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getMyExamSummary = async (req, res) => {
  try {
    const [totalExams, recentExams, itemSummary] = await Promise.all([
      Exam.countDocuments({ user: req.user._id }),
      Exam.find({ user: req.user._id })
        .select("title subject topic totalItems createdAt updatedAt")
        .sort({ createdAt: -1 })
        .limit(10),
      Exam.aggregate([
        {
          $match: {
            user: req.user._id,
          },
        },
        {
          $group: {
            _id: null,
            totalItems: { $sum: "$totalItems" },
          },
        },
      ]),
    ]);

    res.json({
      success: true,
      summary: {
        totalExams,
        totalItems: itemSummary[0]?.totalItems || 0,
        recentExams,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const getDocxImageType = (contentType) => {
  if (contentType === "image/jpeg" || contentType === "image/jpg") {
    return "jpg";
  }

  return "png";
};

const sanitizeFileName = (name) =>
  `${name || "generated-exam"}.docx`.replace(/[^a-z0-9.]/gi, "_").toLowerCase();

const buildDocxTables = (tables = []) =>
  tables
    .filter((table) => Array.isArray(table.rows) && table.rows.length > 0)
    .map(
      (table) =>
        new Table({
          width: {
            size: 100,
            type: WidthType.PERCENTAGE,
          },
          rows: table.rows.map(
            (row) =>
              new TableRow({
                children: row.map(
                  (cell) =>
                    new TableCell({
                      children: [new Paragraph(String(cell || ""))],
                    }),
                ),
              }),
          ),
        }),
    );

const buildExamDocxBuffer = async (exam, options = {}) => {
  const { includeAnswerKey = false } = options;
  const children = [];

  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: includeAnswerKey
            ? `${exam.title || "Generated Exam"} - Answer Key`
            : exam.title || "Generated Exam",
          bold: true,
          size: 32,
        }),
      ],
    }),
  );

  children.push(new Paragraph(`Subject: ${exam.subject}`));
  children.push(new Paragraph(`Topic: ${exam.topic || "General"}`));
  children.push(new Paragraph(`Total Items: ${exam.totalItems}`));
  children.push(new Paragraph(""));

  exam.questions.forEach((q, index) => {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `${index + 1}. ${q.questionText}`,
            bold: true,
          }),
        ],
      }),
    );

    if (q.image && q.image.data) {
      children.push(
        new Paragraph({
          children: [
            new ImageRun({
              data: q.image.data,
              type: getDocxImageType(q.image.contentType),
              transformation: {
                width: 400,
                height: 250,
              },
            }),
          ],
        }),
      );
    }

    if (q.tableData) {
      children.push(new Paragraph(q.tableData));
    }

    buildDocxTables(q.tables).forEach((table) => {
      children.push(table);
      children.push(new Paragraph(""));
    });

    children.push(new Paragraph(`A. ${q.choices.A}`));
    children.push(new Paragraph(`B. ${q.choices.B}`));
    children.push(new Paragraph(`C. ${q.choices.C}`));
    children.push(new Paragraph(`D. ${q.choices.D}`));

    if (includeAnswerKey) {
      const answerText = q.correctAnswer
        ? `${q.correctAnswer}. ${q.choices[q.correctAnswer] || ""}`
        : "No answer set";

      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `Answer: ${answerText}`,
              bold: true,
            }),
          ],
        }),
      );

      if (q.explanation) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `Explanation: ${q.explanation}`,
              }),
            ],
          }),
        );
      }
    }

    children.push(new Paragraph(""));
  });

  const doc = new Document({
    sections: [
      {
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
};

const sendExamDocx = async (req, res, options = {}) => {
  const { includeAnswerKey = false } = options;

  try {
    const exam = await Exam.findById(req.params.id).populate("questions");

    if (!exam) {
      return res.status(404).json({
        success: false,
        message: "Exam not found.",
      });
    }

    if (!canAccessExam(exam, req.user)) {
      return res.status(403).json({
        success: false,
        message: "You do not have access to this exam.",
      });
    }

    const buffer = await buildExamDocxBuffer(exam, { includeAnswerKey });
    const fileName = sanitizeFileName(
      includeAnswerKey
        ? `${exam.title || "generated-exam"}-answer-key`
        : `${exam.title || "generated-exam"}-no-answer`,
    );

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );

    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    res.send(buffer);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.downloadExamDocx = async (req, res) => {
  await sendExamDocx(req, res, { includeAnswerKey: false });
};

exports.downloadAnswerKeyDocx = async (req, res) => {
  await sendExamDocx(req, res, { includeAnswerKey: true });
};
