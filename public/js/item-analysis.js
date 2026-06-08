protectPage();

const analysisUser = getUser();
let analysisId = location.pathname.split("/").filter(Boolean).pop();
let chartInstances = [];

if (analysisUser && !isAdminRole(analysisUser) && !isCreatorRole(analysisUser)) {
  alert("Item analysis is for Admins and Exam Creators only.");
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
    renderCharts(analysis.items);
  } catch (error) {
    setMessage("analysisMessage", error.message);
  }
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
