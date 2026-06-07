protectPage();

let examOptionData = [];
let blueprintRows = [];
let generationPollTimer = null;

const summaryFields = [
  "title",
  "subject",
  "topic",
  "totalItems",
  "easyCount",
  "averageCount",
  "difficultCount",
];

summaryFields.forEach((id) => {
  document.getElementById(id)?.addEventListener("input", updateExamSummary);
});

function getNumber(id) {
  return Number(document.getElementById(id).value || 0);
}

function getSelectedValues(id) {
  return Array.from(document.getElementById(id).selectedOptions || []).map(
    (option) => option.value,
  );
}

function formatSelection(values, fallback) {
  return values.length > 0 ? values.join(", ") : fallback;
}

function formatPercent(count, total) {
  return total > 0 ? `${Math.round((count / total) * 100)}%` : "0%";
}

function updateDifficultyDonut(easy, average, difficult) {
  const donut = document.getElementById("summaryDifficultyDonut");
  if (!donut) return;

  const total = easy + average + difficult;
  if (total <= 0) {
    donut.style.background = "conic-gradient(#d6d6d6 0 100%)";
    return;
  }

  const easyEnd = (easy / total) * 100;
  const averageEnd = easyEnd + (average / total) * 100;

  donut.style.background = `
    conic-gradient(
      #860012 0 ${easyEnd}%,
      #e3a000 ${easyEnd}% ${averageEnd}%,
      #a9a9a9 ${averageEnd}% 100%
    )
  `;
}

function adjustTotalItems(amount) {
  const input = document.getElementById("totalItems");
  input.value = Math.max(1, Number(input.value || 0) + amount);
  updateExamSummary();
}

function updateExamSummary() {
  syncBlueprintTotals();
  const totalItems = getNumber("totalItems");
  const easy = getNumber("easyCount");
  const average = getNumber("averageCount");
  const difficult = getNumber("difficultCount");
  const subjects = getSelectedValues("subject");
  const topics = getSelectedValues("topic");

  document.getElementById("summaryTotal").textContent = totalItems || 0;
  document.getElementById("summarySubject").textContent =
    formatSelection(subjects, "Not selected");
  document.getElementById("summaryTopic").textContent =
    formatSelection(topics, "All topics");
  document.getElementById("summaryEasy").textContent = `${easy} questions`;
  document.getElementById("summaryAverage").textContent = `${average} questions`;
  document.getElementById("summaryDifficult").textContent =
    `${difficult} questions`;

  document.getElementById("easyPercent").textContent = formatPercent(
    easy,
    totalItems,
  );
  document.getElementById("averagePercent").textContent = formatPercent(
    average,
    totalItems,
  );
  document.getElementById("difficultPercent").textContent = formatPercent(
    difficult,
    totalItems,
  );
  updateDifficultyDonut(easy, average, difficult);
}

function getAvailableBlueprintTopics() {
  const selectedSubjects = getSelectedValues("subject");
  const selectedTopics = getSelectedValues("topic");
  const rows = [];

  examOptionData.forEach((item) => {
    if (selectedSubjects.length > 0 && !selectedSubjects.includes(item.subject)) {
      return;
    }

    (item.topics || []).forEach((topic) => {
      if (selectedTopics.length > 0 && !selectedTopics.includes(topic)) {
        return;
      }

      rows.push({ subject: item.subject, topic });
    });
  });

  return rows;
}

function renderBlueprintRows() {
  const body = document.getElementById("blueprintBody");

  if (blueprintRows.length === 0) {
    body.innerHTML = `
      <tr>
        <td colspan="6" class="empty-table-cell">No blueprint rows yet.</td>
      </tr>
    `;
    syncBlueprintTotals();
    return;
  }

  body.innerHTML = blueprintRows
    .map(
      (row, index) => `
        <tr>
          <td>${escapeHTML(row.subject)}</td>
          <td>${escapeHTML(row.topic)}</td>
          <td><input type="number" min="0" value="${row.easyCount}" onchange="updateBlueprintCount(${index}, 'easyCount', this.value)"></td>
          <td><input type="number" min="0" value="${row.averageCount}" onchange="updateBlueprintCount(${index}, 'averageCount', this.value)"></td>
          <td><input type="number" min="0" value="${row.difficultCount}" onchange="updateBlueprintCount(${index}, 'difficultCount', this.value)"></td>
          <td><button class="btn danger" type="button" onclick="removeBlueprintRow(${index})">Remove</button></td>
        </tr>
      `,
    )
    .join("");
  syncBlueprintTotals();
}

