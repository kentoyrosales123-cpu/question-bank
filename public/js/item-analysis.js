protectPage();

const analysisUser = getUser();
let analysisId = location.pathname.split("/").filter(Boolean).pop();
let chartInstances = [];
let attainmentRowsByKey = new Map();

if (analysisUser && !canUseItemAnalysisRole(analysisUser)) {
  alert("Item analysis is for exam users only.");
  location.href = getDashboardUrl(analysisUser);
}

async function loadAnalysis() {
  try {
    const data = await apiRequest(`/item-analysis/${analysisId}`);
    const analysis = data.analysis;
    const summary = analysis.summary;

    document.getElementById("analysisTitle").textContent = analysis.exam.title;
    document.getElementById("analysisSubtitle").textContent =
      `${analysis.exam.subject} - ${analysis.exam.section}`;
    document.getElementById("totalStudents").textContent = summary.totalStudents;
    document.getElementById("averageScore").textContent =
      `${summary.averageScore} / ${summary.numberOfItems}`;
    document.getElementById("itemsForRevision").textContent =
      summary.itemsForRevision;
    document.getElementById("weakItems").textContent = summary.weakItems;

    document.getElementById("analysisBody").innerHTML = analysis.items
      .map(renderAnalysisRow)
      .join("");

    renderRecommendationPanel(summary);
    renderObeAttainment(analysis.obeAttainment);
    renderCharts(analysis.items);
  } catch (error) {
    setMessage("analysisMessage", error.message);
  }
}

function renderObeAttainment(obeAttainment = {}) {
  const message = document.getElementById("obeAttainmentMessage");
  attainmentRowsByKey = new Map();

  if (!obeAttainment.available) {
    message.textContent =
      obeAttainment.message ||
      "Link this item analysis to a generated exam to compute CO/SO attainment.";
  } else {
    message.textContent =
      "CO/SO/Bloom attainment computed from actual uploaded student responses.";
  }

  renderAttainmentTable(
    "coAttainmentBody",
    obeAttainment.courseOutcomes || [],
    "CO/CLO",
    "CO",
  );
  renderAttainmentTable(
    "soAttainmentBody",
    obeAttainment.studentOutcomes || [],
    "SO",
    "SO",
  );
  renderAttainmentTable(
    "bloomAttainmentBody",
    obeAttainment.bloomLevels || [],
    "Bloom",
    "Bloom",
  );
}

function renderAttainmentTable(bodyId, rows, label, outcomeType) {
  const body = document.getElementById(bodyId);

  if (!body) return;

  body.innerHTML = rows.length
    ? rows.map((row) => renderAttainmentRow(row, outcomeType)).join("")
    : `<tr><td colspan="${outcomeType === "Bloom" ? 8 : 9}" class="empty-table-cell">No ${escapeHTML(label)} attainment data.</td></tr>`;
}

function getAttainmentClass(rate, targetRate = 75) {
  const target = Number(targetRate ?? 75);

  if (Number(rate) >= target) return "easy";
  if (Number(rate) >= target * (2 / 3)) return "average";
  return "difficult";
}

function renderAttainmentRow(row, outcomeType) {
  const statusClass = row.status === "Attained" ? "easy" : "difficult";
  const cqiKey = `${outcomeType}:${row.code}`;

  if (outcomeType === "CO" || outcomeType === "SO") {
    attainmentRowsByKey.set(cqiKey, row);
  }

  return `
    <tr>
      <td><strong>${escapeHTML(row.code)}</strong></td>
      <td>${row.itemCount || 0}</td>
      <td>${row.responseCount || 0}</td>
      <td>${row.correctCount || 0}</td>
      <td>${row.earnedWeight || 0} / ${row.totalWeight || 0}</td>
      <td>${row.targetRate ?? 75}%</td>
      <td><span class="badge ${getAttainmentClass(row.attainmentRate, row.targetRate)}">${row.attainmentRate || 0}%</span></td>
      <td><span class="badge ${statusClass}">${escapeHTML(row.status || "Not assessed")}</span></td>
      ${
        outcomeType === "CO" || outcomeType === "SO"
          ? `<td>${renderCqiAction(row, outcomeType)}</td>`
          : ""
      }
    </tr>
  `;
}

function renderCqiAction(row, outcomeType) {
  const plan = row.cqiPlan;
  const needsPlan = row.status === "Not attained";
  const buttonLabel = plan ? "Update Plan" : needsPlan ? "Create Plan" : "Add Plan";
  const status = plan
    ? `<span class="badge ${plan.status === "Verified" ? "easy" : "average"}">${escapeHTML(plan.status)}</span>`
    : needsPlan
      ? `<span class="badge difficult">Needed</span>`
      : `<span class="badge easy">Optional</span>`;
  const quickAction = renderCqiQuickAction(row, outcomeType);

  return `
    <div class="cqi-action">
      ${status}
      <button class="btn secondary compact-btn" type="button" onclick="openCqiPlanModal('${escapeAttribute(outcomeType)}', '${escapeAttribute(row.code)}')">
        ${buttonLabel}
      </button>
      ${quickAction}
    </div>
  `;
}

