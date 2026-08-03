protectPage();
adminOnlyPage();

const REPORT_SUBPAGES = new Set([
  "overview",
  "obe-alignment",
  "assessment-methods",
  "cqi-monitoring",
  "activity-logs",
]);

function getRequestedReportSubpage() {
  const page = location.hash.replace("#", "").trim();

  return REPORT_SUBPAGES.has(page) ? page : "overview";
}

function showReportSubpage(page = getRequestedReportSubpage()) {
  const selectedPage = REPORT_SUBPAGES.has(page) ? page : "overview";

  document.querySelectorAll("[data-report-page]").forEach((section) => {
    section.classList.toggle(
      "active",
      section.dataset.reportPage === selectedPage,
    );
  });

  document.querySelectorAll("[data-report-tab]").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.reportTab === selectedPage);
  });
}

document.querySelectorAll("[data-report-tab]").forEach((tab) => {
  tab.addEventListener("click", (event) => {
    event.preventDefault();
    const page = tab.dataset.reportTab || "overview";

    history.replaceState(null, "", `#${page}`);
    showReportSubpage(page);
  });
});

window.addEventListener("hashchange", () => showReportSubpage());

function getObeReportFilterParams() {
  const params = new URLSearchParams();
  const filters = {
    engineeringProgram: document.getElementById("obeFilterProgram")?.value || "",
    subject: document.getElementById("obeFilterSubject")?.value.trim() || "",
    section: document.getElementById("obeFilterSection")?.value.trim() || "",
    semester: document.getElementById("obeFilterSemester")?.value || "",
    schoolYear: document.getElementById("obeFilterSchoolYear")?.value.trim() || "",
    assessmentMethod:
      document.getElementById("obeFilterAssessmentMethod")?.value || "",
  };

  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });

  return params;
}

function updateObeFilterSummary(report = {}) {
  const summary = report.filterSummary || "All records";
  const element = document.getElementById("obeFilterSummary");

  if (element) {
    element.textContent = `Showing: ${summary}`;
  }
}

async function loadReports() {
  try {
    const query = getObeReportFilterParams().toString();
    const data = await apiRequest(
      query ? `/dashboard/reports?${query}` : "/dashboard/reports",
    );
    const report = data.report;

    document.getElementById("reportUsers").textContent = report.totalUsers;
    document.getElementById("reportQuestions").textContent =
      report.totalQuestions;
    document.getElementById("reportExams").textContent = report.totalExams;
    document.getElementById("reportActivity").textContent =
      report.activityCount ?? report.loginCount + report.generatedExamCount;
    document.getElementById("reportGenerated").textContent = report.totalExams;
    document.getElementById("reportSubmitted").textContent =
      report.submittedExams;
    document.getElementById("reportPending").textContent = report.pendingExams;
    document.getElementById("reportLogins").textContent = report.loginCount;
    document.getElementById("reportTosDownloads").textContent =
      report.downloadedTosCount || 0;

    updateDifficultyReport(report);
    updateObeFilterSummary(report);
    updateObeReport(report.obeReport || {});
    updateOutcomeCoverageAlerts(report.outcomeCoverageAlerts || {});
    updateAssessmentMethodReport(report.assessmentMethodReport || {});
    updateCqiReport(report.cqiReport || {});

    document.getElementById("reportsActivityBody").innerHTML =
      report.recentActivity.length > 0
        ? report.recentActivity.slice(0, 10).map(renderActivityRow).join("")
        : `
          <tr>
            <td colspan="6" class="empty-table-cell">No activity recorded yet.</td>
          </tr>
        `;

    await hydrateActivityProfileImages(report.recentActivity.slice(0, 10));
  } catch (error) {
    alert(error.message);
  }
}

document
  .getElementById("obeReportFilterForm")
  ?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await loadReports();
    location.hash = "obe-alignment";
    showReportSubpage("obe-alignment");
  });

