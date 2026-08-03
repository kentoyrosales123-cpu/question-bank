const ObeSettings = require("../models/ObeSettings");

const DEFAULT_OBE_SETTINGS = Object.freeze({
  courseOutcomeTarget: 75,
  studentOutcomeTarget: 75,
  attainmentMethod: "response_based",
});

const ATTAINMENT_METHODS = Object.freeze(["response_based", "student_based"]);
const ATTAINMENT_METHOD_ALIASES = Object.freeze({
  response: "response_based",
  response_based: "response_based",
  "response-based": "response_based",
  student: "student_based",
  student_based: "student_based",
  "student-based": "student_based",
});

const normalizeTarget = (value, fallback) => {
  const target = Number(value);

  if (!Number.isFinite(target)) {
    return fallback;
  }

  return Math.min(100, Math.max(0, Math.round(target * 100) / 100));
};

const formatSettings = (settings) => ({
  courseOutcomeTarget: normalizeTarget(
    settings?.courseOutcomeTarget,
    DEFAULT_OBE_SETTINGS.courseOutcomeTarget,
  ),
  studentOutcomeTarget: normalizeTarget(
    settings?.studentOutcomeTarget,
    DEFAULT_OBE_SETTINGS.studentOutcomeTarget,
  ),
  attainmentMethod:
    ATTAINMENT_METHOD_ALIASES[
      String(settings?.attainmentMethod || "").trim().toLowerCase()
    ] || DEFAULT_OBE_SETTINGS.attainmentMethod,
});

const getObeSettings = async () => {
  const settings = await ObeSettings.findOne({ key: "global" }).lean();

  return formatSettings(settings);
};

const saveObeSettings = async (payload, userId) => {
  const settings = {
    courseOutcomeTarget: normalizeTarget(
      payload.courseOutcomeTarget,
      DEFAULT_OBE_SETTINGS.courseOutcomeTarget,
    ),
    studentOutcomeTarget: normalizeTarget(
      payload.studentOutcomeTarget,
      DEFAULT_OBE_SETTINGS.studentOutcomeTarget,
    ),
    attainmentMethod:
      ATTAINMENT_METHOD_ALIASES[
        String(payload.attainmentMethod || "").trim().toLowerCase()
      ] || DEFAULT_OBE_SETTINGS.attainmentMethod,
    updatedBy: userId,
  };

  const saved = await ObeSettings.findOneAndUpdate(
    { key: "global" },
    { key: "global", ...settings },
    { new: true, upsert: true, runValidators: true },
  ).lean();

  return formatSettings(saved);
};

const getTargetForOutcomeType = (settings, type) =>
  type === "student"
    ? settings.studentOutcomeTarget
    : settings.courseOutcomeTarget;

module.exports = {
  ATTAINMENT_METHODS,
  DEFAULT_OBE_SETTINGS,
  getObeSettings,
  getTargetForOutcomeType,
  saveObeSettings,
};
