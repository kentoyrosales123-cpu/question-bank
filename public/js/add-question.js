protectPage();
adminOnlyPage();

document
  .getElementById("questionForm")
  .addEventListener("submit", async (e) => {
    e.preventDefault();

    const form = new FormData();

    form.append("subject", document.getElementById("subject").value);
    form.append("topic", document.getElementById("topic").value);
    form.append("questionText", document.getElementById("questionText").value);
    form.append("choiceA", document.getElementById("choiceA").value);
    form.append("choiceB", document.getElementById("choiceB").value);
    form.append("choiceC", document.getElementById("choiceC").value);
    form.append("choiceD", document.getElementById("choiceD").value);
    form.append(
      "correctAnswer",
      document.getElementById("correctAnswer").value,
    );
    form.append("difficulty", document.getElementById("difficulty").value);
    form.append("tableData", document.getElementById("tableData").value);
    form.append("explanation", document.getElementById("explanation").value);

    const image = document.getElementById("image").files[0];

    if (image) {
      form.append("image", image);
    }

    try {
      await apiRequest("/questions", "POST", form, true);
      document.getElementById("message").textContent =
        "Question saved successfully.";
      document.getElementById("questionForm").reset();
    } catch (error) {
      document.getElementById("message").textContent = error.message;
    }
  });
