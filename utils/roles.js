const ROLES = Object.freeze({
  SUPER_ADMIN: "super_admin",
  ADMIN: "admin",
  EXAM_CREATOR: "exam_creator",
  EXAM_REQUESTOR: "exam_requestor",
});

const ACTIVE_ROLES = Object.freeze(Object.values(ROLES));

const LEGACY_ROLE_MAP = Object.freeze({
  professor: ROLES.EXAM_CREATOR,
  user: ROLES.EXAM_REQUESTOR,
  student: ROLES.EXAM_REQUESTOR,
});

const ROLE_LABELS = Object.freeze({
  [ROLES.SUPER_ADMIN]: "Super Admin",
  [ROLES.ADMIN]: "Admin",
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

const isExamRequestor = (user) =>
  normalizeRole(user?.role) === ROLES.EXAM_REQUESTOR;

const canCreateContent = (user) => isAdmin(user) || isExamCreator(user);

const canGenerateExam = (user) =>
  isAdmin(user) || isExamCreator(user) || isExamRequestor(user);

const canApproveQuestionBank = (user) => isAdmin(user);

const getCreatableRoles = (user) => {
  if (isSuperAdmin(user)) {
    return [ROLES.ADMIN, ROLES.EXAM_CREATOR, ROLES.EXAM_REQUESTOR];
  }
  if (normalizeRole(user?.role) === ROLES.ADMIN) {
    return [ROLES.EXAM_CREATOR, ROLES.EXAM_REQUESTOR];
  }
  return [];
};

const canAssignRole = (actor, role) => getCreatableRoles(actor).includes(role);

module.exports = {
  ROLES,
  ACTIVE_ROLES,
  ROLE_LABELS,
  normalizeRole,
  isSuperAdmin,
  isAdmin,
  isExamCreator,
  isExamRequestor,
  canCreateContent,
  canGenerateExam,
  canApproveQuestionBank,
  getCreatableRoles,
  canAssignRole,
};
