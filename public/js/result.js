protectPage();

async function loadResult() {
  const examId = localStorage.getItem("result_exam_id");

  if (!examId) {
    alert("No result found.");
    location.href = "/generate-exam.html";
    return;
  }

  try {
    const data = await apiRequest(`/exams/${examId}`);
    const exam = data.exam;

    document.getElementById("scoreText").textContent =
      `Score: ${exam.score} / ${exam.totalItems}`;
    renderAttainmentTable(
      "coAttainmentBody",
      data.attainment?.courseOutcomes || [],
      "CO/CLO",
    );
    renderAttainmentTable(
      "soAttainmentBody",
      data.attainment?.studentOutcomes || [],
      "SO",
    );

    document.getElementById("resultList").innerHTML = exam.questions
      .map((q, index) => {
        const answer = exam.answers.find((a) => a.question._id === q._id);
        const isProblemSolving = q.questionType === "Problem Solving";
        const correctAnswer = isProblemSolving
          ? q.solutionAnswer
          : q.correctAnswer;

        return `
          <div class="card question-card">
            <h3>${index + 1}. ${escapeHTML(q.questionText)}</h3>
            ${
              q.image && q.image.contentType
                ? `<img class="question-image" src="/api/questions/${q._id}/image">`
                : ""
            }
            ${renderQuestionTables(q.tables)}
            ${q.tableData ? `<pre>${escapeHTML(q.tableData)}</pre>` : ""}

            <p>Your Answer: 
              <strong class="${answer?.isCorrect ? "correct" : "wrong"}">
                ${escapeHTML(answer?.selectedAnswer || "No answer")}
              </strong>
            </p>

            <p>Correct Answer: <strong>${escapeHTML(correctAnswer || "No answer set")}</strong></p>

            <p>
              <strong>CO/CLO:</strong> ${escapeHTML(q.courseOutcome || "Unmapped")}
              &nbsp; | &nbsp;
              <strong>SO:</strong> ${escapeHTML(q.programOutcome || "Unmapped")}
              &nbsp; | &nbsp;
              <strong>Bloom:</strong> ${escapeHTML(q.bloomLevel || "Unmapped")}
            </p>

            <p><strong>Explanation:</strong> ${escapeHTML(q.explanation || "No explanation provided.")}</p>
          </div>
        `;
      })
      .join("");
  } catch (error) {
    alert(error.message);
  }
}

loadResult();

function renderAttainmentTable(bodyId, rows, emptyLabel) {
  const body = document.getElementById(bodyId);

  if (!body) return;

  const isSo = emptyLabel === "SO";

  body.innerHTML = rows.length
    ? rows.map((row) => renderAttainmentRow(row, isSo)).join("")
    : `<tr><td colspan="${isSo ? 8 : 7}" class="empty-table-cell">No ${escapeHTML(emptyLabel)} attainment data.</td></tr>`;
}

function getAttainmentClass(rate, targetRate = 75) {
  const target = Number(targetRate ?? 75);

  if (Number(rate) >= target) return "easy";
  if (Number(rate) >= target * (2 / 3)) return "average";
  return "difficult";
}

function renderAttainmentRow(row, isSo = false) {
  const statusClass = row.status === "Attained" ? "easy" : "difficult";

  return `
    <tr>
      <td><strong>${escapeHTML(row.code)}</strong></td>
      ${isSo ? `<td>${renderPerformanceIndicators(row)}</td>` : ""}
      <td>${escapeHTML(row.assessedItems || 0)} / ${escapeHTML(row.questionCount || 0)}</td>
      <td>${escapeHTML(row.correctItems || 0)}</td>
      <td>${escapeHTML(row.earnedWeight || 0)} / ${escapeHTML(row.totalWeight || 0)}</td>
      <td>${escapeHTML(row.targetRate ?? 75)}%</td>
      <td>
        <span class="badge ${getAttainmentClass(row.attainmentRate, row.targetRate)}">
          ${escapeHTML(row.attainmentRate || 0)}%
        </span>
      </td>
      <td><span class="badge ${statusClass}">${escapeHTML(row.status || "Not assessed")}</span></td>
    </tr>
  `;
}

function renderPerformanceIndicators(row = {}) {
  const breakdown = Array.isArray(row.piBreakdown) ? row.piBreakdown : [];

  if (breakdown.length > 0) {
    const phaseText = renderPhaseBreakdown(row.phaseBreakdown);
    const rows = breakdown
      .map(
        (pi) =>
          `<small class="muted-text"><strong>${escapeHTML(pi.code)}:</strong> ${escapeHTML(pi.attainmentRate || 0)}% (${escapeHTML(pi.status || "Not assessed")})</small>`,
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

function renderQuestionTables(tables) {
  if (!Array.isArray(tables) || tables.length === 0) {
    return "";
  }

  return tables
    .map(
      (table) => `
        <div class="question-table-wrap">
          <table class="question-table">
            <tbody>
              ${(table.rows || [])
                .map(
                  (row) => `
                    <tr>
                      ${(row || [])
                        .map((cell) => `<td>${escapeHTML(cell)}</td>`)
                        .join("")}
                    </tr>
                  `,
                )
                .join("")}
            </tbody>
          </table>
        </div>
      `,
    )
    .join("");
}
