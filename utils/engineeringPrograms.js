const GENERAL_ENGINEERING_PROGRAM = "GE";

const ENGINEERING_PROGRAMS = Object.freeze([
  GENERAL_ENGINEERING_PROGRAM,
  "ECE",
  "CE",
  "EE",
  "ME",
  "CpE",
  "CHE",
]);

const SPECIFIC_ENGINEERING_PROGRAMS = Object.freeze(
  ENGINEERING_PROGRAMS.filter((program) => program !== GENERAL_ENGINEERING_PROGRAM),
);

const ENGINEERING_PROGRAM_LABELS = Object.freeze({
  [GENERAL_ENGINEERING_PROGRAM]: "General Engineering",
  ECE: "ECE",
  CE: "CE",
  EE: "EE",
  ME: "ME",
  CpE: "CpE",
  CHE: "CHE",
});

const PROGRAM_DEPARTMENT_LABELS = Object.freeze({
  [GENERAL_ENGINEERING_PROGRAM]: "General Engineering",
  ECE: "Electronics Engineering",
  CE: "Civil Engineering",
  EE: "Electrical Engineering",
  ME: "Mechanical Engineering",
  CpE: "Computer Engineering",
  CHE: "Chemical Engineering",
});

const isValidEngineeringProgram = (program) =>
  ENGINEERING_PROGRAMS.includes(String(program || "").trim());

const getQuestionProgramMatch = (program) => ({
  $in: [String(program || "").trim(), GENERAL_ENGINEERING_PROGRAM],
});

const getProgramDepartmentLabel = (program = "") =>
  PROGRAM_DEPARTMENT_LABELS[String(program || "").trim()] || "";

module.exports = {
  ENGINEERING_PROGRAMS,
  ENGINEERING_PROGRAM_LABELS,
  GENERAL_ENGINEERING_PROGRAM,
  PROGRAM_DEPARTMENT_LABELS,
  SPECIFIC_ENGINEERING_PROGRAMS,
  getProgramDepartmentLabel,
  getQuestionProgramMatch,
  isValidEngineeringProgram,
};
