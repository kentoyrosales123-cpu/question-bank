protectPage();

const analysisUser = getUser();
let generatedExams = [];

if (analysisUser && analysisUser.role === "student") {
  alert("Item analysis is for professors and admins only.");
  location.href = getDashboardUrl(analysisUser);
}

document
  .getElementById("itemAnalysisForm")
  .addEventListener("submit", async (event) => {
    event.preventDefault();

    const form = new FormData(event.target);
    const message = document.getElementById("itemAnalysisMessage");

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

  if (!exam) {
    meta.textContent = "";
    return;
  }

  meta.innerHTML = `
    <span>${escapeHTML(exam.subject || "No subject")}</span>
    <span>${escapeHTML(exam.topic || "All topics")}</span>
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
    generatedExams = data.exams || [];
    renderGeneratedExamOptions();
  } catch (error) {
    const select = document.getElementById("generatedExamSelect");
    select.innerHTML = `<option value="">Unable to load generated exams</option>`;
    select.disabled = true;
    document.getElementById("downloadGeneratedAnswerKeyButton").disabled = true;
    document.getElementById("useGeneratedExamButton").disabled = true;
    setMessage("generatedExamMessage", error.message);
  }
}

function useGeneratedExamDetails() {
  const exam = getSelectedGeneratedExam();

  if (!exam) {
    setMessage("generatedExamMessage", "Choose a generated exam first.");
    return;
  }

  document.getElementById("analysisTitle").value = exam.title || "";
  document.getElementById("analysisSubject").value = exam.subject || "";
  document.getElementById("analysisItems").value = exam.totalItems || "";
  setMessage("generatedExamMessage", "Exam details copied to the upload form.", false);
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

async function downloadTemplate() {
  const items = Number(document.getElementById("analysisItems").value || 50);

  try {
    const res = await fetch(`/api/item-analysis/template?items=${items}`, {
      headers: {
        Authorization: `Bearer ${getToken()}`,
      },
    });

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
  } catch (error) {
    const message = document.getElementById("itemAnalysisMessage");
    message.textContent = error.message;
    message.classList.add("wrong");
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

loadGeneratedExamChoices();
