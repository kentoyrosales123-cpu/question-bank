const Question = require("../models/Question");
const Exam = require("../models/Exam");
const {
  canAccessSubject,
  getSubjectAccessFilter,
} = require("../utils/roles");
const {
  formatObeMappingError,
  getMissingObeMappingFields,
} = require("../utils/obeValidation");
const {
  classifyComplexEngineeringProblem,
} = require("../utils/complexEngineeringProblem");
const {
  getQuestionProgramMatch,
  isValidEngineeringProgram,
} = require("../utils/engineeringPrograms");

const parseBooleanBodyValue = (value, fallback = false) => {
  if (value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  return ["true", "1", "yes", "on"].includes(String(value).toLowerCase());
};

const QUESTION_TYPES = ["Multiple Choice", "Problem Solving"];

const normalizeQuestionType = (value) =>
  QUESTION_TYPES.includes(value) ? value : "Multiple Choice";

const isProblemSolvingQuestion = (value) =>
  normalizeQuestionType(value) === "Problem Solving";

const getQuestionSnapshot = (question) => ({
  subject: question.subject,
  engineeringProgram: question.engineeringProgram || "",
  topic: question.topic,
  questionText: question.questionText,
  questionType: normalizeQuestionType(question.questionType),
  choices: {
    A: question.choices?.A || "",
    B: question.choices?.B || "",
    C: question.choices?.C || "",
    D: question.choices?.D || "",
  },
  correctAnswer: question.correctAnswer,
  solutionAnswer: question.solutionAnswer || "",
  difficulty: question.difficulty,
  courseOutcome: question.courseOutcome || "",
  programOutcome: question.programOutcome || "",
  performanceIndicator: question.performanceIndicator || "",
  studentLearningOutcome: question.studentLearningOutcome || "",
  bloomLevel: question.bloomLevel || "",
  outcomeWeight: Number(question.outcomeWeight || 1),
  isComplexEngineeringProblem: Boolean(question.isComplexEngineeringProblem),
  complexityScore: Number(question.complexityScore || 0),
  complexityLevel: question.complexityLevel || "Routine Engineering Problem",
  complexityReasons: question.complexityReasons || [],
  explanation: question.explanation || "",
  tableData: question.tableData || "",
  tables: question.tables || [],
  hasImage: Boolean(question.image && question.image.data),
});

const getChangedFields = (before, after) =>
  Object.keys(after).filter(
    (field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]),
  );

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getPaginationParams = (query = {}) => {
  const page = Math.max(1, Number(query.page || 1));
  const limit = Math.min(50, Math.max(1, Number(query.limit || 20)));

  return {
    page,
    limit,
    skip: (page - 1) * limit,
  };
};

const getScopedQuestionFilter = (filter, user) => {
  const subjectAccessFilter = getSubjectAccessFilter(user);

  if (Object.keys(subjectAccessFilter).length === 0) {
    return filter;
  }

  if (Object.keys(filter).length === 0) {
    return subjectAccessFilter;
  }

  return { $and: [filter, subjectAccessFilter] };
};

const ensureQuestionAccess = (question, user, res) => {
  if (canAccessSubject(user, question.subject)) {
    return true;
  }

  res.status(403).json({
    success: false,
    message: "You do not have access to this subject.",
  });
  return false;
};