function addSelectedTopicsToBlueprint() {
  const existingKeys = new Set(
    blueprintRows.map((row) => `${row.subject}|||${row.topic}`),
  );
  const rowsToAdd = getAvailableBlueprintTopics().filter(
    (row) => !existingKeys.has(`${row.subject}|||${row.topic}`),
  );

  blueprintRows.push(
    ...rowsToAdd.map((row) => ({
      ...row,
      easyCount: 0,
      averageCount: 0,
      difficultCount: 0,
    })),
  );
  renderBlueprintRows();
}

function updateBlueprintCount(index, field, value) {
  if (!blueprintRows[index]) return;
  blueprintRows[index][field] = Math.max(0, Number(value || 0));
  syncBlueprintTotals();
  updateExamSummary();
}

function removeBlueprintRow(index) {
  blueprintRows.splice(index, 1);
  renderBlueprintRows();
  updateExamSummary();
}

function clearBlueprintRows() {
  blueprintRows = [];
  renderBlueprintRows();
  updateExamSummary();
}

function syncBlueprintTotals() {
  if (!document.getElementById("useBlueprint")?.checked) {
    return;
  }

  const totals = blueprintRows.reduce(
    (sum, row) => ({
      easyCount: sum.easyCount + Number(row.easyCount || 0),
      averageCount: sum.averageCount + Number(row.averageCount || 0),
      difficultCount: sum.difficultCount + Number(row.difficultCount || 0),
    }),
    { easyCount: 0, averageCount: 0, difficultCount: 0 },
  );

  document.getElementById("easyCount").value = totals.easyCount;
  document.getElementById("averageCount").value = totals.averageCount;
  document.getElementById("difficultCount").value = totals.difficultCount;
  document.getElementById("totalItems").value =
    totals.easyCount + totals.averageCount + totals.difficultCount;
}

function renderOptions(selectId, values, placeholder) {
  const select = document.getElementById(selectId);

  select.innerHTML =
    values.length > 0
      ? values
          .map((value) => `<option value="${escapeHTML(value)}">${escapeHTML(value)}</option>`)
          .join("")
      : `<option disabled>${escapeHTML(placeholder)}</option>`;
}

function updateTopicOptions() {
  const selectedSubjects = getSelectedValues("subject");
  const topics = examOptionData
    .filter(
      (item) =>
        selectedSubjects.length === 0 ||
        selectedSubjects.includes(item.subject),
    )
    .flatMap((item) => item.topics || []);

  renderOptions("topic", [...new Set(topics)].sort(), "No topics available");
  updateExamSummary();
}

async function loadExamOptions() {
  try {
    const data = await apiRequest("/exams/options");
    examOptionData = data.subjects || [];

    renderOptions(
      "subject",
      examOptionData.map((item) => item.subject),
      "No subjects available",
    );
    updateTopicOptions();
  } catch (error) {
    document.getElementById("examMessage").textContent =
      `Unable to load subjects and topics: ${error.message}`;
    document.getElementById("examMessage").classList.add("wrong");
  }
}

document.getElementById("subject").addEventListener("change", updateTopicOptions);
document.getElementById("topic").addEventListener("change", updateExamSummary);
document.getElementById("useBlueprint").addEventListener("change", updateExamSummary);
document
  .getElementById("addBlueprintRowsButton")
  .addEventListener("click", addSelectedTopicsToBlueprint);
document
  .getElementById("clearBlueprintButton")
  .addEventListener("click", clearBlueprintRows);

document.getElementById("examForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const subjects = getSelectedValues("subject");
  const topics = getSelectedValues("topic");

  const body = {
    title: document.getElementById("title").value,
    subjects,
    topics,
    totalItems: Number(document.getElementById("totalItems").value),
    easyCount: Number(document.getElementById("easyCount").value),
    averageCount: Number(document.getElementById("averageCount").value),
    difficultCount: Number(document.getElementById("difficultCount").value),
  };
  const useBlueprint = document.getElementById("useBlueprint").checked;

  if (useBlueprint) {
    body.blueprint = blueprintRows.filter(
      (row) =>
        Number(row.easyCount || 0) +
          Number(row.averageCount || 0) +
          Number(row.difficultCount || 0) >
        0,
    );
  }

  if (!useBlueprint && subjects.length === 0) {
    document.getElementById("examMessage").textContent =
      "Select at least one subject.";
    document.getElementById("examMessage").classList.add("wrong");
    return;
  }

  if (useBlueprint && (!body.blueprint || body.blueprint.length === 0)) {
    document.getElementById("examMessage").textContent =
      "Add at least one blueprint row with item counts.";
    document.getElementById("examMessage").classList.add("wrong");
    return;
  }

  try {
    setGenerateButtonBusy(true);
    showGenerationQueueModal({
      status: "queued",
      queueNumber: "-",
      message: "Submitting your exam generation request...",
    });
    const data = await apiRequest("/exams/generate", "POST", body);

    if (data.queued) {
      updateGenerationQueueModal(data);
      pollGenerationJob(data.jobId);
      return;
    }

    handleGeneratedExamResult(data);
  } catch (error) {
    hideGenerationQueueModal();
    setGenerateButtonBusy(false);
    document.getElementById("examMessage").textContent = error.message;
    document.getElementById("examMessage").classList.add("wrong");
    document.getElementById("examMessage").classList.remove("correct");
  }
});

