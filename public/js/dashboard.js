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
        <p><strong>${escapeHTML(q.subject)}</strong> - ${escapeHTML(q.topic)} 
        <span class="badge ${escapeHTML(q.difficulty.toLowerCase())}">${escapeHTML(q.difficulty)}</span></p>
      `,
      )
      .join("");

    document.getElementById("recentExams").innerHTML = stats.recentExams
      .map(
        (e) => `
        <p><strong>${escapeHTML(e.title)}</strong> - ${escapeHTML(e.totalItems)} items</p>
      `,
      )
      .join("");

    document.getElementById("registeredUsers").innerHTML = stats.registeredUsers
      .map(
        (u) => `
    <div style="
      padding:12px;
      margin-bottom:10px;
      border-radius:12px;
      background:rgba(255,255,255,0.05);
      border:1px solid rgba(255,255,255,0.1);
    ">
      <strong>${escapeHTML(u.name)}</strong><br>
      <small>${escapeHTML(u.email)}</small><br>

      <span class="badge ${u.role === "admin" ? "difficult" : "easy"}">
        ${u.role === "admin" ? "Super Admin" : "Professor"}
      </span>
    </div>
  `,
      )
      .join("");
  } catch (error) {
    alert(error.message);
  }
}

loadDashboard();
