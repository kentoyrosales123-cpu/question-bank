protectPage();

async function loadResult() {
  const examId = localStorage.getItem("result_exam_id");

  if (!examId) {
    alert("No result found.");
    location.href = "/generate-exam.html";
    return;
  }

  try {
    const data = await apiRequest(`/exams/${examId}`);
    const exam = data.exam;

    document.getElementById("scoreText").textContent =
      `Score: ${exam.score} / ${exam.totalItems}`;

    document.getElementById("resultList").innerHTML = exam.questions
      .map((q, index) => {
        const answer = exam.answers.find((a) => a.question._id === q._id);

        return `
          <div class="card question-card">
            <h3>${index + 1}. ${q.questionText}</h3>

            <p>Your Answer: 
              <strong class="${answer?.isCorrect ? "correct" : "wrong"}">
                ${answer?.selectedAnswer || "No answer"}
              </strong>
            </p>

            <p>Correct Answer: <strong>${q.correctAnswer}</strong></p>

            <p><strong>Explanation:</strong> ${q.explanation || "No explanation provided."}</p>
          </div>
        `;
      })
      .join("");
  } catch (error) {
    alert(error.message);
  }
}

loadResult();