function renderCqiQuickAction(row, outcomeType) {
  const plan = row.cqiPlan;

  if (!plan) return "";

  const outcome = escapeAttribute(outcomeType);
  const code = escapeAttribute(row.code);

  if (plan.status === "Planned") {
    return `
      <button class="btn compact-btn cqi-status-btn" type="button" onclick="quickUpdateCqiStatus('${outcome}', '${code}', 'In Progress')">
        Start
      </button>
    `;
  }

  if (plan.status === "In Progress") {
    return `
      <button class="btn compact-btn cqi-status-btn" type="button" onclick="quickUpdateCqiStatus('${outcome}', '${code}', 'Completed')">
        Complete
      </button>
    `;
  }

  if (plan.status === "Completed") {
    return `
      <button class="btn compact-btn cqi-status-btn" type="button" onclick="openCqiVerificationModal('${outcome}', '${code}')">
        Verify
      </button>
    `;
  }

  return "";
}

function escapeAttribute(value) {
  return escapeHTML(value).replaceAll("'", "&#39;");
}

function toDateInputValue(value) {
  if (!value) return "";
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "";

  return date.toISOString().slice(0, 10);
}

function openCqiPlanModal(outcomeType, outcomeCode) {
  const row = attainmentRowsByKey.get(`${outcomeType}:${outcomeCode}`) || {};
  const plan = row.cqiPlan || {};

  document.getElementById("cqiOutcomeType").value = outcomeType;
  document.getElementById("cqiOutcomeCode").value = outcomeCode;
  document.getElementById("cqiPlanTitle").textContent =
    `${outcomeType} ${outcomeCode} CQI Intervention Plan`;
  document.getElementById("cqiPlanSubtitle").textContent =
    `Attainment: ${row.attainmentRate || 0}% / Target: ${row.targetRate ?? 75}%`;
  document.getElementById("cqiRootCause").value = plan.rootCause || "";
  document.getElementById("cqiIntervention").value = plan.intervention || "";
  document.getElementById("cqiResponsiblePerson").value =
    plan.responsiblePerson || analysisUser?.name || "";
  document.getElementById("cqiTargetDate").value = toDateInputValue(plan.targetDate);
  document.getElementById("cqiStatus").value = plan.status || "Planned";
  document.getElementById("cqiEvidence").value = plan.evidence || "";
  document.getElementById("cqiRemarks").value = plan.remarks || "";
  document.getElementById("cqiImplementationDate").value = toDateInputValue(
    plan.implementationDate,
  );
  document.getElementById("cqiReassessmentResult").value =
    plan.reassessmentResult || "";
  document.getElementById("cqiVerificationRemarks").value =
    plan.verificationRemarks || "";
  document.getElementById("cqiFollowUpDecision").value =
    plan.followUpDecision || "";
  setMessage("cqiPlanMessage", "", false);
  document.getElementById("cqiPlanModal").classList.remove("hidden");
}

function closeCqiPlanModal() {
  document.getElementById("cqiPlanModal")?.classList.add("hidden");
}

function openCqiVerificationModal(outcomeType, outcomeCode) {
  openCqiPlanModal(outcomeType, outcomeCode);
  document.getElementById("cqiStatus").value = "Verified";

  if (!document.getElementById("cqiReassessmentResult").value) {
    suggestCqiVerification();
  }
}

function getActiveCqiRow() {
  const outcomeType = document.getElementById("cqiOutcomeType").value;
  const outcomeCode = document.getElementById("cqiOutcomeCode").value;

  return attainmentRowsByKey.get(`${outcomeType}:${outcomeCode}`) || {};
}

