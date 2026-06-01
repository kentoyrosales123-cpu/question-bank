protectPage();

async function loadQuestions(endpoint = "/questions") {
  try {
    const data = await apiRequest(endpoint);

    document.getElementById("questionsBody").innerHTML = data.questions
      .map(
        (q) => `
      <tr>
        <td>${escapeHTML(q.subject)}</td>
        <td>${escapeHTML(q.topic)}</td>
        <td>${escapeHTML(q.questionText.substring(0, 80))}...</td>
        <td><span class="badge ${escapeHTML(q.difficulty.toLowerCase())}">${escapeHTML(q.difficulty)}</span></td>
        <td>${escapeHTML(q.correctAnswer)}</td>
        <td>
          ${getUser()?.role === "admin" ? `<button class="btn danger" onclick="deleteQuestion('${q._id}')">Delete</button>` : ""}
        </td>
      </tr>
    `,
      )
      .join("");
  } catch (error) {
    alert(error.message);
  }
}

async function filterQuestions() {
  const subject = document.getElementById("filterSubject").value;
  const topic = document.getElementById("filterTopic").value;
  const difficulty = document.getElementById("filterDifficulty").value;

  const query = new URLSearchParams({ subject, topic, difficulty }).toString();

  loadQuestions(`/questions/filter?${query}`);
}

async function deleteQuestion(id) {
  if (!confirm("Delete this question?")) return;

  try {
    await apiRequest(`/questions/${id}`, "DELETE");
    loadQuestions();
  } catch (error) {
    alert(error.message);
  }
}

loadQuestions();