async function resetObeReportFilters() {
  document.getElementById("obeFilterProgram").value = "";
  document.getElementById("obeFilterSubject").value = "";
  document.getElementById("obeFilterSection").value = "";
  document.getElementById("obeFilterSemester").value = "";
  document.getElementById("obeFilterSchoolYear").value = "";
  document.getElementById("obeFilterAssessmentMethod").value = "";
  await loadReports();
}

function updateOutcomeCoverageAlerts(report) {
  document.getElementById("coverageAlertTotal").textContent =
    report.totalAlerts || 0;
  document.getElementById("coverageAlertPriority").textContent =
    (report.criticalAlerts || 0) + (report.highAlerts || 0);

  const alerts = report.alerts || [];
  document.getElementById("outcomeCoverageAlertBody").innerHTML =
    alerts.length > 0
      ? alerts.map(renderOutcomeCoverageAlertRow).join("")
      : `<tr><td colspan="6" class="empty-table-cell">No outcome coverage alerts detected.</td></tr>`;
}

function getCoverageAlertClass(severity) {
  if (severity === "Critical" || severity === "High") return "difficult";
  if (severity === "Medium") return "average";

  return "easy";
}

function renderOutcomeCoverageAlertRow(alert) {
  return `
    <tr>
      <td><span class="badge ${getCoverageAlertClass(alert.severity)}">${escapeHTML(alert.severity)}</span></td>
      <td>${escapeHTML(alert.area || "")}</td>
      <td><strong>${escapeHTML(alert.item || "")}</strong></td>
      <td>${escapeHTML(alert.issue || "")}</td>
      <td>${escapeHTML(alert.action || "")}</td>
      <td>${escapeHTML(alert.evidenceCount ?? "")}</td>
    </tr>
  `;
}

function updateAssessmentMethodReport(report) {
  document.getElementById("assessmentMethodsUsed").textContent =
    `${report.methodsUsed || 0} / ${report.totalMethods || 0}`;
  document.getElementById("assessmentGeneratedTotal").textContent =
    report.totalGeneratedExams || 0;
  document.getElementById("assessmentEvidenceTotal").textContent =
    report.totalItemAnalysisEvidence || 0;
  document.getElementById("assessmentExamOnly").textContent =
    `${report.examOnly || 0}%`;

  const rows = report.rows || [];
  document.getElementById("assessmentMethodBody").innerHTML =
    rows.length > 0
      ? rows.map(renderAssessmentMethodRow).join("")
      : `<tr><td colspan="4" class="empty-table-cell">No assessment method evidence yet.</td></tr>`;
}

function renderAssessmentMethodRow(row) {
  return `
    <tr>
      <td><strong>${escapeHTML(row.method)}</strong></td>
      <td>${row.generatedExams || 0}</td>
      <td>${row.itemAnalysisEvidence || 0}</td>
      <td><span class="badge ${row.totalEvidence > 0 ? "easy" : "average"}">${row.totalEvidence || 0}</span></td>
    </tr>
  `;
}

function updateCqiReport(cqiReport) {
  document.getElementById("cqiNeededPlans").textContent =
    cqiReport.neededPlans || 0;
  document.getElementById("cqiOpenPlans").textContent =
    cqiReport.openPlans || 0;
  document.getElementById("cqiOverduePlans").textContent =
    cqiReport.overduePlans || 0;
  document.getElementById("cqiVerifiedPlans").textContent =
    cqiReport.verifiedPlans || 0;

  document.getElementById("cqiNeededBody").innerHTML =
    cqiReport.neededPlanRows?.length > 0
      ? cqiReport.neededPlanRows.map(renderNeededCqiRow).join("")
      : `<tr><td colspan="4" class="empty-table-cell">No missing CQI plans detected.</td></tr>`;
  document.getElementById("cqiOverdueBody").innerHTML =
    cqiReport.overduePlanRows?.length > 0
      ? cqiReport.overduePlanRows.map(renderOverdueCqiRow).join("")
      : `<tr><td colspan="4" class="empty-table-cell">No overdue CQI plans.</td></tr>`;
  document.getElementById("cqiRecentBody").innerHTML =
    cqiReport.recentPlans?.length > 0
      ? cqiReport.recentPlans.map(renderRecentCqiRow).join("")
      : `<tr><td colspan="8" class="empty-table-cell">No CQI plans saved yet.</td></tr>`;
}

