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

const isValidEngineeringProgram = (program) =>
  ENGINEERING_PROGRAMS.includes(String(program || "").trim());

const getQuestionProgramMatch = (program) => ({
  $in: [String(program || "").trim(), GENERAL_ENGINEERING_PROGRAM],
});

module.exports = {
  ENGINEERING_PROGRAMS,
  ENGINEERING_PROGRAM_LABELS,
  GENERAL_ENGINEERING_PROGRAM,
  SPECIFIC_ENGINEERING_PROGRAMS,
  getQuestionProgramMatch,
  isValidEngineeringProgram,
};
