const canLoadQuestionsPage = protectPage() && contentManagerPage();
const CEE_CAC_SUBJECTS = ["CEE 601", "CEE 602", "CEE 603", "CEE 604"];

let currentQuestionsEndpoint = "/questions";
let currentQuestions = [];
let currentQuestionsPage = 1;
let currentQuestionsTotal = 0;
let currentQuestionsTotalPages = 1;
const questionsPerPage = 20;

async function loadQuestions(endpoint = "/questions", page = 1) {
  try {
    currentQuestionsEndpoint = endpoint;
    currentQuestionsPage = page;
    const url = withQuestionPagination(endpoint, page);
    const data = await apiRequest(url);

    currentQuestions = data.questions || [];
    currentQuestionsTotal = Number(data.count ?? currentQuestions.length);
    currentQuestionsTotalPages = Number(data.totalPages || 1);

    renderQuestionsPage();
  } catch (error) {
    alert(error.message);
  }
}

function withQuestionPagination(endpoint, page) {
  const [path, query = ""] = endpoint.split("?");
  const params = new URLSearchParams(query);

  params.set("page", page);
  params.set("limit", questionsPerPage);

  return `${path}?${params.toString()}`;
}

function renderQuestionsPage() {
  currentQuestionsPage = Math.min(
    currentQuestionsTotalPages,
    Math.max(1, Number(currentQuestionsPage) || 1),
  );

  document.getElementById("questionsBody").innerHTML = currentQuestions.length
    ? currentQuestions
        .map(
          (q) => {
            const difficultyLabel = getQuestionDifficultyLabel(q.difficulty);
            const difficultyClass = getQuestionDifficultyClass(q.difficulty);

            return `
      <tr>
        <td>${escapeHTML(q.subject)}</td>
        <td>${escapeHTML(q.engineeringProgram || "Not set")}</td>
        <td>${escapeHTML(q.topic)}</td>
        <td>${escapeHTML(truncateText(q.questionText, 80))}</td>
        <td>
  <span class="badge ${escapeHTML(difficultyClass)}">
    ${escapeHTML(difficultyLabel)}
  </span>
</td>

<td>
  ${renderCepBadge(q)}
</td>

<td>
  <span class="badge ${q.courseOutcome && q.programOutcome && q.studentLearningOutcome ? "easy" : "average"}">
    ${escapeHTML(formatObeTag(q))}
  </span>
</td>

<td>${escapeHTML(q.correctAnswer)}</td>

<td>
          <div class="action-row">
            <button class="btn secondary" type="button" onclick="viewQuestion('${q._id}')">View</button>
            ${
              isAdminRole(getUser()) || isCeeCacCoordinatorRole(getUser())
                ? `
                  <button class="btn"
type="button"
onclick="editQuestion('${q._id}')">
Edit
</button>

<button class="btn danger"
type="button"
onclick="deleteQuestion('${q._id}')">
Delete
</button>
                `
                : ""
            }
          </div>
        </td>
      </tr>
    `;
          },
        )
        .join("")
    : `<tr><td colspan="9" class="muted-text">No questions found.</td></tr>`;

  renderQuestionsPagination();
}

function renderQuestionsPagination() {
  const pagination = document.getElementById("questionsPagination");

  if (!pagination) return;

  const firstItem = currentQuestionsTotal
    ? (currentQuestionsPage - 1) * questionsPerPage + 1
    : 0;
  const lastItem = Math.min(
    currentQuestionsTotal,
    currentQuestionsPage * questionsPerPage,
  );

  pagination.innerHTML = `
    <span class="pagination-summary">
      Showing ${firstItem}-${lastItem} of ${currentQuestionsTotal} questions
    </span>
    <div class="pagination-actions">
      <button class="btn secondary" type="button" onclick="goToQuestionsPage(${currentQuestionsPage - 1})" ${currentQuestionsPage <= 1 ? "disabled" : ""}>
        Previous
      </button>
      <span class="pagination-page">Page ${currentQuestionsPage} of ${currentQuestionsTotalPages}</span>
      <button class="btn secondary" type="button" onclick="goToQuestionsPage(${currentQuestionsPage + 1})" ${currentQuestionsPage >= currentQuestionsTotalPages ? "disabled" : ""}>
        Next
      </button>
    </div>
  `;
}

function goToQuestionsPage(page) {
  loadQuestions(currentQuestionsEndpoint, page);
}

