protectPage();

let currentQuestionsEndpoint = "/questions";
let currentQuestions = [];
let currentQuestionsPage = 1;
const questionsPerPage = 20;

async function loadQuestions(endpoint = "/questions", page = 1) {
  try {
    currentQuestionsEndpoint = endpoint;
    const data = await apiRequest(endpoint);
    currentQuestions = data.questions || [];
    currentQuestionsPage = page;

    renderQuestionsPage();
  } catch (error) {
    alert(error.message);
  }
}

function renderQuestionsPage() {
  const totalPages = Math.max(1, Math.ceil(currentQuestions.length / questionsPerPage));
  currentQuestionsPage = Math.min(
    totalPages,
    Math.max(1, Number(currentQuestionsPage) || 1),
  );

  const startIndex = (currentQuestionsPage - 1) * questionsPerPage;
  const pageQuestions = currentQuestions.slice(startIndex, startIndex + questionsPerPage);

  document.getElementById("questionsBody").innerHTML = pageQuestions.length
    ? pageQuestions
        .map(
          (q) => `
      <tr>
        <td>${escapeHTML(q.subject)}</td>
        <td>${escapeHTML(q.topic)}</td>
        <td>${escapeHTML(truncateText(q.questionText, 80))}</td>
        <td><span class="badge ${escapeHTML(q.difficulty.toLowerCase())}">${escapeHTML(q.difficulty)}</span></td>
        <td>${escapeHTML(q.correctAnswer)}</td>
        <td>
          <div class="action-row">
            <button class="btn secondary" type="button" onclick="viewQuestion('${q._id}')">View</button>
            ${
              getUser()?.role === "admin"
                ? `
                  <button class="btn" type="button" onclick="editQuestion('${q._id}')">Edit</button>
                  <button class="btn danger" type="button" onclick="deleteQuestion('${q._id}')">Delete</button>
                `
                : ""
            }
          </div>
        </td>
      </tr>
    `,
        )
        .join("")
    : `<tr><td colspan="6" class="muted-text">No questions found.</td></tr>`;

  renderQuestionsPagination(totalPages);
}

function renderQuestionsPagination(totalPages) {
  const pagination = document.getElementById("questionsPagination");

  if (!pagination) return;

  const firstItem = currentQuestions.length
    ? (currentQuestionsPage - 1) * questionsPerPage + 1
    : 0;
  const lastItem = Math.min(
    currentQuestions.length,
    currentQuestionsPage * questionsPerPage,
  );

  pagination.innerHTML = `
    <span class="pagination-summary">
      Showing ${firstItem}-${lastItem} of ${currentQuestions.length} questions
    </span>
    <div class="pagination-actions">
      <button class="btn secondary" type="button" onclick="goToQuestionsPage(${currentQuestionsPage - 1})" ${currentQuestionsPage <= 1 ? "disabled" : ""}>
        Previous
      </button>
      <span class="pagination-page">Page ${currentQuestionsPage} of ${totalPages}</span>
      <button class="btn secondary" type="button" onclick="goToQuestionsPage(${currentQuestionsPage + 1})" ${currentQuestionsPage >= totalPages ? "disabled" : ""}>
        Next
      </button>
    </div>
  `;
}

function goToQuestionsPage(page) {
  currentQuestionsPage = page;
  renderQuestionsPage();
}

