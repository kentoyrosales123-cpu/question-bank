protectPage();

const obeUser = getUser();
const isFullObeAdmin = isSuperAdminRole(obeUser);

if (obeUser && !canUseTeacherObeRole(obeUser)) {
  alert("OBE Management is for exam users only.");
  location.href = getDashboardUrl(obeUser);
}

let outcomes = [];
let studentOutcomes = [];
let peos = [];
let curriculumMap = null;
let curriculumCourses = [];
let peoPage = 1;
let studentOutcomePage = 1;
let courseOutcomePage = 1;
let curriculumMapPage = 1;
let rubricAssessments = [];
let rubricTemplates = [];
let rubricTemplateExams = [];
let evidenceRecords = [];
let attainmentSnapshots = [];
let editingCourseOutcomeId = null;
const peosPerPage = 15;
const studentOutcomesPerPage = 15;
const courseOutcomesPerPage = 15;
const curriculumMapRowsPerPage = 15;
const OBE_SUBPAGES = [
  "curriculum-map",
  "obe-traceability-matrix",
  "live-attainment",
  "peos",
  "student-outcomes",
  "performance-indicator",
  "course-outcomes",
  "rubrics",
  "evidence",
  "attainment-history",
];
const LIMITED_OBE_SUBPAGES = ["live-attainment", "rubrics", "evidence"];

function getAllowedObeSubpages() {
  return isFullObeAdmin ? OBE_SUBPAGES : LIMITED_OBE_SUBPAGES;
}

function getRequestedObeSubpage() {
  const hash = String(location.hash || "").replace("#", "");
  const allowedPages = getAllowedObeSubpages();

  return allowedPages.includes(hash) ? hash : allowedPages[0];
}

function showObeSubpage(page = getRequestedObeSubpage()) {
  const allowedPages = getAllowedObeSubpages();
  const activePage = allowedPages.includes(page) ? page : allowedPages[0];

  document.querySelectorAll("[data-obe-page]").forEach((section) => {
    const pageName = section.getAttribute("data-obe-page");

    section.classList.toggle("role-hidden", !allowedPages.includes(pageName));
    section.classList.toggle(
      "hidden",
      pageName !== activePage || !allowedPages.includes(pageName),
    );
  });

  document.querySelectorAll("[data-obe-tab]").forEach((tab) => {
    const tabName = tab.getAttribute("data-obe-tab");

    tab.classList.toggle("hidden", !allowedPages.includes(tabName));
    tab.classList.toggle(
      "active",
      tabName === activePage,
    );
  });
}

function applyObeRoleMode() {
  document
    .getElementById("obeSettingsForm")
    ?.closest(".card")
    ?.classList.toggle("hidden", !isFullObeAdmin);
}

async function loadObeSettings() {
  if (!isFullObeAdmin) {
    return;
  }

  try {
    const data = await apiRequest("/obe/settings");
    const settings = data.settings || {};

    document.getElementById("courseOutcomeTarget").value =
      settings.courseOutcomeTarget ?? 75;
    document.getElementById("studentOutcomeTarget").value =
      settings.studentOutcomeTarget ?? 75;
    document.getElementById("attainmentMethod").value =
      settings.attainmentMethod || "response_based";
  } catch (error) {
    setMessage("obeSettingsMessage", getObeRouteErrorMessage(error));
  }
}

async function loadOutcomes() {
  if (!isFullObeAdmin) {
    loadLiveObeAttainment();
    loadRubrics();
    loadEvidence();
    return;
  }

  try {
    const [courseData, studentData, peoData] = await Promise.all([
      apiRequest("/obe/course-outcomes"),
      apiRequest("/obe/student-outcomes"),
      apiRequest("/obe/peos"),
    ]);

    outcomes = courseData.outcomes || [];
    studentOutcomes = studentData.studentOutcomes || [];
    peos = peoData.peos || [];
    renderPeos();
    renderStudentOutcomes();
    renderOutcomes();
    renderOutcomeOptions();
    loadCurriculumMapCourses();
    loadCurriculumMap();
    loadLiveObeAttainment();
    loadRubrics();
    loadEvidence();
    loadSnapshots();
  } catch (error) {
    alert(error.message);
  }
}

async function loadLiveObeAttainment() {
  try {
    if (isFullObeAdmin) {
      const data = await apiRequest("/dashboard/reports");
      const report = data.report || {};
      const obeReport = report.obeReport || {};
      const summary = obeReport.courseLevelSummary || {};

      document.getElementById("liveObeAlignedQuestions").textContent =
        obeReport.alignedQuestions || 0;
      document.getElementById("liveObeAlignmentRate").textContent =
        `${obeReport.alignmentRate || 0}% of question bank`;
      document.getElementById("liveObeCloAttained").textContent =
        `${summary.attainedClos || 0} / ${summary.assessedClos || 0}`;
      document.getElementById("liveObeSoAttained").textContent =
        `${summary.attainedSos || 0} / ${summary.assessedSos || 0}`;
      document.getElementById("liveObeOverallRate").textContent =
        `${summary.overallAttainmentRate || 0}%`;
      document.getElementById("liveObeStatus").textContent =
        summary.status || "No Evidence";
      document.getElementById("liveObeCloBody").innerHTML =
        renderLiveOutcomeRows(obeReport.courseOutcomes || [], "CLO");
      document.getElementById("liveObeSoBody").innerHTML =
        renderLiveOutcomeRows(obeReport.programOutcomes || [], "SO");
      document.getElementById("liveObeCepBody").innerHTML =
        renderLiveCepRows(obeReport.cepAttainment || []);
      document
        .getElementById("teacherObeSubmissionPanel")
        ?.classList.remove("hidden");
      document.getElementById("teacherObeSubmissionBody").innerHTML =
        Array.isArray(report.teacherSubmissionStatus)
          ? renderTeacherObeSubmissionRows(report.teacherSubmissionStatus)
          : `<tr><td colspan="8" class="empty-table-cell">Submission status data is not available from the server yet. Restart the server, then refresh Live Attainment.</td></tr>`;
      document
        .getElementById("liveObeCqiRecommendationPanel")
        ?.classList.remove("hidden");
      document.getElementById("liveObeCqiRecommendationBody").innerHTML =
        renderCqiRecommendationRows(
          report.cqiReport?.recommendationRows ||
            report.cqiReport?.neededPlanRows ||
            [],
        );
      document.getElementById("liveObeEvidenceBody").innerHTML =
        renderLiveEvidenceRows(obeReport.evidenceTraceabilityMatrix || []);
    } else {
      const data = await apiRequest("/dashboard/my-obe");
      const dashboard = data.dashboard || {};
      const summary = dashboard.summary || {};
      const courseRows = dashboard.courseOutcomes || [];
      const soRows = dashboard.studentOutcomes || [];
      const assessedClos = courseRows.filter((row) => Number(row.assessedItems || 0) > 0).length;
      const attainedClos = courseRows.filter((row) => row.status === "Attained").length;
      const assessedSos = soRows.filter((row) => Number(row.assessedItems || 0) > 0).length;
      const attainedSos = soRows.filter((row) => row.status === "Attained").length;
      const assessedRows = [...courseRows, ...soRows].filter(
        (row) => Number(row.assessedItems || 0) > 0,
      );
      const overallRate = assessedRows.length
        ? Math.round(
            (assessedRows.reduce(
              (total, row) => total + Number(row.attainmentRate || 0),
              0,
            ) /
              assessedRows.length) *
              10,
          ) / 10
        : 0;

      document.getElementById("liveObeAlignedQuestions").textContent =
        summary.generatedExams || 0;
      document.getElementById("liveObeAlignmentRate").textContent =
        "generated exams";
      document.getElementById("liveObeCloAttained").textContent =
        `${attainedClos} / ${assessedClos}`;
      document.getElementById("liveObeSoAttained").textContent =
        `${attainedSos} / ${assessedSos}`;
      document.getElementById("liveObeOverallRate").textContent =
        `${overallRate}%`;
      document.getElementById("liveObeStatus").textContent =
        summary.notAttainedWithoutCqi > 0 ? "Needs CQI" : "Teacher Scope";
      document.getElementById("liveObeCloBody").innerHTML =
        renderLiveOutcomeRows(courseRows, "CLO");
      document.getElementById("liveObeSoBody").innerHTML =
        renderLiveOutcomeRows(soRows, "SO");
      document.getElementById("liveObeCepBody").innerHTML =
        renderLiveCepRows(dashboard.cepAttainment || []);
      document
        .getElementById("teacherObeSubmissionPanel")
        ?.classList.add("hidden");
      document
        .getElementById("liveObeCqiRecommendationPanel")
        ?.classList.add("hidden");
      document.getElementById("liveObeEvidenceBody").innerHTML =
        renderTeacherSubmissionEvidenceRows(dashboard.submissionStatus || []);
    }
    setMessage("liveObeMessage", "", false);
  } catch (error) {
    setMessage("liveObeMessage", getObeRouteErrorMessage(error));
  }
}

function renderTeacherSubmissionEvidenceRows(rows = []) {
  if (!rows.length) {
    return `<tr><td colspan="6" class="empty-table-cell">No teacher OBE submission records yet.</td></tr>`;
  }

  return rows
    .slice(0, 30)
    .map(
      (row) => `
        <tr>
          <td><strong>${escapeHTML(row.subject)}</strong></td>
          <td>${escapeHTML(row.section)}</td>
          <td>${escapeHTML(`${row.linkedItemAnalysis || 0} item analysis, ${row.rubricAssessments || 0} rubrics, ${row.evidenceRecords || 0} files`)}</td>
          <td>${row.generatedExams || 0}</td>
          <td>${row.notAttainedOutcomes || 0} weak outcomes</td>
          <td>
            <span class="badge ${row.status === "Ready for Review" ? "easy" : row.status === "Needs CQI" ? "difficult" : "average"}">
              ${escapeHTML(row.status)}
            </span>
          </td>
        </tr>
      `,
    )
    .join("");
}