function renderExamContext(exam = {}) {
  const title = exam.examTitle || exam.analysisExamId?.title || "Untitled exam";
  const subject = exam.subject || exam.analysisExamId?.subject || "";
  const section = exam.section || exam.analysisExamId?.section || "";

  return `
    <strong>${escapeHTML(title)}</strong>
    <small>${escapeHTML([subject, section].filter(Boolean).join(" - "))}</small>
  `;
}

function renderNeededCqiRow(row) {
  return `
    <tr>
      <td>${renderExamContext(row)}</td>
      <td><span class="badge difficult">${escapeHTML(row.outcomeType)} ${escapeHTML(row.outcomeCode)}</span></td>
      <td>${escapeHTML(row.attainmentRate || 0)}% / ${escapeHTML(row.targetRate ?? 75)}%</td>
      <td><strong>${escapeHTML(row.gap || 0)}%</strong></td>
    </tr>
  `;
}

function formatDate(value) {
  if (!value) return "Not set";
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? "Not set" : date.toLocaleDateString();
}

function getCqiStatusClass(status) {
  if (status === "Verified" || status === "Completed") return "easy";
  if (status === "In Progress") return "average";
  return "difficult";
}

function renderOverdueCqiRow(plan) {
  return `
    <tr>
      <td>${renderExamContext({ analysisExamId: plan.analysisExamId })}</td>
      <td><span class="badge difficult">${escapeHTML(plan.outcomeType)} ${escapeHTML(plan.outcomeCode)}</span></td>
      <td>${escapeHTML(plan.responsiblePerson || "Unassigned")}</td>
      <td>${escapeHTML(formatDate(plan.targetDate))}</td>
    </tr>
  `;
}

function renderRecentCqiRow(plan) {
  return `
    <tr>
      <td>${renderExamContext({ analysisExamId: plan.analysisExamId })}</td>
      <td><span class="badge ${getCqiStatusClass(plan.status)}">${escapeHTML(plan.outcomeType)} ${escapeHTML(plan.outcomeCode)}</span></td>
      <td><span class="badge ${getCqiStatusClass(plan.status)}">${escapeHTML(plan.status || "Planned")}</span></td>
      <td>${escapeHTML(plan.responsiblePerson || "Unassigned")}</td>
      <td>${escapeHTML(formatDate(plan.targetDate))}</td>
      <td>${escapeHTML(plan.followUpDecision || "Open")}</td>
      <td>${escapeHTML(formatDate(plan.verifiedAt))}</td>
      <td>${escapeHTML(formatDate(plan.updatedAt))}</td>
    </tr>
  `;
}

function updateObeReport(obeReport) {
  document.getElementById("obeAlignedQuestions").textContent =
    obeReport.alignedQuestions || 0;
  document.getElementById("obeUnmappedQuestions").textContent =
    obeReport.unmappedQuestions || 0;
  document.getElementById("obeAlignmentRate").textContent =
    `${obeReport.alignmentRate || 0}%`;
  document.getElementById("obeAttainmentMethod").textContent =
    obeReport.attainmentMethodLabel || "Response-based";
  document.getElementById("obeAttainmentFormula").textContent =
    obeReport.attainmentFormula ||
    "Correct mapped responses / Total mapped responses";
  updateCourseObeSummary(obeReport.courseLevelSummary || {});
  updateEvidenceTraceabilityMatrix(obeReport.evidenceTraceabilityMatrix || []);

  document.getElementById("obeCloBody").innerHTML = renderOutcomeRows(
    obeReport.courseOutcomes,
    "CLO",
  );
  document.getElementById("obePloBody").innerHTML = renderOutcomeRows(
    obeReport.programOutcomes,
    "SO",
  );
  document.getElementById("obeBloomBody").innerHTML =
    obeReport.bloomLevels?.length > 0
      ? obeReport.bloomLevels
          .map(
            (item) => `
              <tr>
                <td>${escapeHTML(item.level)}</td>
                <td>${item.questionCount}</td>
              </tr>
            `,
          )
          .join("")
      : `<tr><td colspan="2" class="empty-table-cell">No Bloom mapping yet.</td></tr>`;
}

