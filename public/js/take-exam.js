protectPage();

let currentExam = null;

async function loadExam() {
  const examId = localStorage.getItem("current_exam_id");

  if (!examId) {
    alert("No exam selected.");
    location.href = "/generate-exam.html";
    return;
  }

  try {
    const data = await apiRequest(`/exams/${examId}`);
    currentExam = data.exam;

    document.getElementById("examTitle").textContent = currentExam.title;

    document.getElementById("takeExamForm").innerHTML =
      currentExam.questions
        .map(
          (q, index) => `
        <div class="card question-card">
          <h3>${index + 1}. ${escapeHTML(q.questionText)}</h3>

          ${
            q.image && q.image.contentType
              ? `<img
        class="question-image"
        src="/api/questions/${q._id}/image"
        style="max-width:300px;display:block;margin:15px 0;border-radius:10px;"
      >`
              : ""
          }
          ${renderQuestionTables(q.tables)}
          ${q.tableData ? `<pre>${escapeHTML(q.tableData)}</pre>` : ""}

          ${
            q.questionType === "Problem Solving"
              ? `<div class="question-detail-block">
                  <span class="field-label">Answer</span>
                  <div class="answer-space"></div>
                </div>`
              : ["A", "B", "C", "D"]
                  .map(
                    (letter) => `
              <label class="choice">
                ${letter}. ${escapeHTML(q.choices?.[letter] || "")}
              </label>
            `,
                  )
                  .join("")
          }
        </div>
      `,
        )
        .join("");
  } catch (error) {
    alert(error.message);
  }
}

loadExam();

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

async function downloadExamDocx() {
  await downloadExamFile("download-docx", "generated_exam_no_answer.docx");
}

async function downloadAnswerKeyDocx() {
  await downloadExamFile(
    "download-answer-key-docx",
    "generated_exam_answer_key.docx",
  );
}

async function downloadTosDocx() {
  await downloadExamFile("download-tos-docx", "generated_exam_tos.docx");
}

async function downloadExamFile(endpoint, fileName) {
  const examId = localStorage.getItem("current_exam_id");

  if (!examId) {
    alert("No exam selected.");
    return;
  }

  try {
    const res = await fetch(`/api/exams/${examId}/${endpoint}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${getToken()}`,
      },
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.message || "Download failed.");
    }

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();

    a.remove();
    window.URL.revokeObjectURL(url);
  } catch (error) {
    alert(error.message);
  }
}
