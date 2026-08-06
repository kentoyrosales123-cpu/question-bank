protectPage();

const parsedReviewUser = getUser();

if (parsedReviewUser && !canCreateContentRole(parsedReviewUser)) {
  alert("Parsed question review is for Admins, Exam Creators, and CEE-CAC Coordinators only.");
  location.href = getDashboardUrl(parsedReviewUser);
}

let pendingQuestions = [];
const selectedParsedIds = new Set();
const parsedReviewParams = new URLSearchParams(location.search);
const parsedReviewUploadId = parsedReviewParams.get("uploadId") || "";
const approvalQueue = [];
const approvalQueuedIds = new Set();
const approvalQueueStates = new Map();
let isApprovalQueueRunning = false;
let approvalQueueTotal = 0;
let approvalQueueCompleted = 0;
let approvalQueueFailed = 0;

async function loadParsedQuestions() {
  try {
    const endpoint = parsedReviewUploadId
      ? `/parser?uploadId=${encodeURIComponent(parsedReviewUploadId)}`
      : "/parser";
    const data = await apiRequest(endpoint);
    pendingQuestions = data.parsedQuestions.filter((q) => q.status === "Pending");
    selectedParsedIds.clear();

    updateParsedReviewScope(data);

    updateReviewStats(pendingQuestions);
    renderParsedQuestions(pendingQuestions);
  } catch (error) {
    alert(error.message);
  }
}

function updateParsedReviewScope(data) {
  const heading = document.querySelector(".topbar h1");
  const uploadName =
    data.upload?.originalName ||
    pendingQuestions.find((question) => question.upload?.originalName)?.upload
      ?.originalName;

  if (!heading || !parsedReviewUploadId) {
    return;
  }

  heading.textContent = uploadName
    ? `Review Parsed Questions: ${uploadName}`
    : "Review Parsed Questions";
}

function updateReviewStats(questions) {
  const needsAnswer = questions.filter((q) => !q.correctAnswer).length;
  const withMedia = questions.filter(
    (q) =>
      (q.image && q.image.contentType) ||
      (Array.isArray(q.tables) && q.tables.length > 0),
  ).length;
  const duplicateRisk = questions.filter(
    (q) => Array.isArray(q.duplicateCandidates) && q.duplicateCandidates.length > 0,
  ).length;

  document.getElementById("pendingCount").textContent = questions.length;
  document.getElementById("needsAnswerCount").textContent = needsAnswer;
  document.getElementById("mediaCount").textContent = withMedia;
  document.getElementById("duplicateRiskCount").textContent = duplicateRisk;
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
  const duplicateCandidates = q.duplicateCandidates || [];
  const appliedOutcome = getAutoAppliedOutcomeValues(q);
  const queueState = approvalQueueStates.get(q._id);
  const isQueueLocked =
    queueState?.state === "queued" || queueState?.state === "processing";

  return `
    <article class="review-card ${queueState ? `queue-${queueState.state}` : ""}" id="parsed_card_${q._id}">
      <header class="review-card-header">
        <label class="review-select">
          <input
            class="parsed-select-checkbox"
            type="checkbox"
            value="${escapeHTML(q._id)}"
            ${selectedParsedIds.has(q._id) ? "checked" : ""}
            ${isQueueLocked ? "disabled" : ""}
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
          ${duplicateCandidates.length ? `<span class="mini-badge warning">Duplicate</span>` : ""}
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

      ${duplicateCandidates.length ? renderDuplicateWarning(duplicateCandidates) : ""}

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

          <div class="obe-suggestion">
            <small>
              Complex engineering problem score:
              ${escapeHTML(q.complexityScore || 0)}%
            </small>
            <strong>
              ${escapeHTML(q.complexityLevel || (q.isComplexEngineeringProblem ? "Complex Engineering Problem" : "Routine Engineering Problem"))}
            </strong>
            ${
              Array.isArray(q.complexityReasons) && q.complexityReasons.length
                ? `<span>${q.complexityReasons.map(escapeHTML).join(" | ")}</span>`
                : `<span>No complexity indicators detected yet.</span>`
            }
          </div>

          <label class="checkbox-row">
            <input
              id="isComplexEngineeringProblem_${q._id}"
              type="checkbox"
              ${q.isComplexEngineeringProblem ? "checked" : ""}
            />
            <span>Complex engineering problem</span>
          </label>

          ${renderOutcomeSuggestion(q)}

          <div class="field-grid two">
            ${renderField("Course Outcome", `courseOutcome_${q._id}`, appliedOutcome.courseOutcome)}
            ${renderField("Student Outcome", `programOutcome_${q._id}`, appliedOutcome.programOutcome)}
          </div>

          ${renderField("Student Learning Outcome", `studentLearningOutcome_${q._id}`, appliedOutcome.studentLearningOutcome)}

          <div class="field-grid two">
            <div>
              <label class="field-label" for="bloomLevel_${q._id}">Bloom Level</label>
              <select id="bloomLevel_${q._id}">
                ${["", "Remember", "Understand", "Apply", "Analyze", "Evaluate", "Create"]
                  .map(
                    (level) => `
                      <option value="${level}" ${appliedOutcome.bloomLevel === level ? "selected" : ""}>${level || "Not mapped"}</option>
                    `,
                  )
                  .join("")}
              </select>
            </div>
            <div>
              <label class="field-label" for="outcomeWeight_${q._id}">Outcome Weight</label>
              <input id="outcomeWeight_${q._id}" type="number" min="0" step="0.1" value="${escapeHTML(q.outcomeWeight || 1)}">
            </div>
          </div>

          <label class="field-label" for="explanation_${q._id}">Explanation</label>
          <textarea id="explanation_${q._id}" class="explanation-textarea">${escapeHTML(q.explanation || "")}</textarea>

          <footer class="review-actions">
            <button class="btn secondary" onclick="saveParsed('${q._id}')" ${isQueueLocked ? "disabled" : ""}>Save Edit</button>
            <button class="btn success" onclick="approveParsed('${q._id}')" ${isQueueLocked ? "disabled" : ""}>Add to Question Bank</button>
            <button class="btn danger" onclick="rejectParsed('${q._id}')" ${isQueueLocked ? "disabled" : ""}>Reject</button>
            <p class="message ${queueState?.state === "error" ? "wrong" : queueState ? "correct" : ""}" id="msg_${q._id}">
              ${queueState ? escapeHTML(queueState.message) : ""}
            </p>
          </footer>
        </section>
      </div>
    </article>
  `;
}

