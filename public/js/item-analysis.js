protectPage();

const analysisUser = getUser();
let analysisId = location.pathname.split("/").filter(Boolean).pop();
let chartInstances = [];

if (analysisUser && !canCreateContentRole(analysisUser)) {
  alert("Item analysis is for content managers only.");
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
  );
  renderAttainmentTable(
    "soAttainmentBody",
    obeAttainment.studentOutcomes || [],
    "SO",
  );
  renderAttainmentTable(
    "bloomAttainmentBody",
    obeAttainment.bloomLevels || [],
    "Bloom",
  );
}

function renderAttainmentTable(bodyId, rows, label) {
  const body = document.getElementById(bodyId);

  if (!body) return;

  body.innerHTML = rows.length
    ? rows.map(renderAttainmentRow).join("")
    : `<tr><td colspan="7" class="empty-table-cell">No ${escapeHTML(label)} attainment data.</td></tr>`;
}

function getAttainmentClass(rate) {
  if (Number(rate) >= 75) return "easy";
  if (Number(rate) >= 50) return "average";
  return "difficult";
}

function renderAttainmentRow(row) {
  const statusClass = row.status === "Attained" ? "easy" : "difficult";

  return `
    <tr>
      <td><strong>${escapeHTML(row.code)}</strong></td>
      <td>${row.itemCount || 0}</td>
      <td>${row.responseCount || 0}</td>
      <td>${row.correctCount || 0}</td>
      <td>${row.earnedWeight || 0} / ${row.totalWeight || 0}</td>
      <td><span class="badge ${getAttainmentClass(row.attainmentRate)}">${row.attainmentRate || 0}%</span></td>
      <td><span class="badge ${statusClass}">${escapeHTML(row.status || "Not assessed")}</span></td>
    </tr>
  `;
}

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
