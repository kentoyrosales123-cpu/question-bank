const Question = require("../models/Question");
const Exam = require("../models/Exam");

const { Document, Packer, Paragraph, TextRun } = require("docx");

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

    if (!subject || !totalItems) {
      return res.status(400).json({
        success: false,
        message: "Subject and total items are required.",
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

    const populatedExam = await Exam.findById(exam._id).populate("questions");

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

    const exam = await Exam.findById(examId).populate("questions");

    if (!exam) {
      return res.status(404).json({
        success: false,
        message: "Exam not found.",
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
      .populate("questions")
      .populate("answers.question");

    if (!exam) {
      return res.status(404).json({
        success: false,
        message: "Exam not found.",
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

exports.downloadExamDocx = async (req, res) => {
  try {
    const exam = await Exam.findById(req.params.id).populate("questions");

    if (!exam) {
      return res.status(404).json({
        success: false,
        message: "Exam not found.",
      });
    }

    const children = [];

    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: exam.title || "Generated Exam",
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

      children.push(new Paragraph(`A. ${q.choices.A}`));
      children.push(new Paragraph(`B. ${q.choices.B}`));
      children.push(new Paragraph(`C. ${q.choices.C}`));
      children.push(new Paragraph(`D. ${q.choices.D}`));
      children.push(new Paragraph(`Answer: ${q.correctAnswer || ""}`));

      if (q.explanation) {
        children.push(new Paragraph(`Explanation: ${q.explanation}`));
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

    const buffer = await Packer.toBuffer(doc);

    const fileName = `${exam.title || "generated-exam"}.docx`
      .replace(/[^a-z0-9]/gi, "_")
      .toLowerCase();

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