function truncateText(value, maxLength) {
  const text = String(value || "");

  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function getQuestionDifficultyLabel(difficulty) {
  return difficulty || "Average";
}

function getQuestionDifficultyClass(difficulty) {
  return String(getQuestionDifficultyLabel(difficulty)).toLowerCase();
}

function renderCepBadge(question) {
  const isCep = Boolean(question.isComplexEngineeringProblem);
  const score = Number(question.complexityScore || 0);
  const level = question.complexityLevel || "Routine Engineering Problem";
  const label = isCep ? "CEP" : "Not CEP";
  const badgeClass = isCep ? "difficult" : score > 30 ? "average" : "easy";

  return `
    <span class="badge ${badgeClass}" title="${escapeAttribute(level)}">
      ${label} ${score}%
    </span>
  `;
}

function renderSubjectEditControl(question) {
  if (isCeeCacCoordinatorRole(getUser())) {
    return `
      <select id="editSubject" required>
        ${CEE_CAC_SUBJECTS.map(
          (subject) => `
            <option value="${subject}" ${question.subject === subject ? "selected" : ""}>${subject}</option>
          `,
        ).join("")}
      </select>
    `;
  }

  return `<input id="editSubject" value="${escapeAttribute(question.subject)}" required />`;
}

function formatObeTag(question) {
  const clo = question.courseOutcome || "No CLO";
  const so = question.programOutcome || "No SO";
  const slo = question.studentLearningOutcome || "No SLO";

  return `${clo} / ${so} / ${slo}`;
}

async function filterQuestions() {
  const subject = document.getElementById("filterSubject").value;
  const topic = document.getElementById("filterTopic").value;
  const difficulty = document.getElementById("filterDifficulty").value;
  const courseOutcome = document.getElementById("filterCourseOutcome").value;
  const programOutcome = document.getElementById("filterProgramOutcome").value;
  const studentLearningOutcome = document.getElementById(
    "filterStudentLearningOutcome",
  ).value;
  const bloomLevel = document.getElementById("filterBloomLevel").value;

  const query = new URLSearchParams({
    subject,
    topic,
    difficulty,
    courseOutcome,
    programOutcome,
    studentLearningOutcome,
    bloomLevel,
  }).toString();

  loadQuestions(`/questions/filter?${query}`, 1);
}

async function viewQuestion(id) {
  try {
    const data = await apiRequest(`/questions/${id}`);
    const [analyticsData, historyData] = await Promise.all([
      apiRequest(`/questions/${id}/analytics`).catch(() => ({
        analytics: null,
      })),
      apiRequest(`/questions/${id}/history`).catch(() => ({ history: [] })),
    ]);
    const question = data.question;
    const analytics = analyticsData.analytics;
    const history = historyData.history || [];

    document.getElementById("questionModalTitle").textContent =
      "Question Details";
    const difficultyLabel = getQuestionDifficultyLabel(question.difficulty);
    const difficultyClass = getQuestionDifficultyClass(question.difficulty);

    document.getElementById("questionDetails").innerHTML = `
      <div class="detail-grid">
        <div>
          <span class="field-label">Subject</span>
          <strong>${escapeHTML(question.subject)}</strong>
        </div>
        <div>
          <span class="field-label">Program</span>
          <strong>${escapeHTML(question.engineeringProgram || "Not set")}</strong>
        </div>
        <div>
          <span class="field-label">Topic</span>
          <strong>${escapeHTML(question.topic)}</strong>
        </div>
        <div>
          <span class="field-label">Difficulty</span>
          <span class="badge ${escapeHTML(difficultyClass)}">${escapeHTML(difficultyLabel)}</span>
        </div>
        <div>
          <span class="field-label">Correct Answer</span>
          <strong>${escapeHTML(question.correctAnswer)}</strong>
        </div>
        <div>
          <span class="field-label">Course Outcome</span>
          <strong>${escapeHTML(question.courseOutcome || "Not mapped")}</strong>
        </div>
        <div>
          <span class="field-label">Student Outcome</span>
          <strong>${escapeHTML(question.programOutcome || "Not mapped")}</strong>
        </div>
        <div>
          <span class="field-label">Student Learning Outcome</span>
          <strong>${escapeHTML(question.studentLearningOutcome || "Not mapped")}</strong>
        </div>
        <div>
          <span class="field-label">Bloom Level</span>
          <strong>${escapeHTML(question.bloomLevel || "Not mapped")}</strong>
        </div>
        <div>
          <span class="field-label">Outcome Weight</span>
          <strong>${escapeHTML(question.outcomeWeight || 1)}</strong>
        </div>
        <div>
          <span class="field-label">Complex Engineering Problem</span>
          <strong>${question.isComplexEngineeringProblem ? "Yes" : "No"} - ${escapeHTML(question.complexityLevel || "Routine Engineering Problem")} (${escapeHTML(question.complexityScore || 0)}%)</strong>
        </div>
      </div>

      ${
        Array.isArray(question.complexityReasons) &&
        question.complexityReasons.length
          ? `<div class="question-detail-block">
              <span class="field-label">Complexity Indicators</span>
              <p>${question.complexityReasons.map(escapeHTML).join(" | ")}</p>
            </div>`
          : ""
      }

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
                .map((entry, index) => {
                  const changes = (entry.changedFields || [])
                    .map((field) => {
                      const before = entry.before?.[field] ?? "Empty";

                      const after = entry.after?.[field] ?? "Empty";

                      return `
                        <div class="version-change">
                          <strong>${escapeHTML(field)}</strong>

                          <div class="version-compare">
                            <div class="version-before">
                              <span>Before</span>
                              <p>${escapeHTML(
                                typeof before === "object"
                                  ? JSON.stringify(before, null, 2)
                                  : String(before),
                              )}</p>
                            </div>

                            <div class="version-after">
                              <span>After</span>
                              <p>${escapeHTML(
                                typeof after === "object"
                                  ? JSON.stringify(after, null, 2)
                                  : String(after),
                              )}</p>
                            </div>
                          </div>
                        </div>
                      `;
                    })
                    .join("");

                  return `
                    <article class="recommendation-item version-card">
                      <div class="version-header">
                        <strong>
                          Version ${history.length - index}
                        </strong>

                        <small>
                          ${new Date(entry.editedAt).toLocaleString()}
                        </small>
                      </div>

                      <p class="muted-text">
                        Edited by:
                        ${escapeHTML(
                          entry.editedBy?.name ||
                            entry.editedBy?.email ||
                            "Unknown user",
                        )}
                      </p>

                      ${changes}
                    </article>
                  `;
                })
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

    document.getElementById("questionModalTitle").textContent = "Edit Question";
    document.getElementById("questionDetails").innerHTML = `
      <form id="editQuestionForm">
        <div class="field-grid two">
          <label>
            <span class="field-label">Subject</span>
            ${renderSubjectEditControl(question)}
          </label>
          <label>
            <span class="field-label">Engineering Program</span>
            <select id="editEngineeringProgram" required>
              ${["GE", "ECE", "CE", "EE", "ME", "CpE", "CHE"]
                .map(
                  (program) => `
                    <option value="${program}" ${question.engineeringProgram === program ? "selected" : ""}>${program === "GE" ? "General Engineering" : program}</option>
                  `,
                )
                .join("")}
            </select>
          </label>
        </div>

        <div class="field-grid two">
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

        <div class="field-grid two">
          <label>
            <span class="field-label">Course Outcome</span>
            <input id="editCourseOutcome" value="${escapeAttribute(question.courseOutcome || "")}" placeholder="CLO1" required />
          </label>
          <label>
            <span class="field-label">Student Outcome</span>
            <input id="editProgramOutcome" value="${escapeAttribute(question.programOutcome || "")}" placeholder="SO a" required />
          </label>
        </div>

        <label>
          <span class="field-label">Student Learning Outcome</span>
          <input id="editStudentLearningOutcome" value="${escapeAttribute(question.studentLearningOutcome || "")}" placeholder="SLO1" required />
        </label>

        <div class="field-grid two">
          <label>
            <span class="field-label">Bloom Level</span>
            <select id="editBloomLevel" required>
              ${["", "Remember", "Understand", "Apply", "Analyze", "Evaluate", "Create"]
                .map(
                  (level) => `
                    <option value="${level}" ${question.bloomLevel === level ? "selected" : ""}>${level || "Not mapped"}</option>
                  `,
                )
                .join("")}
            </select>
          </label>
          <label>
            <span class="field-label">Outcome Weight</span>
            <input id="editOutcomeWeight" type="number" min="0.1" step="0.1" value="${escapeAttribute(question.outcomeWeight || 1)}" required />
          </label>
        </div>

        <label class="checkbox-row">
          <input id="editIsComplexEngineeringProblem" type="checkbox" ${question.isComplexEngineeringProblem ? "checked" : ""} />
          <span>Complex engineering problem</span>
        </label>

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
  form.append(
    "engineeringProgram",
    document.getElementById("editEngineeringProgram").value,
  );
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
  form.append(
    "courseOutcome",
    document.getElementById("editCourseOutcome").value,
  );
  form.append(
    "programOutcome",
    document.getElementById("editProgramOutcome").value,
  );
  form.append(
    "studentLearningOutcome",
    document.getElementById("editStudentLearningOutcome").value,
  );
  form.append("bloomLevel", document.getElementById("editBloomLevel").value);
  form.append(
    "outcomeWeight",
    document.getElementById("editOutcomeWeight").value,
  );
  form.append(
    "isComplexEngineeringProblem",
    document.getElementById("editIsComplexEngineeringProblem").checked,
  );
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

if (canLoadQuestionsPage) {
  loadQuestions();
}