function getTeacherSubmissionStatusClass(status = "") {
  if (status === "Ready for Review") return "easy";
  if (status === "CQI In Progress") return "average";
  return "difficult";
}

function renderTeacherObeSubmissionRows(rows = []) {
  if (!rows.length) {
    return `<tr><td colspan="8" class="empty-table-cell">No teacher OBE submission records yet.</td></tr>`;
  }

  return rows
    .map(
      (row) => `
        <tr>
          <td>
            <strong>${escapeHTML(row.teacherName || "Unnamed user")}</strong>
            <small class="muted-text">${escapeHTML(row.email || row.role || "")}</small>
          </td>
          <td>${row.generatedExams || 0}</td>
          <td>${row.linkedItemAnalysis || 0}</td>
          <td>
            <span class="badge ${row.coSoAttainmentAvailable ? "easy" : "difficult"}">
              ${row.itemAnalysisWithResults || 0}
            </span>
          </td>
          <td>${row.rubricAssessments || 0}</td>
          <td>${row.evidenceRecords || 0}</td>
          <td>${row.completedCqiPlans || 0} / ${row.cqiPlans || 0}</td>
          <td>
            <span class="badge ${getTeacherSubmissionStatusClass(row.status)}">
              ${escapeHTML(row.status || "Missing Evidence")}
            </span>
          </td>
        </tr>
      `,
    )
    .join("");
}

function getCqiRecommendationClass(priority = "") {
  if (priority === "High") return "difficult";
  if (priority === "Medium") return "average";
  return "easy";
}

function renderCqiRecommendationRows(rows = []) {
  if (!rows.length) {
    return `<tr><td colspan="6" class="empty-table-cell">No automatic CQI recommendations right now.</td></tr>`;
  }

  return rows
    .map(
      (row) => `
        <tr>
          <td>
            <strong>${escapeHTML(row.examTitle || "Untitled exam")}</strong>
            <small class="muted-text">${escapeHTML([row.subject, row.section].filter(Boolean).join(" - "))}</small>
          </td>
          <td><span class="badge difficult">${escapeHTML(row.outcomeType)} ${escapeHTML(row.outcomeCode)}</span></td>
          <td>${escapeHTML(row.attainmentRate || 0)}% / ${escapeHTML(row.targetRate ?? 75)}% <strong>(${escapeHTML(row.gap || 0)}%)</strong></td>
          <td>
            <span class="badge ${getCqiRecommendationClass(row.recommendationPriority)}">
              ${escapeHTML(row.recommendationPriority || "Low")}
            </span>
          </td>
          <td>
            <strong>${escapeHTML(row.recommendedAction || "Create a CQI intervention plan.")}</strong>
            <small class="muted-text">${escapeHTML(row.recommendedRootCause || "")}</small>
          </td>
          <td>${escapeHTML(row.recommendedEvidence || "Follow-up item analysis and reassessment result.")}</td>
        </tr>
      `,
    )
    .join("");
}

function renderLiveOutcomeRows(rows = [], type = "CLO") {
  if (!rows.length) {
    return `<tr><td colspan="${type === "CLO" ? 7 : 7}" class="empty-table-cell">No ${type} attainment evidence yet.</td></tr>`;
  }

  return rows
    .map(
      (row) => `
        <tr>
          <td><strong>${escapeHTML(row.code)}</strong></td>
          ${
            type === "CLO"
              ? `<td>${escapeHTML(row.programs || "Not set")}</td>`
              : ""
          }
          ${type === "SO" ? `<td>${renderPerformanceIndicators(row)}</td>` : ""}
          <td>${row.assessedItems || 0}</td>
          <td>${row.correctItems || 0}</td>
          <td>${row.attainedStudents || 0} / ${row.assessedStudents || 0}</td>
          <td>${row.targetRate ?? 75}%</td>
          <td>
            <span class="badge ${Number(row.attainmentRate || 0) >= Number(row.targetRate ?? 75) ? "easy" : "difficult"}">
              ${row.attainmentRate || 0}%
            </span>
          </td>
        </tr>
      `,
    )
    .join("");
}

function renderPerformanceIndicators(row = {}) {
  const breakdown = Array.isArray(row.piBreakdown) ? row.piBreakdown : [];

  if (breakdown.length > 0) {
    const phaseText = renderPhaseBreakdown(row.phaseBreakdown);
    const rows = breakdown
      .map(
        (pi) =>
          `<small class="muted-text"><strong>${escapeHTML(pi.code)}:</strong> ${escapeHTML(pi.attainmentRate || 0)}% (${escapeHTML(pi.status || "No Evidence")})</small>`,
      )
      .join("");
    return `<details><summary>${escapeHTML(breakdown.length)} PI result${breakdown.length === 1 ? "" : "s"}${phaseText ? ` | ${phaseText}` : ""}</summary>${rows}</details>`;
  }

  const indicators = Array.isArray(row.performanceIndicatorRows)
    ? row.performanceIndicatorRows
    : [];

  if (indicators.length > 0) {
    return indicators
      .map(
        (indicator) =>
          `<small class="muted-text"><strong>${escapeHTML(indicator.label)}:</strong> ${escapeHTML(indicator.description)}</small>`,
      )
      .join("");
  }

  return escapeHTML(row.performanceIndicators || "Not set");
}

function renderPhaseBreakdown(phases = []) {
  return Array.isArray(phases) && phases.length
    ? phases
        .filter((phase) => Number(phase.totalWeight || phase.possibleWeight || phase.totalScore || 0) > 0)
        .map((phase) => `${phase.phase || phase.code}: ${phase.attainmentRate || 0}%`)
        .join(", ")
    : "";
}

function renderLiveCepRows(rows = []) {
  if (!rows.length) {
    return `<tr><td colspan="8" class="empty-table-cell">No CEP-based attainment evidence yet.</td></tr>`;
  }

  return rows
    .map((row) => {
      const assessed = Number(row.assessedItems || 0);
      const target = Number(row.targetRate ?? 75);
      const rate = Number(row.attainmentRate || 0);
      const badgeClass =
        assessed <= 0 ? "average" : rate >= target ? "easy" : "difficult";

      return `
        <tr>
          <td><strong>${escapeHTML(row.code)}</strong></td>
          <td>${escapeHTML(row.programs || "Not set")}</td>
          <td>${row.questionCount || 0}</td>
          <td>${row.assessedItems || 0}</td>
          <td>${row.correctItems || 0}</td>
          <td>${row.attainedStudents || 0} / ${row.assessedStudents || 0}</td>
          <td>${row.targetRate ?? 75}%</td>
          <td>
            <span class="badge ${badgeClass}">
              ${row.attainmentRate || 0}%
            </span>
          </td>
        </tr>
      `;
    })
    .join("");
}

function renderLiveEvidenceRows(rows = []) {
  const evidenceRows = rows.filter((row) => Number(row.assessedItems || 0) > 0);

  if (!evidenceRows.length) {
    return `<tr><td colspan="6" class="empty-table-cell">No linked item-analysis or rubric evidence yet.</td></tr>`;
  }

  return evidenceRows
    .slice(0, 30)
    .map(
      (row) => `
        <tr>
          <td><strong>${escapeHTML(row.courseOutcome)}</strong></td>
          <td>${escapeHTML(row.programOutcome)}</td>
          <td>${escapeHTML(row.evidenceSources || "No evidence")}</td>
          <td>${row.attainedStudents || 0} / ${row.assessedStudents || 0}</td>
          <td>${row.attainmentRate || 0}% / ${row.targetRate ?? 75}%</td>
          <td>
            <span class="badge ${row.status === "Attained" ? "easy" : "difficult"}">
              ${escapeHTML(row.status || "No Evidence")}
            </span>
          </td>
        </tr>
      `,
    )
    .join("");
}

function parseRubricCriteriaInput() {
  return String(document.getElementById("rubricCriteria")?.value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("|").map((part) => part.trim());

      return {
        label: parts[0] || "",
        courseOutcome: parts[1] || "",
        programOutcome: formatStudentOutcomeLink(parts[2] || ""),
        performanceIndicator: parts.length >= 7 ? parts[3] || "" : "",
        bloomLevel: parts[parts.length >= 7 ? 4 : 3] || "",
        maxScore: Number(parts[parts.length >= 7 ? 5 : 4] || 0),
        targetScore: Number(parts[parts.length >= 7 ? 6 : 5] || 0),
        weight: 1,
      };
    });
}

function parseRubricStudentScoresInput() {
  return String(document.getElementById("rubricStudentScores")?.value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("|").map((part) => part.trim());
      const scores = String(parts[2] || "")
        .split(/[,\s]+/)
        .map((score) => Number(score))
        .filter((score) => Number.isFinite(score));

      return {
        studentName: parts[0] || "",
        studentId: parts[1] || "",
        criterionScores: scores.map((score, criterionIndex) => ({
          criterionIndex,
          score,
        })),
      };
    });
}

function formatRubricTemplateCriteria(criteria = []) {
  return criteria
    .map(
      (criterion) =>
        [
          criterion.criterion || "",
          criterion.excellent || "",
          criterion.good || "",
          criterion.fair || "",
          criterion.needsImprovement || "",
          criterion.maxPoints || 0,
        ].join(" | "),
    )
    .join("\n");
}

function escapeAttribute(value) {
  return escapeHTML(value).replaceAll("'", "&#039;");
}

