protectPage();

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
  const subject = document.getElementById("subject").value.trim();
  const topic = document.getElementById("topic").value.trim();

  document.getElementById("summaryTotal").textContent = totalItems || 0;
  document.getElementById("summarySubject").textContent =
    subject || "Not selected";
  document.getElementById("summaryTopic").textContent = topic || "All topics";
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

document.getElementById("examForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const body = {
    title: document.getElementById("title").value,
    subject: document.getElementById("subject").value,
    topic: document.getElementById("topic").value,
    totalItems: Number(document.getElementById("totalItems").value),
    easyCount: Number(document.getElementById("easyCount").value),
    averageCount: Number(document.getElementById("averageCount").value),
    difficultCount: Number(document.getElementById("difficultCount").value),
  };

  try {
    const data = await apiRequest("/exams/generate", "POST", body);
    localStorage.setItem("current_exam_id", data.exam._id);
    location.href = "/take-exam.html";
  } catch (error) {
    document.getElementById("examMessage").textContent = error.message;
  }
});

updateExamSummary();