function getCourseObeStatusClass(status) {
  if (status === "Attained") return "easy";
  if (status === "Partially Attained") return "average";
  return "difficult";
}

function updateCourseObeSummary(summary) {
  const body = document.getElementById("courseObeSummaryBody");

  if (!body) return;

  if (!summary || Object.keys(summary).length === 0) {
    body.innerHTML = `
      <tr>
        <td colspan="9" class="empty-table-cell">No course-level OBE summary available.</td>
      </tr>
    `;
    return;
  }

  body.innerHTML = `
    <tr>
      <td>${escapeHTML(summary.program || "All programs")}</td>
      <td><strong>${escapeHTML(summary.subject || "All subjects")}</strong></td>
      <td>${escapeHTML(summary.section || "All sections")}</td>
      <td>${escapeHTML(summary.semester || "All terms")}</td>
      <td>${escapeHTML(summary.schoolYear || "All school years")}</td>
      <td>${escapeHTML(summary.cloSummary || "0 / 0")} <small>${escapeHTML(summary.cloAverage || 0)}%</small></td>
      <td>${escapeHTML(summary.soSummary || "0 / 0")} <small>${escapeHTML(summary.soAverage || 0)}%</small></td>
      <td>${escapeHTML(summary.overallAttainmentRate || 0)}% / ${escapeHTML(summary.targetRate ?? 75)}%</td>
      <td>
        <span class="badge ${getCourseObeStatusClass(summary.status)}">
          ${escapeHTML(summary.status || "No Evidence")}
        </span>
      </td>
    </tr>
  `;
}

function updateEvidenceTraceabilityMatrix(rows = []) {
  const body = document.getElementById("obeTraceabilityBody");

  if (!body) return;

  body.innerHTML =
    rows.length > 0
      ? rows.map(renderTraceabilityRow).join("")
      : `
        <tr>
          <td colspan="10" class="empty-table-cell">No OBE evidence traceability rows available.</td>
        </tr>
      `;
}

function getTraceabilityStatusClass(status) {
  if (status === "Attained" || status === "No CQI Required") return "easy";
  if (status === "No Evidence") return "average";
  return "difficult";
}

function renderTraceabilityRow(row) {
  const studentText = `${row.attainedStudents || 0} / ${row.assessedStudents || 0}`;
  const attainmentText = `${row.attainmentRate || 0}% / ${row.targetRate ?? 75}%`;

  return `
    <tr>
      <td>${escapeHTML(row.program || "Not set")}</td>
      <td>${escapeHTML(row.subject || "Not set")}</td>
      <td><strong>${escapeHTML(row.courseOutcome || "")}</strong></td>
      <td><strong>${escapeHTML(row.programOutcome || "")}</strong></td>
      <td>${escapeHTML(row.questionCount || 0)}</td>
      <td>${escapeHTML(row.assessmentMethods || "No evidence")}</td>
      <td>${escapeHTML(row.evidenceSources || "No evidence")}</td>
      <td>${escapeHTML(studentText)}</td>
      <td>
        <span class="badge ${getTraceabilityStatusClass(row.status)}">
          ${escapeHTML(attainmentText)}
        </span>
      </td>
      <td>
        <span class="badge ${getTraceabilityStatusClass(row.cqiStatus)}">
          ${escapeHTML(row.cqiStatus || "No CQI Required")}
        </span>
      </td>
    </tr>
  `;
}