function handleGeneratedExamResult(data) {
  if (!data.exam) {
    throw new Error(data.message || "Exam generation finished without an exam.");
  }

    localStorage.setItem("current_exam_id", data.exam._id);
    const isPending = (data.exam.approvalStatus || "Approved") === "Pending";
    document.getElementById("examMessage").textContent =
      data.message ||
      (isPending
        ? "Exam generated and submitted for admin approval."
        : "Exam generated successfully. You can preview or download it now.");
    document.getElementById("examMessage").classList.remove("wrong");
    document.getElementById("examMessage").classList.add("correct");
    document
      .getElementById("generatedExamActions")
      .classList.toggle("hidden", isPending);
  hideGenerationQueueModal();
  setGenerateButtonBusy(false);
}

async function pollGenerationJob(jobId) {
  clearInterval(generationPollTimer);

  const checkStatus = async () => {
    try {
      const data = await apiRequest(`/exams/generate/jobs/${jobId}`);

      if (data.status === "completed") {
        clearInterval(generationPollTimer);
        handleGeneratedExamResult(data.result);
        return;
      }

      if (data.status === "failed") {
        clearInterval(generationPollTimer);
        hideGenerationQueueModal();
        setGenerateButtonBusy(false);
        throw new Error(data.result?.message || "Exam generation failed.");
      }

      updateGenerationQueueModal(data);
    } catch (error) {
      clearInterval(generationPollTimer);
      hideGenerationQueueModal();
      setGenerateButtonBusy(false);
      document.getElementById("examMessage").textContent = error.message;
      document.getElementById("examMessage").classList.add("wrong");
      document.getElementById("examMessage").classList.remove("correct");
    }
  };

  generationPollTimer = setInterval(checkStatus, 1500);
  await checkStatus();
}

function setGenerateButtonBusy(isBusy) {
  const button = document.querySelector(".generate-btn");
  button.disabled = isBusy;
  button.textContent = isBusy ? "Generating..." : "Generate Exam";
}

function ensureGenerationQueueModal() {
  if (document.getElementById("generationQueueModal")) {
    return;
  }

  const modal = document.createElement("div");
  modal.className = "modal hidden";
  modal.id = "generationQueueModal";
  modal.innerHTML = `
    <div class="modal-panel generation-queue-panel">
      <div class="modal-header">
        <div>
          <h2>Exam Generation Queue</h2>
          <p class="muted-text">Only 2 users can generate exams at the same time.</p>
        </div>
      </div>
      <div class="generation-queue-body">
        <strong id="generationQueueNumber">Queue #...</strong>
        <p id="generationQueueStatus">Waiting for an available generation slot...</p>
        <small id="generationQueueHint">Please keep this page open while your exam is generated.</small>
      </div>
    </div>
  `;
  document.body.append(modal);
}

function showGenerationQueueModal(data) {
  ensureGenerationQueueModal();
  updateGenerationQueueModal(data);
  document.getElementById("generationQueueModal").classList.remove("hidden");
}

function hideGenerationQueueModal() {
  document.getElementById("generationQueueModal")?.classList.add("hidden");
}

function updateGenerationQueueModal(data) {
  ensureGenerationQueueModal();
  const isProcessing = data.status === "processing";
  const queueNumber = data.queueNumber || "-";

  document.getElementById("generationQueueNumber").textContent = isProcessing
    ? "Now processing"
    : `Queue #${queueNumber}`;
  document.getElementById("generationQueueStatus").textContent =
    data.message ||
    (isProcessing
      ? "Your exam is being generated now."
      : "Waiting for an available generation slot...");
  document.getElementById("generationQueueHint").textContent = isProcessing
    ? "This usually takes a moment."
    : "Your request will start automatically when one of the 2 slots opens.";
}

loadExamOptions();
renderBlueprintRows();
updateExamSummary();

async function downloadGeneratedExam(endpoint) {
  const examId = localStorage.getItem("current_exam_id");

  if (!examId) {
    document.getElementById("examMessage").textContent = "Generate an exam first.";
    document.getElementById("examMessage").classList.add("wrong");
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
    a.download =
      endpoint === "download-answer-key-docx"
        ? "generated_exam_answer_key.docx"
        : "generated_exam_no_answer_key.docx";

    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  } catch (error) {
    document.getElementById("examMessage").textContent = error.message;
    document.getElementById("examMessage").classList.add("wrong");
  }
}
