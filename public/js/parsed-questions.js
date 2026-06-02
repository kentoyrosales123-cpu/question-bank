protectPage();
adminOnlyPage();

let pendingQuestions = [];
const selectedParsedIds = new Set();

async function loadParsedQuestions() {
  try {
    const data = await apiRequest("/parser");
    pendingQuestions = data.parsedQuestions.filter((q) => q.status === "Pending");
    selectedParsedIds.clear();

    updateReviewStats(pendingQuestions);
    renderParsedQuestions(pendingQuestions);
  } catch (error) {
    alert(error.message);
  }
}

function updateReviewStats(questions) {
  const needsAnswer = questions.filter((q) => !q.correctAnswer).length;
  const withMedia = questions.filter(
    (q) =>
      (q.image && q.image.contentType) ||
      (Array.isArray(q.tables) && q.tables.length > 0),
  ).length;

  document.getElementById("pendingCount").textContent = questions.length;
  document.getElementById("needsAnswerCount").textContent = needsAnswer;
  document.getElementById("mediaCount").textContent = withMedia;
}

function renderParsedQuestions(questions) {
  const list = document.getElementById("parsedList");

  if (questions.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <h2>No pending parsed questions</h2>
        <p>Uploaded questions that need review will appear here.</p>
      </div>
    `;
    syncBulkSelectionControls();
    return;
  }

  list.innerHTML = questions.map(renderParsedCard).join("");
  syncBulkSelectionControls();
}

function renderParsedCard(q, index) {
  const warnings = getQuestionWarnings(q);
  const hasImage = q.image && q.image.contentType;
  const hasTables = Array.isArray(q.tables) && q.tables.length > 0;

  return `
    <article class="review-card" id="parsed_card_${q._id}">
      <header class="review-card-header">
        <label class="review-select">
          <input
            class="parsed-select-checkbox"
            type="checkbox"
            value="${escapeHTML(q._id)}"
            ${selectedParsedIds.has(q._id) ? "checked" : ""}
            onchange="toggleParsedSelection('${q._id}', this.checked)"
          />
          <span>Select</span>
        </label>
        <div class="review-card-title">
          <div class="review-card-kicker">
            <span class="status-pill">Pending</span>
            <span>Item ${index + 1}</span>
          </div>
          <h2>${escapeHTML(q.questionText || "Untitled question")}</h2>
        </div>
        <div class="review-card-flags">
          ${hasImage ? `<span class="mini-badge">Image</span>` : ""}
          ${hasTables ? `<span class="mini-badge">Table</span>` : ""}
          ${warnings.length ? `<span class="mini-badge warning">Review</span>` : ""}
        </div>
      </header>

      ${
        warnings.length
          ? `<div class="review-warnings">${warnings
              .map((warning) => `<span>${escapeHTML(warning)}</span>`)
              .join("")}</div>`
          : ""
      }

      <div class="review-card-body">
        <aside class="review-assets">
          ${
            hasImage
              ? `<img
                  class="review-image"
                  src="/api/parser/${q._id}/image"
                  alt="Parsed question figure"
                  onerror="this.closest('.review-assets').classList.add('asset-error');"
                >`
              : hasTables
                ? ""
                : `<div class="asset-placeholder">No image</div>`
          }
          ${hasTables ? renderQuestionTables(q.tables) : ""}
        </aside>

        <section class="review-editor">
          <div class="field-grid two">
            ${renderField("Subject", `subject_${q._id}`, q.subject)}
            ${renderField("Topic", `topic_${q._id}`, q.topic)}
          </div>

          <label class="field-label" for="questionText_${q._id}">Question Text</label>
          <textarea id="questionText_${q._id}" class="question-textarea">${escapeHTML(q.questionText)}</textarea>

          <div class="choice-grid">
            ${renderChoiceField("A", q)}
            ${renderChoiceField("B", q)}
            ${renderChoiceField("C", q)}
            ${renderChoiceField("D", q)}
          </div>

          <div class="field-grid two">
            <div>
              <label class="field-label" for="correctAnswer_${q._id}">Correct Answer</label>
              <select id="correctAnswer_${q._id}">
                <option value="">Select answer</option>
                <option value="A" ${q.correctAnswer === "A" ? "selected" : ""}>A</option>
                <option value="B" ${q.correctAnswer === "B" ? "selected" : ""}>B</option>
                <option value="C" ${q.correctAnswer === "C" ? "selected" : ""}>C</option>
                <option value="D" ${q.correctAnswer === "D" ? "selected" : ""}>D</option>
              </select>
            </div>
            <div>
              <label class="field-label" for="difficulty_${q._id}">Difficulty</label>
              <select id="difficulty_${q._id}">
                <option value="Easy" ${q.difficulty === "Easy" ? "selected" : ""}>Easy</option>
                <option value="Average" ${q.difficulty === "Average" ? "selected" : ""}>Average</option>
                <option value="Difficult" ${q.difficulty === "Difficult" ? "selected" : ""}>Difficult</option>
              </select>
            </div>
          </div>

          <label class="field-label" for="explanation_${q._id}">Explanation</label>
          <textarea id="explanation_${q._id}" class="explanation-textarea">${escapeHTML(q.explanation || "")}</textarea>

          <footer class="review-actions">
            <button class="btn secondary" onclick="saveParsed('${q._id}')">Save Edit</button>
            <button class="btn success" onclick="approveParsed('${q._id}')">Approve to Question Bank</button>
            <button class="btn danger" onclick="rejectParsed('${q._id}')">Reject</button>
            <p class="message" id="msg_${q._id}"></p>
          </footer>
        </section>
      </div>
    </article>
  `;
}

function getVisibleParsedIds() {
  return Array.from(document.querySelectorAll(".parsed-select-checkbox")).map(
    (input) => input.value,
  );
}

function getVisibleSelectedIds() {
  const visibleIds = new Set(getVisibleParsedIds());
  return Array.from(selectedParsedIds).filter((id) => visibleIds.has(id));
}

function syncBulkSelectionControls() {
  const visibleIds = getVisibleParsedIds();
  const selectedIds = getVisibleSelectedIds();
  const selectAll = document.getElementById("selectAllParsed");
  const count = document.getElementById("selectedParsedCount");
  const approveButton = document.getElementById("bulkApproveButton");
  const rejectButton = document.getElementById("bulkRejectButton");
  const hasSelection = selectedIds.length > 0;

  count.textContent = `${selectedIds.length} selected`;
  approveButton.disabled = !hasSelection;
  rejectButton.disabled = !hasSelection;
  selectAll.disabled = visibleIds.length === 0;
  selectAll.checked = visibleIds.length > 0 && selectedIds.length === visibleIds.length;
  selectAll.indeterminate =
    selectedIds.length > 0 && selectedIds.length < visibleIds.length;
}

function toggleParsedSelection(id, isSelected) {
  if (isSelected) {
    selectedParsedIds.add(id);
  } else {
    selectedParsedIds.delete(id);
  }

  syncBulkSelectionControls();
}

function toggleVisibleParsedSelection(isSelected) {
  getVisibleParsedIds().forEach((id) => {
    if (isSelected) {
      selectedParsedIds.add(id);
    } else {
      selectedParsedIds.delete(id);
    }
  });

  document.querySelectorAll(".parsed-select-checkbox").forEach((input) => {
    input.checked = isSelected;
  });

  syncBulkSelectionControls();
}

function setBulkReviewMessage(text, type = "success") {
  const message = document.getElementById("bulkReviewMessage");

  message.textContent = text;
  message.classList.toggle("correct", type === "success");
  message.classList.toggle("wrong", type === "error");
}

function removeParsedQuestionFromList(id) {
  pendingQuestions = pendingQuestions.filter((q) => q._id !== id);
  selectedParsedIds.delete(id);
}

function renderField(label, id, value) {
  return `
    <div>
      <label class="field-label" for="${id}">${label}</label>
      <input id="${id}" value="${escapeHTML(value)}">
    </div>
  `;
}

function renderChoiceField(letter, q) {
  const id = `choice${letter}_${q._id}`;

  return `
    <div class="choice-field">
      <label class="choice-prefix" for="${id}">${letter}</label>
      <input id="${id}" value="${escapeHTML(q.choices?.[letter] || "")}">
    </div>
  `;
}

function getQuestionWarnings(q) {
  const warnings = [];
  const filledChoices = ["A", "B", "C", "D"].filter(
    (letter) => q.choices && q.choices[letter],
  );

  if (!q.questionText) warnings.push("Missing question text");
  if (filledChoices.length < 4) warnings.push("Incomplete choices");
  if (!q.correctAnswer) warnings.push("No answer selected");
  if (!q.subject) warnings.push("Missing subject");
  if (!q.topic) warnings.push("Missing topic");

  return warnings;
}

async function saveParsed(id) {
  const body = getParsedFormBody(id);

  try {
    const data = await apiRequest(`/parser/${id}`, "PUT", body);
    setMessage(id, data.message, "success");
  } catch (error) {
    setMessage(id, error.message, "error");
  }
}

async function approveParsed(id) {
  const body = getParsedFormBody(id);

  if (!isParsedQuestionReadyForApproval(body)) {
    setMessage(
      id,
      "Set the correct answer and complete all choices before approving.",
      "error",
    );
    return;
  }

  try {
    await apiRequest(`/parser/${id}`, "PUT", body);
    const data = await apiRequest(`/parser/${id}/approve`, "POST");

    setMessage(id, data.message, "success");
    removeParsedQuestionFromList(id);
    setTimeout(loadParsedQuestions, 500);
  } catch (error) {
    setMessage(id, error.message, "error");
  }
}

function isParsedQuestionReadyForApproval(body) {
  const missingChoices = ["A", "B", "C", "D"].filter(
    (letter) => !body.choices[letter],
  );

  return Boolean(body.correctAnswer && missingChoices.length === 0);
}

async function rejectParsed(id) {
  try {
    const data = await apiRequest(`/parser/${id}/reject`, "POST");
    setMessage(id, data.message, "success");

    const card = document.getElementById(`parsed_card_${id}`);

    if (card) {
      card.style.transition = "opacity 0.25s ease, transform 0.25s ease";
      card.style.opacity = "0";
      card.style.transform = "translateY(8px)";

      setTimeout(() => {
        removeParsedQuestionFromList(id);
        updateReviewStats(pendingQuestions);
        renderParsedQuestions(getFilteredQuestions());
      }, 250);
    }
  } catch (error) {
    setMessage(id, error.message, "error");
  }
}

async function approveSelectedParsed() {
  const ids = getVisibleSelectedIds();

  if (ids.length === 0) {
    setBulkReviewMessage("Select at least one parsed question.", "error");
    return;
  }

  const invalidIds = ids.filter((id) => {
    const body = getParsedFormBody(id);
    return !isParsedQuestionReadyForApproval(body);
  });

  if (invalidIds.length > 0) {
    invalidIds.forEach((id) => {
      setMessage(
        id,
        "Set the correct answer and complete all choices before approving.",
        "error",
      );
    });
    setBulkReviewMessage(
      `${invalidIds.length} selected question${invalidIds.length > 1 ? "s need" : " needs"} a complete answer setup before approval.`,
      "error",
    );
    return;
  }

  setBulkActionState(true);
  setBulkReviewMessage(`Approving ${ids.length} selected question${ids.length > 1 ? "s" : ""}...`);

  let approvedCount = 0;

  try {
    for (const id of ids) {
      await apiRequest(`/parser/${id}`, "PUT", getParsedFormBody(id));
      const data = await apiRequest(`/parser/${id}/approve`, "POST");
      approvedCount++;
      setMessage(id, data.message, "success");
      removeParsedQuestionFromList(id);
    }

    setBulkReviewMessage(`${approvedCount} selected question${approvedCount > 1 ? "s" : ""} approved.`);
    renderParsedQuestions(getFilteredQuestions());
    updateReviewStats(pendingQuestions);
  } catch (error) {
    setBulkReviewMessage(
      `${approvedCount} approved before an error occurred: ${error.message}`,
      "error",
    );
    renderParsedQuestions(getFilteredQuestions());
    updateReviewStats(pendingQuestions);
  } finally {
    setBulkActionState(false);
  }
}

async function rejectSelectedParsed() {
  const ids = getVisibleSelectedIds();

  if (ids.length === 0) {
    setBulkReviewMessage("Select at least one parsed question.", "error");
    return;
  }

  setBulkActionState(true);
  setBulkReviewMessage(`Rejecting ${ids.length} selected question${ids.length > 1 ? "s" : ""}...`);

  let rejectedCount = 0;

  try {
    for (const id of ids) {
      const data = await apiRequest(`/parser/${id}/reject`, "POST");
      rejectedCount++;
      setMessage(id, data.message, "success");
      removeParsedQuestionFromList(id);
    }

    setBulkReviewMessage(`${rejectedCount} selected question${rejectedCount > 1 ? "s" : ""} rejected.`);
    renderParsedQuestions(getFilteredQuestions());
    updateReviewStats(pendingQuestions);
  } catch (error) {
    setBulkReviewMessage(
      `${rejectedCount} rejected before an error occurred: ${error.message}`,
      "error",
    );
    renderParsedQuestions(getFilteredQuestions());
    updateReviewStats(pendingQuestions);
  } finally {
    setBulkActionState(false);
  }
}

function setBulkActionState(isWorking) {
  document.getElementById("bulkApproveButton").disabled = isWorking;
  document.getElementById("bulkRejectButton").disabled = isWorking;
  document.getElementById("selectAllParsed").disabled = isWorking;

  if (!isWorking) {
    syncBulkSelectionControls();
  }
}

function getParsedFormBody(id) {
  return {
    subject: document.getElementById(`subject_${id}`).value.trim(),
    topic: document.getElementById(`topic_${id}`).value.trim(),
    questionText: document.getElementById(`questionText_${id}`).value.trim(),
    choices: {
      A: document.getElementById(`choiceA_${id}`).value.trim(),
      B: document.getElementById(`choiceB_${id}`).value.trim(),
      C: document.getElementById(`choiceC_${id}`).value.trim(),
      D: document.getElementById(`choiceD_${id}`).value.trim(),
    },
    correctAnswer: document.getElementById(`correctAnswer_${id}`).value,
    difficulty: document.getElementById(`difficulty_${id}`).value,
    explanation: document.getElementById(`explanation_${id}`).value.trim(),
  };
}

function setMessage(id, text, type) {
  const message = document.getElementById(`msg_${id}`);

  if (!message) return;

  message.textContent = text;
  message.classList.toggle("correct", type === "success");
  message.classList.toggle("wrong", type === "error");
}

function getFilteredQuestions() {
  const query = document.getElementById("reviewSearch").value.trim().toLowerCase();

  if (!query) {
    return pendingQuestions;
  }

  return pendingQuestions.filter((q) =>
    [q.subject, q.topic, q.questionText, q.correctAnswer, q.difficulty]
      .join(" ")
      .toLowerCase()
      .includes(query),
  );
}

function escapeHTML(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
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

document.getElementById("reviewSearch").addEventListener("input", () => {
  selectedParsedIds.clear();
  renderParsedQuestions(getFilteredQuestions());
});

document.getElementById("selectAllParsed").addEventListener("change", (event) => {
  toggleVisibleParsedSelection(event.target.checked);
});

document
  .getElementById("bulkApproveButton")
  .addEventListener("click", approveSelectedParsed);

document
  .getElementById("bulkRejectButton")
  .addEventListener("click", rejectSelectedParsed);

loadParsedQuestions();