function renderRubricTemplateCriteriaTable(criteria = []) {
  const body = document.getElementById("rubricTemplateCriteriaBody");

  if (!body) return;

  const rows = criteria.length
    ? criteria
    : [
        {
          criterion: "",
          excellent: "",
          good: "",
          fair: "",
          needsImprovement: "",
          maxPoints: 0,
        },
      ];

  body.innerHTML = rows
    .map(
      (criterion, index) => `
        <tr>
          <td>
            <input
              data-rubric-template-field="criterion"
              value="${escapeAttribute(criterion.criterion || "")}"
              placeholder="Understanding of the Problem"
            />
          </td>
          <td>
            <textarea
              data-rubric-template-field="excellent"
              rows="3"
              placeholder="Clearly identifies all given information"
            >${escapeHTML(criterion.excellent || "")}</textarea>
          </td>
          <td>
            <textarea
              data-rubric-template-field="good"
              rows="3"
              placeholder="Identifies most relevant information"
            >${escapeHTML(criterion.good || "")}</textarea>
          </td>
          <td>
            <textarea
              data-rubric-template-field="fair"
              rows="3"
              placeholder="Shows partial understanding"
            >${escapeHTML(criterion.fair || "")}</textarea>
          </td>
          <td>
            <textarea
              data-rubric-template-field="needsImprovement"
              rows="3"
              placeholder="Misinterprets key information"
            >${escapeHTML(criterion.needsImprovement || "")}</textarea>
          </td>
          <td>
            <input
              data-rubric-template-field="maxPoints"
              type="number"
              min="0"
              step="0.5"
              value="${escapeAttribute(criterion.maxPoints || 0)}"
            />
          </td>
          <td>
            <button
              class="btn danger compact-btn"
              type="button"
              onclick="removeRubricTemplateCriteriaRow(${index})"
            >
              Remove
            </button>
          </td>
        </tr>
      `,
    )
    .join("");

  syncRubricTemplateCriteriaText();
}

function getRubricTemplateCriteriaTableRows() {
  return Array.from(
    document.querySelectorAll("#rubricTemplateCriteriaBody tr"),
  ).map((row) => {
    const getValue = (field) =>
      row
        .querySelector(`[data-rubric-template-field="${field}"]`)
        ?.value.trim() || "";

    return {
      criterion: getValue("criterion"),
      excellent: getValue("excellent"),
      good: getValue("good"),
      fair: getValue("fair"),
      needsImprovement: getValue("needsImprovement"),
      maxPoints: Number(getValue("maxPoints") || 0),
    };
  });
}

function syncRubricTemplateCriteriaText() {
  const criteriaInput = document.getElementById("rubricTemplateCriteria");

  if (!criteriaInput) return;

  criteriaInput.value = formatRubricTemplateCriteria(
    getRubricTemplateCriteriaTableRows(),
  );
}

function addRubricTemplateCriteriaRow() {
  const rows = getRubricTemplateCriteriaTableRows();

  rows.push({
    criterion: "",
    excellent: "",
    good: "",
    fair: "",
    needsImprovement: "",
    maxPoints: 0,
  });
  renderRubricTemplateCriteriaTable(rows);
}

function removeRubricTemplateCriteriaRow(index) {
  const rows = getRubricTemplateCriteriaTableRows();

  rows.splice(index, 1);
  renderRubricTemplateCriteriaTable(rows);
}

function parseRubricTemplateCriteriaInput() {
  syncRubricTemplateCriteriaText();

  return getRubricTemplateCriteriaTableRows().filter(
    (criterion) => criterion.criterion || Number(criterion.maxPoints || 0) > 0,
  );
}

function getSelectedRubricTemplate() {
  const id = document.getElementById("rubricTemplateType")?.value || "";
  return rubricTemplates.find((template) => template._id === id);
}

function renderRubricTemplateOptions() {
  const select = document.getElementById("rubricTemplateType");
  const criteriaInput = document.getElementById("rubricTemplateCriteria");

  if (!select || !criteriaInput) return;

  if (rubricTemplates.length === 0) {
    select.innerHTML = `<option value="">No rubric templates found</option>`;
    criteriaInput.value = "";
    renderRubricTemplateCriteriaTable([]);
    return;
  }

  const selected = select.value || rubricTemplates[0]._id;
  select.innerHTML = rubricTemplates
    .map(
      (template) => `
        <option value="${escapeHTML(template._id)}" ${template._id === selected ? "selected" : ""}>
          ${escapeHTML(template.name)}
        </option>
      `,
    )
    .join("");

  const template = getSelectedRubricTemplate() || rubricTemplates[0];
  select.value = template._id;
  criteriaInput.value = formatRubricTemplateCriteria(template.criteria || []);
  renderRubricTemplateCriteriaTable(template.criteria || []);
}

async function loadRubricTemplates() {
  try {
    const data = await apiRequest("/obe/rubric-templates");
    rubricTemplates = data.templates || [];
    renderRubricTemplateOptions();
  } catch (error) {
    setMessage("rubricImportMessage", getObeRouteErrorMessage(error));
  }
}

function getSelectedRubricTemplateExam() {
  const id = document.getElementById("rubricTemplateExam")?.value || "";
  return rubricTemplateExams.find((exam) => exam._id === id);
}

function renderRubricTemplateExamOptions() {
  const select = document.getElementById("rubricTemplateExam");

  if (!select) return;

  const selected = select.value;
  const options = [
    `<option value="">No linked exam - manual item mapping</option>`,
    ...rubricTemplateExams.map((exam) => {
      const labelParts = [
        exam.title || "Generated Exam",
        exam.subject,
        exam.section,
        `${exam.totalItems || 0} items`,
      ].filter(Boolean);

      return `
        <option value="${escapeHTML(exam._id)}" ${exam._id === selected ? "selected" : ""}>
          ${escapeHTML(labelParts.join(" - "))}
        </option>
      `;
    }),
  ];

  select.innerHTML = options.join("");
}

async function loadRubricTemplateExams() {
  const select = document.getElementById("rubricTemplateExam");

  if (!select) return;

  try {
    const data = await apiRequest("/users/me/activity");
    rubricTemplateExams = (data.exams || []).filter(
      (exam) =>
        exam.examType === "Problem Solving" &&
        (!exam.approvalStatus || exam.approvalStatus === "Approved"),
    );
    renderRubricTemplateExamOptions();
  } catch (error) {
    rubricTemplateExams = [];
    renderRubricTemplateExamOptions();
    setMessage("rubricImportMessage", getObeRouteErrorMessage(error));
  }
}

async function saveSelectedRubricTemplate() {
  const template = getSelectedRubricTemplate();

  if (!template) {
    setMessage("rubricImportMessage", "Choose a rubric template first.");
    return;
  }

  try {
    const data = await apiRequest(`/obe/rubric-templates/${template._id}`, "PUT", {
      name: template.name,
      description: template.description || "",
      criteria: parseRubricTemplateCriteriaInput(),
    });

    setMessage("rubricImportMessage", data.message, false);
    await loadRubricTemplates();
  } catch (error) {
    setMessage("rubricImportMessage", getObeRouteErrorMessage(error));
  }
}

async function loadRubrics() {
  try {
    const data = await apiRequest("/obe/rubrics");

    rubricAssessments = data.assessments || [];
    renderRubrics();
  } catch (error) {
    setMessage("rubricMessage", getObeRouteErrorMessage(error));
  }
}

function formatAttainmentChips(rows = []) {
  return rows.length
    ? rows
        .slice(0, 4)
        .map(
          (row) => `
            <span class="badge ${row.status === "Attained" ? "easy" : "difficult"}">
              ${escapeHTML(row.code)} ${row.attainmentRate || 0}%
            </span>
          `,
        )
        .join("")
    : `<span class="muted-text">No scores yet</span>`;
}

function renderRubrics() {
  const body = document.getElementById("rubricBody");

  if (!body) return;

  body.innerHTML = rubricAssessments.length
    ? rubricAssessments
        .map(
          (assessment) => `
            <tr>
              <td>
                <strong>${escapeHTML(assessment.title)}</strong>
                <small>${escapeHTML(assessment.assessmentMethod || "")} ${escapeHTML(assessment.assessmentPhase || "Summative")} ${escapeHTML(assessment.semester || "")}</small>
              </td>
              <td>${escapeHTML(assessment.subject)}</td>
              <td>${assessment.criteria?.length || 0}</td>
              <td>${assessment.studentScores?.length || 0}</td>
              <td>${formatAttainmentChips(assessment.attainment?.courseOutcomes)}</td>
              <td>${formatAttainmentChips(assessment.attainment?.studentOutcomes)}</td>
              <td>
                <button class="btn danger compact-btn" type="button" onclick="deleteRubric('${assessment._id}')">
                  Delete
                </button>
              </td>
            </tr>
          `,
        )
        .join("")
    : `<tr><td colspan="7" class="empty-table-cell">No rubric assessments saved yet.</td></tr>`;
}

document.getElementById("rubricForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const body = {
    title: document.getElementById("rubricTitle").value.trim(),
    subject: document.getElementById("rubricSubject").value.trim(),
    engineeringProgram: document.getElementById("rubricProgram").value,
    assessmentMethod: document.getElementById("rubricAssessmentMethod").value,
    assessmentPhase: document.getElementById("rubricAssessmentPhase").value,
    section: document.getElementById("rubricSection").value.trim(),
    semester: document.getElementById("rubricSemester").value.trim(),
    schoolYear: document.getElementById("rubricSchoolYear").value.trim(),
    criteria: parseRubricCriteriaInput(),
    studentScores: parseRubricStudentScoresInput(),
  };

  try {
    const data = await apiRequest("/obe/rubrics", "POST", body);
    setMessage("rubricMessage", data.message, false);
    document.getElementById("rubricForm").reset();
    await loadRubrics();
  } catch (error) {
    setMessage("rubricMessage", getObeRouteErrorMessage(error));
  }
});

