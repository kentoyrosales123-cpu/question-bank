protectPage();

let profileImageUrl = null;

async function loadProfile() {
  try {
    const data = await apiRequest("/users/me/profile");
    const user = data.user;
    const stats = data.stats;

    renderProfile(user, stats);
    await loadProfileImage();
  } catch (error) {
    setMessage("profileMessage", error.message);
  }
}

function renderProfile(user, stats) {
  const initials = getInitials(user.name || user.email);
  const roleLabel = getRoleLabel(user.role);
  const roleClass = hasAnyRole(user, ["super_admin", "admin"]) ? "difficult" : "easy";

  document.getElementById("profileInitials").textContent = initials;
  document.getElementById("profileName").textContent = user.name;
  document.getElementById("profileEmail").textContent = user.email;
  document.getElementById("profileRoleBadge").textContent = roleLabel;
  document.getElementById("profileRoleBadge").className = `badge ${roleClass}`;

  document.getElementById("detailName").textContent = user.name;
  document.getElementById("detailEmail").textContent = user.email;
  document.getElementById("detailRole").textContent = roleLabel;
  document.getElementById("detailVerified").textContent =
    user.isEmailVerified === false ? "Pending" : "Verified";
  document.getElementById("detailJoined").textContent = formatDate(user.createdAt);
  document.getElementById("detailUpdated").textContent = formatDate(user.updatedAt);
  document.getElementById("summaryJoined").textContent = formatShortDate(
    user.createdAt,
  );

  document.getElementById("profileTotalExams").textContent = stats.totalExams;
  document.querySelectorAll(".admin-profile-action").forEach((link) => {
    link.classList.toggle("hidden", !isAdminRole(user));
  });
  document.getElementById("profileRecentActivity").innerHTML =
    stats.recentExams && stats.recentExams.length > 0
      ? stats.recentExams.map(renderRecentExam).join("")
      : `<p class="muted-text">No recent activity yet.</p>`;
}

async function loadProfileImage() {
  const res = await fetch("/api/users/me/profile-image", {
    headers: {
      Authorization: `Bearer ${getToken()}`,
    },
  });

  if (!res.ok) {
    return;
  }

  const blob = await res.blob();

  if (profileImageUrl) {
    URL.revokeObjectURL(profileImageUrl);
  }

  profileImageUrl = URL.createObjectURL(blob);
  document.getElementById("profilePhoto").src = profileImageUrl;
  document.getElementById("profilePhoto").classList.remove("hidden");
  document.getElementById("profileInitials").classList.add("hidden");
}

function getInitials(value) {
  return String(value || "U")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : "-";
}

function formatShortDate(value) {
  return value
    ? new Date(value).toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : "-";
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

function renderRecentExam(exam) {
  const status = exam.approvalStatus || "Approved";
  const isPending = status === "Pending";
  const isRejected = status === "Rejected";
  const statusText = isPending
    ? `Exam "${exam.title}" is pending admin approval`
    : isRejected
    ? `Exam "${exam.title}" was rejected`
    : `Exam "${exam.title}" is approved`;
  const statusClass = isPending || isRejected ? "red" : "purple";

  return `
    <div class="profile-recent-item">
      <span class="recent-icon ${statusClass}"></span>
      <div>
        <strong>${escapeHTML(statusText)}</strong>
        <small>${escapeHTML(exam.totalItems)} items</small>
      </div>
      <small>${relativeTime(exam.createdAt)}</small>
    </div>
  `;
}

async function openActivityModal() {
  document.getElementById("profileActivityModal").classList.remove("hidden");
  document.getElementById("profileActivityBody").innerHTML = `
    <tr>
      <td colspan="6" class="empty-table-cell">Loading activity...</td>
    </tr>
  `;

  try {
    const data = await apiRequest("/users/me/activity");
    const exams = data.exams || [];

    document.getElementById("profileActivityBody").innerHTML =
      exams.length > 0
        ? exams.map(renderActivityExamRow).join("")
        : `
          <tr>
            <td colspan="6" class="empty-table-cell">No generated exams yet.</td>
          </tr>
        `;
  } catch (error) {
    setMessage("profileActivityMessage", error.message);
  }
}

function closeActivityModal() {
  document.getElementById("profileActivityModal").classList.add("hidden");
  document.getElementById("profileActivityBody").innerHTML = "";
  setMessage("profileActivityMessage", "");
}

function renderActivityExamRow(exam) {
  const status = exam.approvalStatus || "Approved";
  const isPending = status === "Pending";
  const isRejected = status === "Rejected";

  return `
    <tr>
      <td>
        <strong>${escapeHTML(exam.title)}</strong><br>
        <small>${escapeHTML(exam.topic || "All topics")}</small>
      </td>
      <td>${escapeHTML(exam.subject || "-")}</td>
      <td>${escapeHTML(exam.totalItems)}</td>
      <td>
        <span class="badge ${isPending ? "average" : isRejected ? "difficult" : "easy"}">
          ${isPending ? "Pending Approval" : isRejected ? "Rejected" : exam.submitted ? "Submitted" : "Approved"}
        </span>
      </td>
      <td>${formatDate(exam.createdAt)}</td>
      <td>
        ${
          isPending || isRejected
            ? `<span class="muted-text">${isRejected ? "Rejected by admin" : "Awaiting admin approval"}</span>`
            : `<div class="action-row">
                <button class="btn secondary" type="button" onclick="downloadGeneratedExam('${exam._id}', 'download-docx')">
                  No Answer Key
                </button>
                <button class="btn" type="button" onclick="downloadGeneratedExam('${exam._id}', 'download-answer-key-docx')">
                  With Answer Key
                </button>
              </div>`
        }
      </td>
    </tr>
  `;
}

async function downloadGeneratedExam(examId, endpoint) {
  try {
    const res = await fetch(`/api/exams/${examId}/${endpoint}`, {
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
        ?.match(/filename="([^"]+)"/)?.[1] || "generated-exam.docx";

    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  } catch (error) {
    setMessage("profileActivityMessage", error.message);
  }
}

function showProfileEditor() {
  document.getElementById("profileImageForm").classList.remove("hidden");
}

function hideProfileEditor() {
  document.getElementById("profileImageForm").classList.add("hidden");
  document.getElementById("profileImageForm").reset();
  setMessage("profileMessage", "");
}

document
  .getElementById("profileImageForm")
  .addEventListener("submit", async (event) => {
    event.preventDefault();

    const file = document.getElementById("profileImage").files[0];

    if (!file) {
      setMessage("profileMessage", "Choose an image first.");
      return;
    }

    const form = new FormData();
    form.append("profileImage", file);

    try {
      const data = await apiRequest("/users/me/profile-image", "PATCH", form, true);
      setMessage("profileMessage", data.message, false);
      document.getElementById("profileImageForm").reset();
      await loadProfileImage();
      setTimeout(hideProfileEditor, 700);
    } catch (error) {
      setMessage("profileMessage", error.message);
    }
  });

loadProfile();
