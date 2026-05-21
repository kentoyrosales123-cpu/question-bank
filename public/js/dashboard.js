protectPage();
adminOnlyPage();

async function loadDashboard() {
  try {
    const data = await apiRequest("/dashboard/stats");

    const stats = data.stats;

    document.getElementById("totalUsers").textContent = stats.totalUsers;
    document.getElementById("totalQuestions").textContent =
      stats.totalQuestions;
    document.getElementById("easyQuestions").textContent = stats.easyQuestions;
    document.getElementById("difficultQuestions").textContent =
      stats.difficultQuestions;

    document.getElementById("recentQuestions").innerHTML = stats.recentQuestions
      .map(
        (q) => `
        <p><strong>${q.subject}</strong> - ${q.topic} 
        <span class="badge ${q.difficulty.toLowerCase()}">${q.difficulty}</span></p>
      `,
      )
      .join("");

    document.getElementById("recentExams").innerHTML = stats.recentExams
      .map(
        (e) => `
        <p><strong>${e.title}</strong> - ${e.totalItems} items</p>
      `,
      )
      .join("");
  } catch (error) {
    alert(error.message);
  }
}

loadDashboard();
