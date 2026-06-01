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