function getAutoAppliedOutcomeValues(q) {
  const suggestion = q.suggestedCourseOutcome || {};

  return {
    courseOutcome: q.courseOutcome || suggestion.code || "",
    programOutcome: q.programOutcome || suggestion.programOutcome || "",
    studentLearningOutcome:
      q.studentLearningOutcome || suggestion.studentLearningOutcome || "",
    bloomLevel: q.bloomLevel || suggestion.bloomLevel || "",
  };
}

function renderDuplicateWarning(candidates) {
  return `
    <div class="review-warnings duplicate-warning">
      <strong>High duplicate risk</strong>
      ${candidates
        .map(
          (candidate) => `
            <span>
              ${Math.round(candidate.score * 100)}% match:
              ${escapeHTML(candidate.engineeringProgram || "No program")} -
              ${escapeHTML(candidate.questionText).slice(0, 120)}
            </span>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderOutcomeSuggestion(q) {
  const suggestion = q.suggestedCourseOutcome;

  if (!suggestion) {
    return `
      <div class="obe-suggestion">
        <small>No CO/CLO suggestion available for this subject yet.</small>
      </div>
    `;
  }
  const outcomeTitle = suggestion.code
    ? `${escapeHTML(suggestion.code)} - ${escapeHTML(suggestion.description)}`
    : escapeHTML(suggestion.description || "No CO/CLO match");

  return `
    <div class="obe-suggestion">
      <small>Suggested mapping auto-applied - ${suggestion.confidence}% confidence</small>
      <strong>${outcomeTitle}</strong>
      <span>
        ${escapeHTML(suggestion.programOutcome || "No SO mapped")}
        ${suggestion.studentLearningOutcome
          ? ` | ${escapeHTML(suggestion.studentLearningOutcome)}`
          : ""}
        ${suggestion.bloomLevel ? ` | ${escapeHTML(suggestion.bloomLevel)}` : ""}
      </span>
      <button class="btn secondary compact-btn" type="button" onclick="applyOutcomeSuggestion('${q._id}')">
        Reset to Suggestion
      </button>
    </div>
  `;
}

function applyOutcomeSuggestion(id) {
  const question = pendingQuestions.find((item) => item._id === id);
  const suggestion = question?.suggestedCourseOutcome;

  if (!suggestion) {
    setMessage(id, "No suggestion available for this question.", "error");
    return;
  }

  document.getElementById(`courseOutcome_${id}`).value = suggestion.code || "";
  document.getElementById(`programOutcome_${id}`).value =
    suggestion.programOutcome || "";
  document.getElementById(`studentLearningOutcome_${id}`).value =
    suggestion.studentLearningOutcome || "";
  document.getElementById(`bloomLevel_${id}`).value = suggestion.bloomLevel || "";
  setMessage(id, "CO/CLO suggestion applied. Review it before approving.", "success");
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
  approvalQueueStates.delete(id);
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
  if (!q.engineeringProgram) warnings.push("Missing program");
  if (!q.topic) warnings.push("Missing topic");
  if (!q.courseOutcome) warnings.push("Missing CO/CLO");
  if (!q.programOutcome) warnings.push("Missing SO");
  if (!q.studentLearningOutcome) warnings.push("Missing SLO");
  if (!q.bloomLevel) warnings.push("Missing Bloom level");
  if (!Number.isFinite(Number(q.outcomeWeight)) || Number(q.outcomeWeight) <= 0) {
    warnings.push("Missing outcome weight");
  }
  if (Array.isArray(q.duplicateCandidates) && q.duplicateCandidates.length > 0) {
    warnings.push("High duplicate risk");
  }

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
      getParsedQuestionApprovalError(body),
      "error",
    );
    return;
  }

  enqueueApprovalJobs([{ id, body }]);
}

