protectPage();

const analysisUser = getUser();
let generatedExams = [];

if (analysisUser && !canUseItemAnalysisRole(analysisUser)) {
  alert("Item analysis is for exam users only.");
  location.href = getDashboardUrl(analysisUser);
}

document
  .getElementById("itemAnalysisForm")
  .addEventListener("submit", async (event) => {
    event.preventDefault();

    const form = new FormData(event.target);
    const message = document.getElementById("itemAnalysisMessage");
    const selectedGeneratedExam = getSelectedGeneratedExam();
    const includeInObe = document.getElementById("includeInObe")?.checked;

    if (includeInObe && !selectedGeneratedExam) {
      message.textContent =
        "Choose a generated exam first, then click Use Exam Details. OBE attainment needs the exam's CO/SO item mapping.";
      message.classList.add("wrong");
      message.classList.remove("correct");
      return;
    }

    if (includeInObe && !formMatchesGeneratedExam(selectedGeneratedExam)) {
      message.textContent =
        "Click Use Exam Details before uploading so the item count and exam information match the generated exam.";
      message.classList.add("wrong");
      message.classList.remove("correct");
      return;
    }

    if (includeInObe && selectedGeneratedExam) {
      form.set("includeInObe", "true");
      form.append("generatedExamId", selectedGeneratedExam._id);
    }

    try {
      message.textContent = "Uploading and computing item analysis...";
      message.classList.remove("wrong");

      const data = await apiRequest("/item-analysis/upload", "POST", form, true);
      message.textContent = data.message;
      message.classList.add("correct");
      location.href = `/item-analysis/${data.analysisExamId}`;
    } catch (error) {
      message.textContent = error.message;
      message.classList.add("wrong");
      message.classList.remove("correct");
    }
  });

function getSelectedGeneratedExam() {
  const select = document.getElementById("generatedExamSelect");
  return generatedExams.find((exam) => exam._id === select.value);
}

function updateAnalysisTypeFields() {
  const isProblemSolving =
    document.getElementById("analysisType").value === "Problem Solving";
  const answerKeyFields = document.getElementById("answerKeyFields");
  const maxScoreKeyWrap = document.getElementById("maxScoreKeyWrap");
  const omrButton = document.querySelector(
    'button[onclick="downloadOmrTemplate()"]',
  );

  if (answerKeyFields) answerKeyFields.hidden = isProblemSolving;
  if (maxScoreKeyWrap) maxScoreKeyWrap.hidden = !isProblemSolving;
  if (omrButton) omrButton.disabled = isProblemSolving;
}

function updateLinkedReportButton(analysisExamId = "") {
  const button = document.getElementById("openLinkedItemAnalysisButton");

  if (!button) {
    return;
  }

  if (!analysisExamId) {
    button.href = "#";
    button.classList.add("hidden");
    return;
  }

  button.href = `/item-analysis/${analysisExamId}`;
  button.classList.remove("hidden");
}

function getItemAnalysisExamPayload(exam) {
  return {
    title: document.getElementById("analysisTitle").value || exam?.title || "",
    subject:
      document.getElementById("analysisSubject").value || exam?.subject || "",
    section:
      document.getElementById("analysisSection").value ||
      exam?.section ||
      "No section",
    semester:
      document.getElementById("analysisSemester").value ||
      exam?.semester ||
      "",
    schoolYear:
      document.getElementById("analysisSchoolYear").value ||
      exam?.schoolYear ||
      "",
    assessmentMethod:
      document.getElementById("analysisAssessmentMethod").value ||
      exam?.assessmentMethod ||
      "Major Exam",
    assessmentPhase:
      document.getElementById("analysisAssessmentPhase").value ||
      exam?.assessmentPhase ||
      "Summative",
    analysisType:
      document.getElementById("analysisType").value ||
      exam?.examType ||
      "Multiple Choice",
  };
}

function formMatchesGeneratedExam(exam) {
  if (!exam) {
    return false;
  }

  const title = document.getElementById("analysisTitle").value.trim();
  const subject = document.getElementById("analysisSubject").value.trim();
  const items = Number(document.getElementById("analysisItems").value || 0);
  const analysisType = document.getElementById("analysisType").value;

  return (
    title === String(exam.title || "").trim() &&
    subject === String(exam.subject || "").trim() &&
    items === Number(exam.totalItems || 0) &&
    analysisType === (exam.examType || "Multiple Choice")
  );
}