function renderOutcomeRows(outcomes = [], label) {
  const showProgram = label === "CLO";
  const emptyColspan = showProgram ? 8 : 7;

  return outcomes.length > 0
    ? outcomes
        .map(
          (item) => `
            <tr>
              <td><strong>${escapeHTML(item.code)}</strong></td>
              ${showProgram ? `<td>${escapeHTML(item.programs || "Not set")}</td>` : ""}
              <td>${item.questionCount}</td>
              <td>${item.assessedItems}</td>
              <td>${item.correctItems}</td>
              <td>${item.attainedStudents || 0} / ${item.assessedStudents || 0}</td>
              <td>${item.targetRate ?? 75}%</td>
              <td>
                <span class="badge ${getAttainmentClass(item.attainmentRate, item.targetRate)}">
                  ${item.attainmentRate}%
                </span>
              </td>
            </tr>
          `,
        )
        .join("")
    : `<tr><td colspan="${emptyColspan}" class="empty-table-cell">No ${label} mapping yet.</td></tr>`;
}

function getAttainmentClass(rate, targetRate = 75) {
  const target = Number(targetRate ?? 75);

  if (Number(rate) >= target) return "easy";
  if (Number(rate) >= target * (2 / 3)) return "average";

  return "difficult";
}

function percent(part, total) {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

function updateDifficultyReport(report) {
  const easyPercent = percent(report.easyQuestions, report.totalQuestions);
  const averagePercent = percent(report.averageQuestions, report.totalQuestions);
  const difficultPercent = percent(
    report.difficultQuestions,
    report.totalQuestions,
  );

  document.getElementById("reportEasy").textContent =
    `${report.easyQuestions} (${easyPercent}%)`;
  document.getElementById("reportAverage").textContent =
    `${report.averageQuestions} (${averagePercent}%)`;
  document.getElementById("reportDifficult").textContent =
    `${report.difficultQuestions} (${difficultPercent}%)`;
  document.getElementById("reportQuestionTotal").textContent =
    report.totalQuestions;
  document.getElementById("reportDonutTotal").textContent =
    report.totalQuestions;
  document.getElementById("reportDifficultyDonut").style.background = `
    conic-gradient(
      #5fbf68 0 ${easyPercent}%,
      #f5a623 ${easyPercent}% ${easyPercent + averagePercent}%,
      #e94b3c ${easyPercent + averagePercent}% 100%
    )
  `;
}

function renderActivityRow(activity) {
  const activityDate = new Date(activity.createdAt);
  const user = activity.user || {};
  const initials = getInitials(user.name || user.email || "?");
  const isTosDownload =
    activity.action === "download_tos" || activity.metadata?.documentType === "tos";
  const actionLabel = formatActivityAction(activity, isTosDownload);
  const badgeClass =
    isTosDownload
      ? "average"
      : activity.action === "generate_exam"
      ? "average"
      : activity.action === "approve_exam" || activity.action === "download_exam"
      ? "easy"
      : activity.action === "reject_exam"
      ? "difficult"
      : "easy";

  return `
    <tr>
      <td>
        <div class="report-user-cell">
          <span
            class="avatar activity-avatar"
            id="activityAvatar_${activity._id}"
            data-initials="${escapeHTML(initials)}"
          >${escapeHTML(initials)}</span>
          <div>
            <strong>${escapeHTML(user.name || "Unknown user")}</strong><br>
            <small>${escapeHTML(user.email || "")}</small>
          </div>
        </div>
      </td>
      <td>
        <span class="badge ${hasAnyRole(user, ["super_admin", "admin"]) ? "difficult" : "easy"}">
          ${escapeHTML(getRoleLabel(user.role))}
        </span>
      </td>
      <td><span class="badge ${badgeClass}">${actionLabel}</span></td>
      <td>${escapeHTML(activity.description)}</td>
      <td>${activityDate.toLocaleDateString()}</td>
      <td>${activityDate.toLocaleTimeString()}</td>
    </tr>
  `;
}

function formatActivityAction(activity, isTosDownload = false) {
  if (isTosDownload) return "Downloaded TOS";

  const labels = {
    login: "Logged In",
    register_account: "Registered Account",
    verify_email: "Verified Email",
    resend_email_verification: "Resent Verification Code",
    request_password_reset: "Requested Password Reset",
    reset_password: "Reset Password",
    manage_peo: "Managed PEO",
    generate_exam: "Generated Exam",
    approve_exam: "Approved Exam",
    reject_exam: "Rejected Exam",
    download_exam: "Downloaded Exam",
    update_obe_settings: "Updated OBE Settings",
    manage_course_outcome: "Managed Course Outcome",
    manage_student_outcome: "Managed Student Outcome",
    manage_cqi_plan: "Managed CQI Plan",
    update_cqi_status: "Updated CQI Status",
    save_scanned_result: "Saved Scanned Result",
    approve_parsed_question: "Approved Parsed Question",
    reject_parsed_question: "Rejected Parsed Question",
    update_user_role: "Updated User Role",
    update_user_approval: "Updated User Approval",
    resolve_support_ticket: "Resolved Support Ticket",
    reply_support_ticket: "Replied Support Ticket",
  };

  return (
    labels[activity.action] ||
    String(activity.action || "activity")
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase())
  );
}