function isParsedQuestionReadyForApproval(body) {
  return !getParsedQuestionApprovalError(body);
}

function getParsedQuestionApprovalError(body) {
  const missingChoices = ["A", "B", "C", "D"].filter(
    (letter) => !body.choices[letter],
  );

  if (!body.engineeringProgram) {
    return "This question has no saved engineering program. Re-parse it after selecting a program.";
  }

  if (!body.correctAnswer || missingChoices.length > 0) {
    return "Set the correct answer and complete all choices before approving.";
  }

  if (
    !body.courseOutcome ||
    !body.programOutcome ||
    !body.studentLearningOutcome ||
    !body.bloomLevel ||
    !Number.isFinite(Number(body.outcomeWeight)) ||
    Number(body.outcomeWeight) <= 0
  ) {
    return "Complete CO/CLO, SO, SLO, Bloom level, and positive outcome weight before approving.";
  }

  return "";
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
      const body = getParsedFormBody(id);

      setMessage(
        id,
        getParsedQuestionApprovalError(body),
        "error",
      );
    });
    setBulkReviewMessage(
      `${invalidIds.length} selected question${invalidIds.length > 1 ? "s need" : " needs"} a complete answer setup before approval.`,
      "error",
    );
    return;
  }

  enqueueApprovalJobs(ids.map((id) => ({ id, body: getParsedFormBody(id) })));
}

function enqueueApprovalJobs(jobs) {
  const newJobs = jobs.filter((job) => !approvalQueuedIds.has(job.id));

  if (newJobs.length === 0) {
    setBulkReviewMessage("Selected questions are already in the approval queue.", "error");
    return;
  }

  if (!isApprovalQueueRunning) {
    approvalQueueTotal = 0;
    approvalQueueCompleted = 0;
    approvalQueueFailed = 0;
  }

  newJobs.forEach((job) => {
    approvalQueue.push(job);
    approvalQueuedIds.add(job.id);
    approvalQueueTotal += 1;
    setCardQueueState(job.id, "queued", "Queued for approval.");
  });

  setBulkReviewMessage(
    `${newJobs.length} question${newJobs.length > 1 ? "s" : ""} added to approval queue.`,
  );
  updateApprovalQueuePanel();
  processApprovalQueue();
}

async function processApprovalQueue() {
  if (isApprovalQueueRunning) {
    return;
  }

  isApprovalQueueRunning = true;
  setBulkActionState(true);

  while (approvalQueue.length > 0) {
    const job = approvalQueue.shift();
    const position = approvalQueueCompleted + approvalQueueFailed + 1;

    setCardQueueState(
      job.id,
      "processing",
      `Processing approval ${position}/${approvalQueueTotal}...`,
    );
    updateApprovalQueuePanel(job.id);

    try {
      await apiRequest(`/parser/${job.id}`, "PUT", job.body);
      const data = await apiRequest(`/parser/${job.id}/approve`, "POST");

      approvalQueueCompleted += 1;
      setCardQueueState(job.id, "done", data.message || "Added to question bank.");
      removeParsedQuestionFromList(job.id);
      updateReviewStats(pendingQuestions);
      fadeApprovedCard(job.id);
    } catch (error) {
      approvalQueueFailed += 1;
      setCardQueueState(job.id, "error", error.message);
      setCardControlsDisabled(job.id, false);
    } finally {
      approvalQueuedIds.delete(job.id);
      updateApprovalQueuePanel();
    }
  }

  const completed = approvalQueueCompleted;
  const failed = approvalQueueFailed;

  isApprovalQueueRunning = false;
  setBulkActionState(false);
  selectedParsedIds.clear();
  renderParsedQuestions(getFilteredQuestions());
  updateReviewStats(pendingQuestions);
  updateApprovalQueuePanel();

  if (failed > 0) {
    setBulkReviewMessage(
      `${completed} approved, ${failed} failed. Review the failed card messages and try again.`,
      "error",
    );
  } else {
    setBulkReviewMessage(
      `${completed} question${completed === 1 ? "" : "s"} added to the question bank.`,
    );
  }
}

