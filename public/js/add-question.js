protectPage();
contentManagerPage();

const CEE_CAC_SUBJECTS = ["CEE 601", "CEE 602", "CEE 603", "CEE 604"];
let studentOutcomeRows = [];

const normalizeSoCode = (value = "") =>
  String(value || "")
    .replace(/^SO[-\s]*/i, "")
    .trim()
    .toLowerCase();

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
  ?.addEventListener("change", updateQuestionTypeFields);
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
      "performanceIndicator",
      document.getElementById("performanceIndicator").value,
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
      updateQuestionTypeFields();
      updatePerformanceIndicatorOptions();
    } catch (error) {
      document.getElementById("message").textContent = error.message;
    }
  });
