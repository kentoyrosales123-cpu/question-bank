protectPage();
adminOnlyPage();

let dashboardStats = null;
let activeDashboardModal = null;
const dashboardUserImageUrls = new Map();

function setDashboardLoadingState() {
  document.getElementById("totalUsers").textContent = "...";
  document.getElementById("totalQuestions").textContent = "...";
  document.getElementById("recentQuestions").innerHTML =
    `<p class="muted-text">Loading recent questions...</p>`;
  document.getElementById("recentExams").innerHTML =
    `<p class="muted-text">Loading recent exams...</p>`;
  document.getElementById("registeredUsers").innerHTML =
    `<p class="muted-text">Loading registered users...</p>`;
  document.getElementById("activityBody").innerHTML = `
    <tr>
      <td colspan="6" class="empty-table-cell">Loading activity...</td>
    </tr>
  `;
}

async function loadDashboard() {
  try {
    setDashboardLoadingState();
    const data = await apiRequest("/dashboard/stats");
    const stats = data.stats;
    dashboardStats = stats;
    const user = getUser();

    if (user?.name) {
      document.getElementById("adminWelcome").textContent =
        `Welcome back, ${user.name}! Here's what's happening with your question bank.`;
    }

    document
      .getElementById("supportTicketsButton")
      ?.classList.toggle("hidden", !isSuperAdminRole(user));

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
    hydrateDashboardUserProfileImages(stats.registeredUsers);

    document.getElementById("activityBody").innerHTML =
      stats.recentActivity && stats.recentActivity.length > 0
        ? stats.recentActivity.slice(0, 10).map(renderActivityRow).join("")
        : `
          <tr>
            <td colspan="6" class="empty-table-cell">No activity recorded yet.</td>
          </tr>
        `;

    if (activeDashboardModal) {
      renderDashboardModal(activeDashboardModal);
    }
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

  const donut = document.getElementById("difficultyDonut");
  if (!donut) return;

  if (total <= 0) {
    donut.style.background = "conic-gradient(#d6d6d6 0 100%)";
    return;
  }

  donut.style.background = `
    conic-gradient(
      #860012 0 ${easyPercent}%,
      #e3a000 ${easyPercent}% ${easyPercent + averagePercent}%,
      #a9a9a9 ${easyPercent + averagePercent}% 100%
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
  const status = exam.approvalStatus || "Approved";
  const isPending = status === "Pending";
  const isRejected = status === "Rejected";
  const owner = exam.user?.name || exam.user?.email || "Unknown user";

  return `
    <div class="dashboard-list-item">
      <span class="item-file">D</span>
      <div>
        <strong>${escapeHTML(exam.title)}</strong>
        <small>${escapeHTML(exam.totalItems)} items by ${escapeHTML(owner)}</small>
      </div>
      <span class="badge ${isPending ? "average" : isRejected ? "difficult" : "easy"}">
        ${isPending ? "Pending Approval" : isRejected ? "Rejected" : "Released"}
      </span>
      ${
        isPending
          ? `<div class="action-row">
              <button class="btn secondary compact-btn" type="button" onclick="approveExam('${exam._id}')">Approve</button>
              <button class="btn danger compact-btn" type="button" onclick="rejectExam('${exam._id}')">Reject</button>
            </div>`
          : `<small>${relativeTime(exam.createdAt)}</small>`
      }
    </div>
  `;
}

async function rejectExam(examId) {
  if (!confirm("Reject this exam request?")) {
    return;
  }

  try {
    const data = await apiRequest(`/exams/${examId}/reject`, "POST");
    alert(data.message || "Exam request rejected.");
    await loadDashboard();
  } catch (error) {
    alert(error.message);
  }
}

async function approveExam(examId) {
  try {
    const data = await apiRequest(`/exams/${examId}/approve`, "POST");
    alert(data.message || "Exam approved.");
    await loadDashboard();
  } catch (error) {
    alert(error.message);
  }
}

function openDashboardModal(type) {
  activeDashboardModal = type;
  renderDashboardModal(type);
  document.getElementById("dashboardModal").classList.remove("hidden");
}

function closeDashboardModal() {
  activeDashboardModal = null;
  document.getElementById("dashboardModal").classList.add("hidden");
  document.getElementById("dashboardModalBody").innerHTML = "";
}

function renderDashboardModal(type) {
  if (!dashboardStats) return;

  const title = document.getElementById("dashboardModalTitle");
  const subtitle = document.getElementById("dashboardModalSubtitle");
  const body = document.getElementById("dashboardModalBody");

  if (type === "questions") {
    const questions = dashboardStats.recentQuestions || [];
    title.textContent = "Recent Questions";
    subtitle.textContent = `${questions.length} latest question-bank items`;
    body.innerHTML =
      questions.length > 0
        ? questions.map(renderQuestionItem).join("")
        : `<p class="muted-text">No recent questions.</p>`;
    return;
  }

  if (type === "users") {
    const users = dashboardStats.registeredUsers || [];
    title.textContent = "Registered Users";
    subtitle.textContent = `${users.length} latest registered accounts`;
    body.innerHTML =
      users.length > 0
        ? users.map(renderUserItem).join("")
        : `<p class="muted-text">No registered users.</p>`;
    hydrateDashboardUserProfileImages(users);
    return;
  }

  const exams = dashboardStats.recentExams || [];
  const pendingExams = exams.filter(
    (exam) => (exam.approvalStatus || "Approved") === "Pending",
  );
  const releasedExams = exams.filter(
    (exam) => (exam.approvalStatus || "Approved") === "Approved",
  );
  const rejectedExams = exams.filter(
    (exam) => (exam.approvalStatus || "Approved") === "Rejected",
  );

  title.textContent = "Exam Approval Requests";
  subtitle.textContent = `${pendingExams.length} pending approval request${pendingExams.length === 1 ? "" : "s"}`;
  body.innerHTML = `
    ${
      pendingExams.length > 0
        ? pendingExams.map(renderExamItem).join("")
        : `<p class="muted-text">No pending approval requests.</p>`
    }
    <div class="dashboard-modal-divider">
      <strong>Released Exams</strong>
    </div>
    ${
      releasedExams.length > 0
        ? releasedExams.map(renderExamItem).join("")
        : `<p class="muted-text">No released exams yet.</p>`
    }
    <div class="dashboard-modal-divider">
      <strong>Rejected Exams</strong>
    </div>
    ${
      rejectedExams.length > 0
        ? rejectedExams.map(renderExamItem).join("")
        : `<p class="muted-text">No rejected exams yet.</p>`
    }
  `;
}

function renderUserItem(user) {
  const initial = escapeHTML((user.name || user.email || "?").charAt(0));
  const userId = user._id ? String(user._id) : "";
  const isManager = hasAnyRole(user, ["super_admin", "admin"]);

  return `
    <div class="dashboard-list-item user-row">
      <span class="avatar dashboard-user-avatar" ${userId ? `data-user-avatar-id="${escapeHTML(userId)}"` : ""}>${initial}</span>
      <div>
        <strong>${escapeHTML(user.name)}</strong>
        <small>${escapeHTML(user.email)}</small>
      </div>
      <span class="badge ${isManager ? "difficult" : "easy"}">
        ${escapeHTML(getRoleLabel(user.role))}
      </span>
    </div>
  `;
}

async function hydrateDashboardUserProfileImages(users = []) {
  const token = getToken();
  if (!token) return;

  const uniqueUsers = new Map();
  users.forEach((user) => {
    if (user?._id) {
      uniqueUsers.set(String(user._id), user);
    }
  });

  await Promise.all(
    Array.from(uniqueUsers.keys()).map(async (userId) => {
      const avatars = Array.from(
        document.querySelectorAll(".dashboard-user-avatar"),
      ).filter((avatar) => avatar.dataset.userAvatarId === userId);

      if (!avatars.length) return;

      try {
        const res = await fetch(
          `/api/users/${encodeURIComponent(userId)}/profile-image`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
        );

        if (!res.ok) return;

        const blob = await res.blob();
        if (!blob.size) return;

        const oldImageUrl = dashboardUserImageUrls.get(userId);
        if (oldImageUrl) {
          window.URL.revokeObjectURL(oldImageUrl);
        }

        const imageUrl = window.URL.createObjectURL(blob);
        dashboardUserImageUrls.set(userId, imageUrl);

        avatars.forEach((avatar) => {
          avatar.innerHTML = `<img src="${imageUrl}" alt="Profile picture">`;
          avatar.classList.add("has-image");
        });
      } catch (error) {
        // Keep the initials fallback when the user has no uploaded picture.
      }
    }),
  );
}

function renderActivityRow(activity) {
  const activityDate = new Date(activity.createdAt);
  const user = activity.user || {};
  const actionLabel =
    activity.action === "generate_exam"
      ? "Generated Exam"
      : activity.action === "approve_exam"
      ? "Approved Exam"
      : activity.action === "reject_exam"
      ? "Rejected Exam"
      : activity.action === "download_exam"
      ? "Downloaded Exam"
      : "Logged In";
  const badgeClass =
    activity.action === "generate_exam"
      ? "average"
      : activity.action === "approve_exam"
      ? "easy"
      : activity.action === "reject_exam"
      ? "difficult"
      : activity.action === "download_exam"
      ? "easy"
      : "easy";

  return `
    <tr>
      <td>
        <strong>${escapeHTML(user.name || "Unknown user")}</strong><br>
        <small>${escapeHTML(user.email || "")}</small>
      </td>
      <td>
        <span class="badge ${hasAnyRole(user, ["super_admin", "admin"]) ? "difficult" : "easy"}">
          ${escapeHTML(getRoleLabel(user.role))}
        </span>
      </td>
      <td><span class="badge ${badgeClass}">${actionLabel}</span></td>
      <td>${escapeHTML(activity.description)}</td>
      <td>${activityDate.toLocaleDateString()}</td>
      <td>${activityDate.toLocaleTimeString()}</td>
    </tr>
  `;
}

function getActivityDownloadQuery() {
  const startDate = document.getElementById("activityStartDate")?.value || "";
  const endDate = document.getElementById("activityEndDate")?.value || "";

  if (startDate && endDate && startDate > endDate) {
    throw new Error("Start date cannot be after end date.");
  }

  const params = new URLSearchParams();

  if (startDate) params.set("startDate", startDate);
  if (endDate) params.set("endDate", endDate);

  return params.toString();
}

async function downloadActivityLog() {
  try {
    const query = getActivityDownloadQuery();
    const url = query
      ? `/api/dashboard/activity/download?${query}`
      : "/api/dashboard/activity/download";
    const res = await fetch(url, {
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
    const objectUrl = window.URL.createObjectURL(blob);
    const fileName =
      res
        .headers
        .get("Content-Disposition")
        ?.match(/filename="([^"]+)"/)?.[1] || "activity-log.xlsx";

    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(objectUrl);
  } catch (error) {
    alert(error.message);
  }
}

loadDashboard();
