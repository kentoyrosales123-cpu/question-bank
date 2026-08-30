protectPage();
contentManagerPage();

const CEE_CAC_SUBJECTS = ["CEE 601", "CEE 602", "CEE 603", "CEE 604"];
let studentOutcomeRows = [];
let questionTypeTouched = false;

const normalizeSoCode = (value = "") =>
  String(value || "")
    .replace(/^SO[-\s]*/i, "")
    .trim()
    .toLowerCase();

function normalizePerformanceIndicators(value, primary = "") {
  const rawItems = Array.isArray(value)
    ? value
    : String(value || "")
        .split(/[,;\n]/)
        .map((item) => item.trim());
  const seen = new Set();

  return [primary, ...rawItems]
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase();

      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizeProgramOutcomes(value, primary = "") {
  const rawItems = Array.isArray(value)
    ? value
    : String(value || "")
        .split(/[,;\n\s]+/)
        .map((item) => item.trim());
  const seen = new Set();

  return [primary, ...rawItems]
    .map((item) =>
      String(item || "")
        .replace(/^SO[-\s]*/i, "")
        .trim()
        .toLowerCase(),
    )
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase();

      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function detectQuestionTypeFromForm() {
  const questionText = document.getElementById("questionText")?.value || "";
  const solutionAnswer = document.getElementById("solutionAnswer")?.value || "";
  const choices = ["choiceA", "choiceB", "choiceC", "choiceD"]
    .map((id) => document.getElementById(id)?.value.trim() || "")
    .filter(Boolean);

  if (choices.length >= 2) return "Multiple Choice";

  const text = [questionText, solutionAnswer]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return "Multiple Choice";

  let score = 0;
  const terms = [
    "calculate",
    "compute",
    "determine",
    "derive",
    "evaluate",
    "find",
    "solve",
    "simplify",
    "prove",
    "design",
    "analyze",
    "what is the value",
    "how many",
  ];

  if (solutionAnswer) score += 3;
  if (terms.some((term) => text.includes(term))) score += 2;
  if (/(?:[a-z]\s*=|\d+\s*[+\-*/^]\s*\d+|[a-z]\^[\-\d]+|=)/i.test(text)) {
    score += 2;
  }
  if (/\b(?:v|a|ohm|w|kw|hz|n|pa|j|c|f|h|m|cm|mm|kg|s|rad|rpm)\b/i.test(text)) {
    score += 1;
  }

  const numbers = text.match(/\d+(?:\.\d+)?\s*(?:%|[a-z]+)?/gi) || [];
  if (numbers.length >= 2) score += 1;
  if (numbers.length >= 4) score += 1;

  return score >= 3 ? "Problem Solving" : "Multiple Choice";
}

function autoDetectQuestionType() {
  if (questionTypeTouched) return;

  const questionType = document.getElementById("questionType");
  const detectedType = detectQuestionTypeFromForm();

  if (questionType && questionType.value !== detectedType) {
    questionType.value = detectedType;
    updateQuestionTypeFields();
  }
}

function updatePerformanceIndicatorOptions() {
  const soInput = document.getElementById("programOutcome");
  const piSelect = document.getElementById("performanceIndicator");

  if (!soInput || !piSelect) return;

  const soCode = normalizeSoCode(soInput.value);
  const outcome = studentOutcomeRows.find(
    (row) => normalizeSoCode(row.code) === soCode,
  );
  const indicators = outcome?.performanceIndicatorRows || [];

  piSelect.innerHTML = `<option value="">Performance Indicator</option>`;
  indicators.forEach((indicator) => {
    const option = document.createElement("option");
    option.value = indicator.label;
    option.textContent = `${indicator.label} - ${indicator.description}`;
    piSelect.appendChild(option);
  });
}

function updateQuestionTypeFields() {
  const isProblemSolving =
    document.getElementById("questionType")?.value === "Problem Solving";
  const multipleChoiceFields = document.getElementById("multipleChoiceFields");
  const solutionAnswer = document.getElementById("solutionAnswer");
  const mcqInputs = [
    "choiceA",
    "choiceB",
    "choiceC",
    "choiceD",
    "correctAnswer",
  ].map((id) => document.getElementById(id));

  if (multipleChoiceFields) {
    multipleChoiceFields.hidden = isProblemSolving;
  }

  if (solutionAnswer) {
    solutionAnswer.hidden = !isProblemSolving;
    solutionAnswer.required = isProblemSolving;
  }

  mcqInputs.forEach((input) => {
    if (input) input.required = !isProblemSolving;
  });
}

async function loadStudentOutcomePis() {
  try {
    const data = await apiRequest("/obe/student-outcomes");
    studentOutcomeRows = data.studentOutcomes || [];
    updatePerformanceIndicatorOptions();
  } catch (error) {
    studentOutcomeRows = [];
  }
}

function canUseSubject(subject) {
  const user = getUser();

  if (isAdminRole(user)) return true;
  if (isCeeCacCoordinatorRole(user)) {
    return CEE_CAC_SUBJECTS.includes(subject);
  }

  return !CEE_CAC_SUBJECTS.includes(subject);
}

function restrictSubjectForCoordinator() {
  if (!isCeeCacCoordinatorRole(getUser())) {
    return;
  }

  const subjectInput = document.getElementById("subject");
  const select = document.createElement("select");
  select.id = "subject";
  select.required = true;
  select.innerHTML = `
    <option value="">Select subject</option>
    ${CEE_CAC_SUBJECTS.map(
      (subject) => `<option value="${subject}">${subject}</option>`,
    ).join("")}
  `;
  subjectInput.replaceWith(select);
}

restrictSubjectForCoordinator();
loadStudentOutcomePis();
document
  .getElementById("programOutcome")
  ?.addEventListener("input", updatePerformanceIndicatorOptions);
document
  .getElementById("questionType")
  ?.addEventListener("change", () => {
    questionTypeTouched = true;
    updateQuestionTypeFields();
  });
["questionText", "solutionAnswer", "choiceA", "choiceB", "choiceC", "choiceD"].forEach(
  (id) => document.getElementById(id)?.addEventListener("input", autoDetectQuestionType),
);
updateQuestionTypeFields();

document
  .getElementById("questionForm")
  .addEventListener("submit", async (e) => {
    e.preventDefault();

    const subject = document.getElementById("subject").value;

    if (!canUseSubject(subject)) {
      document.getElementById("message").textContent =
        "Only CEE-CAC Coordinator can use CEE 601, CEE 602, CEE 603, and CEE 604.";
      return;
    }

    const form = new FormData();

    form.append("subject", subject);
    form.append(
      "engineeringProgram",
      document.getElementById("engineeringProgram").value,
    );
    form.append("topic", document.getElementById("topic").value);
    form.append("questionType", document.getElementById("questionType").value);
    form.append("questionText", document.getElementById("questionText").value);
    form.append("choiceA", document.getElementById("choiceA").value);
    form.append("choiceB", document.getElementById("choiceB").value);
    form.append("choiceC", document.getElementById("choiceC").value);
    form.append("choiceD", document.getElementById("choiceD").value);
    form.append(
      "correctAnswer",
      document.getElementById("correctAnswer").value,
    );
    form.append(
      "solutionAnswer",
      document.getElementById("solutionAnswer").value,
    );
    form.append("difficulty", document.getElementById("difficulty").value);
    form.append(
      "courseOutcome",
      document.getElementById("courseOutcome").value,
    );
    form.append(
      "programOutcome",
      document.getElementById("programOutcome").value,
    );
    form.append(
      "programOutcomes",
      normalizeProgramOutcomes(
        document.getElementById("programOutcomes").value,
        document.getElementById("programOutcome").value,
      ).join(", "),
    );
    form.append(
      "performanceIndicator",
      document.getElementById("performanceIndicator").value,
    );
    form.append(
      "performanceIndicators",
      normalizePerformanceIndicators(
        document.getElementById("performanceIndicators").value,
        document.getElementById("performanceIndicator").value,
      ).join(", "),
    );
    form.append(
      "studentLearningOutcome",
      document.getElementById("studentLearningOutcome").value,
    );
    form.append("bloomLevel", document.getElementById("bloomLevel").value);
    form.append("outcomeWeight", document.getElementById("outcomeWeight").value);
    if (document.getElementById("isComplexEngineeringProblem").checked) {
      form.append("isComplexEngineeringProblem", true);
    }
    form.append("tableData", document.getElementById("tableData").value);
    form.append("explanation", document.getElementById("explanation").value);

    const image = document.getElementById("image").files[0];

    if (image) {
      form.append("image", image);
    }

    try {
      await apiRequest("/questions", "POST", form, true);
      document.getElementById("message").textContent =
        "Question saved successfully.";
      document.getElementById("questionForm").reset();
      questionTypeTouched = false;
      updateQuestionTypeFields();
      updatePerformanceIndicatorOptions();
    } catch (error) {
      document.getElementById("message").textContent = error.message;
    }
  });
