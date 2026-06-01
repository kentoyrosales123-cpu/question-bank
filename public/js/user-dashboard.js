protectPage();
userOnlyPage();

const user = getUser();

if (user) {
  document.getElementById("welcomeTitle").textContent = `Welcome, ${user.name}`;
}

async function loadUserDashboard() {
  try {
    const data = await apiRequest("/exams/my/summary");
    const summary = data.summary;

    document.getElementById("totalExams").textContent = summary.totalExams;
    document.getElementById("submittedExams").textContent =
      summary.submittedExams;
    document.getElementById("pendingExams").textContent = summary.pendingExams;
    document.getElementById("averageScore").textContent =
      `${summary.averageScore}%`;

    document.getElementById("recentUserExams").innerHTML =
      summary.recentExams.length > 0
        ? summary.recentExams.map(renderExamItem).join("")
        : `<p class="muted-text">No exams generated yet.</p>`;
  } catch (error) {
    setMessage(
      "dashboardMessage",
      error.message === "Route not found"
        ? "Dashboard data is not available yet. Restart the server and refresh this page."
        : error.message,
    );
  }
}

function renderExamItem(exam) {
  const scoreText = exam.submitted
    ? `${exam.score} / ${exam.totalItems}`
    : "Not submitted";
  const action = exam.submitted
    ? `<button class="btn secondary" type="button" onclick="openResult('${exam._id}')">View Result</button>`
    : `<button class="btn" type="button" onclick="continueExam('${exam._id}')">Continue</button>`;

  return `
    <div class="list-item">
      <div>
        <strong>${escapeHTML(exam.title)}</strong>
        <small>${escapeHTML(exam.subject)}${exam.topic ? ` - ${escapeHTML(exam.topic)}` : ""}</small>
        <span class="badge ${exam.submitted ? "easy" : "average"}">${escapeHTML(scoreText)}</span>
      </div>
      ${action}
    </div>
  `;
}

function continueExam(examId) {
  localStorage.setItem("current_exam_id", examId);
  location.href = "/take-exam.html";
}

function openResult(examId) {
  localStorage.setItem("result_exam_id", examId);
  location.href = "/result.html";
}

loadUserDashboard();