async function downloadRubricTemplate() {
  try {
    setMessage("rubricImportMessage", "Preparing rubric template...", false);
    const selectedExam = getSelectedRubricTemplateExam();
    const items = selectedExam
      ? Math.max(1, Math.min(50, Number(selectedExam.totalItems || 1)))
      : Math.max(
          1,
          Math.min(
            50,
            Number(document.getElementById("rubricTemplateItems")?.value || 3),
          ),
        );
    const maxScore = Math.max(
      1,
      Number(document.getElementById("rubricTemplateMaxScore")?.value || 10),
    );
    const selectedTemplate = getSelectedRubricTemplate();
    const rubricType = selectedTemplate?.key || "problem-solving-standard";
    const targetScore = Math.round(maxScore * 0.75 * 100) / 100;
    const params = new URLSearchParams({
      rubricType,
      rubricTemplateId: selectedTemplate?._id || "",
      items: String(items),
      maxScore: String(maxScore),
      targetScore: String(targetScore),
    });

    if (selectedExam?._id) {
      params.set("generatedExamId", selectedExam._id);
    }

    const res = await fetch(`/api/obe/rubrics/template?${params}`, {
      headers: {
        Authorization: `Bearer ${getToken()}`,
      },
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.message || "Template download failed.");
    }

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `rubric-${rubricType}-${items}-items-template.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
    setMessage("rubricImportMessage", "Rubric template downloaded.", false);
  } catch (error) {
    setMessage("rubricImportMessage", error.message);
  }
}

document
  .getElementById("rubricImportForm")
  ?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const file = document.getElementById("rubricFile").files[0];
    const form = new FormData();

    if (file) {
      form.append("rubricFile", file);
    }

    try {
      const data = await apiRequest("/obe/rubrics/import", "POST", form, true);
      setMessage("rubricImportMessage", data.message, false);
      document.getElementById("rubricImportForm").reset();
      await loadRubrics();
    } catch (error) {
      setMessage("rubricImportMessage", getObeRouteErrorMessage(error));
    }
  });

document
  .getElementById("rubricTemplateType")
  ?.addEventListener("change", renderRubricTemplateOptions);

document
  .getElementById("rubricTemplateCriteriaBody")
  ?.addEventListener("input", syncRubricTemplateCriteriaText);

document
  .getElementById("rubricTemplateExam")
  ?.addEventListener("change", () => {
    const selectedExam = getSelectedRubricTemplateExam();
    const itemInput = document.getElementById("rubricTemplateItems");

    if (selectedExam && itemInput) {
      itemInput.value = Math.max(1, Math.min(50, Number(selectedExam.totalItems || 1)));
    }
  });

async function deleteRubric(id) {
  if (!confirm("Delete this rubric assessment?")) return;

  try {
    const data = await apiRequest(`/obe/rubrics/${id}`, "DELETE");
    setMessage("rubricMessage", data.message, false);
    await loadRubrics();
  } catch (error) {
    setMessage("rubricMessage", error.message);
  }
}

async function loadEvidence() {
  try {
    const data = await apiRequest("/obe/evidence");

    evidenceRecords = data.evidence || [];
    renderEvidence();
  } catch (error) {
    setMessage("evidenceMessage", getObeRouteErrorMessage(error));
  }
}

function renderEvidence() {
  const body = document.getElementById("evidenceBody");

  if (!body) return;

  body.innerHTML = evidenceRecords.length
    ? evidenceRecords
        .map(
          (evidence) => `
            <tr>
              <td>
                <strong>${escapeHTML(evidence.title)}</strong>
                <small>${escapeHTML(evidence.description || "")}</small>
              </td>
              <td>${escapeHTML(evidence.evidenceType)}</td>
              <td>${escapeHTML(evidence.assessmentPhase || "Summative")}</td>
              <td>
                ${escapeHTML(evidence.subject || "Not set")}
                <small>${escapeHTML(evidence.engineeringProgram || "")} ${escapeHTML(evidence.schoolYear || "")}</small>
              </td>
              <td>
                <span class="badge average">${escapeHTML(evidence.courseOutcome || "No CO")}</span>
                <span class="badge average">${escapeHTML(evidence.programOutcome || "No SO")}</span>
              </td>
              <td>
                ${
                  evidence.filePath
                    ? `<a href="${escapeHTML(evidence.filePath)}" target="_blank">${escapeHTML(evidence.originalName || evidence.fileName)}</a>`
                    : `<span class="muted-text">Metadata only</span>`
                }
              </td>
              <td>${new Date(evidence.createdAt).toLocaleDateString()}</td>
              <td>
                <button class="btn danger compact-btn" type="button" onclick="deleteEvidence('${evidence._id}')">
                  Delete
                </button>
              </td>
            </tr>
          `,
        )
        .join("")
    : `<tr><td colspan="8" class="empty-table-cell">No OBE evidence saved yet.</td></tr>`;
}

document.getElementById("evidenceForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const form = new FormData();
  [
    ["title", "evidenceTitle"],
    ["evidenceType", "evidenceType"],
    ["assessmentPhase", "evidenceAssessmentPhase"],
    ["subject", "evidenceSubject"],
    ["engineeringProgram", "evidenceProgram"],
    ["courseOutcome", "evidenceCourseOutcome"],
    ["programOutcome", "evidenceProgramOutcome"],
    ["section", "evidenceSection"],
    ["semester", "evidenceSemester"],
    ["schoolYear", "evidenceSchoolYear"],
    ["description", "evidenceDescription"],
  ].forEach(([field, id]) => form.append(field, document.getElementById(id).value.trim()));

  const file = document.getElementById("evidenceFile").files[0];
  if (file) form.append("file", file);

  try {
    const data = await apiRequest("/obe/evidence", "POST", form, true);
    setMessage("evidenceMessage", data.message, false);
    document.getElementById("evidenceForm").reset();
    await loadEvidence();
  } catch (error) {
    setMessage("evidenceMessage", getObeRouteErrorMessage(error));
  }
});

async function deleteEvidence(id) {
  if (!confirm("Delete this evidence record?")) return;

  try {
    const data = await apiRequest(`/obe/evidence/${id}`, "DELETE");
    setMessage("evidenceMessage", data.message, false);
    await loadEvidence();
  } catch (error) {
    setMessage("evidenceMessage", error.message);
  }
}

async function loadSnapshots() {
  try {
    const data = await apiRequest("/obe/attainment-snapshots");

    attainmentSnapshots = data.snapshots || [];
    renderSnapshots();
  } catch (error) {
    setMessage("snapshotMessage", getObeRouteErrorMessage(error));
  }
}

function renderSnapshots() {
  const body = document.getElementById("snapshotBody");

  if (!body) return;

  body.innerHTML = attainmentSnapshots.length
    ? attainmentSnapshots
        .map((snapshot) => {
          const summary = snapshot.summary || {};

          return `
            <tr>
              <td><strong>${escapeHTML(snapshot.title)}</strong></td>
              <td>${escapeHTML(snapshot.filterSummary || "All records")}</td>
              <td>${summary.attainedClos || 0} / ${summary.assessedClos || 0}</td>
              <td>${summary.attainedSos || 0} / ${summary.assessedSos || 0}</td>
              <td>${summary.overallAttainmentRate || 0}%</td>
              <td>
                <span class="badge ${summary.status === "Attained" ? "easy" : "average"}">
                  ${escapeHTML(summary.status || "No Evidence")}
                </span>
              </td>
              <td>${new Date(snapshot.createdAt).toLocaleDateString()}</td>
              <td>
                <button class="btn danger compact-btn" type="button" onclick="deleteSnapshot('${snapshot._id}')">
                  Delete
                </button>
              </td>
            </tr>
          `;
        })
        .join("")
    : `<tr><td colspan="8" class="empty-table-cell">No OBE snapshots captured yet.</td></tr>`;
}

document.getElementById("snapshotForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const body = {
    title: document.getElementById("snapshotTitle").value.trim(),
    engineeringProgram: document.getElementById("snapshotProgram").value,
    subject: document.getElementById("snapshotSubject").value.trim(),
    section: document.getElementById("snapshotSection").value.trim(),
    semester: document.getElementById("snapshotSemester").value.trim(),
    schoolYear: document.getElementById("snapshotSchoolYear").value.trim(),
    assessmentMethod: document.getElementById("snapshotAssessmentMethod").value,
  };

  try {
    const data = await apiRequest("/obe/attainment-snapshots", "POST", body);
    setMessage("snapshotMessage", data.message, false);
    document.getElementById("snapshotForm").reset();
    await loadSnapshots();
  } catch (error) {
    setMessage("snapshotMessage", getObeRouteErrorMessage(error));
  }
});

async function deleteSnapshot(id) {
  if (!confirm("Delete this attainment snapshot?")) return;

  try {
    const data = await apiRequest(`/obe/attainment-snapshots/${id}`, "DELETE");
    setMessage("snapshotMessage", data.message, false);
    await loadSnapshots();
  } catch (error) {
    setMessage("snapshotMessage", error.message);
  }
}

function getCurriculumMapFilters() {
  const department = document
    .getElementById("curriculumDepartmentFilter")
    ?.value.trim();
  const subject = document.getElementById("curriculumSubjectFilter")?.value.trim();

  return { department, subject };
}

async function loadCurriculumMapCourses() {
  try {
    const data = await apiRequest("/obe/curriculum-map-courses");
    curriculumCourses = data.courses || [];
    renderCurriculumCourses();
    setMessage("curriculumCourseMessage", "", false);
  } catch (error) {
    setMessage("curriculumCourseMessage", getObeRouteErrorMessage(error));
  }
}

async function loadCurriculumMap() {
  try {
    const params = new URLSearchParams();
    const { department, subject } = getCurriculumMapFilters();

    if (department) params.set("department", department);
    if (subject) params.set("subject", subject);

    const data = await apiRequest(
      `/obe/curriculum-map${params.toString() ? `?${params}` : ""}`,
    );
    curriculumMap = data.curriculumMap || {};
    curriculumMapPage = 1;
    renderCurriculumMap();
    setMessage("curriculumMapMessage", "", false);
  } catch (error) {
    setMessage("curriculumMapMessage", getObeRouteErrorMessage(error));
  }
}

function renderCurriculumAlignmentEditor(selectedAlignments = []) {
  const container = document.getElementById("curriculumCourseAlignments");
  if (!container) return;
  const department = String(
    document.getElementById("curriculumCourseDepartment")?.value || "",
  )
    .trim()
    .toLowerCase();
  const departmentStudentOutcomes = department
    ? studentOutcomes.filter(
        (outcome) =>
          String(outcome.department || "").trim().toLowerCase() === department,
      )
    : [];

  const selectedBySo = new Map(
    selectedAlignments.map((alignment) => [
      formatStudentOutcomeLink(alignment.studentOutcome),
      String(alignment.level || "").toUpperCase(),
    ]),
  );

  if (!department) {
    container.innerHTML = `<p class="muted-text">Type a department to show its Student Outcomes.</p>`;
    return;
  }

  container.innerHTML = departmentStudentOutcomes.length
    ? departmentStudentOutcomes
        .map((outcome) => {
          const code = formatStudentOutcomeLink(outcome.code);
          const level = selectedBySo.get(code) || "I";
          const checked = selectedBySo.has(code) ? "checked" : "";

          return `
            <div class="curriculum-alignment-row">
              <label>
                <input type="checkbox" value="${escapeHTML(code)}" ${checked} />
                <span>
                  <strong>${escapeHTML(outcome.code)}</strong>
                  <small>${escapeHTML(outcome.department)} - ${escapeHTML(outcome.description || "")}</small>
                </span>
              </label>
              <select aria-label="${escapeHTML(outcome.code)} alignment level">
                <option value="I" ${level === "I" ? "selected" : ""}>I - Introductory</option>
                <option value="E" ${level === "E" ? "selected" : ""}>E - Enabling</option>
                <option value="D" ${level === "D" ? "selected" : ""}>D - Demonstrative</option>
              </select>
            </div>
          `;
        })
        .join("")
    : `<p class="muted-text">No Student Outcomes found for this department.</p>`;
}

function getCurriculumCourseAlignments() {
  return Array.from(
    document.querySelectorAll("#curriculumCourseAlignments .curriculum-alignment-row"),
  )
    .filter((row) => row.querySelector('input[type="checkbox"]')?.checked)
    .map((row) => ({
      studentOutcome: row.querySelector('input[type="checkbox"]')?.value || "",
      level: row.querySelector("select")?.value || "",
    }));
}

function formatCurriculumAlignmentLevel(level = "") {
  const labels = {
    I: "Introductory",
    E: "Enabling",
    D: "Demonstrative",
  };
  const code = String(level || "").toUpperCase();

  return labels[code] ? `${code} - ${labels[code]}` : code;
}

function renderCurriculumCourses() {
  const body = document.getElementById("curriculumCourseBody");
  if (!body) return;

  body.innerHTML = curriculumCourses.length
    ? curriculumCourses
        .map(
          (course) => `
            <tr>
              <td>
                <strong>${escapeHTML(course.courseCode || "No code")}</strong>
                <small>${escapeHTML(course.subject || "")}</small>
              </td>
              <td>${escapeHTML(course.department || "No department")}</td>
              <td>${escapeHTML(course.units || "")}</td>
              <td>
                ${
                  course.alignments?.length
                    ? course.alignments
                        .map(
                          (alignment) => `
                            <span class="curriculum-alignment-chip">
                              SO ${escapeHTML(alignment.studentOutcome)}: ${escapeHTML(formatCurriculumAlignmentLevel(alignment.level))}
                            </span>
                          `,
                        )
                        .join("")
                    : `<span class="muted-text">No SO alignment</span>`
                }
              </td>
              <td>${escapeHTML(course.description || "")}</td>
              <td>
                <button class="btn secondary compact-btn" type="button" onclick="editCurriculumCourse('${course._id}')">
                  Edit
                </button>
                <button class="btn danger compact-btn" type="button" onclick="deleteCurriculumCourse('${course._id}')">
                  Delete
                </button>
              </td>
            </tr>
          `,
        )
        .join("")
    : `<tr><td colspan="6" class="empty-table-cell">No curriculum map courses saved yet.</td></tr>`;
}

async function downloadCurriculumMapExcel() {
  try {
    const res = await fetch("/api/obe/curriculum-map-courses/export", {
      headers: {
        Authorization: `Bearer ${getToken()}`,
      },
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.message || "Curriculum map download failed.");
    }

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const fileName =
      res
        .headers
        .get("Content-Disposition")
        ?.match(/filename="([^"]+)"/)?.[1] || "curriculum-map.xlsx";
    const link = document.createElement("a");

    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
    setMessage("curriculumCourseMessage", "Curriculum map Excel downloaded.", false);
  } catch (error) {
    setMessage("curriculumCourseMessage", getObeRouteErrorMessage(error));
  }
}

function renderPerformanceIndicatorOptions(selectedId = "") {
  const select = document.getElementById("performanceIndicatorOutcome");
  if (!select) return;

  select.innerHTML = studentOutcomes.length
    ? studentOutcomes
        .map(
          (outcome) => `
            <option value="${escapeHTML(outcome._id)}" ${outcome._id === selectedId ? "selected" : ""}>
              ${escapeHTML(outcome.department)} - ${escapeHTML(outcome.code)}
            </option>
          `,
        )
        .join("")
    : `<option value="">Add Student Outcomes first</option>`;
  renderPerformanceIndicatorEditor();
  renderPerformanceIndicatorSummary();
}

function getSelectedPerformanceIndicatorOutcome() {
  const selectedId =
    document.getElementById("performanceIndicatorOutcome")?.value || "";

  return studentOutcomes.find((outcome) => outcome._id === selectedId) || null;
}

function renderPerformanceIndicatorEditor() {
  const body = document.getElementById("performanceIndicatorRows");
  if (!body) return;

  const outcome = getSelectedPerformanceIndicatorOutcome();
  const rows =
    outcome?.performanceIndicatorRows?.length > 0
      ? outcome.performanceIndicatorRows
      : [{ piNumber: 1, description: "", weight: 1 }];

  body.innerHTML = rows.map(renderPerformanceIndicatorEditRow).join("");
}

function renderPerformanceIndicatorEditRow(row = {}) {
  return `
    <tr>
      <td>
        <input class="pi-number-input" type="number" min="1" step="1" value="${escapeHTML(row.piNumber || 1)}" />
      </td>
      <td>
        <input class="pi-description-input" required value="${escapeHTML(row.description || "")}" placeholder="Performance indicator description" />
      </td>
      <td>
        <input class="pi-weight-input" type="number" min="0" step="0.01" value="${escapeHTML(row.weight || 1)}" />
      </td>
      <td>
        <button class="btn danger compact-btn" type="button" onclick="removePerformanceIndicatorRow(this)">
          Remove
        </button>
      </td>
    </tr>
  `;
}

function normalizePerformanceIndicatorRow(row = {}, index = 0) {
  return {
    piNumber: Number(row.piNumber || index + 1) || index + 1,
    description: String(row.description || "").trim(),
    weight: Number(row.weight || 1) || 0,
    label: `PI ${Number(row.piNumber || index + 1) || index + 1}`,
  };
}

function addPerformanceIndicatorRow(row = {}) {
  const body = document.getElementById("performanceIndicatorRows");
  if (!body) return;

  const nextNumber =
    body.querySelectorAll("tr").length + 1;
  body.insertAdjacentHTML(
    "beforeend",
    renderPerformanceIndicatorEditRow({
      piNumber: row.piNumber || nextNumber,
      description: row.description || "",
      weight: row.weight || 1,
    }),
  );
}

function removePerformanceIndicatorRow(button) {
  const body = document.getElementById("performanceIndicatorRows");
  const row = button?.closest("tr");
  if (!body || !row) return;

  row.remove();

  if (body.querySelectorAll("tr").length === 0) {
    addPerformanceIndicatorRow();
  }
}

function getPerformanceIndicatorRows() {
  return Array.from(document.querySelectorAll("#performanceIndicatorRows tr"))
    .map((row, index) =>
      normalizePerformanceIndicatorRow(
        {
          piNumber: row.querySelector(".pi-number-input")?.value,
          description: row.querySelector(".pi-description-input")?.value,
          weight: row.querySelector(".pi-weight-input")?.value,
        },
        index,
      ),
    )
    .filter((row) => row.description);
}

function renderPerformanceIndicatorSummary() {
  const body = document.getElementById("performanceIndicatorSummaryBody");
  if (!body) return;
  const keyword = String(
    document.getElementById("performanceIndicatorSearch")?.value || "",
  )
    .trim()
    .toLowerCase();
  const visibleOutcomes = studentOutcomes.filter((outcome) => {
    const indicatorText = (outcome.performanceIndicatorRows || [])
      .map((row) => `${row.piNumber} ${row.description} ${row.weight}`)
      .join(" ");

    return [
      outcome.code,
      outcome.department,
      outcome.description,
      outcome.performanceIndicators,
      indicatorText,
    ]
      .join(" ")
      .toLowerCase()
      .includes(keyword);
  });

  body.innerHTML = visibleOutcomes.length
    ? visibleOutcomes
        .map((outcome) => {
          const rows = outcome.performanceIndicatorRows || [];

          return `
            <tr>
              <td>
                <strong>${escapeHTML(outcome.code)}</strong>
                <small>${escapeHTML(outcome.department || "")}</small>
              </td>
              <td>${escapeHTML(outcome.description || "")}</td>
              <td>
                ${
                  rows.length
                    ? rows
                        .map(
                          (row) => `
                            <small>
                              <strong>PI ${escapeHTML(row.piNumber)}:</strong>
                              ${escapeHTML(row.description)}
                              <span class="muted-text">Weight: ${escapeHTML(row.weight || 0)}</span>
                            </small>
                          `,
                        )
                        .join("")
                    : `<span class="muted-text">No PI rows saved</span>`
                }
              </td>
              <td>
                <button class="btn secondary compact-btn" type="button" onclick="selectPerformanceIndicatorOutcome('${outcome._id}')">
                  Edit PI
                </button>
              </td>
            </tr>
          `;
        })
        .join("")
    : `<tr><td colspan="4" class="empty-table-cell">${
        studentOutcomes.length
          ? "No performance indicators match your keyword."
          : "No Student Outcomes saved yet."
      }</td></tr>`;
}

function selectPerformanceIndicatorOutcome(id) {
  const select = document.getElementById("performanceIndicatorOutcome");
  if (!select) return;

  select.value = id;
  renderPerformanceIndicatorEditor();
  document.getElementById("performanceIndicatorForm").scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
}

function renderCurriculumMap() {
  const summary = curriculumMap?.summary || {};
  const rows = curriculumMap?.rows || [];
  const unmappedStudentOutcomes =
    curriculumMap?.unmappedStudentOutcomes || [];

  document.getElementById("curriculumSoCount").textContent =
    summary.studentOutcomeCount || 0;
  document.getElementById("curriculumPeoCount").textContent =
    summary.peoCount || 0;
  document.getElementById("curriculumCoCount").textContent =
    summary.courseOutcomeCount || 0;
  document.getElementById("curriculumMappedCoCount").textContent =
    summary.mappedCourseOutcomeCount || 0;
  document.getElementById("curriculumQuestionCount").textContent =
    summary.questionCoverageCount || 0;

  const totalPages = Math.max(
    1,
    Math.ceil(rows.length / curriculumMapRowsPerPage),
  );
  curriculumMapPage = Math.min(
    totalPages,
    Math.max(1, Number(curriculumMapPage) || 1),
  );
  const startIndex = (curriculumMapPage - 1) * curriculumMapRowsPerPage;
  const pageRows = rows.slice(
    startIndex,
    startIndex + curriculumMapRowsPerPage,
  );

  document.getElementById("curriculumMapBody").innerHTML = rows.length
    ? pageRows.map(renderCurriculumMapRow).join("")
    : `<tr><td colspan="7" class="empty-table-cell">No OBE alignment and assessment traceability rows found.</td></tr>`;
  renderCurriculumMapPagination(rows.length, totalPages);

  document.getElementById("unmappedStudentOutcomeList").innerHTML =
    unmappedStudentOutcomes.length > 0
      ? `
        <div class="curriculum-unmapped">
          <strong>SO rows without linked CO/CLO</strong>
          <div>
            ${unmappedStudentOutcomes
              .map(
                (outcome) => `
                  <span class="badge average">
                    ${escapeHTML(outcome.department)} - ${escapeHTML(outcome.code)}
                  </span>
                `,
              )
              .join("")}
          </div>
        </div>
      `
      : "";
}

function renderCurriculumMapPagination(totalItems, totalPages) {
  const pagination = document.getElementById("curriculumMapPagination");

  if (!pagination) return;

  const firstItem = totalItems
    ? (curriculumMapPage - 1) * curriculumMapRowsPerPage + 1
    : 0;
  const lastItem = Math.min(
    totalItems,
    curriculumMapPage * curriculumMapRowsPerPage,
  );

  pagination.innerHTML = `
    <span class="pagination-summary">
      Showing ${firstItem}-${lastItem} of ${totalItems} OBE alignment and assessment traceability rows
    </span>
    <div class="pagination-actions">
      <button class="btn secondary" type="button" onclick="goToCurriculumMapPage(${curriculumMapPage - 1})" ${curriculumMapPage <= 1 ? "disabled" : ""}>
        Previous
      </button>
      <span class="pagination-page">Page ${curriculumMapPage} of ${totalPages}</span>
      <button class="btn secondary" type="button" onclick="goToCurriculumMapPage(${curriculumMapPage + 1})" ${curriculumMapPage >= totalPages ? "disabled" : ""}>
        Next
      </button>
    </div>
  `;
}

function goToCurriculumMapPage(page) {
  curriculumMapPage = page;
  renderCurriculumMap();
}

function renderCurriculumMapRow(row) {
  const so = row.studentOutcome;
  const co = row.courseOutcome || {};
  const coverage = row.coverage || {};
  const linkedPeos = row.peos || [];
  const programs = coverage.programs || [];
  const questionCount = Number(coverage.questionCount || 0);

  return `
    <tr>
      <td>
        ${
          linkedPeos.length > 0
            ? linkedPeos
                .map(
                  (peo) => `
                    <strong>${escapeHTML(peo.code)}</strong>
                    <small>${escapeHTML(peo.description || "")}</small>
                  `,
                )
                .join("")
            : escapeHTML(formatPeoLinks(so?.peoLinks || "")) ||
              `<span class="muted-text">Not mapped</span>`
        }
      </td>
      <td>
        ${
          so
            ? `<strong>${escapeHTML(so.code)}</strong><small>${escapeHTML(so.description || "")}</small>`
            : `<span class="badge difficult">Unmapped SO</span>`
        }
      </td>
      <td>
        <strong>${escapeHTML(co.code || "No CO")}</strong>
        <small>${escapeHTML(co.description || "")}</small>
      </td>
      <td>
        ${escapeHTML(co.subject || "")}
        <small>${escapeHTML(co.department || "No department")}</small>
      </td>
      <td>${escapeHTML(co.bloomLevel || "Not set")}</td>
      <td>
        <span class="badge ${questionCount > 0 ? "easy" : "difficult"}">
          ${questionCount}
        </span>
      </td>
      <td>
        ${
          programs.length > 0
            ? programs
                .map(
                  (program) => `
                    <span class="curriculum-program-chip">
                      ${escapeHTML(program.engineeringProgram || "No program")}: ${program.questionCount}
                    </span>
                  `,
                )
                .join("")
            : `<span class="muted-text">No question evidence</span>`
        }
      </td>
    </tr>
  `;
}

document
  .getElementById("obeSettingsForm")
  .addEventListener("submit", async (event) => {
    event.preventDefault();

    const body = {
      courseOutcomeTarget: document.getElementById("courseOutcomeTarget").value,
      studentOutcomeTarget: document.getElementById("studentOutcomeTarget").value,
      attainmentMethod: document.getElementById("attainmentMethod").value,
    };

    try {
      const data = await apiRequest("/obe/settings", "PUT", body);
      const settings = data.settings || {};

      document.getElementById("courseOutcomeTarget").value =
        settings.courseOutcomeTarget ?? 75;
      document.getElementById("studentOutcomeTarget").value =
        settings.studentOutcomeTarget ?? 75;
      document.getElementById("attainmentMethod").value =
        settings.attainmentMethod || "response_based";
      setMessage("obeSettingsMessage", data.message, false);
    } catch (error) {
      setMessage("obeSettingsMessage", getObeRouteErrorMessage(error));
    }
  });

document
  .getElementById("curriculumCourseForm")
  ?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const body = {
      department: document.getElementById("curriculumCourseDepartment").value.trim(),
      courseCode: document.getElementById("curriculumCourseCode").value.trim(),
      subject: document.getElementById("curriculumCourseSubject").value.trim(),
      units: document.getElementById("curriculumCourseUnits").value,
      description: document
        .getElementById("curriculumCourseDescription")
        .value.trim(),
      alignments: getCurriculumCourseAlignments(),
    };

    try {
      const data = await apiRequest("/obe/curriculum-map-courses", "POST", body);
      setMessage("curriculumCourseMessage", data.message, false);
      document.getElementById("curriculumCourseForm").reset();
      renderCurriculumAlignmentEditor();
      await loadCurriculumMapCourses();
    } catch (error) {
      setMessage("curriculumCourseMessage", getObeRouteErrorMessage(error));
    }
  });

document
  .getElementById("curriculumCourseDepartment")
  ?.addEventListener("input", () => {
    renderCurriculumAlignmentEditor();
  });

document
  .getElementById("performanceIndicatorOutcome")
  ?.addEventListener("change", renderPerformanceIndicatorEditor);

document
  .getElementById("performanceIndicatorForm")
  ?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const outcome = getSelectedPerformanceIndicatorOutcome();

    if (!outcome) {
      setMessage("performanceIndicatorMessage", "Select a Student Outcome first.");
      return;
    }

    const performanceIndicatorDetails = getPerformanceIndicatorRows();

    if (performanceIndicatorDetails.length === 0) {
      setMessage(
        "performanceIndicatorMessage",
        "Enter at least one PI description before saving.",
      );
      return;
    }

    try {
      const data = await apiRequest(
        `/obe/student-outcomes/${outcome._id}/performance-indicators`,
        "PUT",
        { performanceIndicatorDetails },
      );
      setMessage("performanceIndicatorMessage", data.message, false);
      const selectedId = outcome._id;
      const savedRows = performanceIndicatorDetails.map((row, index) =>
        normalizePerformanceIndicatorRow(row, index),
      );

      studentOutcomes = studentOutcomes.map((item) =>
        item._id === selectedId
          ? {
              ...item,
              performanceIndicators: savedRows
                .map((row) => `${row.piNumber}. ${row.description}`)
                .join("\n"),
              performanceIndicatorRows: savedRows,
            }
          : item,
      );
      renderPerformanceIndicatorOptions(selectedId);
      await loadOutcomes();
      renderPerformanceIndicatorOptions(selectedId);
    } catch (error) {
      setMessage(
        "performanceIndicatorMessage",
        getObeRouteErrorMessage(error),
      );
    }
  });

function renderOutcomeOptions() {
  const departments = [
    ...new Set(
      [
        ...peos.map((peo) => peo.department),
        ...studentOutcomes.map((outcome) => outcome.department),
        ...outcomes.map((outcome) => outcome.department),
      ].filter(Boolean),
    ),
  ].sort();

  document.getElementById("departmentOptions").innerHTML = departments
    .map((department) => `<option value="${escapeHTML(department)}"></option>`)
    .join("");
  document.getElementById("studentOutcomeOptions").innerHTML = studentOutcomes
    .map(
      (outcome) =>
        `<option value="${escapeHTML(outcome.code)}">${escapeHTML(outcome.department)} - ${escapeHTML(outcome.description)}</option>`,
    )
    .join("");
  document.getElementById("soPeoLinks").innerHTML = peos.length
    ? peos
        .map(
          (peo) => `
            <label title="${escapeHTML(peo.description || "")}">
              <input type="checkbox" value="${escapeHTML(peo.code)}" />
              ${escapeHTML(peo.code)}
            </label>
          `,
        )
        .join("")
    : `<span class="muted-text">Add PEO records first.</span>`;
  renderCurriculumAlignmentEditor();
  renderPerformanceIndicatorOptions(
    document.getElementById("performanceIndicatorOutcome")?.value || "",
  );
}

function renderPeos() {
  const filter = String(document.getElementById("peoFilter")?.value || "")
    .toLowerCase()
    .trim();
  const visible = peos.filter((peo) =>
    [
      peo.department,
      peo.code,
      peo.description,
      peo.performanceIndicators,
    ]
      .join(" ")
      .toLowerCase()
      .includes(filter),
  );
  const totalPages = Math.max(1, Math.ceil(visible.length / peosPerPage));

  peoPage = Math.min(totalPages, Math.max(1, Number(peoPage) || 1));

  const startIndex = (peoPage - 1) * peosPerPage;
  const pageRows = visible.slice(startIndex, startIndex + peosPerPage);

  document.getElementById("peoBody").innerHTML = pageRows.length
    ? pageRows
        .map(
          (peo) => `
            <tr>
              <td>${escapeHTML(peo.department)}</td>
              <td><strong>${escapeHTML(peo.code)}</strong></td>
              <td>${escapeHTML(peo.description)}</td>
              <td>${escapeHTML(peo.performanceIndicators || "")}</td>
              <td>
                <button class="btn danger compact-btn" type="button" onclick="deletePeo('${peo._id}')">
                  Delete
                </button>
              </td>
            </tr>
          `,
        )
        .join("")
    : `<tr><td colspan="5" class="empty-table-cell">No PEO rows saved yet.</td></tr>`;
  renderPeoPagination(visible.length, totalPages);
}

function renderPeoPagination(totalItems, totalPages) {
  const pagination = document.getElementById("peoPagination");

  if (!pagination) return;

  const firstItem = totalItems ? (peoPage - 1) * peosPerPage + 1 : 0;
  const lastItem = Math.min(totalItems, peoPage * peosPerPage);

  pagination.innerHTML = `
    <span class="pagination-summary">
      Showing ${firstItem}-${lastItem} of ${totalItems} PEO rows
    </span>
    <div class="pagination-actions">
      <button class="btn secondary" type="button" onclick="goToPeoPage(${peoPage - 1})" ${peoPage <= 1 ? "disabled" : ""}>
        Previous
      </button>
      <span class="pagination-page">Page ${peoPage} of ${totalPages}</span>
      <button class="btn secondary" type="button" onclick="goToPeoPage(${peoPage + 1})" ${peoPage >= totalPages ? "disabled" : ""}>
        Next
      </button>
    </div>
  `;
}

function goToPeoPage(page) {
  peoPage = page;
  renderPeos();
}

function renderStudentOutcomes() {
  const filter = String(
    document.getElementById("studentOutcomeFilter").value || "",
  )
    .toLowerCase()
    .trim();
  const visible = studentOutcomes.filter((outcome) =>
    [
      outcome.department,
      outcome.code,
      outcome.description,
      outcome.performanceIndicators,
      outcome.graduateAttributes,
      outcome.peoLinks,
    ]
      .join(" ")
      .toLowerCase()
      .includes(filter),
  );
  const totalPages = Math.max(
    1,
    Math.ceil(visible.length / studentOutcomesPerPage),
  );

  studentOutcomePage = Math.min(
    totalPages,
    Math.max(1, Number(studentOutcomePage) || 1),
  );

  const startIndex = (studentOutcomePage - 1) * studentOutcomesPerPage;
  const pageRows = visible.slice(
    startIndex,
    startIndex + studentOutcomesPerPage,
  );

  document.getElementById("studentOutcomeBody").innerHTML = pageRows.length
    ? pageRows
        .map(
          (outcome) => `
            <tr>
              <td>${escapeHTML(outcome.department)}</td>
              <td><strong>${escapeHTML(outcome.code)}</strong></td>
              <td>${escapeHTML(outcome.description)}</td>
              <td>${escapeHTML(outcome.performanceIndicators || "")}</td>
              <td>${escapeHTML(outcome.graduateAttributes || "")}</td>
              <td>${escapeHTML(formatPeoLinks(outcome.peoLinks))}</td>
              <td>
                <button class="btn danger compact-btn" type="button" onclick="deleteStudentOutcome('${outcome._id}')">
                  Delete
                </button>
              </td>
            </tr>
          `,
        )
        .join("")
    : `<tr><td colspan="7" class="empty-table-cell">No Student Outcomes saved yet.</td></tr>`;
  renderStudentOutcomePagination(visible.length, totalPages);
}

function renderStudentOutcomePagination(totalItems, totalPages) {
  const pagination = document.getElementById("studentOutcomePagination");

  if (!pagination) return;

  const firstItem = totalItems
    ? (studentOutcomePage - 1) * studentOutcomesPerPage + 1
    : 0;
  const lastItem = Math.min(
    totalItems,
    studentOutcomePage * studentOutcomesPerPage,
  );

  pagination.innerHTML = `
    <span class="pagination-summary">
      Showing ${firstItem}-${lastItem} of ${totalItems} student outcomes
    </span>
    <div class="pagination-actions">
      <button class="btn secondary" type="button" onclick="goToStudentOutcomePage(${studentOutcomePage - 1})" ${studentOutcomePage <= 1 ? "disabled" : ""}>
        Previous
      </button>
      <span class="pagination-page">Page ${studentOutcomePage} of ${totalPages}</span>
      <button class="btn secondary" type="button" onclick="goToStudentOutcomePage(${studentOutcomePage + 1})" ${studentOutcomePage >= totalPages ? "disabled" : ""}>
        Next
      </button>
    </div>
  `;
}

function goToStudentOutcomePage(page) {
  studentOutcomePage = page;
  renderStudentOutcomes();
}

function renderOutcomes() {
  const filter = String(document.getElementById("outcomeFilter").value || "")
    .toLowerCase()
    .trim();
  const visible = outcomes.filter((outcome) =>
    [
      outcome.subject,
      outcome.department,
      outcome.code,
      outcome.description,
      outcome.programOutcome,
      outcome.bloomLevel,
      outcome.keywords,
    ]
      .join(" ")
      .toLowerCase()
      .includes(filter),
  );
  const totalPages = Math.max(
    1,
    Math.ceil(visible.length / courseOutcomesPerPage),
  );

  courseOutcomePage = Math.min(
    totalPages,
    Math.max(1, Number(courseOutcomePage) || 1),
  );

  const startIndex = (courseOutcomePage - 1) * courseOutcomesPerPage;
  const pageRows = visible.slice(
    startIndex,
    startIndex + courseOutcomesPerPage,
  );

  document.getElementById("outcomeBody").innerHTML = pageRows.length
    ? pageRows
        .map(
          (outcome) => `
            <tr>
              <td>${escapeHTML(outcome.subject)}</td>
              <td>${escapeHTML(outcome.department || "Not set")}</td>
              <td><strong>${escapeHTML(outcome.code)}</strong></td>
              <td>${escapeHTML(outcome.description)}</td>
              <td>${escapeHTML(formatStudentOutcomeLink(outcome.programOutcome) || "Not mapped")}</td>
              <td>${escapeHTML(outcome.bloomLevel || "Not set")}</td>
              <td>${escapeHTML(outcome.keywords || "")}</td>
              <td>
                <button class="btn secondary compact-btn" type="button" onclick="editOutcome('${outcome._id}')">
                  Edit
                </button>
                <button class="btn danger compact-btn" type="button" onclick="deleteOutcome('${outcome._id}')">
                  Delete
                </button>
              </td>
            </tr>
          `,
        )
        .join("")
    : `<tr><td colspan="8" class="empty-table-cell">No CO/CLO rows saved yet.</td></tr>`;
  renderCourseOutcomePagination(visible.length, totalPages);
}

function renderCourseOutcomePagination(totalItems, totalPages) {
  const pagination = document.getElementById("courseOutcomePagination");

  if (!pagination) return;

  const firstItem = totalItems
    ? (courseOutcomePage - 1) * courseOutcomesPerPage + 1
    : 0;
  const lastItem = Math.min(
    totalItems,
    courseOutcomePage * courseOutcomesPerPage,
  );

  pagination.innerHTML = `
    <span class="pagination-summary">
      Showing ${firstItem}-${lastItem} of ${totalItems} CO/CLO rows
    </span>
    <div class="pagination-actions">
      <button class="btn secondary" type="button" onclick="goToCourseOutcomePage(${courseOutcomePage - 1})" ${courseOutcomePage <= 1 ? "disabled" : ""}>
        Previous
      </button>
      <span class="pagination-page">Page ${courseOutcomePage} of ${totalPages}</span>
      <button class="btn secondary" type="button" onclick="goToCourseOutcomePage(${courseOutcomePage + 1})" ${courseOutcomePage >= totalPages ? "disabled" : ""}>
        Next
      </button>
    </div>
  `;
}

function goToCourseOutcomePage(page) {
  courseOutcomePage = page;
  renderOutcomes();
}

document.getElementById("peoForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const body = {
    department: document.getElementById("peoDepartment").value.trim(),
    code: document.getElementById("peoCode").value.trim(),
    description: document.getElementById("peoDescription").value.trim(),
    performanceIndicators: document
      .getElementById("peoPerformanceIndicators")
      .value.trim(),
  };

  try {
    const data = await apiRequest("/obe/peos", "POST", body);
    setMessage("peoMessage", data.message, false);
    document.getElementById("peoForm").reset();
    await loadOutcomes();
  } catch (error) {
    setMessage("peoMessage", getObeRouteErrorMessage(error));
  }
});

document
  .getElementById("bulkPeoForm")
  .addEventListener("submit", async (event) => {
    event.preventDefault();

    const body = {
      department: document.getElementById("bulkPeoDepartment").value.trim(),
      bulkText: document.getElementById("bulkPeoText").value,
    };

    try {
      const data = await apiRequest("/obe/peos/import", "POST", body);
      setMessage("bulkPeoMessage", data.message, false);
      document.getElementById("bulkPeoForm").reset();
      await loadOutcomes();
    } catch (error) {
      setMessage("bulkPeoMessage", getObeRouteErrorMessage(error));
    }
  });

document
  .getElementById("studentOutcomeForm")
  .addEventListener("submit", async (event) => {
    event.preventDefault();

    const body = {
      department: document.getElementById("soDepartment").value.trim(),
      code: document.getElementById("soCode").value.trim(),
      description: document.getElementById("soDescription").value.trim(),
      performanceIndicators: document
        .getElementById("soPerformanceIndicators")
        .value.trim(),
      graduateAttributes: getCheckedValues("soGraduateAttributes").join(", "),
      peoLinks: getCheckedValues("soPeoLinks").join(", "),
    };

    try {
      const data = await apiRequest("/obe/student-outcomes", "POST", body);
      setMessage("studentOutcomeMessage", data.message, false);
      document.getElementById("studentOutcomeForm").reset();
      clearCheckedValues("soGraduateAttributes");
      clearCheckedValues("soPeoLinks");
      await loadOutcomes();
    } catch (error) {
      setMessage(
        "studentOutcomeMessage",
        getObeRouteErrorMessage(error),
      );
    }
  });

function getCheckedValues(groupId) {
  return Array.from(
    document.querySelectorAll(`#${groupId} input[type="checkbox"]:checked`),
  ).map((input) => input.value);
}

