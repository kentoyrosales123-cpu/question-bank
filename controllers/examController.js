const Question = require("../models/Question");
const Exam = require("../models/Exam");
const { logActivity } = require("../services/activityLogger");
const { notifyRoles, notifyUsers } = require("../services/notificationService");
const {
  canGenerateExam,
  isAdmin,
  isExamRequestor,
  ROLES,
} = require("../utils/roles");

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
  if (isAdmin(user)) return true;

  return exam.user && exam.user.toString() === user._id.toString();
};

const isApprovedExam = (exam) => (exam.approvalStatus || "Approved") === "Approved";

const getBlockedExamMessage = (exam) =>
  exam.approvalStatus === "Rejected"
    ? "This exam request was rejected by an admin."
    : "This exam is pending admin approval.";

const canOpenExamContent = (exam, user) => {
  if (!canAccessExam(exam, user)) return false;
  return isAdmin(user) || isApprovedExam(exam);
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

const MAX_CONCURRENT_GENERATIONS = 2;
const GENERATION_JOB_TTL_MS = 10 * 60 * 1000;
const generationJobs = new Map();
const generationQueue = [];
let activeGenerationJobs = 0;
let generationJobSequence = 0;

const getGenerationQueueNumber = (job) => {
  if (!job) return 0;
  if (job.status === "processing") return 1;

  const index = generationQueue.findIndex((queuedJob) => queuedJob.id === job.id);
  return index >= 0 ? activeGenerationJobs + index + 1 : 0;
};

const createGenerationResponse = (job) => ({
  queued: true,
  jobId: job.id,
  status: job.status,
  queueNumber: getGenerationQueueNumber(job),
  activeSlots: MAX_CONCURRENT_GENERATIONS,
  message:
    job.status === "processing"
      ? "Your exam generation is now processing."
      : `Your exam generation is queued at number ${getGenerationQueueNumber(job)}.`,
});

const createMockResponse = (job) => ({
  statusCode: 200,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    job.result = {
      statusCode: this.statusCode,
      payload,
    };
  },
});

const cleanupGenerationJob = (jobId) => {
  setTimeout(() => {
    generationJobs.delete(jobId);
  }, GENERATION_JOB_TTL_MS);
};

const runGenerationQueue = () => {
  while (activeGenerationJobs < MAX_CONCURRENT_GENERATIONS && generationQueue.length > 0) {
    const job = generationQueue.shift();
    activeGenerationJobs++;
    job.status = "processing";
    job.startedAt = new Date();

    Promise.resolve(generateExamForQueue(job.req, createMockResponse(job)))
      .then(() => {
        const result = job.result || {
          statusCode: 500,
          payload: {
            success: false,
            message: "Exam generation did not return a result.",
          },
        };

        job.status = result.statusCode >= 400 ? "failed" : "completed";
        job.completedAt = new Date();
      })
      .catch((error) => {
        job.status = "failed";
        job.completedAt = new Date();
        job.result = {
          statusCode: 500,
          payload: {
            success: false,
            message: error.message,
          },
        };
      })
      .finally(() => {
        activeGenerationJobs--;
        cleanupGenerationJob(job.id);
        runGenerationQueue();
      });
  }
};

