const Question = require("../models/Question");
const Exam = require("../models/Exam");
const fs = require("fs");
const path = require("path");
const { logActivity } = require("../services/activityLogger");
const { notifyRoles, notifyUsers } = require("../services/notificationService");
const { getObeSettings } = require("../services/obeSettingsService");
const {
  normalizeAssessmentMethod,
} = require("../utils/assessmentMethods");
const {
  normalizeAssessmentPhase,
} = require("../utils/assessmentPhases");
const {
  canAccessSubject,
  canGenerateExam,
  getSubjectAccessFilter,
  isAdmin,
  isExamRequestor,
  ROLES,
} = require("../utils/roles");
const { hasCompleteObeMapping } = require("../utils/obeValidation");
const {
  getQuestionProgramMatch,
  SPECIFIC_ENGINEERING_PROGRAMS,
} = require("../utils/engineeringPrograms");
const {
  attachStudentOutcomeIndicators,
} = require("../utils/studentOutcomeIndicators");
const {
  weightedPhaseAttainment,
} = require("../utils/phaseAttainment");

const EXAM_TYPES = ["Multiple Choice", "Problem Solving"];

const normalizeExamType = (value) =>
  EXAM_TYPES.includes(value) ? value : "Multiple Choice";

const getQuestionTypeFilter = (examType) =>
  normalizeExamType(examType) === "Problem Solving"
    ? { questionType: "Problem Solving" }
    : {
        $or: [
          { questionType: "Multiple Choice" },
          { questionType: { $exists: false } },
          { questionType: "" },
        ],
      };

const {
  Document,
  Footer,
  Header,
  Packer,
  Paragraph,
  TextRun,
  ImageRun,
  Table,
  TableCell,
  TableRow,
  AlignmentType,
  BorderStyle,
  PageOrientation,
  ShadingType,
  VerticalAlign,
  WidthType,
} = require("docx");

const TOS_LOGO_DOCX_PATH = path.join(
  __dirname,
  "..",
  "public",
  "logo-docx.png",
);

const ENGINEERING_PROGRAMS = SPECIFIC_ENGINEERING_PROGRAMS;

const canAccessExam = (exam, user) => {
  if (!exam || !user) return false;
  if (isAdmin(user)) return true;

  return exam.user && exam.user.toString() === user._id.toString();
};

const isApprovedExam = (exam) =>
  (exam.approvalStatus || "Approved") === "Approved";

const getBlockedExamMessage = (exam) =>
  exam.approvalStatus === "Rejected"
    ? "This exam request was rejected by an admin."
    : "This exam is pending admin approval.";

const canOpenExamContent = (exam, user) => {
  if (!canAccessExam(exam, user)) return false;
  return isAdmin(user) || isApprovedExam(exam);
};

const createAttainmentBucket = (code, targetRate) => ({
  code,
  targetRate,
  questionCount: 0,
  assessedItems: 0,
  correctItems: 0,
  totalWeight: 0,
  earnedWeight: 0,
  attainmentRate: 0,
  status: "Not assessed",
  piBuckets: new Map(),
  phaseBuckets: new Map(),
});

const finalizeAttainmentBucket = (bucket) => {
  const totalWeight = Number(bucket.totalWeight || 0);
  const attainmentRate =
    totalWeight > 0
      ? Math.round((Number(bucket.earnedWeight || 0) / totalWeight) * 100)
      : 0;

  const finalized = {
    ...bucket,
    totalWeight: Math.round(totalWeight * 100) / 100,
    earnedWeight: Math.round(Number(bucket.earnedWeight || 0) * 100) / 100,
    attainmentRate,
    status:
      totalWeight <= 0
        ? "Not assessed"
        : attainmentRate >= Number(bucket.targetRate ?? 75)
          ? "Attained"
          : "Not attained",
  };

  delete finalized.piBuckets;
  delete finalized.phaseBuckets;

  return finalized;
};

const ensureAttainmentBucket = (map, code, targetRate) => {
  if (!map.has(code)) {
    map.set(code, createAttainmentBucket(code, targetRate));
  }

  return map.get(code);
};

const finalizeStudentOutcomeBucket = (bucket) => {
  const finalized = finalizeAttainmentBucket(bucket);
  const piBreakdown = Array.from(bucket.piBuckets?.values?.() || [])
    .map(finalizeAttainmentBucket)
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  const phaseBreakdown = Array.from(bucket.phaseBuckets?.values?.() || [])
    .map((phaseBucket) => ({
      ...finalizeAttainmentBucket(phaseBucket),
      phase: phaseBucket.code,
    }))
    .sort((a, b) => a.code.localeCompare(b.code));
  const phaseWeightedRate = weightedPhaseAttainment(phaseBreakdown, {
    evidenceKey: "totalWeight",
  });
  const assessedPis = piBreakdown.filter((pi) => Number(pi.totalWeight || 0) > 0);

  if (phaseWeightedRate !== null) {
    finalized.attainmentRate = phaseWeightedRate;
    finalized.status =
      phaseWeightedRate >= Number(finalized.targetRate ?? 75)
        ? "Attained"
        : "Not attained";
  } else if (assessedPis.length > 0) {
    const attainmentRate =
      Math.round(
        (assessedPis.reduce(
          (sum, pi) => sum + Number(pi.attainmentRate || 0),
          0,
        ) /
          assessedPis.length) *
          10,
      ) / 10;

    finalized.attainmentRate = attainmentRate;
    finalized.status =
      attainmentRate >= Number(finalized.targetRate ?? 75)
        ? "Attained"
        : "Not attained";
  }

  finalized.piBreakdown = piBreakdown;
  finalized.phaseBreakdown = phaseBreakdown;
  return finalized;
};

