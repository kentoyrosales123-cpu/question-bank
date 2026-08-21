const { logActivity } = require("../services/activityLogger");

const AUDITED_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const ACTION_VERBS = {
  POST: "created",
  PUT: "updated",
  PATCH: "updated",
  DELETE: "deleted",
};

const RESOURCE_LABELS = {
  auth: "authentication",
  questions: "question",
  exams: "exam",
  uploads: "upload",
  parser: "parsed question",
  dashboard: "dashboard",
  "item-analysis": "item analysis",
  "support-tickets": "support ticket",
  notifications: "notification",
  obe: "OBE record",
  ai: "AI question",
  users: "user",
};

const SPECIAL_ACTIONS = [
  {
    pattern: /^\/api\/exams\/generate\b/,
    skip: true,
  },
  {
    pattern: /^\/api\/obe\/peos\b/,
    action: "manage_peo",
    description: "Managed Program Educational Objective",
  },
  {
    pattern: /^\/api\/obe\/settings\b/,
    action: "update_obe_settings",
    description: "Updated OBE attainment settings",
  },
  {
    pattern: /^\/api\/obe\/course-outcomes\b/,
    action: "manage_course_outcome",
    description: "Managed course outcome",
  },
  {
    pattern: /^\/api\/obe\/student-outcomes\b/,
    action: "manage_student_outcome",
    description: "Managed student outcome",
  },
  {
    pattern: /^\/api\/item-analysis\/[^/]+\/cqi-plan\/status\b/,
    action: "update_cqi_status",
    description: "Updated CQI status",
  },
  {
    pattern: /^\/api\/item-analysis\/[^/]+\/cqi-plan\b/,
    action: "manage_cqi_plan",
    description: "Managed CQI intervention plan",
  },
  {
    pattern: /^\/api\/item-analysis\/[^/]+\/scanned-result\b/,
    action: "save_scanned_result",
    description: "Saved scanned item analysis result",
  },
  {
    pattern: /^\/api\/parser\/[^/]+\/approve\b/,
    action: "approve_parsed_question",
    description: "Approved parsed question",
  },
  {
    pattern: /^\/api\/parser\/[^/]+\/reject\b/,
    action: "reject_parsed_question",
    description: "Rejected parsed question",
  },
  {
    pattern: /^\/api\/users\/[^/]+\/role\b/,
    action: "update_user_role",
    description: "Updated user role",
  },
  {
    pattern: /^\/api\/users\/[^/]+\/approval\b/,
    action: "update_user_approval",
    description: "Updated user approval status",
  },
  {
    pattern: /^\/api\/support-tickets\/[^/]+\/resolve\b/,
    action: "resolve_support_ticket",
    description: "Resolved support ticket",
  },
  {
    pattern: /^\/api\/support-tickets\/[^/]+\/reply\b/,
    action: "reply_support_ticket",
    description: "Replied to support ticket",
  },
];

const cleanPath = (url = "") => String(url).split("?")[0];

const getResourceLabel = (path) => {
  const segments = path.split("/").filter(Boolean);
  const apiIndex = segments.indexOf("api");
  const resource = segments[apiIndex + 1] || "system";

  if (resource === "ai" && segments[apiIndex + 2] === "questions") {
    return RESOURCE_LABELS.ai;
  }

  return RESOURCE_LABELS[resource] || resource.replace(/-/g, " ");
};

const titleCase = (value) =>
  String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const buildActivity = (req) => {
  const path = cleanPath(req.originalUrl);
  const special = SPECIAL_ACTIONS.find((item) => item.pattern.test(path));

  if (special) {
    return special;
  }

  const resourceLabel = getResourceLabel(path);
  const verb = ACTION_VERBS[req.method] || "changed";
  const normalizedResource = resourceLabel.toLowerCase().replace(/\s+/g, "_");

  return {
    action: `${verb}_${normalizedResource}`,
    description: `${titleCase(verb)} ${resourceLabel}`,
  };
};

const activityAuditMiddleware = (req, res, next) => {
  if (!AUDITED_METHODS.has(req.method) || !req.originalUrl.startsWith("/api/")) {
    return next();
  }

  res.on("finish", () => {
    if (req.activityLogged || !req.user || res.statusCode >= 400) {
      return;
    }

    const activity = buildActivity(req);
    if (activity.skip) {
      return;
    }

    logActivity(req, {
      user: req.user,
      action: activity.action,
      description: activity.description,
      metadata: {
        method: req.method,
        path: cleanPath(req.originalUrl),
        statusCode: res.statusCode,
        route: req.route?.path || "",
      },
    });
  });

  next();
};

module.exports = activityAuditMiddleware;