function buildCqiSuggestion(row) {
  const targetRate = Number(row.targetRate ?? 75);
  const attainmentRate = Number(row.attainmentRate || 0);
  const gap = Math.max(0, targetRate - attainmentRate);
  const itemCount = Number(row.itemCount || 0);
  const responseCount = Number(row.responseCount || 0);
  const correctCount = Number(row.correctCount || 0);
  const outcomeCode = row.code || "the selected outcome";
  const evidenceNotes = [];
  const actionNotes = [];

  let rootCause =
    `${outcomeCode} did not meet the ${targetRate}% attainment target. ` +
    `The current result is ${attainmentRate}%, based on ${correctCount} correct responses out of ${responseCount}.`;
  let intervention =
    "Conduct targeted remediation for the learning competencies linked to this outcome, then reassess using aligned items in the next assessment cycle.";

  if (gap <= 5) {
    rootCause +=
      " The gap is small, which suggests partial mastery but inconsistent performance across the assessed items.";
    intervention =
      "Provide a focused review session on the least-mastered concepts, give short guided practice activities, review the items with low performance, and reassess the outcome through a formative quiz or equivalent activity.";
  } else if (gap <= 20) {
    rootCause +=
      " The gap is moderate, which suggests that several students need additional support on the prerequisite concepts and application tasks.";
    intervention =
      "Reteach the key concepts connected to this outcome, provide additional worked examples and practice exercises, conduct consultation or tutorial sessions, revise unclear assessment items if needed, and reassess the outcome in the next major activity.";
  } else {
    rootCause +=
      " The gap is large, which suggests a broader issue in instructional coverage, student preparedness, item alignment, or assessment design.";
    intervention =
      "Review the course content coverage, teaching strategy, assessment alignment, and item quality for this outcome. Implement reteaching sessions, scaffolded practice, revised instructional materials, and a redesigned aligned assessment before the next attainment review.";
  }

  if (responseCount < 10) {
    evidenceNotes.push(
      "Response count is low; collect additional assessment evidence before making a final attainment judgment.",
    );
    actionNotes.push(
      "Increase the number of student responses or include another aligned assessment before closing the CQI cycle.",
    );
  }

  if (itemCount < 3) {
    evidenceNotes.push(
      "Only a few items assessed this outcome; coverage may be too narrow.",
    );
    actionNotes.push(
      "Add more outcome-aligned items in future assessments to improve evidence quality.",
    );
  }

  return {
    rootCause,
    intervention: [intervention, ...actionNotes].join("\n\n"),
    evidence:
      evidenceNotes.length > 0
        ? evidenceNotes.join(" ")
        : "Item analysis results, OBE attainment table, and class performance summary.",
    remarks:
      "Monitor implementation and compare the reassessment result against the configured attainment target.",
  };
}

function suggestCqiPlan() {
  const row = getActiveCqiRow();
  const suggestion = buildCqiSuggestion(row);

  document.getElementById("cqiRootCause").value = suggestion.rootCause;
  document.getElementById("cqiIntervention").value = suggestion.intervention;
  document.getElementById("cqiEvidence").value = suggestion.evidence;
  document.getElementById("cqiRemarks").value = suggestion.remarks;
  setMessage("cqiPlanMessage", "Suggested CQI plan added. Review and edit before saving.", false);
}

function buildCqiVerificationSuggestion(row) {
  const targetRate = Number(row.targetRate ?? 75);
  const attainmentRate = Number(row.attainmentRate || 0);
  const outcomeCode = row.code || "the selected outcome";
  const attained = attainmentRate >= targetRate;

  return {
    reassessmentResult:
      `After implementing the intervention for ${outcomeCode}, reassessment evidence should be compared against the ${targetRate}% target. ` +
      `Current recorded attainment is ${attainmentRate}%. Attach or reference the follow-up assessment, class activity output, or updated item analysis used for verification.`,
    verificationRemarks: attained
      ? "The outcome meets the target based on the reviewed evidence. The CQI loop may be closed, subject to coordinator approval and evidence retention."
      : "The outcome has not yet met the target based on the reviewed evidence. Continue the intervention, collect additional evidence, and reassess in the next cycle.",
    followUpDecision: attained ? "Closed" : "Needs Further Action",
  };
}

function suggestCqiVerification() {
  const row = getActiveCqiRow();
  const suggestion = buildCqiVerificationSuggestion(row);

  document.getElementById("cqiReassessmentResult").value =
    suggestion.reassessmentResult;
  document.getElementById("cqiVerificationRemarks").value =
    suggestion.verificationRemarks;
  document.getElementById("cqiFollowUpDecision").value =
    suggestion.followUpDecision;

  if (!document.getElementById("cqiImplementationDate").value) {
    document.getElementById("cqiImplementationDate").value =
      new Date().toISOString().slice(0, 10);
  }

  setMessage(
    "cqiPlanMessage",
    "Suggested verification details added. Review evidence before marking as Verified.",
    false,
  );
}

async function quickUpdateCqiStatus(outcomeType, outcomeCode, status) {
  try {
    const data = await apiRequest(
      `/item-analysis/${analysisId}/cqi-plan/status`,
      "PATCH",
      {
        outcomeType,
        outcomeCode,
        status,
      },
    );

    setMessage("analysisMessage", data.message, false);
    await loadAnalysis();
  } catch (error) {
    setMessage("analysisMessage", error.message);
  }
}