async function hydrateActivityProfileImages(activities) {
  await Promise.all(
    activities.map(async (activity) => {
      if (!activity.user || !activity.user._id) {
        return;
      }

      const avatar = document.getElementById(`activityAvatar_${activity._id}`);

      if (!avatar) {
        return;
      }

      try {
        const res = await fetch(`/api/users/${activity.user._id}/profile-image`, {
          headers: {
            Authorization: `Bearer ${getToken()}`,
          },
        });

        if (!res.ok) {
          return;
        }

        const blob = await res.blob();
        const imageUrl = URL.createObjectURL(blob);
        avatar.innerHTML = `<img src="${imageUrl}" alt="Profile picture">`;
        avatar.classList.add("has-image");
      } catch (error) {
        avatar.textContent = avatar.dataset.initials || "?";
      }
    }),
  );
}

function getInitials(value) {
  return String(value || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function getActivityDownloadQuery() {
  const startDate = document.getElementById("activityStartDate")?.value || "";
  const endDate = document.getElementById("activityEndDate")?.value || "";

  if (startDate && endDate && startDate > endDate) {
    throw new Error("Start date cannot be after end date.");
  }

  const params = new URLSearchParams();

  if (startDate) params.set("startDate", startDate);
  if (endDate) params.set("endDate", endDate);

  return params.toString();
}

async function downloadActivityLog() {
  try {
    const query = getActivityDownloadQuery();
    const url = query
      ? `/api/dashboard/activity/download?${query}`
      : "/api/dashboard/activity/download";
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${getToken()}`,
      },
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.message || "Download failed.");
    }

    const blob = await res.blob();
    const objectUrl = window.URL.createObjectURL(blob);
    const fileName =
      res
        .headers
        .get("Content-Disposition")
        ?.match(/filename="([^"]+)"/)?.[1] || "activity-log.xlsx";

    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(objectUrl);
  } catch (error) {
    alert(error.message);
  }
}

async function downloadAccreditationObeReport() {
  try {
    const query = getObeReportFilterParams().toString();
    const url = query
      ? `/api/dashboard/obe/export?${query}`
      : "/api/dashboard/obe/export";
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${getToken()}`,
      },
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.message || "Download failed.");
    }

    const blob = await res.blob();
    const objectUrl = window.URL.createObjectURL(blob);
    const fileName =
      res
        .headers
        .get("Content-Disposition")
        ?.match(/filename="([^"]+)"/)?.[1] ||
      "accreditation-obe-report.xlsx";

    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(objectUrl);
  } catch (error) {
    alert(error.message);
  }
}

showReportSubpage();
loadReports();