async function ensureItemAnalysisExamFromGeneratedExam() {
  const exam = getSelectedGeneratedExam();

  if (!exam) {
    return null;
  }

  const data = await apiRequest(
    `/item-analysis/from-generated-exam/${exam._id}`,
    "POST",
    getItemAnalysisExamPayload(exam),
  );

  exam.analysisExamId = data.analysisExamId;
  exam.itemAnalysisExam = data.exam;
  updateLinkedReportButton(data.analysisExamId);

  return data.exam;
}

function formatExamDate(value) {
  return value
    ? new Date(value).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "-";
}

function renderGeneratedExamMeta() {
  const exam = getSelectedGeneratedExam();
  const meta = document.getElementById("generatedExamMeta");
  updateLinkedReportButton(exam?.analysisExamId || "");

  if (!exam) {
    meta.textContent = "";
    return;
  }

  meta.innerHTML = `
    <span>${escapeHTML(exam.subject || "No subject")}</span>
    <span>${escapeHTML(exam.topic || "All topics")}</span>
    <span>${escapeHTML(exam.section || "No section")}</span>
    <span>${escapeHTML(exam.semester || "No term")}</span>
    <span>${escapeHTML(exam.schoolYear || "No school year")}</span>
    <span>${escapeHTML(exam.assessmentMethod || "Major Exam")}</span>
    <span>${escapeHTML(exam.assessmentPhase || "Summative")}</span>
    <span>${escapeHTML(exam.examType || "Multiple Choice")}</span>
    <span>${escapeHTML(exam.totalItems)} items</span>
    <span>${formatExamDate(exam.createdAt)}</span>
  `;
}

function renderGeneratedExamOptions() {
  const select = document.getElementById("generatedExamSelect");
  const downloadButton = document.getElementById("downloadGeneratedAnswerKeyButton");
  const useButton = document.getElementById("useGeneratedExamButton");

  if (generatedExams.length === 0) {
    select.innerHTML = `<option value="">No generated exams found</option>`;
    select.disabled = true;
    downloadButton.disabled = true;
    useButton.disabled = true;
    return;
  }

  select.disabled = false;
  downloadButton.disabled = false;
  useButton.disabled = false;
  select.innerHTML = generatedExams
    .map(
      (exam) => `
        <option value="${escapeHTML(exam._id)}">
          ${escapeHTML(exam.title)} - ${escapeHTML(exam.totalItems)} items
        </option>
      `,
    )
    .join("");
  renderGeneratedExamMeta();
}

async function loadGeneratedExamChoices() {
  try {
    const data = await apiRequest("/users/me/activity");
    generatedExams = (data.exams || []).filter(
      (exam) => (exam.approvalStatus || "Approved") === "Approved",
    );
    renderGeneratedExamOptions();
  } catch (error) {
    const select = document.getElementById("generatedExamSelect");
    select.innerHTML = `<option value="">Unable to load generated exams</option>`;
    select.disabled = true;
    document.getElementById("downloadGeneratedAnswerKeyButton").disabled = true;
    document.getElementById("useGeneratedExamButton").disabled = true;
    updateLinkedReportButton("");
    setMessage("generatedExamMessage", error.message);
  }
}

async function useGeneratedExamDetails() {
  const exam = getSelectedGeneratedExam();

  if (!exam) {
    setMessage("generatedExamMessage", "Choose a generated exam first.");
    return;
  }

  document.getElementById("analysisTitle").value = exam.title || "";
  document.getElementById("analysisSubject").value = exam.subject || "";
  document.getElementById("analysisSection").value = exam.section || "";
  document.getElementById("analysisSemester").value = exam.semester || "";
  document.getElementById("analysisSchoolYear").value = exam.schoolYear || "";
  document.getElementById("analysisAssessmentMethod").value =
    exam.assessmentMethod || "Major Exam";
  document.getElementById("analysisAssessmentPhase").value =
    exam.assessmentPhase || "Summative";
  document.getElementById("analysisType").value =
    exam.examType || "Multiple Choice";
  document.getElementById("analysisItems").value = exam.totalItems || "";
  updateAnalysisTypeFields();

  try {
    setMessage(
      "generatedExamMessage",
      "Linking generated exam to item analysis...",
      false,
    );
    await ensureItemAnalysisExamFromGeneratedExam();
    setMessage(
      "generatedExamMessage",
      (exam.examType || "Multiple Choice") === "Problem Solving"
        ? "Problem-solving exam linked. Upload numeric item scores to compute analysis."
        : "Exam details linked to item analysis. The report shortcut and OMR QR are ready.",
      false,
    );
  } catch (error) {
    setMessage("generatedExamMessage", error.message);
  }
}