function formatPeoLinks(value = "") {
  return String(value || "")
    .split(/[,\s]+/)
    .map((item) => {
      const code = item.replace(/^PEO[-\s]*/i, "").trim();
      return code ? `PEO${code}`.toUpperCase() : "";
    })
    .filter(Boolean)
    .join(", ");
}

function formatStudentOutcomeLink(value = "") {
  return String(value || "")
    .split(/[,\s]+/)
    .map((item) =>
      item
        .replace(/^SO[-\s]*/i, "")
        .trim()
        .toLowerCase(),
    )
    .filter(Boolean)
    .join(", ");
}

function clearCheckedValues(groupId) {
  document
    .querySelectorAll(`#${groupId} input[type="checkbox"]`)
    .forEach((input) => {
      input.checked = false;
    });
}

document
  .getElementById("bulkStudentOutcomeForm")
  .addEventListener("submit", async (event) => {
    event.preventDefault();

    const body = {
      department: document.getElementById("bulkSoDepartment").value.trim(),
      bulkText: document.getElementById("bulkSoText").value,
    };

    try {
      const data = await apiRequest(
        "/obe/student-outcomes/import",
        "POST",
        body,
      );
      setMessage("bulkStudentOutcomeMessage", data.message, false);
      document.getElementById("bulkStudentOutcomeForm").reset();
      await loadOutcomes();
    } catch (error) {
      setMessage(
        "bulkStudentOutcomeMessage",
        getObeRouteErrorMessage(error),
      );
    }
  });

