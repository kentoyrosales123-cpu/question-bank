const crypto = require("crypto");
const ParsedQuestion = require("../models/ParsedQuestion");
const { generateQuestions } = require("../services/aiQuestionService");
const { canAccessSubject, canCreateContent } = require("../utils/roles");

const aiGenerationJobs = new Map();
const JOB_TTL_MS = 60 * 60 * 1000;

const clampJobCount = (value) => Math.min(20, Math.max(1, Number(value || 1)));

const serializeJob = (job) => ({
  id: job.id,
  status: job.status,
  total: job.total,
  generated: job.generated,
  remaining: job.remaining,
  batchSize: job.batchSize,
  message: job.message,
  error: job.error,
  createdAt: job.createdAt,
  updatedAt: job.updatedAt,
});

const cleanupOldJobs = () => {
  const cutoff = Date.now() - JOB_TTL_MS;

  for (const [id, job] of aiGenerationJobs.entries()) {
    if (new Date(job.createdAt).getTime() < cutoff) {
      aiGenerationJobs.delete(id);
    }
  }
};

const runGenerationJob = async ({ job, user, body }) => {
  try {
    job.status = "generating";
    job.message = "Qwen is generating draft questions in 1-2 item batches.";
    job.updatedAt = new Date();

    const generatedQuestions = await generateQuestions(
      {
        engineeringProgram: body.engineeringProgram,
        department: body.department,
        subject: body.subject,
        topic: body.topic,
        difficulty: body.difficulty,
        bloomLevel: body.bloomLevel,
        count: body.count,
      },
      (progress) => {
        job.total = progress.total;
        job.generated = progress.generated;
        job.remaining = progress.remaining;
        job.batchSize = progress.batchSize;
        job.updatedAt = new Date();
      },
    );

    job.status = "saving";
    job.message = "Saving generated drafts to the review queue.";
    job.remaining = 0;
    job.updatedAt = new Date();

    const saved = await ParsedQuestion.insertMany(
      generatedQuestions.map((question) => ({
        ...question,
        questionType: "Multiple Choice",
        solutionAnswer: "",
        source: "AI",
        generatedBy: user._id,
        status: "Pending",
      })),
    );

    job.status = "complete";
    job.generated = saved.length;
    job.remaining = 0;
    job.message = `${saved.length} AI-generated question${saved.length === 1 ? "" : "s"} added to review.`;
    job.updatedAt = new Date();
  } catch (error) {
    job.status = "failed";
    job.error = error.message;
    job.message = error.message;
    job.updatedAt = new Date();
  }
};

exports.generateAiQuestions = async (req, res) => {
  try {
    cleanupOldJobs();

    if (!canCreateContent(req.user)) {
      return res.status(403).json({
        success: false,
        message: "AI question generation is for content managers only.",
      });
    }

    const subject = String(req.body.subject || "").trim();

    if (!canAccessSubject(req.user, subject)) {
      return res.status(403).json({
        success: false,
        message: "You do not have access to generate questions for this subject.",
      });
    }

    const job = {
      id: crypto.randomUUID(),
      status: "queued",
      total: clampJobCount(req.body.count),
      generated: 0,
      remaining: clampJobCount(req.body.count),
      batchSize: 0,
      message: "Queued for AI generation.",
      error: "",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const body = {
      engineeringProgram: req.body.engineeringProgram,
      department: req.body.department,
      subject,
      topic: req.body.topic,
      difficulty: req.body.difficulty,
      bloomLevel: req.body.bloomLevel,
      count: req.body.count,
    };

    aiGenerationJobs.set(job.id, job);
    setImmediate(() => runGenerationJob({ job, user: req.user, body }));

    res.status(202).json({
      success: true,
      message: "AI generation queued.",
      job: serializeJob(job),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getAiQuestionJob = async (req, res) => {
  cleanupOldJobs();

  const job = aiGenerationJobs.get(req.params.id);

  if (!job) {
    return res.status(404).json({
      success: false,
      message: "AI generation job not found.",
    });
  }

  res.json({
    success: true,
    job: serializeJob(job),
  });
};
