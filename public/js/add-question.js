protectPage();
contentManagerPage();

const CEE_CAC_SUBJECTS = ["CEE 601", "CEE 602", "CEE 603", "CEE 604"];

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
    form.append("questionText", document.getElementById("questionText").value);
    form.append("choiceA", document.getElementById("choiceA").value);
    form.append("choiceB", document.getElementById("choiceB").value);
    form.append("choiceC", document.getElementById("choiceC").value);
    form.append("choiceD", document.getElementById("choiceD").value);
    form.append(
      "correctAnswer",
      document.getElementById("correctAnswer").value,
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
    } catch (error) {
      document.getElementById("message").textContent = error.message;
    }
  });