const enqueueGenerationJob = (req) => {
  const job = {
    id: `${Date.now()}-${++generationJobSequence}`,
    userId: req.user._id.toString(),
    req: {
      body: req.body,
      user: req.user,
      headers: req.headers,
      ip: req.ip,
      originalUrl: req.originalUrl,
      get: req.get.bind(req),
    },
    status: "queued",
    createdAt: new Date(),
  };

  generationJobs.set(job.id, job);
  generationQueue.push(job);
  runGenerationQueue();

  return job;
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

const generateExamForQueue = async (req, res) => {
  try {
    if (!canGenerateExam(req.user)) {
      return res.status(403).json({
        success: false,
        message: "Only Admins, Exam Creators, and Exam Requestors can generate exams.",
      });
    }

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
      approvalStatus: isExamRequestor(req.user) ? "Pending" : "Approved",
      approvedBy: isExamRequestor(req.user) ? undefined : req.user._id,
      approvedAt: isExamRequestor(req.user) ? undefined : new Date(),
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

    if (isExamRequestor(req.user)) {
      await notifyRoles([ROLES.ADMIN, ROLES.SUPER_ADMIN], {
        actor: req.user._id,
        title: "Exam approval request",
        message: `${req.user.name} generated "${exam.title}" and needs approval.`,
        type: "exam_approval",
        link: "/dashboard.html",
      });
    }

    res.status(201).json({
      success: true,
      message: isExamRequestor(req.user)
        ? "Exam generated and submitted for admin approval."
        : "Exam generated successfully.",
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

    if (!canOpenExamContent(exam, req.user)) {
      return res.status(403).json({
        success: false,
        message: isApprovedExam(exam)
          ? "You do not have access to this exam."
          : getBlockedExamMessage(exam),
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

    if (!canOpenExamContent(exam, req.user)) {
      return res.status(403).json({
        success: false,
        message: isApprovedExam(exam)
          ? "You do not have access to this exam."
          : getBlockedExamMessage(exam),
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

exports.generateExam = async (req, res) => {
  const job = enqueueGenerationJob(req);

  res.status(202).json({
    success: true,
    ...createGenerationResponse(job),
  });
};

exports.getGenerationJobStatus = async (req, res) => {
  const job = generationJobs.get(req.params.id);

  if (!job || job.userId !== req.user._id.toString()) {
    return res.status(404).json({
      success: false,
      message: "Generation job not found.",
    });
  }

  if (job.status === "completed" || job.status === "failed") {
    return res.status(job.result?.statusCode || 200).json({
      success: job.status === "completed",
      queued: false,
      jobId: job.id,
      status: job.status,
      result: job.result?.payload,
    });
  }

  res.json({
    success: true,
    ...createGenerationResponse(job),
  });
};

exports.getMyExamSummary = async (req, res) => {
  try {
    const [totalExams, approvedExams, pendingExams, rejectedExams, recentExams, itemSummary] = await Promise.all([
      Exam.countDocuments({ user: req.user._id }),
      Exam.countDocuments({
        user: req.user._id,
        approvalStatus: "Approved",
      }),
      Exam.countDocuments({
        user: req.user._id,
        approvalStatus: "Pending",
      }),
      Exam.countDocuments({
        user: req.user._id,
        approvalStatus: "Rejected",
      }),
      Exam.find({ user: req.user._id })
        .select("title subject topic totalItems approvalStatus createdAt updatedAt")
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
        approvedExams,
        pendingExams,
        rejectedExams,
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

exports.approveExam = async (req, res) => {
  try {
    if (!isAdmin(req.user)) {
      return res.status(403).json({
        success: false,
        message: "Admin access only.",
      });
    }

    const exam = await Exam.findById(req.params.id).populate("user", "name email role");

    if (!exam) {
      return res.status(404).json({
        success: false,
        message: "Exam not found.",
      });
    }

    exam.approvalStatus = "Approved";
    exam.approvedBy = req.user._id;
    exam.approvedAt = new Date();
    exam.rejectedBy = undefined;
    exam.rejectedAt = undefined;
    await exam.save();

    await logActivity(req, {
      user: req.user,
      action: "approve_exam",
      description: `Approved exam: ${exam.title}`,
      metadata: {
        exam: exam._id,
        owner: exam.user?._id,
      },
    });

    if (exam.user?._id) {
      await notifyUsers([exam.user._id], {
        actor: req.user._id,
        title: "Exam approved",
        message: `"${exam.title}" has been approved and released.`,
        type: "exam_approved",
        link: "/user-dashboard.html",
      });
    }

    res.json({
      success: true,
      message: "Exam approved and released.",
      exam,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.rejectExam = async (req, res) => {
  try {
    if (!isAdmin(req.user)) {
      return res.status(403).json({
        success: false,
        message: "Admin access only.",
      });
    }

    const exam = await Exam.findById(req.params.id).populate("user", "name email role");

    if (!exam) {
      return res.status(404).json({
        success: false,
        message: "Exam not found.",
      });
    }

    exam.approvalStatus = "Rejected";
    exam.rejectedBy = req.user._id;
    exam.rejectedAt = new Date();
    exam.approvedBy = undefined;
    exam.approvedAt = undefined;
    await exam.save();

    await logActivity(req, {
      user: req.user,
      action: "reject_exam",
      description: `Rejected exam: ${exam.title}`,
      metadata: {
        exam: exam._id,
        owner: exam.user?._id,
      },
    });

    if (exam.user?._id) {
      await notifyUsers([exam.user._id], {
        actor: req.user._id,
        title: "Exam rejected",
        message: `"${exam.title}" was rejected by an admin.`,
        type: "exam_rejected",
        link: "/user-dashboard.html",
      });
    }

    res.json({
      success: true,
      message: "Exam request rejected.",
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

    if (!canOpenExamContent(exam, req.user)) {
      return res.status(403).json({
        success: false,
        message: isApprovedExam(exam)
          ? "You do not have access to this exam."
          : getBlockedExamMessage(exam),
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
