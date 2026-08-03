const ROLES = Object.freeze({
  SUPER_ADMIN: "super_admin",
  ADMIN: "admin",
  CEE_CAC_COORDINATOR: "cee_cac_coordinator",
  EXAM_CREATOR: "exam_creator",
  EXAM_REQUESTOR: "exam_requestor",
});

const ACTIVE_ROLES = Object.freeze(Object.values(ROLES));
const CEE_CAC_SUBJECTS = Object.freeze(["CEE 601", "CEE 602", "CEE 603", "CEE 604"]);

const LEGACY_ROLE_MAP = Object.freeze({
  professor: ROLES.EXAM_CREATOR,
  user: ROLES.EXAM_REQUESTOR,
  student: ROLES.EXAM_REQUESTOR,
});

const ROLE_LABELS = Object.freeze({
  [ROLES.SUPER_ADMIN]: "Super Admin",
  [ROLES.ADMIN]: "Admin",
  [ROLES.CEE_CAC_COORDINATOR]: "CEE-CAC Coordinator",
  [ROLES.EXAM_CREATOR]: "Exam Creator",
  [ROLES.EXAM_REQUESTOR]: "Exam Requestor",
  professor: "Exam Creator",
  user: "Exam Requestor",
  student: "Exam Requestor",
});

const normalizeRole = (role) => LEGACY_ROLE_MAP[role] || role;

const isSuperAdmin = (user) => normalizeRole(user?.role) === ROLES.SUPER_ADMIN;

const isAdmin = (user) =>
  [ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(normalizeRole(user?.role));

const isExamCreator = (user) =>
  normalizeRole(user?.role) === ROLES.EXAM_CREATOR;

const isCeeCacCoordinator = (user) =>
  normalizeRole(user?.role) === ROLES.CEE_CAC_COORDINATOR;

const isExamRequestor = (user) =>
  normalizeRole(user?.role) === ROLES.EXAM_REQUESTOR;

const canCreateContent = (user) =>
  isAdmin(user) || isExamCreator(user) || isCeeCacCoordinator(user);

const canGenerateExam = (user) =>
  isAdmin(user) ||
  isExamCreator(user) ||
  isExamRequestor(user) ||
  isCeeCacCoordinator(user);

const canUseItemAnalysis = (user) => canGenerateExam(user);

const canUseTeacherObe = (user) => canGenerateExam(user);

const canApproveQuestionBank = (user) => isAdmin(user) || isCeeCacCoordinator(user);

const getCreatableRoles = (user) => {
  if (isSuperAdmin(user)) {
    return [
      ROLES.ADMIN,
      ROLES.CEE_CAC_COORDINATOR,
      ROLES.EXAM_CREATOR,
      ROLES.EXAM_REQUESTOR,
    ];
  }
  if (normalizeRole(user?.role) === ROLES.ADMIN) {
    return [
      ROLES.CEE_CAC_COORDINATOR,
      ROLES.EXAM_CREATOR,
      ROLES.EXAM_REQUESTOR,
    ];
  }
  return [];
};

const canAssignRole = (actor, role) => getCreatableRoles(actor).includes(role);

const normalizeSubject = (subject) => String(subject || "").trim();

const canAccessSubject = (user, subject) => {
  const normalizedSubject = normalizeSubject(subject);

  if (!normalizedSubject) return true;
  if (isAdmin(user)) return true;
  if (isCeeCacCoordinator(user)) {
    return CEE_CAC_SUBJECTS.includes(normalizedSubject);
  }

  return !CEE_CAC_SUBJECTS.includes(normalizedSubject);
};

const getAllowedSubjects = (user) =>
  isCeeCacCoordinator(user) ? [...CEE_CAC_SUBJECTS] : null;

const getSubjectAccessFilter = (user) => {
  if (isAdmin(user)) return {};
  if (isCeeCacCoordinator(user)) {
    return { subject: { $in: [...CEE_CAC_SUBJECTS] } };
  }

  return { subject: { $nin: [...CEE_CAC_SUBJECTS] } };
};

module.exports = {
  ROLES,
  ACTIVE_ROLES,
  CEE_CAC_SUBJECTS,
  ROLE_LABELS,
  normalizeRole,
  isSuperAdmin,
  isAdmin,
  isCeeCacCoordinator,
  isExamCreator,
  isExamRequestor,
  canCreateContent,
  canGenerateExam,
  canUseItemAnalysis,
  canUseTeacherObe,
  canApproveQuestionBank,
  canAccessSubject,
  getAllowedSubjects,
  getSubjectAccessFilter,
  getCreatableRoles,
  canAssignRole,
};
