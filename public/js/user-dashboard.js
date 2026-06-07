protectPage();
userOnlyPage();

const user = getUser();

if (user) {
  document.getElementById("welcomeTitle").textContent = `Welcome back, ${user.name}!`;
}

async function loadUserDashboard() {
  try {
    const data = await apiRequest("/exams/my/summary");
    const summary = data.summary;
    const lastExam = summary.recentExams[0];

    document.getElementById("totalExams").textContent = summary.totalExams;
    document.getElementById("downloadableExams").textContent =
      summary.approvedExams || 0;
    document.getElementById("stripGenerated").textContent = summary.totalExams;
    document.getElementById("stripDownloads").textContent = summary.approvedExams || 0;
    document.getElementById("stripItems").textContent = summary.totalItems || 0;
    document.getElementById("lastActivity").textContent = lastExam
      ? formatDate(lastExam.createdAt)
      : "No activity";

    document.getElementById("recentUserExams").innerHTML =
      summary.recentExams.length > 0
        ? summary.recentExams.slice(0, 2).map(renderExamItem).join("")
        : `<div class="empty-state compact-empty">
            <h2>No exams generated yet.</h2>
            <p>Create your first exam from the question bank.</p>
          </div>`;
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
  const subtitle = `${escapeHTML(exam.subject)}${exam.topic ? ` - ${escapeHTML(exam.topic)}` : ""}`;
  const status = exam.approvalStatus || "Approved";
  const isPending = status === "Pending";
  const isRejected = status === "Rejected";

  return `
    <div class="student-exam-item">
      <span class="student-exam-icon"></span>
      <div class="student-exam-info">
        <strong>${escapeHTML(exam.title)}</strong>
        <small>${subtitle}</small>
        <span class="badge ${isPending ? "average" : isRejected ? "difficult" : "easy"}">
          ${isPending ? "Pending Approval" : isRejected ? "Rejected" : `Approved - ${exam.totalItems} items`}
        </span>
      </div>
      <span class="student-exam-date">${formatDate(exam.createdAt)}</span>
      ${
        isPending || isRejected
          ? `<button class="btn secondary compact-btn" type="button" disabled>${isRejected ? "Rejected" : "Awaiting Approval"}</button>`
          : `<button class="btn secondary compact-btn" type="button" onclick="previewExam('${exam._id}')">Preview</button>`
      }
    </div>
  `;
}

function previewExam(examId) {
  localStorage.setItem("current_exam_id", examId);
  location.href = "/take-exam.html";
}

function formatDate(value) {
  if (!value) {
    return "No activity";
  }

  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

loadUserDashboard();
