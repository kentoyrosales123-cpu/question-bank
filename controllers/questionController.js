const Question = require("../models/Question");
const Exam = require("../models/Exam");

const getQuestionSnapshot = (question) => ({
  subject: question.subject,
  topic: question.topic,
  questionText: question.questionText,
  choices: {
    A: question.choices?.A || "",
    B: question.choices?.B || "",
    C: question.choices?.C || "",
    D: question.choices?.D || "",
  },
  correctAnswer: question.correctAnswer,
  difficulty: question.difficulty,
  explanation: question.explanation || "",
  tableData: question.tableData || "",
  tables: question.tables || [],
  hasImage: Boolean(question.image && question.image.data),
});

const getChangedFields = (before, after) =>
  Object.keys(after).filter(
    (field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]),
  );

exports.createQuestion = async (req, res) => {
  try {
    const {
      subject,
      topic,
      questionText,
      choiceA,
      choiceB,
      choiceC,
      choiceD,
      correctAnswer,
      difficulty,
      explanation,
      tableData,
      tables,
    } = req.body;

    if (
      !subject ||
      !topic ||
      !questionText ||
      !choiceA ||
      !choiceB ||
      !choiceC ||
      !choiceD ||
      !correctAnswer ||
      !difficulty
    ) {
      return res.status(400).json({
        success: false,
        message: "Please complete all required fields.",
      });
    }

    const image = req.file
      ? {
          data: req.file.buffer,
          contentType: req.file.mimetype,
        }
      : undefined;

    const question = await Question.create({
      subject,
      topic,
      questionText,
      choices: {
        A: choiceA,
        B: choiceB,
        C: choiceC,
        D: choiceD,
      },
      correctAnswer,
      difficulty,
      explanation,
      tableData,
      tables: tables ? JSON.parse(tables) : [],
      image,
      createdBy: req.user._id,
    });

    res.status(201).json({
      success: true,
      message: "Question added successfully.",
      question,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getQuestions = async (req, res) => {
  try {
    const questions = await Question.find()
      .select("-image.data")
      .populate("createdBy", "name email")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: questions.length,
      questions,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getQuestion = async (req, res) => {
  try {
    const question = await Question.findById(req.params.id).select(
      "-image.data",
    );

    if (!question) {
      return res.status(404).json({
        success: false,
        message: "Question not found.",
      });
    }

    res.json({
      success: true,
      question,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getQuestionImage = async (req, res) => {
  try {
    const question = await Question.findById(req.params.id).select("image");

    if (!question || !question.image || !question.image.data) {
      return res.status(404).send("Image not found");
    }

    res.set("Content-Type", question.image.contentType);
    res.send(question.image.data);
  } catch (error) {
    res.status(500).send("Failed to load image");
  }
};

exports.updateQuestion = async (req, res) => {
  try {
    const question = await Question.findById(req.params.id);

    if (!question) {
      return res.status(404).json({
        success: false,
        message: "Question not found.",
      });
    }

    const getBodyValue = (field, fallback) =>
      Object.prototype.hasOwnProperty.call(req.body, field)
        ? req.body[field]
        : fallback;

    const updateData = {
      subject: getBodyValue("subject", question.subject),
      topic: getBodyValue("topic", question.topic),
      questionText: getBodyValue("questionText", question.questionText),
      choices: {
        A: getBodyValue("choiceA", question.choices.A),
        B: getBodyValue("choiceB", question.choices.B),
        C: getBodyValue("choiceC", question.choices.C),
        D: getBodyValue("choiceD", question.choices.D),
      },
      correctAnswer: getBodyValue("correctAnswer", question.correctAnswer),
      difficulty: getBodyValue("difficulty", question.difficulty),
      explanation: getBodyValue("explanation", question.explanation),
      tableData: getBodyValue("tableData", question.tableData),
      tables: req.body.tables ? JSON.parse(req.body.tables) : question.tables,
      image: req.file
        ? {
            data: req.file.buffer,
            contentType: req.file.mimetype,
          }
        : question.image,
    };
    const before = getQuestionSnapshot(question);
    const after = {
      ...updateData,
      hasImage: Boolean(updateData.image && updateData.image.data),
    };
    delete after.image;
    const changedFields = getChangedFields(before, after);

    const updateOperation = { $set: updateData };

    if (changedFields.length > 0) {
      updateOperation.$push = {
        versionHistory: {
          editedBy: req.user._id,
          editedAt: new Date(),
          before,
          after,
          changedFields,
        },
      };
    }

    const updatedQuestion = await Question.findByIdAndUpdate(
      req.params.id,
      updateOperation,
      { new: true },
    ).select("-image.data");

    res.json({
      success: true,
      message: "Question updated successfully.",
      question: updatedQuestion,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getQuestionHistory = async (req, res) => {
  try {
    const question = await Question.findById(req.params.id)
      .select("versionHistory")
      .populate("versionHistory.editedBy", "name email");

    if (!question) {
      return res.status(404).json({
        success: false,
        message: "Question not found.",
      });
    }

    res.json({
      success: true,
      history: [...(question.versionHistory || [])].reverse(),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getQuestionAnalytics = async (req, res) => {
  try {
    const question = await Question.findById(req.params.id).select(
      "subject topic questionText difficulty",
    );

    if (!question) {
      return res.status(404).json({
        success: false,
        message: "Question not found.",
      });
    }

    const exams = await Exam.find({ questions: question._id })
      .select(
        "title subject topic totalItems submitted answers score createdAt user",
      )
      .populate("user", "name email")
      .sort({ createdAt: -1 });
    let submittedUsage = 0;
    let correctCount = 0;
    let wrongCount = 0;

    exams.forEach((exam) => {
      const answer = (exam.answers || []).find(
        (item) =>
          item.question && item.question.toString() === question._id.toString(),
      );

      if (!answer) {
        return;
      }

      submittedUsage++;

      if (answer.isCorrect) {
        correctCount++;
      } else {
        wrongCount++;
      }
    });

    const accuracy =
      submittedUsage > 0
        ? Math.round((correctCount / submittedUsage) * 1000) / 10
        : 0;

    res.json({
      success: true,
      analytics: {
        generatedExamUsage: exams.length,
        submittedUsage,
        correctCount,
        wrongCount,
        accuracy,
        recentExams: exams.slice(0, 8).map((exam) => ({
          _id: exam._id,
          title: exam.title,
          subject: exam.subject,
          topic: exam.topic,
          submitted: exam.submitted,
          createdAt: exam.createdAt,
          user: exam.user,
        })),
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.deleteQuestion = async (req, res) => {
  try {
    const question = await Question.findById(req.params.id);

    if (!question) {
      return res.status(404).json({
        success: false,
        message: "Question not found.",
      });
    }

    await question.deleteOne();

    res.json({
      success: true,
      message: "Question deleted successfully.",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.filterQuestions = async (req, res) => {
  try {
    const { subject, topic, difficulty } = req.query;

    const filter = {};

    if (subject) filter.subject = new RegExp(subject, "i");
    if (topic) filter.topic = new RegExp(topic, "i");
    if (difficulty) filter.difficulty = difficulty;

    const questions = await Question.find(filter)
      .select("-image.data")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: questions.length,
      questions,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
