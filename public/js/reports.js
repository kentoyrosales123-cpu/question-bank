protectPage();
adminOnlyPage();

async function loadReports() {
  try {
    const data = await apiRequest("/dashboard/reports");
    const report = data.report;

    document.getElementById("reportUsers").textContent = report.totalUsers;
    document.getElementById("reportQuestions").textContent =
      report.totalQuestions;
    document.getElementById("reportExams").textContent = report.totalExams;
    document.getElementById("reportActivity").textContent =
      report.loginCount + report.generatedExamCount;
    document.getElementById("reportGenerated").textContent = report.totalExams;
    document.getElementById("reportSubmitted").textContent =
      report.submittedExams;
    document.getElementById("reportPending").textContent = report.pendingExams;
    document.getElementById("reportLogins").textContent = report.loginCount;

    updateDifficultyReport(report);

    document.getElementById("reportsActivityBody").innerHTML =
      report.recentActivity.length > 0
        ? report.recentActivity.slice(0, 10).map(renderActivityRow).join("")
        : `
          <tr>
            <td colspan="5" class="empty-table-cell">No activity recorded yet.</td>
          </tr>
        `;

    await hydrateActivityProfileImages(report.recentActivity.slice(0, 10));
  } catch (error) {
    alert(error.message);
  }
}

function percent(part, total) {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

function updateDifficultyReport(report) {
  const easyPercent = percent(report.easyQuestions, report.totalQuestions);
  const averagePercent = percent(report.averageQuestions, report.totalQuestions);
  const difficultPercent = percent(
    report.difficultQuestions,
    report.totalQuestions,
  );

  document.getElementById("reportEasy").textContent =
    `${report.easyQuestions} (${easyPercent}%)`;
  document.getElementById("reportAverage").textContent =
    `${report.averageQuestions} (${averagePercent}%)`;
  document.getElementById("reportDifficult").textContent =
    `${report.difficultQuestions} (${difficultPercent}%)`;
  document.getElementById("reportQuestionTotal").textContent =
    report.totalQuestions;
  document.getElementById("reportDonutTotal").textContent =
    report.totalQuestions;
  document.getElementById("reportDifficultyDonut").style.background = `
    conic-gradient(
      #5fbf68 0 ${easyPercent}%,
      #f5a623 ${easyPercent}% ${easyPercent + averagePercent}%,
      #e94b3c ${easyPercent + averagePercent}% 100%
    )
  `;
}

function renderActivityRow(activity) {
  const activityDate = new Date(activity.createdAt);
  const user = activity.user || {};
  const initials = getInitials(user.name || user.email || "?");
  const actionLabel =
    activity.action === "generate_exam" ? "Generated Exam" : "Logged In";
  const badgeClass = activity.action === "generate_exam" ? "average" : "easy";

  return `
    <tr>
      <td>
        <div class="report-user-cell">
          <span
            class="avatar activity-avatar"
            id="activityAvatar_${activity._id}"
            data-initials="${escapeHTML(initials)}"
          >${escapeHTML(initials)}</span>
          <div>
            <strong>${escapeHTML(user.name || "Unknown user")}</strong><br>
            <small>${escapeHTML(user.email || "")}</small>
          </div>
        </div>
      </td>
      <td><span class="badge ${badgeClass}">${actionLabel}</span></td>
      <td>${escapeHTML(activity.description)}</td>
      <td>${activityDate.toLocaleDateString()}</td>
      <td>${activityDate.toLocaleTimeString()}</td>
    </tr>
  `;
}

async function hydrateActivityProfileImages(activities) {
  await Promise.all(
    activities.map(async (activity) => {
      if (!activity.user || !activity.user._id) {
        return;
      }

      const avatar = document.getElementById(`activityAvatar_${activity._id}`);

      if (!avatar) {
        return;
      }

      try {
        const res = await fetch(`/api/users/${activity.user._id}/profile-image`, {
          headers: {
            Authorization: `Bearer ${getToken()}`,
          },
        });

        if (!res.ok) {
          return;
        }

        const blob = await res.blob();
        const imageUrl = URL.createObjectURL(blob);
        avatar.innerHTML = `<img src="${imageUrl}" alt="Profile picture">`;
        avatar.classList.add("has-image");
      } catch (error) {
        avatar.textContent = avatar.dataset.initials || "?";
      }
    }),
  );
}

function getInitials(value) {
  return String(value || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
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

loadReports();