document.getElementById("outcomeForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const body = {
    department: document.getElementById("department").value.trim(),
    subject: document.getElementById("subject").value.trim(),
    code: document.getElementById("code").value.trim(),
    description: document.getElementById("description").value.trim(),
    programOutcome: formatStudentOutcomeLink(
      document.getElementById("programOutcome").value,
    ),
    bloomLevel: document.getElementById("bloomLevel").value,
    keywords: document.getElementById("keywords").value.trim(),
  };

  try {
    const endpoint = editingCourseOutcomeId
      ? `/obe/course-outcomes/${editingCourseOutcomeId}`
      : "/obe/course-outcomes";
    const method = editingCourseOutcomeId ? "PUT" : "POST";
    const data = await apiRequest(endpoint, method, body);

    setMessage("outcomeMessage", data.message, false);
    resetOutcomeForm();
    await loadOutcomes();
  } catch (error) {
    setMessage("outcomeMessage", error.message);
  }
});

document
  .getElementById("cancelOutcomeEditButton")
  ?.addEventListener("click", () => {
    resetOutcomeForm();
    setMessage("outcomeMessage", "", false);
  });

document
  .getElementById("bulkOutcomeForm")
  .addEventListener("submit", async (event) => {
    event.preventDefault();

    const body = {
      subject: document.getElementById("bulkSubject").value.trim(),
      department: document.getElementById("bulkDepartment").value.trim(),
      bulkText: document.getElementById("bulkText").value,
    };

    try {
      const data = await apiRequest("/obe/course-outcomes/import", "POST", body);
      setMessage("bulkOutcomeMessage", data.message, false);
      document.getElementById("bulkOutcomeForm").reset();
      await loadOutcomes();
    } catch (error) {
      setMessage("bulkOutcomeMessage", error.message);
    }
  });