exports.createQuestion = async (req, res) => {
  try {
    const {
      subject,
      engineeringProgram,
      topic,
      questionText,
      questionType,
      choiceA,
      choiceB,
      choiceC,
      choiceD,
      correctAnswer,
      solutionAnswer,
      difficulty,
      courseOutcome,
      programOutcome,
      performanceIndicator,
      studentLearningOutcome,
      bloomLevel,
      outcomeWeight,
      isComplexEngineeringProblem,
      explanation,
      tableData,
      tables,
    } = req.body;

    const normalizedQuestionType = normalizeQuestionType(questionType);
    const isProblemSolving = isProblemSolvingQuestion(normalizedQuestionType);

    if (
      !subject ||
      !engineeringProgram ||
      !topic ||
      !questionText ||
      !difficulty
    ) {
      return res.status(400).json({
        success: false,
        message: "Please complete all required fields.",
      });
    }

    if (
      !isProblemSolving &&
      (!choiceA || !choiceB || !choiceC || !choiceD || !correctAnswer)
    ) {
      return res.status(400).json({
        success: false,
        message: "Please complete all choices and select the correct answer.",
      });
    }

    if (isProblemSolving && !String(solutionAnswer || "").trim()) {
      return res.status(400).json({
        success: false,
        message: "Please provide the final answer for the problem-solving question.",
      });
    }

    if (!isValidEngineeringProgram(engineeringProgram)) {
      return res.status(400).json({
        success: false,
        message: "Selected engineering program is invalid.",
      });
    }

    const missingObeFields = getMissingObeMappingFields({
      engineeringProgram,
      courseOutcome,
      programOutcome,
      performanceIndicator,
      studentLearningOutcome,
      bloomLevel,
      outcomeWeight,
    });

    if (missingObeFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: formatObeMappingError(missingObeFields),
      });
    }

    if (!canAccessSubject(req.user, subject)) {
      return res.status(403).json({
        success: false,
        message: "You do not have access to add questions for this subject.",
      });
    }

    const image = req.file
      ? {
          data: req.file.buffer,
          contentType: req.file.mimetype,
        }
      : undefined;

    const complexity = classifyComplexEngineeringProblem({
      subject,
      topic,
      questionText,
      choices: {
        A: choiceA,
        B: choiceB,
        C: choiceC,
        D: choiceD,
      },
      difficulty,
      solutionAnswer,
      explanation,
      tableData,
    });

    const question = await Question.create({
      subject,
      engineeringProgram,
      topic,
      questionText,
      questionType: normalizedQuestionType,
      choices: {
        A: isProblemSolving ? "" : choiceA,
        B: isProblemSolving ? "" : choiceB,
        C: isProblemSolving ? "" : choiceC,
        D: isProblemSolving ? "" : choiceD,
      },
      correctAnswer: isProblemSolving ? "" : correctAnswer,
      solutionAnswer: isProblemSolving ? solutionAnswer : "",
      difficulty,
      courseOutcome,
      programOutcome,
      performanceIndicator,
      studentLearningOutcome,
      bloomLevel,
      outcomeWeight: Number(outcomeWeight || 1),
      isComplexEngineeringProblem: parseBooleanBodyValue(
        isComplexEngineeringProblem,
        complexity.isComplexEngineeringProblem,
      ),
      complexityScore: complexity.complexityScore,
      complexityLevel: parseBooleanBodyValue(
        isComplexEngineeringProblem,
        complexity.isComplexEngineeringProblem,
      )
        ? "Complex Engineering Problem"
        : complexity.complexityLevel,
      complexityReasons: complexity.complexityReasons,
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
    const { page, limit, skip } = getPaginationParams(req.query);
    const filter = getScopedQuestionFilter({}, req.user);
    const [questions, count] = await Promise.all([
      Question.find(filter)
        .select("-image.data")
        .populate("createdBy", "name email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Question.countDocuments(filter),
    ]);

    res.json({
      success: true,
      count,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(count / limit)),
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

    if (!ensureQuestionAccess(question, req.user, res)) {
      return;
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
    const question = await Question.findById(req.params.id).select("subject image");

    if (!question || !question.image || !question.image.data) {
      return res.status(404).send("Image not found");
    }

    if (!canAccessSubject(req.user, question.subject)) {
      return res.status(403).send("Question image access denied");
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

    if (!ensureQuestionAccess(question, req.user, res)) {
      return;
    }

    const getBodyValue = (field, fallback) =>
      Object.prototype.hasOwnProperty.call(req.body, field)
        ? req.body[field]
        : fallback;

    const updateData = {
      subject: getBodyValue("subject", question.subject),
      engineeringProgram: getBodyValue(
        "engineeringProgram",
        question.engineeringProgram,
      ),
      topic: getBodyValue("topic", question.topic),
      questionText: getBodyValue("questionText", question.questionText),
      questionType: normalizeQuestionType(
        getBodyValue("questionType", question.questionType),
      ),
      choices: {
        A: getBodyValue("choiceA", question.choices.A),
        B: getBodyValue("choiceB", question.choices.B),
        C: getBodyValue("choiceC", question.choices.C),
        D: getBodyValue("choiceD", question.choices.D),
      },
      correctAnswer: getBodyValue("correctAnswer", question.correctAnswer),
      solutionAnswer: getBodyValue("solutionAnswer", question.solutionAnswer),
      difficulty: getBodyValue("difficulty", question.difficulty),
      courseOutcome: getBodyValue("courseOutcome", question.courseOutcome),
      programOutcome: getBodyValue("programOutcome", question.programOutcome),
      performanceIndicator: getBodyValue(
        "performanceIndicator",
        question.performanceIndicator,
      ),
      studentLearningOutcome: getBodyValue(
        "studentLearningOutcome",
        question.studentLearningOutcome,
      ),
      bloomLevel: getBodyValue("bloomLevel", question.bloomLevel),
      outcomeWeight: Number(
        getBodyValue("outcomeWeight", question.outcomeWeight || 1) || 1,
      ),
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

    if (isProblemSolvingQuestion(updateData.questionType)) {
      updateData.choices = { A: "", B: "", C: "", D: "" };
      updateData.correctAnswer = "";
    } else {
      updateData.solutionAnswer = "";
    }

    if (
      !isProblemSolvingQuestion(updateData.questionType) &&
      (!updateData.choices.A ||
        !updateData.choices.B ||
        !updateData.choices.C ||
        !updateData.choices.D ||
        !updateData.correctAnswer)
    ) {
      return res.status(400).json({
        success: false,
        message: "Please complete all choices and select the correct answer.",
      });
    }

    if (
      isProblemSolvingQuestion(updateData.questionType) &&
      !String(updateData.solutionAnswer || "").trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "Please provide the final answer for the problem-solving question.",
      });
    }

    const complexity = classifyComplexEngineeringProblem(updateData);

    updateData.isComplexEngineeringProblem = parseBooleanBodyValue(
      req.body.isComplexEngineeringProblem,
      complexity.isComplexEngineeringProblem,
    );
    updateData.complexityScore = complexity.complexityScore;
    updateData.complexityLevel = updateData.isComplexEngineeringProblem
      ? "Complex Engineering Problem"
      : complexity.complexityLevel;
    updateData.complexityReasons = complexity.complexityReasons;

    if (!canAccessSubject(req.user, updateData.subject)) {
      return res.status(403).json({
        success: false,
        message: "You do not have access to save questions for this subject.",
      });
    }

    const missingObeFields = getMissingObeMappingFields(updateData);

    if (missingObeFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: formatObeMappingError(missingObeFields),
      });
    }

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
      .select("subject versionHistory")
      .populate("versionHistory.editedBy", "name email");

    if (!question) {
      return res.status(404).json({
        success: false,
        message: "Question not found.",
      });
    }

    if (!ensureQuestionAccess(question, req.user, res)) {
      return;
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
      "subject engineeringProgram topic questionText difficulty courseOutcome programOutcome performanceIndicator studentLearningOutcome bloomLevel outcomeWeight",
    );

    if (!question) {
      return res.status(404).json({
        success: false,
        message: "Question not found.",
      });
    }

    if (!ensureQuestionAccess(question, req.user, res)) {
      return;
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

    if (!ensureQuestionAccess(question, req.user, res)) {
      return;
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
    const {
      subject,
      engineeringProgram,
      topic,
      questionType,
      difficulty,
      courseOutcome,
      programOutcome,
      studentLearningOutcome,
      bloomLevel,
    } = req.query;

    const filter = {};

    if (subject) filter.subject = new RegExp(escapeRegex(subject), "i");
    if (engineeringProgram) {
      filter.engineeringProgram = getQuestionProgramMatch(engineeringProgram);
    }
    if (topic) filter.topic = new RegExp(escapeRegex(topic), "i");
    if (questionType) filter.questionType = normalizeQuestionType(questionType);
    if (difficulty) filter.difficulty = difficulty;
    if (courseOutcome) {
      filter.courseOutcome = new RegExp(escapeRegex(courseOutcome), "i");
    }
    if (programOutcome) {
      filter.programOutcome = new RegExp(escapeRegex(programOutcome), "i");
    }
    if (studentLearningOutcome) {
      filter.studentLearningOutcome = new RegExp(
        escapeRegex(studentLearningOutcome),
        "i",
      );
    }
    if (bloomLevel) filter.bloomLevel = bloomLevel;

    const { page, limit, skip } = getPaginationParams(req.query);
    const scopedFilter = getScopedQuestionFilter(filter, req.user);
    const [questions, count] = await Promise.all([
      Question.find(scopedFilter)
        .select("-image.data")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Question.countDocuments(scopedFilter),
    ]);

    res.json({
      success: true,
      count,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(count / limit)),
      questions,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