function setCardQueueState(id, state, message) {
  const card = document.getElementById(`parsed_card_${id}`);

  approvalQueueStates.set(id, { state, message });
  setMessage(id, message, state === "error" ? "error" : "success");

  if (!card) return;

  card.classList.toggle("queue-queued", state === "queued");
  card.classList.toggle("queue-processing", state === "processing");
  card.classList.toggle("queue-done", state === "done");
  card.classList.toggle("queue-error", state === "error");
  setCardControlsDisabled(id, state === "queued" || state === "processing");
}

function setCardControlsDisabled(id, isDisabled) {
  const card = document.getElementById(`parsed_card_${id}`);

  if (!card) return;

  card
    .querySelectorAll("button, input, select, textarea")
    .forEach((control) => {
      control.disabled = isDisabled;
    });
}

function fadeApprovedCard(id) {
  const card = document.getElementById(`parsed_card_${id}`);

  if (!card) return;

  card.style.transition = "opacity 0.25s ease, transform 0.25s ease";
  card.style.opacity = "0.58";
  card.style.transform = "translateY(4px)";
}

function updateApprovalQueuePanel(activeId = "") {
  const panel = document.getElementById("approvalQueuePanel");
  const title = document.getElementById("approvalQueueTitle");
  const progress = document.getElementById("approvalQueueProgress");
  const detail = document.getElementById("approvalQueueDetail");

  if (!panel || !title || !progress || !detail) return;

  const processed = approvalQueueCompleted + approvalQueueFailed;
  const percent = approvalQueueTotal
    ? Math.round((processed / approvalQueueTotal) * 100)
    : 0;
  const activeQuestion = activeId
    ? pendingQuestions.find((question) => question._id === activeId)
    : null;

  panel.classList.toggle(
    "hidden",
    !isApprovalQueueRunning && approvalQueueTotal === 0,
  );
  title.textContent = isApprovalQueueRunning
    ? `Processing ${processed + 1 > approvalQueueTotal ? approvalQueueTotal : processed + 1} of ${approvalQueueTotal}`
    : `Completed ${approvalQueueCompleted} of ${approvalQueueTotal}`;
  progress.style.width = `${percent}%`;
  detail.textContent = isApprovalQueueRunning
    ? activeQuestion
      ? `Now approving: ${truncateQueueText(activeQuestion.questionText)}`
      : `${approvalQueue.length} waiting in queue...`
    : approvalQueueFailed > 0
      ? `${approvalQueueFailed} question${approvalQueueFailed === 1 ? "" : "s"} need attention.`
      : "Approval queue finished.";

  if (!isApprovalQueueRunning && approvalQueueTotal > 0 && approvalQueueFailed === 0) {
    setTimeout(() => {
      if (!isApprovalQueueRunning) {
        panel.classList.add("hidden");
        approvalQueueTotal = 0;
        approvalQueueCompleted = 0;
        approvalQueueFailed = 0;
        progress.style.width = "0%";
      }
    }, 2500);
  }
}

function truncateQueueText(value) {
  const text = String(value || "Untitled question");

  return text.length > 90 ? `${text.slice(0, 90)}...` : text;
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
  const parsedQuestion = pendingQuestions.find((question) => question._id === id);

  return {
    subject: document.getElementById(`subject_${id}`).value.trim(),
    engineeringProgram: parsedQuestion?.engineeringProgram || "",
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
    isComplexEngineeringProblem: document.getElementById(
      `isComplexEngineeringProblem_${id}`,
    ).checked,
    courseOutcome: document.getElementById(`courseOutcome_${id}`).value.trim(),
    programOutcome: document.getElementById(`programOutcome_${id}`).value.trim(),
    studentLearningOutcome: document
      .getElementById(`studentLearningOutcome_${id}`)
      .value.trim(),
    bloomLevel: document.getElementById(`bloomLevel_${id}`).value,
    outcomeWeight: document.getElementById(`outcomeWeight_${id}`).value,
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
    [
      q.subject,
      q.engineeringProgram,
      q.topic,
      q.questionText,
      q.correctAnswer,
      q.difficulty,
      q.courseOutcome,
      q.programOutcome,
      q.studentLearningOutcome,
      q.bloomLevel,
    ]
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