document.getElementById("outcomeFilter").addEventListener("input", () => {
  courseOutcomePage = 1;
  renderOutcomes();
});
document.getElementById("peoFilter").addEventListener("input", () => {
  peoPage = 1;
  renderPeos();
});
document
  .getElementById("studentOutcomeFilter")
  .addEventListener("input", () => {
    studentOutcomePage = 1;
    renderStudentOutcomes();
  });
document
  .getElementById("performanceIndicatorSearch")
  ?.addEventListener("input", renderPerformanceIndicatorSummary);
document
  .getElementById("curriculumDepartmentFilter")
  ?.addEventListener("change", () => {
    loadCurriculumMap();
  });
document
  .getElementById("curriculumSubjectFilter")
  ?.addEventListener("change", () => {
    loadCurriculumMap();
  });
document.querySelectorAll("[data-obe-tab]").forEach((tab) => {
  tab.addEventListener("click", () => {
    showObeSubpage(tab.getAttribute("data-obe-tab"));
  });
});
window.addEventListener("hashchange", () => showObeSubpage());

async function deleteOutcome(id) {
  if (!confirm("Delete this CO/CLO row?")) return;

  try {
    const data = await apiRequest(`/obe/course-outcomes/${id}`, "DELETE");
    setMessage("outcomeMessage", data.message, false);
    await loadOutcomes();
  } catch (error) {
    setMessage("outcomeMessage", error.message);
  }
}

