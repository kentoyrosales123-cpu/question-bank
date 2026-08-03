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

            <p>Correct Answer: <strong>${escapeHTML(q.correctAnswer)}</strong></p>

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

  body.innerHTML = rows.length
    ? rows.map(renderAttainmentRow).join("")
    : `<tr><td colspan="7" class="empty-table-cell">No ${escapeHTML(emptyLabel)} attainment data.</td></tr>`;
}

function getAttainmentClass(rate, targetRate = 75) {
  const target = Number(targetRate ?? 75);

  if (Number(rate) >= target) return "easy";
  if (Number(rate) >= target * (2 / 3)) return "average";
  return "difficult";
}

function renderAttainmentRow(row) {
  const statusClass = row.status === "Attained" ? "easy" : "difficult";

  return `
    <tr>
      <td><strong>${escapeHTML(row.code)}</strong></td>
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
