protectPage();

let examOptionData = [];

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

function adjustTotalItems(amount) {
  const input = document.getElementById("totalItems");
  input.value = Math.max(1, Number(input.value || 0) + amount);
  updateExamSummary();
}

function updateExamSummary() {
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

  if (subjects.length === 0) {
    document.getElementById("examMessage").textContent =
      "Select at least one subject.";
    document.getElementById("examMessage").classList.add("wrong");
    return;
  }

  try {
    const data = await apiRequest("/exams/generate", "POST", body);
    localStorage.setItem("current_exam_id", data.exam._id);
    document.getElementById("examMessage").textContent =
      "Exam generated successfully. You can preview or download it now.";
    document.getElementById("examMessage").classList.remove("wrong");
    document.getElementById("examMessage").classList.add("correct");
    document.getElementById("generatedExamActions").classList.remove("hidden");
  } catch (error) {
    document.getElementById("examMessage").textContent = error.message;
    document.getElementById("examMessage").classList.add("wrong");
    document.getElementById("examMessage").classList.remove("correct");
  }
});

loadExamOptions();
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