function editOutcome(id) {
  const outcome = outcomes.find((item) => item._id === id);

  if (!outcome) {
    setMessage("outcomeMessage", "CO/CLO row not found.");
    return;
  }

  editingCourseOutcomeId = id;
  document.getElementById("department").value = outcome.department || "";
  document.getElementById("subject").value = outcome.subject || "";
  document.getElementById("code").value = outcome.code || "";
  document.getElementById("description").value = outcome.description || "";
  document.getElementById("programOutcome").value =
    formatStudentOutcomeLink(outcome.programOutcome) || "";
  document.getElementById("bloomLevel").value = outcome.bloomLevel || "";
  document.getElementById("keywords").value = outcome.keywords || "";
  document.getElementById("outcomeFormTitle").textContent = "Edit CO/CLO";
  document.getElementById("outcomeSubmitButton").textContent = "Update CO/CLO";
  document
    .getElementById("cancelOutcomeEditButton")
    ?.classList.remove("hidden");
  document.getElementById("outcomeForm").scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
}

function editCurriculumCourse(id) {
  const course = curriculumCourses.find((item) => item._id === id);

  if (!course) {
    setMessage("curriculumCourseMessage", "Curriculum map course not found.");
    return;
  }

  document.getElementById("curriculumCourseDepartment").value =
    course.department || "";
  document.getElementById("curriculumCourseCode").value = course.courseCode || "";
  document.getElementById("curriculumCourseSubject").value = course.subject || "";
  document.getElementById("curriculumCourseUnits").value = course.units || "";
  document.getElementById("curriculumCourseDescription").value =
    course.description || "";
  renderCurriculumAlignmentEditor(course.alignments || []);
  document.getElementById("curriculumCourseForm").scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
}

async function deleteCurriculumCourse(id) {
  if (!confirm("Delete this curriculum map course?")) return;

  try {
    const data = await apiRequest(`/obe/curriculum-map-courses/${id}`, "DELETE");
    setMessage("curriculumCourseMessage", data.message, false);
    await loadCurriculumMapCourses();
  } catch (error) {
    setMessage("curriculumCourseMessage", getObeRouteErrorMessage(error));
  }
}

function resetOutcomeForm() {
  editingCourseOutcomeId = null;
  document.getElementById("outcomeForm").reset();
  document.getElementById("outcomeFormTitle").textContent = "Add CO/CLO";
  document.getElementById("outcomeSubmitButton").textContent = "Save CO/CLO";
  document
    .getElementById("cancelOutcomeEditButton")
    ?.classList.add("hidden");
}

async function deleteStudentOutcome(id) {
  if (!confirm("Delete this Student Outcome row?")) return;

  try {
    const data = await apiRequest(`/obe/student-outcomes/${id}`, "DELETE");
    setMessage("studentOutcomeMessage", data.message, false);
    await loadOutcomes();
  } catch (error) {
    setMessage("studentOutcomeMessage", error.message);
  }
}

async function deletePeo(id) {
  if (!confirm("Delete this PEO row? Existing SO links will remain as text until updated.")) {
    return;
  }

  try {
    const data = await apiRequest(`/obe/peos/${id}`, "DELETE");
    setMessage("peoMessage", data.message, false);
    await loadOutcomes();
  } catch (error) {
    setMessage("peoMessage", error.message);
  }
}

function getObeRouteErrorMessage(error) {
  return error.message === "Route not found"
    ? "OBE route not loaded yet. Restart the Node server, then reload this page."
    : error.message;
}

applyObeRoleMode();
loadObeSettings();
showObeSubpage();
loadOutcomes();
loadRubricTemplates();
loadRubricTemplateExams();