document.getElementById("cqiPlanForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const body = {
    outcomeType: document.getElementById("cqiOutcomeType").value,
    outcomeCode: document.getElementById("cqiOutcomeCode").value,
    rootCause: document.getElementById("cqiRootCause").value,
    intervention: document.getElementById("cqiIntervention").value,
    responsiblePerson: document.getElementById("cqiResponsiblePerson").value,
    targetDate: document.getElementById("cqiTargetDate").value,
    status: document.getElementById("cqiStatus").value,
    evidence: document.getElementById("cqiEvidence").value,
    remarks: document.getElementById("cqiRemarks").value,
    implementationDate: document.getElementById("cqiImplementationDate").value,
    reassessmentResult: document.getElementById("cqiReassessmentResult").value,
    verificationRemarks: document.getElementById("cqiVerificationRemarks").value,
    followUpDecision: document.getElementById("cqiFollowUpDecision").value,
  };

  try {
    const data = await apiRequest(`/item-analysis/${analysisId}/cqi-plan`, "PUT", body);
    setMessage("cqiPlanMessage", data.message, false);
    await loadAnalysis();
  } catch (error) {
    setMessage("cqiPlanMessage", error.message);
  }
});

function renderAnalysisRow(item) {
  return `
    <tr>
      <td>${item.itemNo}</td>
      <td>${item.correctCount}</td>
      <td>${item.incorrectCount}</td>
      <td>${item.difficultyIndex}</td>
      <td>${escapeHTML(item.difficultyInterpretation)}</td>
      <td><span class="badge ${escapeHTML(item.questionDifficulty.toLowerCase())}">${escapeHTML(item.questionDifficulty)}</span></td>
      <td>${item.discriminationIndex}</td>
      <td>${escapeHTML(item.discriminationInterpretation)}</td>
      <td>
        <span class="badge ${getRecommendationClass(item.recommendation)}">${escapeHTML(item.recommendation)}</span>
        <small class="recommendation-action">${escapeHTML(item.action || "")}</small>
      </td>
    </tr>
  `;
}

function renderRecommendationPanel(summary) {
  const recommendationSummary = summary.recommendationSummary || {};
  const priorityItems = summary.priorityItems || [];

  document.getElementById("recommendationSummary").innerHTML = [
    "Keep",
    "Review",
    "Revise",
    "Check Answer Key",
  ]
    .map(
      (key) => `
        <div class="recommendation-chip">
          <span>${escapeHTML(key)}</span>
          <strong>${recommendationSummary[key] || 0}</strong>
        </div>
      `,
    )
    .join("");

  document.getElementById("priorityRecommendations").innerHTML =
    priorityItems.length > 0
      ? priorityItems
          .map(
            (item) => `
              <article class="recommendation-item">
                <strong>Item ${item.itemNo}: ${escapeHTML(item.recommendation)}</strong>
                <p>${escapeHTML(item.action || "")}</p>
              </article>
            `,
          )
          .join("")
      : `<p class="muted-text">No priority issues detected. Most items are safe to keep.</p>`;
}

function getRecommendationClass(recommendation) {
  if (recommendation === "Keep") return "easy";
  if (recommendation === "Review") return "average";
  return "difficult";
}

function renderCharts(items) {
  if (!window.Chart) {
    document.getElementById("analysisMessage").textContent =
      "Chart.js could not load. The table and export are still available.";
    return;
  }

  chartInstances.forEach((chart) => chart.destroy());
  chartInstances = [];

  const labels = items.map((item) => `Item ${item.itemNo}`);
  const recommendationCounts = items.reduce((counts, item) => {
    counts[item.recommendation] = (counts[item.recommendation] || 0) + 1;
    return counts;
  }, {});

  chartInstances.push(
    new Chart(document.getElementById("difficultyChart"), {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Difficulty Index",
            data: items.map((item) => item.difficultyIndex),
            backgroundColor: "#860012",
          },
        ],
      },
      options: { scales: { y: { min: -1, max: 1 } } },
    }),
  );

  chartInstances.push(
    new Chart(document.getElementById("discriminationChart"), {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Discrimination Index",
            data: items.map((item) => item.discriminationIndex),
            backgroundColor: "#e3a000",
          },
        ],
      },
      options: { scales: { y: { beginAtZero: true, max: 1 } } },
    }),
  );

  chartInstances.push(
    new Chart(document.getElementById("recommendationChart"), {
      type: "pie",
      data: {
        labels: Object.keys(recommendationCounts),
        datasets: [
          {
            data: Object.values(recommendationCounts),
            backgroundColor: ["#860012", "#e3a000", "#d9534f", "#6f000f"],
          },
        ],
      },
    }),
  );
}

async function exportAnalysis() {
  try {
    const res = await fetch(`/api/item-analysis/${analysisId}/export`, {
      headers: {
        Authorization: `Bearer ${getToken()}`,
      },
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.message || "Export failed.");
    }

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `item-analysis-${analysisId}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  } catch (error) {
    setMessage("analysisMessage", error.message);
  }
}

loadAnalysis();
