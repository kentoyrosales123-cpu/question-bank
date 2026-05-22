protectPage();

let currentExam = null;

async function loadExam() {
  const examId = localStorage.getItem("current_exam_id");

  if (!examId) {
    alert("No exam selected.");
    location.href = "/generate-exam.html";
    return;
  }

  try {
    const data = await apiRequest(`/exams/${examId}`);
    currentExam = data.exam;

    document.getElementById("examTitle").textContent = currentExam.title;

    document.getElementById("takeExamForm").innerHTML =
      currentExam.questions
        .map(
          (q, index) => `
        <div class="card question-card">
          <h3>${index + 1}. ${q.questionText}</h3>

          ${
            q.image && q.image.contentType
              ? `<img
        class="question-image"
        src="/api/questions/${q._id}/image"
        style="max-width:300px;display:block;margin:15px 0;border-radius:10px;"
      >`
              : ""
          }
          ${q.tableData ? `<pre>${q.tableData}</pre>` : ""}

          ${["A", "B", "C", "D"]
            .map(
              (letter) => `
            <label class="choice">
              <input type="radio" name="q_${q._id}" value="${letter}">
              ${letter}. ${q.choices[letter]}
            </label>
          `,
            )
            .join("")}
        </div>
      `,
        )
        .join("") +
      `<button class="btn success" type="submit">Submit Exam</button>`;
  } catch (error) {
    alert(error.message);
  }
}

document
  .getElementById("takeExamForm")
  .addEventListener("submit", async (e) => {
    e.preventDefault();

    const answers = currentExam.questions.map((q) => {
      const selected = document.querySelector(
        `input[name="q_${q._id}"]:checked`,
      );

      return {
        questionId: q._id,
        selectedAnswer: selected ? selected.value : "",
      };
    });

    try {
      const data = await apiRequest("/exams/submit", "POST", {
        examId: currentExam._id,
        answers,
      });

      localStorage.setItem("result_exam_id", data.result._id);
      location.href = "/result.html";
    } catch (error) {
      alert(error.message);
    }
  });

loadExam();

async function downloadExamDocx() {
  const examId = localStorage.getItem("current_exam_id");

  if (!examId) {
    alert("No exam selected.");
    return;
  }

  try {
    const res = await fetch(`/api/exams/${examId}/download-docx`, {
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
    a.download = "generated_exam.docx";
    document.body.appendChild(a);
    a.click();

    a.remove();
    window.URL.revokeObjectURL(url);
  } catch (error) {
    alert(error.message);
  }
}
