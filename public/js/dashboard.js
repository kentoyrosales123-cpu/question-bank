protectPage();
adminOnlyPage();

async function loadDashboard() {
  try {
    const data = await apiRequest("/dashboard/stats");
    const stats = data.stats;
    const user = getUser();

    if (user?.name) {
      document.getElementById("adminWelcome").textContent =
        `Welcome back, ${user.name}! Here's what's happening with your question bank.`;
    }

    document.getElementById("totalUsers").textContent = stats.totalUsers;
    document.getElementById("totalQuestions").textContent =
      stats.totalQuestions;

    updateDifficultySummary(stats);

    document.getElementById("recentQuestions").innerHTML =
      stats.recentQuestions.length > 0
        ? stats.recentQuestions.map(renderQuestionItem).join("")
        : `<p class="muted-text">No recent questions.</p>`;

    document.getElementById("recentExams").innerHTML =
      stats.recentExams.length > 0
        ? stats.recentExams.map(renderExamItem).join("")
        : `<p class="muted-text">No recent exams.</p>`;

    document.getElementById("registeredUsers").innerHTML =
      stats.registeredUsers.length > 0
        ? stats.registeredUsers.map(renderUserItem).join("")
        : `<p class="muted-text">No registered users.</p>`;

    document.getElementById("activityBody").innerHTML =
      stats.recentActivity && stats.recentActivity.length > 0
        ? stats.recentActivity.map(renderActivityRow).join("")
        : `
          <tr>
            <td colspan="5" class="empty-table-cell">No activity recorded yet.</td>
          </tr>
        `;
  } catch (error) {
    alert(error.message);
  }
}

function percent(part, total) {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

function updateDifficultySummary(stats) {
  const easy = Number(stats.easyQuestions || 0);
  const average = Number(stats.averageQuestions || 0);
  const difficult = Number(stats.difficultQuestions || 0);
  const total = Number(stats.totalQuestions || 0);
  const easyPercent = percent(easy, total);
  const averagePercent = percent(average, total);
  const difficultPercent = percent(difficult, total);

  document.getElementById("easyBreakdown").textContent =
    `${easy} (${easyPercent}%)`;
  document.getElementById("averageBreakdown").textContent =
    `${average} (${averagePercent}%)`;
  document.getElementById("difficultBreakdown").textContent =
    `${difficult} (${difficultPercent}%)`;
  document.getElementById("difficultyTotal").textContent = total;
  document.getElementById("difficultyDonut").style.background = `
    conic-gradient(
      #5fbf68 0 ${easyPercent}%,
      #f5a623 ${easyPercent}% ${easyPercent + averagePercent}%,
      #e94b3c ${easyPercent + averagePercent}% 100%
    )
  `;
}

function relativeTime(value) {
  const date = new Date(value);
  const seconds = Math.max(1, Math.floor((Date.now() - date.getTime()) / 1000));
  const units = [
    ["day", 86400],
    ["hour", 3600],
    ["min", 60],
  ];

  for (const [label, amount] of units) {
    const count = Math.floor(seconds / amount);
    if (count >= 1) {
      return `${count} ${label}${count > 1 ? "s" : ""} ago`;
    }
  }

  return "just now";
}

function renderQuestionItem(question) {
  return `
    <div class="dashboard-list-item">
      <span class="item-dot ${escapeHTML(question.difficulty.toLowerCase())}"></span>
      <div>
        <strong>${escapeHTML(question.subject)} - ${escapeHTML(question.topic)}</strong>
        <small>${relativeTime(question.createdAt)}</small>
      </div>
      <span class="badge ${escapeHTML(question.difficulty.toLowerCase())}">
        ${escapeHTML(question.difficulty)}
      </span>
    </div>
  `;
}

function renderExamItem(exam) {
  return `
    <div class="dashboard-list-item">
      <span class="item-file">D</span>
      <div>
        <strong>${escapeHTML(exam.title)}</strong>
        <small>${escapeHTML(exam.totalItems)} items</small>
      </div>
      <small>${relativeTime(exam.createdAt)}</small>
    </div>
  `;
}

function renderUserItem(user) {
  const initial = escapeHTML((user.name || user.email || "?").charAt(0));

  return `
    <div class="dashboard-list-item user-row">
      <span class="avatar">${initial}</span>
      <div>
        <strong>${escapeHTML(user.name)}</strong>
        <small>${escapeHTML(user.email)}</small>
      </div>
      <span class="badge ${user.role === "admin" ? "difficult" : "easy"}">
        ${user.role === "admin" ? "Super Admin" : "Professor"}
      </span>
    </div>
  `;
}

function renderActivityRow(activity) {
  const activityDate = new Date(activity.createdAt);
  const user = activity.user || {};
  const actionLabel =
    activity.action === "generate_exam" ? "Generated Exam" : "Logged In";
  const badgeClass = activity.action === "generate_exam" ? "average" : "easy";

  return `
    <tr>
      <td>
        <strong>${escapeHTML(user.name || "Unknown user")}</strong><br>
        <small>${escapeHTML(user.email || "")}</small>
      </td>
      <td><span class="badge ${badgeClass}">${actionLabel}</span></td>
      <td>${escapeHTML(activity.description)}</td>
      <td>${activityDate.toLocaleDateString()}</td>
      <td>${activityDate.toLocaleTimeString()}</td>
    </tr>
  `;
}

async function downloadActivityLog() {
  try {
    const res = await fetch("/api/dashboard/activity/download", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${getToken()}`,
      },
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.message || "Download failed.");
    }

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const fileName =
      res
        .headers
        .get("Content-Disposition")
        ?.match(/filename="([^"]+)"/)?.[1] || "activity-log.csv";

    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  } catch (error) {
    alert(error.message);
  }
}

loadDashboard();