async function downloadGeneratedAnswerKey() {
  const exam = getSelectedGeneratedExam();

  if (!exam) {
    setMessage("generatedExamMessage", "Choose a generated exam first.");
    return;
  }

  try {
    setMessage("generatedExamMessage", "Preparing answer key...", false);

    const res = await fetch(`/api/exams/${exam._id}/download-answer-key-docx`, {
      headers: {
        Authorization: `Bearer ${getToken()}`,
      },
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.message || "Answer key download failed.");
    }

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    const fileName =
      res
        .headers
        .get("Content-Disposition")
        ?.match(/filename="([^"]+)"/)?.[1] || "generated-exam-answer-key.docx";

    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
    setMessage("generatedExamMessage", "Answer key downloaded.", false);
  } catch (error) {
    setMessage("generatedExamMessage", error.message);
  }
}

async function downloadTemplate(messageId = "itemAnalysisMessage") {
  const items = Number(document.getElementById("analysisItems").value || 50);
  const analysisType = encodeURIComponent(
    document.getElementById("analysisType").value || "Multiple Choice",
  );

  try {
    setMessage(
      messageId,
      `Preparing ${items}-item result template...`,
      false,
    );

    const res = await fetch(
      `/api/item-analysis/template?items=${items}&analysisType=${analysisType}`,
      {
        headers: {
          Authorization: `Bearer ${getToken()}`,
        },
      },
    );

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.message || "Template download failed.");
    }

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `item-analysis-template-${items}-items.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
    setMessage(messageId, `${items}-item result template downloaded.`, false);
  } catch (error) {
    setMessage(messageId, error.message);
  }
}

async function downloadOmrTemplate() {
  if (document.getElementById("analysisType").value === "Problem Solving") {
    setMessage(
      "itemAnalysisMessage",
      "OMR sheets are only available for multiple-choice item analysis.",
    );
    return;
  }

  let linkedExam = null;

  try {
    const selectedGeneratedExam = getSelectedGeneratedExam();

    if (selectedGeneratedExam && formMatchesGeneratedExam(selectedGeneratedExam)) {
      setMessage(
        "itemAnalysisMessage",
        "Preparing linked OMR sheet...",
        false,
      );
      linkedExam = await ensureItemAnalysisExamFromGeneratedExam();
    }
  } catch (error) {
    setMessage("itemAnalysisMessage", error.message);
    return;
  }

  const params = new URLSearchParams({
    items: String(Number(document.getElementById("analysisItems").value || 50)),
    title: document.getElementById("analysisTitle").value || "OMR Answer Sheet",
    subject: document.getElementById("analysisSubject").value || "",
    section: document.getElementById("analysisSection").value || "",
    examId: linkedExam?._id || "",
  });

  try {
    const res = await fetch(`/api/item-analysis/omr-template?${params}`, {
      headers: {
        Authorization: `Bearer ${getToken()}`,
      },
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.message || "OMR sheet download failed.");
    }

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    const fileName =
      res
        .headers
        .get("Content-Disposition")
        ?.match(/filename="([^"]+)"/)?.[1] || "omr-answer-sheet.docx";

    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
    setMessage("itemAnalysisMessage", "OMR sheet template downloaded.", false);
  } catch (error) {
    setMessage("itemAnalysisMessage", error.message);
  }
}

document
  .getElementById("generatedExamSelect")
  .addEventListener("change", renderGeneratedExamMeta);

document
  .getElementById("downloadGeneratedAnswerKeyButton")
  .addEventListener("click", downloadGeneratedAnswerKey);

document
  .getElementById("useGeneratedExamButton")
  .addEventListener("click", useGeneratedExamDetails);

document
  .getElementById("downloadRequiredFormatTemplateButton")
  .addEventListener("click", () => downloadTemplate("requiredFormatMessage"));

document
  .getElementById("analysisType")
  .addEventListener("change", updateAnalysisTypeFields);

updateAnalysisTypeFields();
loadGeneratedExamChoices();