const buildExamAttainmentReport = async (exam) => {
  const settings = await getObeSettings();
  const courseOutcomes = new Map();
  const studentOutcomes = new Map();
  const answerByQuestionId = new Map(
    (exam.answers || [])
      .filter((answer) => answer.question)
      .map((answer) => [answer.question._id?.toString?.() || answer.question.toString(), answer]),
  );
  const assessmentPhase = exam.assessmentPhase || "Summative";

  (exam.questions || []).forEach((question) => {
    const questionId = question._id.toString();
    const answer = answerByQuestionId.get(questionId);
    const weight = Math.max(0, Number(question.outcomeWeight || 1));
    const studentOutcomeCode = question.programOutcome || "Unmapped SO";
    const performanceIndicator = question.performanceIndicator || "";
    const outcomePairs = [
      {
        map: courseOutcomes,
        code: question.courseOutcome || "Unmapped CLO",
        targetRate: settings.courseOutcomeTarget,
      },
      {
        map: studentOutcomes,
        code: studentOutcomeCode,
        targetRate: settings.studentOutcomeTarget,
      },
    ];

    outcomePairs.forEach(({ map, code, targetRate }) => {
      const bucket = ensureAttainmentBucket(map, code, targetRate);
      bucket.questionCount += 1;

      if (answer) {
        bucket.assessedItems += 1;
        bucket.totalWeight += weight;

        if (answer.isCorrect) {
          bucket.correctItems += 1;
          bucket.earnedWeight += weight;
        }
      }
    });

    if (answer) {
      const soBucket = ensureAttainmentBucket(
        studentOutcomes,
        studentOutcomeCode,
        settings.studentOutcomeTarget,
      );
      const phaseBucket = ensureAttainmentBucket(
        soBucket.phaseBuckets,
        assessmentPhase,
        settings.studentOutcomeTarget,
      );

      phaseBucket.assessedItems += 1;
      phaseBucket.totalWeight += weight;

      if (answer.isCorrect) {
        phaseBucket.correctItems += 1;
        phaseBucket.earnedWeight += weight;
      }
    }

    if (performanceIndicator) {
      const soBucket = ensureAttainmentBucket(
        studentOutcomes,
        studentOutcomeCode,
        settings.studentOutcomeTarget,
      );
      const piBucket = ensureAttainmentBucket(
        soBucket.piBuckets,
        performanceIndicator,
        settings.studentOutcomeTarget,
      );

      piBucket.questionCount += 1;

      if (answer) {
        piBucket.assessedItems += 1;
        piBucket.totalWeight += weight;

        if (answer.isCorrect) {
          piBucket.correctItems += 1;
          piBucket.earnedWeight += weight;
        }
        const phaseBucket = ensureAttainmentBucket(
          piBucket.phaseBuckets,
          assessmentPhase,
          settings.studentOutcomeTarget,
        );

        phaseBucket.assessedItems += 1;
        phaseBucket.totalWeight += weight;
        if (answer.isCorrect) {
          phaseBucket.correctItems += 1;
          phaseBucket.earnedWeight += weight;
        }
      }
    }
  });

  const studentOutcomeRows = await attachStudentOutcomeIndicators(
    Array.from(studentOutcomes.values()).map(finalizeStudentOutcomeBucket),
  );

  return {
    settings,
    courseOutcomes: Array.from(courseOutcomes.values()).map(finalizeAttainmentBucket),
    studentOutcomes: studentOutcomeRows,
  };
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

const getRandomQuestions = async (
  engineeringProgram,
  subjects,
  topics,
  difficulty,
  count,
  obeFilters = {},
  examType = "Multiple Choice",
) => {
  if (Number(count) <= 0) {
    return [];
  }

  const match = {
    ...getQuestionTypeFilter(examType),
    difficulty,
    engineeringProgram: getQuestionProgramMatch(engineeringProgram),
    courseOutcome: { $ne: "" },
    programOutcome: { $ne: "" },
    bloomLevel: { $ne: "" },
    outcomeWeight: { $gt: 0 },
  };

  if (subjects.length > 0) {
    match.subject = { $in: subjects };
  }

  if (topics.length > 0) {
    match.topic = { $in: topics };
  }

  if (obeFilters.courseOutcomes?.length > 0) {
    match.courseOutcome = { $in: obeFilters.courseOutcomes };
  }

  if (obeFilters.programOutcomes?.length > 0) {
    match.programOutcome = { $in: obeFilters.programOutcomes };
  }

  if (obeFilters.bloomLevels?.length > 0) {
    match.bloomLevel = { $in: obeFilters.bloomLevels };
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

const getBlueprintQuestions = async (engineeringProgram, blueprint, examType) => {
  const selected = [];

  for (const row of blueprint) {
    const rowQuestions = [
      ...(await getRandomQuestions(
        engineeringProgram,
        [row.subject],
        [row.topic],
        "Easy",
        row.easyCount,
        {},
        examType,
      )),
      ...(await getRandomQuestions(
        engineeringProgram,
        [row.subject],
        [row.topic],
        "Average",
        row.averageCount,
        {},
        examType,
      )),
      ...(await getRandomQuestions(
        engineeringProgram,
        [row.subject],
        [row.topic],
        "Difficult",
        row.difficultCount,
        {},
        examType,
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

  const index = generationQueue.findIndex(
    (queuedJob) => queuedJob.id === job.id,
  );
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
  while (
    activeGenerationJobs < MAX_CONCURRENT_GENERATIONS &&
    generationQueue.length > 0
  ) {
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
    const subjectAccessFilter = getSubjectAccessFilter(req.user);
    const questionTypeFilter = getQuestionTypeFilter(req.query.examType);
    const options = await Question.aggregate([
      { $match: questionTypeFilter },
      ...(Object.keys(subjectAccessFilter).length > 0
        ? [{ $match: subjectAccessFilter }]
        : []),
      {
        $group: {
          _id: "$subject",
          topics: { $addToSet: "$topic" },
        },
      },
      { $sort: { _id: 1 } },
    ]);
    const [
      courseOutcomes,
      programOutcomes,
      bloomLevels,
      outcomeOptions,
    ] = await Promise.all([
      Question.distinct("courseOutcome", {
        ...subjectAccessFilter,
        ...questionTypeFilter,
        courseOutcome: { $ne: "" },
      }),
      Question.distinct("programOutcome", {
        ...subjectAccessFilter,
        ...questionTypeFilter,
        programOutcome: { $ne: "" },
      }),
      Question.distinct("bloomLevel", {
        ...subjectAccessFilter,
        ...questionTypeFilter,
        bloomLevel: { $ne: "" },
      }),
      Question.aggregate([
        { $match: questionTypeFilter },
        ...(Object.keys(subjectAccessFilter).length > 0
          ? [{ $match: subjectAccessFilter }]
          : []),
        {
          $match: {
            $or: [
              { courseOutcome: { $ne: "" } },
              { programOutcome: { $ne: "" } },
              { bloomLevel: { $ne: "" } },
            ],
          },
        },
        {
          $group: {
            _id: {
              engineeringProgram: "$engineeringProgram",
              subject: "$subject",
            },
            courseOutcomes: { $addToSet: "$courseOutcome" },
            programOutcomes: { $addToSet: "$programOutcome" },
            bloomLevels: { $addToSet: "$bloomLevel" },
          },
        },
        { $sort: { "_id.engineeringProgram": 1, "_id.subject": 1 } },
      ]),
    ]);

    res.json({
      success: true,
      subjects: options
        .filter((item) => item._id)
        .map((item) => ({
          subject: item._id,
          topics: item.topics.filter(Boolean).sort(),
        })),
      courseOutcomes: courseOutcomes.filter(Boolean).sort(),
      programOutcomes: programOutcomes.filter(Boolean).sort(),
      bloomLevels: bloomLevels.filter(Boolean).sort(),
      outcomeOptions: outcomeOptions.map((item) => ({
        engineeringProgram: item._id.engineeringProgram || "",
        subject: item._id.subject || "",
        courseOutcomes: item.courseOutcomes.filter(Boolean).sort(),
        programOutcomes: item.programOutcomes.filter(Boolean).sort(),
        bloomLevels: item.bloomLevels.filter(Boolean).sort(),
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
        message:
          "Only Admins, Exam Creators, and Exam Requestors can generate exams.",
      });
    }

    const {
      title,
      engineeringProgram,
      subject,
      topic,
      section,
      semester,
      schoolYear,
      assessmentMethod,
      assessmentPhase,
      examType,
      totalItems,
      easyCount,
      averageCount,
      difficultCount,
    } = req.body;
    const subjects = normalizeSelection(req.body.subjects || subject);
    const selectedEngineeringProgram = String(
      engineeringProgram || "",
    ).trim();
    const topics = normalizeSelection(req.body.topics || topic);
    const selectedAssessmentMethod =
      normalizeAssessmentMethod(assessmentMethod);
    const selectedAssessmentPhase = normalizeAssessmentPhase(assessmentPhase);
    const selectedExamType = normalizeExamType(examType);
    const selectedSection = String(section || "").trim();
    const selectedSemester = String(semester || "").trim();
    const selectedSchoolYear = String(schoolYear || "").trim();
    const obeFilters = {
      courseOutcomes: normalizeSelection(req.body.courseOutcomes),
      programOutcomes: normalizeSelection(req.body.programOutcomes),
      bloomLevels: normalizeSelection(req.body.bloomLevels),
    };
    const blueprint = normalizeBlueprint(req.body.blueprint);
    const useBlueprint = blueprint.length > 0;
    const selectedSubjects = useBlueprint
      ? blueprint.map((row) => row.subject)
      : subjects;
    const blockedSubject = selectedSubjects.find(
      (item) => !canAccessSubject(req.user, item),
    );

    if (blockedSubject) {
      return res.status(403).json({
        success: false,
        message: `You do not have access to generate exams for ${blockedSubject}.`,
      });
    }

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

    if (!selectedEngineeringProgram) {
      return res.status(400).json({
        success: false,
        message: "Select an engineering program.",
      });
    }

    if (!ENGINEERING_PROGRAMS.includes(selectedEngineeringProgram)) {
      return res.status(400).json({
        success: false,
        message: "Selected engineering program is invalid.",
      });
    }

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
        allQuestions = (
          await getBlueprintQuestions(
            selectedEngineeringProgram,
            blueprint,
            selectedExamType,
          )
        ).sort(
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
        selectedEngineeringProgram,
        subjects,
        topics,
        "Easy",
        easyCount,
        obeFilters,
        selectedExamType,
      );

      const averageQuestions = await getRandomQuestions(
        selectedEngineeringProgram,
        subjects,
        topics,
        "Average",
        averageCount,
        obeFilters,
        selectedExamType,
      );

      const difficultQuestions = await getRandomQuestions(
        selectedEngineeringProgram,
        subjects,
        topics,
        "Difficult",
        difficultCount,
        obeFilters,
        selectedExamType,
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

    const unmappedQuestion = allQuestions.find(
      (question) => !hasCompleteObeMapping(question),
    );

    if (unmappedQuestion) {
      return res.status(400).json({
        success: false,
        message:
          "Exam generation requires complete OBE mapping. Review the selected program, subject, filters, and question bank mappings.",
      });
    }

    const exam = await Exam.create({
      title: title || "Generated Exam",
      engineeringProgram: selectedEngineeringProgram,
      subject: useBlueprint
        ? formatSelectionLabel([
            ...new Set(blueprint.map((row) => row.subject)),
          ])
        : formatSelectionLabel(subjects),
      topic: useBlueprint
        ? formatSelectionLabel([...new Set(blueprint.map((row) => row.topic))])
        : formatSelectionLabel(topics),
      section: selectedSection,
      semester: selectedSemester,
      schoolYear: selectedSchoolYear,
      assessmentMethod: selectedAssessmentMethod,
      assessmentPhase: selectedAssessmentPhase,
      examType: selectedExamType,
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
        engineeringProgram: selectedEngineeringProgram,
        section: selectedSection,
        semester: selectedSemester,
        schoolYear: selectedSchoolYear,
        assessmentMethod: selectedAssessmentMethod,
        examType: selectedExamType,
        subjects,
        topics,
        totalItems,
        easyCount,
        averageCount,
        difficultCount,
        blueprint,
        obeFilters,
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

      const isProblemSolving = question.questionType === "Problem Solving";
      const expectedAnswer = isProblemSolving
        ? question.solutionAnswer
        : question.correctAnswer;
      const isCorrect =
        String(selectedAnswer || "").trim().toLowerCase() ===
        String(expectedAnswer || "").trim().toLowerCase();

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
    const attainment = await buildExamAttainmentReport(result);

    res.json({
      success: true,
      message: "Exam submitted successfully.",
      score,
      totalItems: exam.totalItems,
      result,
      attainment,
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
      attainment: await buildExamAttainmentReport(exam),
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
    const [
      totalExams,
      approvedExams,
      pendingExams,
      rejectedExams,
      recentExams,
      itemSummary,
    ] = await Promise.all([
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
        .select(
          "title engineeringProgram subject topic section semester schoolYear assessmentPhase examType totalItems approvalStatus createdAt updatedAt",
        )
        .sort({ updatedAt: -1, createdAt: -1 })
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

    const exam = await Exam.findById(req.params.id).populate(
      "user",
      "name email role",
    );

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

    const exam = await Exam.findById(req.params.id).populate(
      "user",
      "name email role",
    );

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

const formatDateForDocx = (value = new Date()) =>
  new Date(value).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

const formatDifficultyCode = (difficulty) => {
  const normalized = String(difficulty || "").toLowerCase();

  if (normalized === "easy") return "K";
  if (normalized === "average") return "C";
  if (normalized === "difficult") return "A";

  return difficulty || "";
};

const formatCognitiveProcess = (question) =>
  question.bloomLevel || formatDifficultyCode(question.difficulty);

const getTopicKey = (question) =>
  `${question.subject || "General"}|||${question.topic || "General"}|||${
    question.courseOutcome || "Unmapped CLO"
  }|||${question.programOutcome || "Unmapped SO"
  }`;

const buildTosRows = (exam) => {
  const totalItems = Number(exam.totalItems || exam.questions.length || 0);
  const grouped = new Map();

  exam.questions.forEach((question, index) => {
    const key = getTopicKey(question);

    if (!grouped.has(key)) {
      grouped.set(key, {
        subject: question.subject || exam.subject || "",
        topic: question.topic || "General",
        courseOutcome: question.courseOutcome || "Unmapped CLO",
        studentOutcomes: new Set(),
        programOutcomes: new Set(),
        difficulties: new Set(),
        itemNumbers: [],
      });
    }

    const row = grouped.get(key);
    row.difficulties.add(formatCognitiveProcess(question));
    if (question.programOutcome) {
      row.studentOutcomes.add(question.programOutcome);
      row.programOutcomes.add(question.programOutcome);
    }
    row.itemNumbers.push(index + 1);
  });

  return Array.from(grouped.values()).map((row, index) => {
    const itemCount = row.itemNumbers.length;
    const percent =
      totalItems > 0 ? Math.round((itemCount / totalItems) * 100) : 0;

    return {
      courseOutcome: row.courseOutcome,
      studentOutcome:
        Array.from(row.studentOutcomes).filter(Boolean).join(", ") ||
        "Unmapped SO",
      topic:
        row.subject && row.subject !== exam.subject
          ? `${row.subject} - ${row.topic}`
          : row.topic,
      cogPr: Array.from(row.difficulties).filter(Boolean).join(", "),
      assessmentTask:
        exam.examType === "Problem Solving"
          ? "Problem-solving item"
          : "Multiple-choice test item",
      percent: `${percent}%`,
      weight: itemCount,
      points: itemCount,
      itemNumbers: row.itemNumbers.join(", "),
    };
  });
};

const createTextRun = (text, options = {}) =>
  new TextRun({
    text: String(text ?? ""),
    font: options.font || "Times New Roman",
    size: options.size || 18,
    color: options.color,
    bold: options.bold,
    italics: options.italics,
    underline: options.underline ? {} : undefined,
  });

const createTosParagraph = (text, options = {}) =>
  new Paragraph({
    alignment: options.alignment || AlignmentType.LEFT,
    spacing: {
      before: options.before || 0,
      after: options.after || 0,
      line: options.line || 240,
    },
    children: [createTextRun(text, options)],
  });

const createTosCell = (text, options = {}) =>
  new TableCell({
    width: options.width
      ? {
          size: options.width,
          type: WidthType.DXA,
        }
      : undefined,
    columnSpan: options.columnSpan,
    rowSpan: options.rowSpan,
    verticalAlign: options.verticalAlign || VerticalAlign.CENTER,
    margins: {
      top: 90,
      bottom: 90,
      left: 90,
      right: 90,
    },
    shading: options.shading
      ? {
          type: ShadingType.CLEAR,
          fill: options.shading,
          color: "auto",
        }
      : undefined,
    children: String(text ?? "")
      .split("\n")
      .map((line) =>
        createTosParagraph(line, {
          alignment: options.alignment || AlignmentType.CENTER,
          bold: options.bold,
          italics: options.italics,
          font: options.font,
          color: options.color,
          size: options.size || 18,
        }),
      ),
  });

const tosBorder = {
  style: BorderStyle.SINGLE,
  size: 4,
  color: "000000",
};

const tosNoBorder = {
  style: BorderStyle.NONE,
  size: 0,
  color: "FFFFFF",
};

const createTosBodyCell = (children, options = {}) =>
  new TableCell({
    columnSpan: options.columnSpan,
    verticalAlign: options.verticalAlign || VerticalAlign.CENTER,
    borders: options.borders,
    margins: {
      top: options.marginY ?? 70,
      bottom: options.marginY ?? 70,
      left: options.marginX ?? 120,
      right: options.marginX ?? 120,
    },
    children,
  });

const createTosFormParagraph = (runs, options = {}) =>
  new Paragraph({
    alignment: options.alignment || AlignmentType.LEFT,
    spacing: {
      before: 0,
      after: 0,
      line: options.line || 240,
    },
    children: runs,
  });

const createTosBlankRun = (text = "____________________", options = {}) =>
  createTextRun(text, {
    size: options.size || 18,
    underline: true,
  });

const createTosFieldRun = (
  value,
  blank = "____________________",
  options = {},
) =>
  createTosBlankRun(
    value ? `${value}${blank.slice(String(value).length)}` : blank,
    options,
  );

const createTosFormCell = (runs, options = {}) =>
  createTosBodyCell([createTosFormParagraph(runs, options)], {
    ...options,
    borders: {
      top: options.topBorder ? tosBorder : tosNoBorder,
      bottom: options.bottomBorder ? tosBorder : tosNoBorder,
      left: options.leftBorder ? tosBorder : tosNoBorder,
      right: options.rightBorder ? tosBorder : tosNoBorder,
    },
  });

const createTosHeaderCell = (text, options = {}) =>
  createTosCell(text, {
    ...options,
    bold: true,
    shading: "D9D9D9",
    size: 20,
  });

let tosLogoPngBufferPromise = null;

const getTosLogoPngBuffer = async () => {
  if (!tosLogoPngBufferPromise) {
    tosLogoPngBufferPromise = fs.promises
      .readFile(TOS_LOGO_DOCX_PATH)
      .catch(() => null);
  }

  return tosLogoPngBufferPromise;
};

const createTosHeaderLogoCell = async () => {
  const logoBuffer = await getTosLogoPngBuffer();

  return new TableCell({
    rowSpan: 3,
    width: {
      size: 3300,
      type: WidthType.DXA,
    },
    verticalAlign: VerticalAlign.CENTER,
    margins: {
      top: 80,
      bottom: 80,
      left: 120,
      right: 120,
    },
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 0 },
        children: logoBuffer
          ? [
              new ImageRun({
                data: logoBuffer,
                type: "png",
                transformation: {
                  width: 150,
                  height: 58,
                },
              }),
            ]
          : [
              new TextRun({
                text: "UM",
                bold: true,
                color: "B45B6A",
                size: 48,
              }),
            ],
      }),
    ],
  });
};

const createTosDocHeader = async () =>
  new Header({
    children: [
      new Table({
        width: {
          size: 100,
          type: WidthType.PERCENTAGE,
        },
        columnWidths: [3300, 11940],
        rows: [
          new TableRow({
            children: [
              await createTosHeaderLogoCell(),
              createTosCell(
                "INSTITUTE OF PEDAGOGICAL ADVANCEMENT AND COMPETITIVENESS",
                {
                  bold: true,
                  color: "2F5B8A",
                  size: 56,
                  font: "Bodoni MT Condensed",
                },
              ),
            ],
          }),
          new TableRow({
            children: [
              createTosCell("[ / ] Main        [ ] Branch", {
                size: 18,
              }),
            ],
          }),
          new TableRow({
            children: [
              createTosCell("TABLE OF SPECIFICATIONS (TOS)", {
                bold: true,
                size: 18,
                font: "Arial",
              }),
            ],
          }),
        ],
      }),
    ],
  });

const createTosFooter = () =>
  new Footer({
    children: [
      new Table({
        width: {
          size: 100,
          type: WidthType.PERCENTAGE,
        },
        rows: [
          new TableRow({
            children: [
              createTosCell(
                "Legend: CogPr (Cognitive Process Category) - Rem = Remember, Und = Understand, App = Apply, Anl = Analyze, Evl = Evaluate",
                {
                  columnSpan: 3,
                  alignment: AlignmentType.LEFT,
                  size: 14,
                },
              ),
            ],
          }),
          new TableRow({
            children: [
              createTosCell(
                "Prepared by:\n\n____________________________\nCourse Teacher",
                {
                  size: 15,
                },
              ),
              createTosCell(
                "*Reviewed by:\n\n____________________________\nProgram Head",
                {
                  size: 15,
                },
              ),
              createTosCell(
                "*Approved by:\n\n____________________________\nCollege Dean/Director",
                {
                  size: 15,
                },
              ),
            ],
          }),
          new TableRow({
            children: [
              createTosCell(
                "*Please affix your signature over printed name and indicate thereafter the signing date.",
                {
                  columnSpan: 3,
                  alignment: AlignmentType.LEFT,
                  size: 13,
                  italics: true,
                },
              ),
            ],
          }),
        ],
      }),
      createTosParagraph(
        "F-13052-237 / Rev. #0 / Effectivity: March 18, 2022",
        {
          alignment: AlignmentType.LEFT,
          size: 12,
          before: 40,
        },
      ),
    ],
  });

const buildTosDocxBuffer = async (exam) => {
  const tosRows = buildTosRows(exam);
  const visibleTosRows = [
    ...tosRows,
    ...Array.from({ length: Math.max(0, 4 - tosRows.length) }, () => ({
      courseOutcome: "",
      studentOutcome: "",
      topic: "",
      cogPr: "",
      assessmentTask: "",
      percent: "",
      weight: "",
      points: "",
      itemNumbers: "",
    })),
  ];
  const totalItems = Number(exam.totalItems || exam.questions.length || 0);
  const courseText = exam.subject || "";
  const programText = exam.engineeringProgram || "";
  const examText = exam.title || "";
  const studentOutcomeText = [
    ...new Set(
      (exam.questions || [])
        .map((question) => question.programOutcome)
        .filter(Boolean),
    ),
  ].join(", ");
  const dateCompletedText = formatDateForDocx();
  const children = [
    new Table({
      width: {
        size: 100,
        type: WidthType.PERCENTAGE,
      },
      columnWidths: [2500, 900, 3600, 850, 2200, 760, 640, 600, 850],
      rows: [
        new TableRow({
          children: [
            createTosFormCell(
              [
                createTextRun("Course: ", { size: 18 }),
                createTosFieldRun(courseText, "____________________________", {
                  size: 18,
                }),
              ],
              { columnSpan: 3, topBorder: true, leftBorder: true },
            ),
            createTosFormCell(
              [
                createTextRun("Date Completed: ", { size: 18 }),
                createTosFieldRun(dateCompletedText, "________________", {
                  size: 18,
                }),
              ],
              { columnSpan: 2, topBorder: true },
            ),
            createTosFormCell(
              [
                createTextRun("Page 1", { size: 18 }),
                createTosBlankRun("__________", { size: 18 }),
                createTextRun(" of 1", { size: 18 }),
              ],
              { columnSpan: 4, topBorder: true, rightBorder: true },
            ),
          ],
        }),
        new TableRow({
          children: [
            createTosFormCell(
              [
                createTextRun("College/Program: ", { size: 18 }),
                createTosFieldRun(programText, "______________________________", {
                  size: 18,
                }),
              ],
              { columnSpan: 3, leftBorder: true },
            ),
            createTosFormCell([
              createTextRun("Section:", { size: 18 }),
              createTosFieldRun(exam.section || "", "_______", {
                size: 18,
              }),
            ]),
            createTosFormCell([
              createTextRun("Term:", { size: 18 }),
              createTosFieldRun(exam.semester || "", "________", {
                size: 18,
              }),
            ]),
            createTosFormCell([
              createTextRun("S.Y.", { size: 18 }),
              createTosFieldRun(exam.schoolYear || "", "_______________", {
                size: 18,
              }),
            ]),
            createTosFormCell(
              [
                createTextRun("Exam:", { size: 18 }),
                createTosFieldRun(examText, "________________", { size: 18 }),
              ],
              { columnSpan: 2 },
            ),
            createTosFormCell(
              [
                createTextRun("Exam Date:", { size: 18 }),
                createTosBlankRun("__", { size: 18 }),
              ],
              { rightBorder: true },
            ),
          ],
        }),
        new TableRow({
          children: [
            createTosFormCell(
              [
                createTextRun("Student Outcome (SO): ", { size: 18 }),
                createTosFieldRun(
                  studentOutcomeText,
                  "____________________________________________________________________________________________",
                  { size: 18 },
                ),
              ],
              { columnSpan: 9, leftBorder: true, rightBorder: true },
            ),
          ],
        }),
        new TableRow({
          children: [
            createTosFormCell(
              [
                createTextRun("Category:      [ ", { size: 18 }),
                createTosBlankRun("/", { size: 18 }),
                createTextRun(" ] - Introductory        [ ", {
                  size: 18,
                  italics: true,
                }),
                createTosBlankRun(" ", { size: 18 }),
                createTextRun(" ] - Enabling        [ ", {
                  size: 18,
                  italics: true,
                }),
                createTosBlankRun(" ", { size: 18 }),
                createTextRun(" ] - Demonstration", {
                  size: 18,
                  italics: true,
                }),
              ],
              { columnSpan: 6, leftBorder: true, bottomBorder: true },
            ),
            createTosFormCell(
              [
                createTextRun("Total Points: ", { size: 18 }),
                createTosFieldRun(
                  totalItems ? String(totalItems) : "",
                  "________________________",
                  { size: 18 },
                ),
              ],
              {
                columnSpan: 3,
                alignment: AlignmentType.RIGHT,
                rightBorder: true,
                bottomBorder: true,
              },
            ),
          ],
        }),
        new TableRow({
          children: [
            createTosHeaderCell("Course Outcome", { rowSpan: 2 }),
            createTosHeaderCell("SO", { rowSpan: 2 }),
            createTosHeaderCell("Topics", { rowSpan: 2 }),
            createTosHeaderCell("CogPr", { rowSpan: 2 }),
            createTosHeaderCell("Assessment Tasks", { rowSpan: 2 }),
            createTosHeaderCell("Distribution", { columnSpan: 3 }),
            createTosHeaderCell("Item\nNumbers", { rowSpan: 2 }),
          ],
        }),
        new TableRow({
          children: [
            createTosHeaderCell("%& Wt"),
            createTosHeaderCell("Points"),
            createTosHeaderCell("Items"),
          ],
        }),
        ...visibleTosRows.map(
          (row) =>
            new TableRow({
              children: [
                createTosCell(row.courseOutcome),
                createTosCell(row.studentOutcome),
                createTosCell(row.topic, { alignment: AlignmentType.LEFT }),
                createTosCell(row.cogPr),
                createTosCell(row.assessmentTask, {
                  alignment: AlignmentType.LEFT,
                }),
                createTosCell(
                  row.percent && row.weight
                    ? `${row.percent} / ${row.weight}`
                    : "",
                ),
                createTosCell(row.points),
                createTosCell(row.weight),
                createTosCell(row.itemNumbers),
              ],
            }),
        ),
      ],
    }),
  ];

  const doc = new Document({
    sections: [
      {
        headers: {
          default: await createTosDocHeader(),
        },
        footers: {
          default: createTosFooter(),
        },
        properties: {
          page: {
            size: {
              orientation: PageOrientation.LANDSCAPE,
            },
            margin: {
              top: 1080,
              right: 720,
              bottom: 1260,
              left: 720,
              header: 360,
              footer: 360,
            },
          },
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
};

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

const emptyBorder = {
  style: BorderStyle.NONE,
  size: 0,
  color: "FFFFFF",
};

const buildUniversityHeader = () =>
  new Header({
    children: [
      new Table({
        width: {
          size: 100,
          type: WidthType.PERCENTAGE,
        },
        borders: {
          top: emptyBorder,
          bottom: {
            style: BorderStyle.SINGLE,
            size: 6,
            color: "F1D789",
          },
          left: emptyBorder,
          right: emptyBorder,
          insideHorizontal: emptyBorder,
          insideVertical: emptyBorder,
        },
        rows: [
          new TableRow({
            children: [
              new TableCell({
                width: {
                  size: 46,
                  type: WidthType.PERCENTAGE,
                },
                borders: {
                  top: emptyBorder,
                  bottom: emptyBorder,
                  left: emptyBorder,
                  right: emptyBorder,
                },
                children: [
                  new Paragraph({
                    spacing: { after: 0 },
                    children: [
                      new TextRun({
                        text: "UM",
                        bold: true,
                        color: "D28D95",
                        size: 64,
                      }),
                    ],
                  }),
                  new Paragraph({
                    spacing: { before: 0, after: 80 },
                    children: [
                      new TextRun({
                        text: "The University of Mindanao",
                        color: "7A7A7A",
                        size: 20,
                      }),
                    ],
                  }),
                ],
              }),
              new TableCell({
                width: {
                  size: 54,
                  type: WidthType.PERCENTAGE,
                },
                borders: {
                  top: emptyBorder,
                  bottom: emptyBorder,
                  left: emptyBorder,
                  right: emptyBorder,
                },
                children: [
                  new Paragraph({
                    alignment: AlignmentType.RIGHT,
                    spacing: { after: 0 },
                    children: [
                      new TextRun({
                        text: "College of Engineering Education",
                        bold: true,
                        italics: true,
                        color: "6F6F6F",
                        size: 19,
                      }),
                    ],
                  }),
                  new Paragraph({
                    alignment: AlignmentType.RIGHT,
                    spacing: { after: 0 },
                    children: [
                      new TextRun({
                        text: "2nd Floor, BE Building",
                        italics: true,
                        color: "6F6F6F",
                        size: 18,
                      }),
                    ],
                  }),
                  new Paragraph({
                    alignment: AlignmentType.RIGHT,
                    spacing: { after: 0 },
                    children: [
                      new TextRun({
                        text: "Matina Campus, Davao City",
                        italics: true,
                        color: "6F6F6F",
                        size: 18,
                      }),
                    ],
                  }),
                  new Paragraph({
                    alignment: AlignmentType.RIGHT,
                    spacing: { after: 0 },
                    children: [
                      new TextRun({
                        text: "Telefax: (082) 296-1084",
                        italics: true,
                        color: "6F6F6F",
                        size: 18,
                      }),
                    ],
                  }),
                  new Paragraph({
                    alignment: AlignmentType.RIGHT,
                    spacing: { after: 80 },
                    children: [
                      new TextRun({
                        text: "Phone No.: (082)300-5456/300-0647 Local 131",
                        italics: true,
                        color: "6F6F6F",
                        size: 18,
                      }),
                    ],
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });

const buildExamDocxBuffer = async (exam, options = {}) => {
  const { includeAnswerKey = false } = options;
  const children = [];
  const examTitle = (exam.title || "").trim();
  const hasCustomTitle =
    examTitle && examTitle.toLowerCase() !== "generated exam";
  const documentTitle = includeAnswerKey
    ? hasCustomTitle
      ? `${examTitle} - Answer Key`
      : "Answer Key"
    : hasCustomTitle
      ? examTitle
      : "";

  if (documentTitle) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: documentTitle,
            bold: true,
            size: 32,
          }),
        ],
      }),
    );
  }

  children.push(new Paragraph(`Subject: ${exam.subject}`));
  if (exam.engineeringProgram) {
    children.push(new Paragraph(`Engineering Program: ${exam.engineeringProgram}`));
  }
  if (exam.section) {
    children.push(new Paragraph(`Section: ${exam.section}`));
  }
  if (exam.semester) {
    children.push(new Paragraph(`Term: ${exam.semester}`));
  }
  if (exam.schoolYear) {
    children.push(new Paragraph(`School Year: ${exam.schoolYear}`));
  }
  children.push(
    new Paragraph(`Assessment Method: ${exam.assessmentMethod || "Major Exam"}`),
    new Paragraph(`Assessment Phase: ${exam.assessmentPhase || "Summative"}`),
    new Paragraph(`Exam Type: ${exam.examType || "Multiple Choice"}`),
  );
  children.push(new Paragraph(`Topic: ${exam.topic || "General"}`));
  children.push(new Paragraph(`Total Items: ${exam.totalItems}`));
  children.push(new Paragraph(""));

  exam.questions.forEach((q, index) => {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `${index + 1}. ${q.questionText}`,
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

    if (q.questionType === "Problem Solving") {
      children.push(new Paragraph("Answer: ______________________________"));
      children.push(new Paragraph(""));
      children.push(new Paragraph(""));
    } else {
      children.push(new Paragraph(`A. ${q.choices.A}`));
      children.push(new Paragraph(`B. ${q.choices.B}`));
      children.push(new Paragraph(`C. ${q.choices.C}`));
      children.push(new Paragraph(`D. ${q.choices.D}`));
    }

    if (includeAnswerKey) {
      const answerText =
        q.questionType === "Problem Solving"
          ? q.solutionAnswer || "No answer set"
          : q.correctAnswer
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
        headers: {
          default: buildUniversityHeader(),
        },
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
    const downloadType = includeAnswerKey ? "answer key" : "exam";

    await logActivity(req, {
      user: req.user,
      action: "download_exam",
      description: `Downloaded ${downloadType}: ${exam.title}`,
      metadata: {
        exam: exam._id,
        title: exam.title,
        includeAnswerKey,
        fileName,
      },
    });

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

const sendTosDocx = async (req, res) => {
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

    const buffer = await buildTosDocxBuffer(exam);
    const fileName = sanitizeFileName(`${exam.title || "generated-exam"}-tos`);

    await logActivity(req, {
      user: req.user,
      action: "download_tos",
      description: `Downloaded TOS: ${exam.title}`,
      metadata: {
        exam: exam._id,
        title: exam.title,
        fileName,
        documentType: "tos",
      },
    });

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

exports.downloadTosDocx = async (req, res) => {
  await sendTosDocx(req, res);
};
