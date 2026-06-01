protectPage();
adminOnlyPage();

async function loadParsedQuestions() {
  try {
    const data = await apiRequest("/parser");

    document.getElementById("parsedList").innerHTML = data.parsedQuestions
      .filter((q) => q.status === "Pending")
      .map(
        (q) => `
        <div class="card question-card" id="parsed_card_${q._id}">
          <p><strong>Status:</strong> ${q.status}</p>

          <input id="subject_${q._id}" value="${escapeHTML(q.subject)}">
          <input id="topic_${q._id}" value="${escapeHTML(q.topic)}">

          ${
            q.image && q.image.contentType
              ? `<img
  class="question-image"
  src="/api/parser/${q._id}/image"
  style="max-width: 420px; display: block; margin: 15px 0; border-radius: 10px;"
  onerror="console.log('BROKEN IMAGE URL:', this.src); this.style.border='2px solid red';"
>`
              : ""
          }

          <textarea id="questionText_${q._id}">${escapeHTML(q.questionText)}</textarea>

          ${renderQuestionTables(q.tables)}

          <input id="choiceA_${q._id}" value="${escapeHTML(q.choices.A)}">
          <input id="choiceB_${q._id}" value="${escapeHTML(q.choices.B)}">
          <input id="choiceC_${q._id}" value="${escapeHTML(q.choices.C)}">
          <input id="choiceD_${q._id}" value="${escapeHTML(q.choices.D)}">

          <select id="correctAnswer_${q._id}">
            <option value="">Correct Answer</option>
            <option value="A" ${q.correctAnswer === "A" ? "selected" : ""}>A</option>
            <option value="B" ${q.correctAnswer === "B" ? "selected" : ""}>B</option>
            <option value="C" ${q.correctAnswer === "C" ? "selected" : ""}>C</option>
            <option value="D" ${q.correctAnswer === "D" ? "selected" : ""}>D</option>
          </select>

          <select id="difficulty_${q._id}">
            <option value="Easy" ${q.difficulty === "Easy" ? "selected" : ""}>Easy</option>
            <option value="Average" ${q.difficulty === "Average" ? "selected" : ""}>Average</option>
            <option value="Difficult" ${q.difficulty === "Difficult" ? "selected" : ""}>Difficult</option>
          </select>

          <textarea id="explanation_${q._id}" placeholder="Explanation">${escapeHTML(q.explanation || "")}</textarea>

          <button class="btn secondary" onclick="saveParsed('${q._id}')">Save Edit</button>
          <button class="btn success" onclick="approveParsed('${q._id}')">Approve to Question Bank</button>
          <button class="btn danger" onclick="rejectParsed('${q._id}')">Reject</button>

          <p class="message" id="msg_${q._id}"></p>
        </div>
      `,
      )
      .join("");
  } catch (error) {
    alert(error.message);
  }
}

async function saveParsed(id) {
  const body = {
    subject: document.getElementById(`subject_${id}`).value,
    topic: document.getElementById(`topic_${id}`).value,
    questionText: document.getElementById(`questionText_${id}`).value,
    choices: {
      A: document.getElementById(`choiceA_${id}`).value,
      B: document.getElementById(`choiceB_${id}`).value,
      C: document.getElementById(`choiceC_${id}`).value,
      D: document.getElementById(`choiceD_${id}`).value,
    },
    correctAnswer: document.getElementById(`correctAnswer_${id}`).value,
    difficulty: document.getElementById(`difficulty_${id}`).value,
    explanation: document.getElementById(`explanation_${id}`).value,
  };

  try {
    const data = await apiRequest(`/parser/${id}`, "PUT", body);
    document.getElementById(`msg_${id}`).textContent = data.message;
  } catch (error) {
    document.getElementById(`msg_${id}`).textContent = error.message;
  }
}

async function approveParsed(id) {
  try {
    await saveParsed(id);

    const data = await apiRequest(`/parser/${id}/approve`, "POST");

    document.getElementById(`msg_${id}`).textContent = data.message;

    setTimeout(loadParsedQuestions, 700);
  } catch (error) {
    document.getElementById(`msg_${id}`).textContent = error.message;
  }
}

async function rejectParsed(id) {
  try {
    const data = await apiRequest(`/parser/${id}/reject`, "POST");

    document.getElementById(`msg_${id}`).textContent = data.message;

    // Remove card instantly
    const card = document.getElementById(`parsed_card_${id}`);

    if (card) {
      card.style.transition = "all 0.4s ease";
      card.style.opacity = "0";
      card.style.transform = "translateX(20px)";

      setTimeout(() => {
        card.remove();
      }, 400);
    }
  } catch (error) {
    document.getElementById(`msg_${id}`).textContent = error.message;
  }
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

loadParsedQuestions();
