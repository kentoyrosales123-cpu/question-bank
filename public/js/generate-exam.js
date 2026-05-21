protectPage();

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
