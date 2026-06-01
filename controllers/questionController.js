const Question = require("../models/Question");

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

    const updateData = {
      subject: req.body.subject || question.subject,
      topic: req.body.topic || question.topic,
      questionText: req.body.questionText || question.questionText,
      choices: {
        A: req.body.choiceA || question.choices.A,
        B: req.body.choiceB || question.choices.B,
        C: req.body.choiceC || question.choices.C,
        D: req.body.choiceD || question.choices.D,
      },
      correctAnswer: req.body.correctAnswer || question.correctAnswer,
      difficulty: req.body.difficulty || question.difficulty,
      explanation: req.body.explanation || question.explanation,
      tableData: req.body.tableData || question.tableData,
      tables: req.body.tables ? JSON.parse(req.body.tables) : question.tables,
      image: req.file
        ? {
            data: req.file.buffer,
            contentType: req.file.mimetype,
          }
        : question.image,
    };

    const updatedQuestion = await Question.findByIdAndUpdate(
      req.params.id,
      updateData,
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