function truncateText(value, maxLength) {
  const text = String(value || "");

  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

async function filterQuestions() {
  const subject = document.getElementById("filterSubject").value;
  const topic = document.getElementById("filterTopic").value;
  const difficulty = document.getElementById("filterDifficulty").value;

  const query = new URLSearchParams({ subject, topic, difficulty }).toString();

  loadQuestions(`/questions/filter?${query}`, 1);
}

async function viewQuestion(id) {
  try {
    const data = await apiRequest(`/questions/${id}`);
    const [analyticsData, historyData] = await Promise.all([
      apiRequest(`/questions/${id}/analytics`).catch(() => ({ analytics: null })),
      apiRequest(`/questions/${id}/history`).catch(() => ({ history: [] })),
    ]);
    const question = data.question;
    const analytics = analyticsData.analytics;
    const history = historyData.history || [];

    document.getElementById("questionModalTitle").textContent =
      "Question Details";
    document.getElementById("questionDetails").innerHTML = `
      <div class="detail-grid">
        <div>
          <span class="field-label">Subject</span>
          <strong>${escapeHTML(question.subject)}</strong>
        </div>
        <div>
          <span class="field-label">Topic</span>
          <strong>${escapeHTML(question.topic)}</strong>
        </div>
        <div>
          <span class="field-label">Difficulty</span>
          <span class="badge ${escapeHTML(question.difficulty.toLowerCase())}">${escapeHTML(question.difficulty)}</span>
        </div>
        <div>
          <span class="field-label">Correct Answer</span>
          <strong>${escapeHTML(question.correctAnswer)}</strong>
        </div>
      </div>

      <div class="question-detail-block">
        <span class="field-label">Question</span>
        <p>${escapeHTML(question.questionText)}</p>
      </div>

      ${
        question.image && question.image.contentType
          ? `<img class="question-image" src="/api/questions/${question._id}/image" alt="Question image">`
          : ""
      }

      ${renderQuestionTables(question.tables)}
      ${question.tableData ? `<pre>${escapeHTML(question.tableData)}</pre>` : ""}

      <div class="choice-grid">
        ${["A", "B", "C", "D"]
          .map(
            (letter) => `
              <div class="choice readonly-choice">
                <strong>${letter}.</strong> ${escapeHTML(question.choices?.[letter] || "")}
              </div>
            `,
          )
          .join("")}
      </div>

      <div class="question-detail-block">
        <span class="field-label">Explanation</span>
        <p>${escapeHTML(question.explanation || "No explanation provided.")}</p>
      </div>

      ${renderQuestionAnalytics(analytics)}
      ${renderQuestionHistory(history)}
    `;

    document.getElementById("questionModal").classList.remove("hidden");
  } catch (error) {
    alert(error.message);
  }
}

function renderQuestionAnalytics(analytics) {
  if (!analytics) {
    return "";
  }

  return `
    <div class="question-detail-block">
      <span class="field-label">Usage Analytics</span>
      <div class="detail-grid">
        <div><span class="field-label">Generated Exams</span><strong>${analytics.generatedExamUsage}</strong></div>
        <div><span class="field-label">Submitted Uses</span><strong>${analytics.submittedUsage}</strong></div>
        <div><span class="field-label">Correct</span><strong>${analytics.correctCount}</strong></div>
        <div><span class="field-label">Accuracy</span><strong>${analytics.accuracy}%</strong></div>
      </div>
      ${
        analytics.recentExams?.length
          ? `<div class="recommendation-list">
              ${analytics.recentExams
                .map(
                  (exam) => `
                    <article class="recommendation-item">
                      <strong>${escapeHTML(exam.title)}</strong>
                      <p>${escapeHTML(exam.subject)} | ${escapeHTML(exam.topic || "All topics")} | ${new Date(exam.createdAt).toLocaleDateString()}</p>
                    </article>
                  `,
                )
                .join("")}
            </div>`
          : `<p class="muted-text">This question has not been used in generated exams yet.</p>`
      }
    </div>
  `;
}

function renderQuestionHistory(history) {
  return `
    <div class="question-detail-block">
      <span class="field-label">Version History</span>
      ${
        history.length
          ? `<div class="recommendation-list">
              ${history
                .map(
                  (entry) => `
                    <article class="recommendation-item">
                      <strong>${escapeHTML(entry.changedFields?.join(", ") || "Updated")}</strong>
                      <p>
                        ${new Date(entry.editedAt).toLocaleString()} by
                        ${escapeHTML(entry.editedBy?.name || entry.editedBy?.email || "Unknown user")}
                      </p>
                    </article>
                  `,
                )
                .join("")}
            </div>`
          : `<p class="muted-text">No edits recorded yet.</p>`
      }
    </div>
  `;
}

async function editQuestion(id) {
  try {
    const data = await apiRequest(`/questions/${id}`);
    const question = data.question;

    document.getElementById("questionModalTitle").textContent =
      "Edit Question";
    document.getElementById("questionDetails").innerHTML = `
      <form id="editQuestionForm">
        <div class="field-grid two">
          <label>
            <span class="field-label">Subject</span>
            <input id="editSubject" value="${escapeAttribute(question.subject)}" required />
          </label>
          <label>
            <span class="field-label">Topic</span>
            <input id="editTopic" value="${escapeAttribute(question.topic)}" required />
          </label>
        </div>

        <label>
          <span class="field-label">Question</span>
          <textarea id="editQuestionText" required>${escapeHTML(question.questionText)}</textarea>
        </label>

        <div class="field-grid two">
          ${["A", "B", "C", "D"]
            .map(
              (letter) => `
                <label>
                  <span class="field-label">Choice ${letter}</span>
                  <input id="editChoice${letter}" value="${escapeAttribute(question.choices?.[letter] || "")}" required />
                </label>
              `,
            )
            .join("")}
        </div>

        <div class="field-grid two">
          <label>
            <span class="field-label">Correct Answer</span>
            <select id="editCorrectAnswer" required>
              ${["A", "B", "C", "D"]
                .map(
                  (letter) => `
                    <option value="${letter}" ${question.correctAnswer === letter ? "selected" : ""}>${letter}</option>
                  `,
                )
                .join("")}
            </select>
          </label>
          <label>
            <span class="field-label">Difficulty</span>
            <select id="editDifficulty" required>
              ${["Easy", "Average", "Difficult"]
                .map(
                  (difficulty) => `
                    <option value="${difficulty}" ${question.difficulty === difficulty ? "selected" : ""}>${difficulty}</option>
                  `,
                )
                .join("")}
            </select>
          </label>
        </div>

        <label>
          <span class="field-label">Optional Table Data</span>
          <textarea id="editTableData">${escapeHTML(question.tableData || "")}</textarea>
        </label>

        <label>
          <span class="field-label">Explanation / Solution</span>
          <textarea id="editExplanation">${escapeHTML(question.explanation || "")}</textarea>
        </label>

        ${
          question.image && question.image.contentType
            ? `<img class="question-image" src="/api/questions/${question._id}/image" alt="Current question image">`
            : ""
        }

        <label>
          <span class="field-label">Replace Figure/Image</span>
          <input id="editImage" type="file" accept="image/*" />
        </label>

        <div class="review-actions">
          <button class="btn success" type="submit">Save Changes</button>
          <button class="btn secondary" type="button" onclick="closeQuestionModal()">Cancel</button>
          <p class="message" id="editQuestionMessage"></p>
        </div>
      </form>
    `;

    document
      .getElementById("editQuestionForm")
      .addEventListener("submit", (event) => saveQuestionEdits(event, id));

    document.getElementById("questionModal").classList.remove("hidden");
  } catch (error) {
    alert(error.message);
  }
}

async function saveQuestionEdits(event, id) {
  event.preventDefault();

  const form = new FormData();

  form.append("subject", document.getElementById("editSubject").value);
  form.append("topic", document.getElementById("editTopic").value);
  form.append(
    "questionText",
    document.getElementById("editQuestionText").value,
  );
  form.append("choiceA", document.getElementById("editChoiceA").value);
  form.append("choiceB", document.getElementById("editChoiceB").value);
  form.append("choiceC", document.getElementById("editChoiceC").value);
  form.append("choiceD", document.getElementById("editChoiceD").value);
  form.append(
    "correctAnswer",
    document.getElementById("editCorrectAnswer").value,
  );
  form.append("difficulty", document.getElementById("editDifficulty").value);
  form.append("tableData", document.getElementById("editTableData").value);
  form.append("explanation", document.getElementById("editExplanation").value);

  const image = document.getElementById("editImage").files[0];

  if (image) {
    form.append("image", image);
  }

  try {
    await apiRequest(`/questions/${id}`, "PUT", form, true);
    setMessage("editQuestionMessage", "Question updated successfully.", false);
    await loadQuestions(currentQuestionsEndpoint, currentQuestionsPage);
    setTimeout(closeQuestionModal, 500);
  } catch (error) {
    setMessage("editQuestionMessage", error.message);
  }
}

function closeQuestionModal() {
  document.getElementById("questionModal").classList.add("hidden");
  document.getElementById("questionDetails").innerHTML = "";
}

function escapeAttribute(value) {
  return escapeHTML(value).replaceAll("'", "&#039;");
}

async function deleteQuestion(id) {
  if (!confirm("Delete this question?")) return;

  try {
    await apiRequest(`/questions/${id}`, "DELETE");
    loadQuestions(currentQuestionsEndpoint, currentQuestionsPage);
  } catch (error) {
    alert(error.message);
  }
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

loadQuestions();
