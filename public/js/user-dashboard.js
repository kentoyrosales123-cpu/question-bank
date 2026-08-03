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

async function loadTeacherObeDashboard() {
  try {
    const data = await apiRequest("/dashboard/my-obe");
    const dashboard = data.dashboard || {};
    const summary = dashboard.summary || {};

    document.getElementById("teacherObeEvidence").textContent =
      (summary.linkedItemAnalysis || 0) +
      (summary.rubricAssessments || 0) +
      (summary.evidenceRecords || 0);
    document.getElementById("teacherObeNeedsCqi").textContent =
      summary.notAttainedWithoutCqi || 0;
    document.getElementById("teacherGeneratedExams").textContent =
      summary.generatedExams || 0;
    document.getElementById("teacherLinkedAnalysis").textContent =
      summary.linkedItemAnalysis || 0;
    document.getElementById("teacherRubrics").textContent =
      summary.rubricAssessments || 0;
    document.getElementById("teacherEvidenceFiles").textContent =
      summary.evidenceRecords || 0;
    document.getElementById("teacherCloBody").innerHTML = renderObeOutcomeRows(
      dashboard.courseOutcomes || [],
      "CO/CLO",
    );
    document.getElementById("teacherSoBody").innerHTML = renderObeOutcomeRows(
      dashboard.studentOutcomes || [],
      "SO",
    );
    document.getElementById("teacherSubmissionBody").innerHTML =
      renderSubmissionRows(dashboard.submissionStatus || []);
    document.getElementById("teacherEvidenceList").innerHTML =
      renderEvidenceList(dashboard.recentEvidence || []);
  } catch (error) {
    const message =
      error.message === "Teacher OBE dashboard is for content managers only."
        ? "OBE dashboard is available for teacher/content-manager accounts."
        : error.message;

    document.getElementById("teacherCloBody").innerHTML =
      `<tr><td colspan="4" class="empty-table-cell">${escapeHTML(message)}</td></tr>`;
    document.getElementById("teacherSoBody").innerHTML =
      `<tr><td colspan="4" class="empty-table-cell">${escapeHTML(message)}</td></tr>`;
    document.getElementById("teacherSubmissionBody").innerHTML =
      `<tr><td colspan="5" class="empty-table-cell">${escapeHTML(message)}</td></tr>`;
    document.getElementById("teacherEvidenceList").innerHTML =
      `<div class="empty-state compact-empty"><p>${escapeHTML(message)}</p></div>`;
  }
}

function renderObeOutcomeRows(rows = [], label = "Outcome") {
  if (!rows.length) {
    return `<tr><td colspan="4" class="empty-table-cell">No ${escapeHTML(label)} attainment yet.</td></tr>`;
  }

  return rows
    .slice(0, 8)
    .map(
      (row) => `
        <tr>
          <td><strong>${escapeHTML(row.code)}</strong></td>
          <td>${row.attainedStudents || 0} / ${row.assessedStudents || 0}</td>
          <td>${row.targetRate ?? 75}%</td>
          <td>
            <span class="badge ${row.status === "Attained" ? "easy" : "difficult"}">
              ${row.attainmentRate || 0}%
            </span>
          </td>
        </tr>
      `,
    )
    .join("");
}

function renderSubmissionRows(rows = []) {
  if (!rows.length) {
    return `<tr><td colspan="5" class="empty-table-cell">No OBE submission records yet.</td></tr>`;
  }

  return rows
    .slice(0, 8)
    .map(
      (row) => `
        <tr>
          <td>
            <strong>${escapeHTML(row.subject)}</strong>
            <small>${escapeHTML(row.section)} | ${escapeHTML(row.semester)} | ${escapeHTML(row.schoolYear)}</small>
          </td>
          <td>${row.linkedItemAnalysis || 0}</td>
          <td>${row.rubricAssessments || 0}</td>
          <td>${row.evidenceRecords || 0}</td>
          <td>
            <span class="badge ${getSubmissionBadgeClass(row.status)}">
              ${escapeHTML(row.status)}
            </span>
          </td>
        </tr>
      `,
    )
    .join("");
}

function getSubmissionBadgeClass(status = "") {
  if (status === "Ready for Review") return "easy";
  if (status === "Needs CQI") return "difficult";
  return "average";
}

function renderEvidenceList(records = []) {
  if (!records.length) {
    return `<div class="empty-state compact-empty">
      <h2>No evidence uploaded yet.</h2>
      <p>Upload linked item analysis, rubrics, and evidence files for OBE review.</p>
    </div>`;
  }

  return records
    .slice(0, 5)
    .map(
      (record) => `
        <div class="student-exam-item">
          <span class="student-exam-icon"></span>
          <div class="student-exam-info">
            <strong>${escapeHTML(record.title)}</strong>
            <small>${escapeHTML(record.evidenceType)} | ${escapeHTML(record.subject || "No subject")}</small>
            <span class="badge average">
              ${escapeHTML(record.courseOutcome || "No CO")} / ${escapeHTML(record.programOutcome || "No SO")}
            </span>
          </div>
          <span class="student-exam-date">${formatDate(record.createdAt)}</span>
        </div>
      `,
    )
    .join("");
}

document
  .getElementById("teacherEvidenceForm")
  ?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const form = new FormData();
    const file = document.getElementById("teacherEvidenceFile").files[0];

    form.append("title", document.getElementById("teacherEvidenceTitle").value.trim());
    form.append("evidenceType", document.getElementById("teacherEvidenceType").value);
    form.append("subject", document.getElementById("teacherEvidenceSubject").value.trim());
    if (file) form.append("file", file);

    try {
      const data = await apiRequest("/obe/evidence", "POST", form, true);
      setMessage("teacherEvidenceMessage", data.message, false);
      document.getElementById("teacherEvidenceForm").reset();
      await loadTeacherObeDashboard();
    } catch (error) {
      setMessage("teacherEvidenceMessage", error.message);
    }
  });

function renderExamItem(exam) {
  const subtitle = [
    exam.engineeringProgram,
    exam.subject,
    exam.topic,
  ]
    .filter(Boolean)
    .map(escapeHTML)
    .join(" - ");
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
loadTeacherObeDashboard();
