const Question = require("../models/Question");
const Exam = require("../models/Exam");

const { Document, Packer, Paragraph, TextRun, ImageRun } = require("docx");

const canAccessExam = (exam, user) => {
  if (!exam || !user) return false;
  if (user.role === "admin") return true;

  return exam.user && exam.user.toString() === user._id.toString();
};

const getRandomQuestions = async (subject, topic, difficulty, count) => {
  const match = {
    subject,
    difficulty,
  };

  if (topic) {
    match.topic = topic;
  }

  return Question.aggregate([
    { $match: match },
    { $sample: { size: Number(count) } },
  ]);
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

    if (!subject || !totalItems) {
      return res.status(400).json({
        success: false,
        message: "Subject and total items are required.",
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

    const easyQuestions = await getRandomQuestions(
      subject,
      topic,
      "Easy",
      easyCount,
    );

    const averageQuestions = await getRandomQuestions(
      subject,
      topic,
      "Average",
      averageCount,
    );

    const difficultQuestions = await getRandomQuestions(
      subject,
      topic,
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

    const allQuestions = [
      ...easyQuestions,
      ...averageQuestions,
      ...difficultQuestions,
    ].sort(() => Math.random() - 0.5);

    const exam = await Exam.create({
      title: title || "Generated Exam",
      subject,
      topic,
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

const getDocxImageType = (contentType) => {
  if (contentType === "image/jpeg" || contentType === "image/jpg") {
    return "jpg";
  }

  return "png";
};

const sanitizeFileName = (name) =>
  `${name || "generated-exam"}.docx`.replace(/[^a-z0-9.]/gi, "_").toLowerCase();

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
