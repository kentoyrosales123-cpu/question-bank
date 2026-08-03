const API = "/api";

function getToken() {
  return localStorage.getItem("qb_token");
}

function getUser() {
  try {
    return JSON.parse(localStorage.getItem("qb_user") || "null");
  } catch (error) {
    localStorage.removeItem("qb_user");
    return null;
  }
}

function setAuth(token, user) {
  localStorage.setItem("qb_token", token);
  localStorage.setItem("qb_user", JSON.stringify(user));
}

const ROLE_LABELS = {
  super_admin: "Super Admin",
  admin: "Admin",
  cee_cac_coordinator: "CEE-CAC Coordinator",
  "Super Admin": "Super Admin",
  Admin: "Admin",
  "CEE-CAC Coordinator": "CEE-CAC Coordinator",
  exam_creator: "Exam Creator",
  exam_requestor: "Exam Requestor",
  professor: "Exam Creator",
  user: "Exam Requestor",
  student: "Exam Requestor",
};

let supportTicketsCache = [];
let activeSupportTicketId = null;
let notificationsCache = [];
let notificationStream = null;
let notificationPollTimer = null;
let isSidebarNavigationPending = false;

function normalizeRole(role) {
  const displayRoleMap = {
    "Super Admin": "super_admin",
    Admin: "admin",
    "CEE-CAC Coordinator": "cee_cac_coordinator",
    "Exam Creator": "exam_creator",
    "Exam Requestor": "exam_requestor",
  };

  return {
    professor: "exam_creator",
    user: "exam_requestor",
    student: "exam_requestor",
  }[role] || displayRoleMap[role] || role;
}

function getRoleLabel(role) {
  return ROLE_LABELS[role] || role || "User";
}

function hasAnyRole(user, roles) {
  return Boolean(user && roles.includes(normalizeRole(user.role)));
}

function isAdminRole(user) {
  return hasAnyRole(user, ["admin", "super_admin"]);
}

function isSuperAdminRole(user) {
  return hasAnyRole(user, ["super_admin"]);
}

function isCreatorRole(user) {
  return hasAnyRole(user, ["exam_creator"]);
}

function isCeeCacCoordinatorRole(user) {
  return hasAnyRole(user, ["cee_cac_coordinator"]);
}

function canCreateContentRole(user) {
  return isAdminRole(user) || isCreatorRole(user) || isCeeCacCoordinatorRole(user);
}

function canUseItemAnalysisRole(user) {
  return canGenerateExamRole(user);
}

function canUseTeacherObeRole(user) {
  return canGenerateExamRole(user);
}

function canGenerateExamRole(user) {
  return (
    isAdminRole(user) ||
    isCreatorRole(user) ||
    isCeeCacCoordinatorRole(user) ||
    hasAnyRole(user, ["exam_requestor"])
  );
}

function getDashboardUrl(user = getUser()) {
  return isAdminRole(user)
    ? "/dashboard.html"
    : "/user-dashboard.html";
}

function contentManagerPage() {
  const user = getUser();

  if (!canCreateContentRole(user)) {
    alert("Content management access only.");
    location.replace(getDashboardUrl(user));
    return false;
  }

  return true;
}

function logout() {
  localStorage.removeItem("qb_token");
  localStorage.removeItem("qb_user");
  location.href = "/login.html";
}

function escapeHTML(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function protectPage() {
  if (!getToken()) {
    location.replace("/login.html");
    return false;
  }

  return true;
}

function adminOnlyPage() {
  const user = getUser();

  if (!isAdminRole(user)) {
    alert("Admin access only.");
    location.replace(getDashboardUrl(user));
    return false;
  }

  return true;
}

function superAdminOnlyPage() {
  const user = getUser();

  if (!isSuperAdminRole(user)) {
    alert("Super Admin access only.");
    location.replace(getDashboardUrl(user));
    return false;
  }

  return true;
}

function userOnlyPage() {
  const user = getUser();

  if (isAdminRole(user)) {
    location.replace("/dashboard.html");
    return false;
  }

  return true;
}

function syncDashboardLinks() {
  const dashboardUrl = getDashboardUrl();
  const user = getUser();

  document.querySelectorAll('a[href="/dashboard.html"]').forEach((link) => {
    link.href = dashboardUrl;
  });

  if (!user || isAdminRole(user)) {
    return;
  }

  if (!canCreateContentRole(user)) {
    [
      "/upload.html",
      "/ai-generator.html",
      "/add-question.html",
      "/questions.html",
      "/parsed-questions.html",
    ].forEach((href) => {
      document.querySelectorAll(`a[href="${href}"]`).forEach((link) => {
        link.classList.add("hidden");
      });
    });
  }

  if (!canUseItemAnalysisRole(user)) {
    document.querySelectorAll('a[href="/item-analysis-upload.html"]').forEach((link) => {
      link.classList.add("hidden");
    });
  }

  if (!canUseTeacherObeRole(user)) {
    document.querySelectorAll('a[href="/obe-management.html"]').forEach((link) => {
      link.classList.add("hidden");
    });
  }

  [
    "/users.html",
    "/reports.html",
  ].forEach((href) => {
    document.querySelectorAll(`a[href="${href}"]`).forEach((link) => {
      link.classList.add("hidden");
    });
  });
}

function setActiveSidebarLink(sidebar) {
  const currentPath = location.pathname;
  const dashboardUrl = getDashboardUrl();

  sidebar.querySelectorAll("a").forEach((link) => {
    const href = link.getAttribute("href");
    const linkPath = href && href.startsWith("/") ? new URL(href, location.origin).pathname : "";
    const isDashboard =
      (currentPath === "/dashboard.html" || currentPath === "/user-dashboard.html") &&
      linkPath === dashboardUrl;

    link.classList.toggle(
      "active",
      Boolean(linkPath && (linkPath === currentPath || isDashboard)),
    );
  });
}

function ensureNotificationBell() {
  if (!getToken() || document.getElementById("notificationBell")) {
    return;
  }

  const bell = document.createElement("button");
  bell.className = "notification-bell";
  bell.id = "notificationBell";
  bell.type = "button";
  bell.setAttribute("aria-label", "Open notifications");
  bell.innerHTML = `
    <span class="notification-bell-icon"></span>
    <span class="notification-count hidden" id="notificationCount">0</span>
  `;
  bell.addEventListener("click", openNotificationModal);
  document.body.append(bell);

  ensureNotificationModal();
  loadNotifications();
  startNotificationStream();
}

function ensureNotificationModal() {
  if (document.getElementById("notificationModal")) {
    return;
  }

  const modal = document.createElement("div");
  modal.className = "modal hidden";
  modal.id = "notificationModal";
  modal.innerHTML = `
    <div class="modal-panel notification-modal-panel">
      <div class="modal-header">
        <div>
          <h2>Notifications</h2>
          <p class="muted-text">Role-based alerts for requests and transactions.</p>
        </div>
        <div class="action-row">
          <button class="btn secondary" type="button" onclick="markAllNotificationsRead()">Mark All Read</button>
          <button class="btn secondary" type="button" onclick="closeNotificationModal()">Close</button>
        </div>
      </div>
      <div class="notification-list" id="notificationList"></div>
    </div>
  `;
  document.body.append(modal);
}

async function loadNotifications() {
  if (!getToken()) {
    return;
  }

  try {
    const data = await notificationRequest("");
    applyNotificationPayload(data);
  } catch (error) {
    renderNotificationCount(0);
  }
}

function applyNotificationPayload(data) {
  notificationsCache = data.notifications || [];
  renderNotificationCount(data.unreadCount || 0);

  if (!document.getElementById("notificationModal")?.classList.contains("hidden")) {
    renderNotifications();
  }
}

function startNotificationStream(useFallback = false) {
  if (!window.EventSource || notificationStream) {
    startNotificationPolling();
    return;
  }

  const token = encodeURIComponent(getToken() || "");
  const endpoint = useFallback
    ? `/api/users/notifications/stream?token=${token}`
    : `/api/notifications/stream?token=${token}`;

  notificationStream = new EventSource(endpoint);
  notificationStream.addEventListener("notifications", (event) => {
    try {
      applyNotificationPayload(JSON.parse(event.data));
    } catch (error) {
      loadNotifications();
    }
  });
  notificationStream.onerror = () => {
    notificationStream.close();
    notificationStream = null;

    if (!useFallback) {
      startNotificationStream(true);
      return;
    }

    startNotificationPolling();
  };
}

function startNotificationPolling() {
  if (notificationPollTimer) {
    return;
  }

  notificationPollTimer = setInterval(loadNotifications, 5000);
}

function stopNotificationConnections() {
  if (notificationStream) {
    notificationStream.close();
    notificationStream = null;
  }

  if (notificationPollTimer) {
    clearInterval(notificationPollTimer);
    notificationPollTimer = null;
  }
}

function renderNotificationCount(count) {
  const countBadge = document.getElementById("notificationCount");

  if (!countBadge) {
    return;
  }

  countBadge.textContent = count > 99 ? "99+" : String(count);
  countBadge.classList.toggle("hidden", count < 1);
}

function openNotificationModal() {
  ensureNotificationModal();
  document.getElementById("notificationModal").classList.remove("hidden");
  renderNotifications();
  loadNotifications();
}

function closeNotificationModal() {
  document.getElementById("notificationModal")?.classList.add("hidden");
}

function renderNotifications() {
  const list = document.getElementById("notificationList");

  if (!list) {
    return;
  }

  list.innerHTML =
    notificationsCache.length > 0
      ? notificationsCache.map(renderNotificationItem).join("")
      : `<p class="muted-text">No notifications yet.</p>`;
}

function renderNotificationItem(notification) {
  const unread = !notification.readAt;

  return `
    <button
      class="notification-item ${unread ? "unread" : ""}"
      type="button"
      onclick="openNotification('${notification._id}')"
    >
      <span class="notification-dot"></span>
      <span>
        <strong>${escapeHTML(notification.title)}</strong>
        <small>${escapeHTML(notification.message)}</small>
        <small>${new Date(notification.createdAt).toLocaleString()}</small>
      </span>
    </button>
  `;
}

async function openNotification(notificationId) {
  const notification = notificationsCache.find((item) => item._id === notificationId);

  if (!notification) {
    return;
  }

  if (!notification.readAt) {
    await notificationRequest(`/${notificationId}/read`, "PATCH");
    notification.readAt = new Date().toISOString();
    renderNotifications();
    loadNotifications();
  }

  if (notification.link === "#support") {
    closeNotificationModal();
    openSupportModal();
    return;
  }

  if (notification.link) {
    location.href = notification.link;
  }
}

async function markAllNotificationsRead() {
  try {
    await notificationRequest("/read-all", "PATCH");
    await loadNotifications();
    renderNotifications();
  } catch (error) {
    alert(error.message);
  }
}

async function notificationRequest(path = "", method = "GET", body = null) {
  try {
    return await apiRequest(`/notifications${path}`, method, body);
  } catch (error) {
    if (error.message !== "Route not found") {
      throw error;
    }

    return apiRequest(`/users/notifications${path}`, method, body);
  }
}

function ensureSupportLink(sidebar) {
  if (isSuperAdminRole(getUser())) {
    sidebar.querySelectorAll(".settings-link, .support-link").forEach((link) => {
      link.remove();
    });
    return;
  }

  let supportLink = sidebar.querySelector(".support-link");

  sidebar.querySelectorAll(".settings-link").forEach((link) => {
    link.classList.remove("settings-link");
    link.classList.add("support-link");
    link.href = "#support";
    link.textContent = "Chat Support";
  });

  supportLink = sidebar.querySelector(".support-link");

  if (!supportLink) {
    const logoutLink = sidebar.querySelector('a[onclick*="logout"]');
    supportLink = document.createElement("a");
    supportLink.className = "support-link";
    supportLink.href = "#support";
    supportLink.textContent = "Chat Support";

    if (logoutLink) {
      logoutLink.before(supportLink);
    } else {
      sidebar.append(supportLink);
    }
  }

  supportLink.setAttribute("role", "button");
  supportLink.addEventListener("click", (event) => {
    event.preventDefault();
    openSupportModal();
  });
}

function ensureSupportModal() {
  if (document.getElementById("supportModal")) {
    return;
  }

  const modal = document.createElement("div");
  modal.className = "modal hidden";
  modal.id = "supportModal";
  modal.innerHTML = `
    <div class="modal-panel support-modal-panel">
      <div class="modal-header">
        <div>
          <h2 id="supportModalTitle">Chat Support</h2>
          <p class="muted-text" id="supportModalSubtitle">File a bug ticket directly to the Super Admin.</p>
        </div>
        <button class="btn secondary" type="button" onclick="closeSupportModal()">Close</button>
      </div>

      <form class="support-form" id="supportTicketForm">
        <label>
          <span class="field-label">Subject</span>
          <input id="supportSubject" type="text" placeholder="Brief bug summary" required />
        </label>

        <label>
          <span class="field-label">Message</span>
          <textarea id="supportMessage" rows="5" placeholder="Describe what happened, what you expected, and any steps to reproduce it." required></textarea>
        </label>

        <div class="form-actions">
          <button class="btn" type="submit">Send Ticket</button>
        </div>
      </form>

      <p class="message" id="supportMessageStatus"></p>

      <div class="support-ticket-list hidden" id="supportTicketListWrap">
        <div class="dashboard-modal-divider">
          <strong id="supportTicketListTitle">Recent Tickets</strong>
        </div>
        <div id="supportTicketList"></div>
      </div>

      <div class="support-ticket-detail hidden" id="supportTicketDetail"></div>
    </div>
  `;

  document.body.append(modal);

  document
    .getElementById("supportTicketForm")
    .addEventListener("submit", submitSupportTicket);
}

async function openSupportModal() {
  ensureSupportModal();
  const isSuperAdmin = isSuperAdminRole(getUser());

  document.getElementById("supportModalTitle").textContent = isSuperAdmin
    ? "Support Tickets"
    : "Chat Support";
  document.getElementById("supportModalSubtitle").textContent = isSuperAdmin
    ? "View and reply to bug tickets submitted by users."
    : "File a bug ticket directly to the Super Admin.";
  document
    .getElementById("supportTicketForm")
    .classList.toggle("hidden", isSuperAdmin);
  document.getElementById("supportModal").classList.remove("hidden");
  if (!isSuperAdmin) {
    document.getElementById("supportSubject").focus();
  }
  await loadSupportTickets();
}

function closeSupportModal() {
  document.getElementById("supportModal")?.classList.add("hidden");
}

async function submitSupportTicket(event) {
  event.preventDefault();

  try {
    const data = await supportTicketRequest("", "POST", {
      subject: document.getElementById("supportSubject").value,
      message: document.getElementById("supportMessage").value,
      pageUrl: location.href,
    });

    setMessage("supportMessageStatus", data.message, false);
    document.getElementById("supportTicketForm").reset();
    await loadSupportTickets();
  } catch (error) {
    setMessage("supportMessageStatus", error.message);
  }
}

async function loadSupportTickets() {
  const wrap = document.getElementById("supportTicketListWrap");
  const list = document.getElementById("supportTicketList");

  if (!wrap || !list) return;

  try {
    const data = await supportTicketRequest("");
    const tickets = data.tickets || [];
    supportTicketsCache = tickets;
    wrap.classList.toggle("hidden", tickets.length === 0);
    document.getElementById("supportTicketListTitle").textContent =
      isSuperAdminRole(getUser()) ? "Recent Support Tickets" : "My Recent Tickets";
    list.innerHTML = tickets.map(renderSupportTicket).join("");
    if (activeSupportTicketId) {
      renderSupportTicketDetail(activeSupportTicketId);
    }
  } catch (error) {
    wrap.classList.remove("hidden");
    list.innerHTML = `<p class="message wrong">${escapeHTML(error.message)}</p>`;
  }
}

function isSuperAdminRole(user) {
  return hasAnyRole(user, ["super_admin"]);
}

function renderSupportTicket(ticket) {
  const reporter = ticket.createdBy?.name || ticket.createdBy?.email || "Unknown user";
  const isOpen = ticket.status !== "Resolved";
  const isSuperAdmin = isSuperAdminRole(getUser());
  const replies = Array.isArray(ticket.replies) ? ticket.replies : [];
  const latestReply = replies[replies.length - 1];

  return `
    <div class="support-ticket-item">
      <div>
        <strong>${escapeHTML(ticket.subject)}</strong>
        <small>${escapeHTML(reporter)} &middot; ${new Date(ticket.createdAt).toLocaleString()}</small>
        <p>${escapeHTML(ticket.message)}</p>
        ${
          latestReply
            ? `<div class="support-latest-reply">
                <small>Latest reply from ${escapeHTML(latestReply.repliedBy?.name || "Super Admin")}</small>
                <p>${escapeHTML(latestReply.message)}</p>
              </div>`
            : ""
        }
        ${ticket.pageUrl ? `<small>${escapeHTML(ticket.pageUrl)}</small>` : ""}
      </div>
      <span class="badge ${isOpen ? "average" : "easy"}">${escapeHTML(ticket.status)}</span>
      ${
        isSuperAdmin
          ? `<div class="action-row">
              <button class="btn secondary compact-btn" type="button" onclick="viewSupportTicket('${ticket._id}')">View</button>
              <button class="btn compact-btn" type="button" onclick="showSupportReply('${ticket._id}')">Reply</button>
              ${
                isOpen
                  ? `<button class="btn secondary compact-btn" type="button" onclick="resolveSupportTicket('${ticket._id}')">Resolve</button>`
                  : ""
              }
            </div>`
          : `<div class="action-row">
              <button class="btn secondary compact-btn" type="button" onclick="viewSupportTicket('${ticket._id}')">View Chat</button>
              <button class="btn compact-btn" type="button" onclick="showSupportReply('${ticket._id}')">Reply</button>
            </div>`
      }
      ${
        !isSuperAdmin && replies.length > 0
          ? `<span class="badge easy">${replies.length} repl${replies.length === 1 ? "y" : "ies"}</span>`
          : ""
      }
    </div>
  `;
}

function viewSupportTicket(ticketId) {
  activeSupportTicketId = ticketId;
  renderSupportTicketDetail(ticketId);
}

function showSupportReply(ticketId) {
  activeSupportTicketId = ticketId;
  renderSupportTicketDetail(ticketId, true);
}

function renderSupportTicketDetail(ticketId, focusReply = false) {
  const detail = document.getElementById("supportTicketDetail");
  const ticket = supportTicketsCache.find((item) => item._id === ticketId);

  if (!detail || !ticket) {
    return;
  }

  const reporter = ticket.createdBy?.name || ticket.createdBy?.email || "Unknown user";
  const replies = Array.isArray(ticket.replies) ? ticket.replies : [];
  const currentUser = getUser();
  const canReply =
    isSuperAdminRole(currentUser) ||
    ticket.createdBy?._id === currentUser?.id ||
    ticket.createdBy === currentUser?.id;

  detail.classList.remove("hidden");
  detail.innerHTML = `
    <div class="dashboard-modal-divider">
      <strong>${escapeHTML(ticket.subject)}</strong>
    </div>
    <div class="support-ticket-detail-body">
      <p><strong>Reporter:</strong> ${escapeHTML(reporter)}</p>
      <p><strong>Status:</strong> ${escapeHTML(ticket.status)}</p>
      ${ticket.pageUrl ? `<p><strong>Page:</strong> ${escapeHTML(ticket.pageUrl)}</p>` : ""}
      <p>${escapeHTML(ticket.message)}</p>

      <div class="support-replies">
        <strong>Replies</strong>
        ${
          replies.length > 0
            ? replies
                .map(
                  (reply) => `
                    <div class="support-reply-item">
                      <small>${escapeHTML(reply.repliedBy?.name || "Super Admin")} &middot; ${new Date(reply.createdAt).toLocaleString()}</small>
                      <p>${escapeHTML(reply.message)}</p>
                    </div>
                  `,
                )
                .join("")
            : `<p class="muted-text">No replies yet.</p>`
        }
      </div>

      ${
        canReply
          ? `<form class="support-reply-form" onsubmit="submitSupportReply(event, '${ticket._id}')">
              <label>
                <span class="field-label">Reply</span>
                <textarea id="supportReplyMessage" rows="3" placeholder="Type your reply..." required></textarea>
              </label>
              <div class="form-actions">
                <button class="btn" type="submit">Send Reply</button>
              </div>
            </form>`
          : ""
      }
    </div>
  `;

  if (focusReply) {
    document.getElementById("supportReplyMessage")?.focus();
  }
}

async function submitSupportReply(event, ticketId) {
  event.preventDefault();

  try {
    const data = await supportTicketRequest(`/${ticketId}/reply`, "POST", {
      message: document.getElementById("supportReplyMessage").value,
    });
    setMessage("supportMessageStatus", data.message, false);
    await loadSupportTickets();
  } catch (error) {
    setMessage("supportMessageStatus", error.message);
  }
}

async function resolveSupportTicket(ticketId) {
  try {
    const data = await supportTicketRequest(`/${ticketId}/resolve`, "PATCH");
    setMessage("supportMessageStatus", data.message, false);
    await loadSupportTickets();
  } catch (error) {
    setMessage("supportMessageStatus", error.message);
  }
}

async function supportTicketRequest(path = "", method = "GET", body = null) {
  try {
    return await apiRequest(`/support-tickets${path}`, method, body);
  } catch (error) {
    if (error.message !== "Route not found") {
      throw error;
    }

    return apiRequest(`/users/support-tickets${path}`, method, body);
  }
}

function ensureSidebarLink(sidebar, { href, label, afterHref }) {
  if (sidebar.querySelector(`a[href="${href}"]`)) {
    return;
  }

  const link = document.createElement("a");
  link.href = href;
  link.textContent = label;

  const anchor = sidebar.querySelector(`a[href="${afterHref}"]`);

  if (anchor) {
    anchor.after(link);
    return;
  }

  const firstDivider = sidebar.querySelector(".nav-divider");

  if (firstDivider) {
    firstDivider.before(link);
  } else {
    sidebar.append(link);
  }
}

function normalizeSidebarLinks(sidebar) {
  const user = getUser();

  if (location.pathname !== "/parsed-questions.html") {
    sidebar.querySelectorAll('a[href="/parsed-questions.html"]').forEach((link) => {
      link.remove();
    });
  }

  if (!canUseTeacherObeRole(user)) {
    sidebar.querySelectorAll('a[href="/obe-management.html"]').forEach((link) => {
      link.remove();
    });
    sidebar.querySelectorAll('a[href="/ai-generator.html"]').forEach((link) => {
      link.remove();
    });
  }

  ensureSidebarLink(sidebar, {
    href: "/questions.html",
    label: "Questions",
    afterHref: "/dashboard.html",
  });
  ensureSidebarLink(sidebar, {
    href: "/add-question.html",
    label: "Add Question",
    afterHref: "/questions.html",
  });
  if (isSuperAdminRole(user)) {
    ensureSidebarLink(sidebar, {
      href: "/ai-generator.html",
      label: "AI Generator",
      afterHref: "/add-question.html",
    });
  }
  ensureSidebarLink(sidebar, {
    href: "/upload.html",
    label: "Upload Questionnaire",
    afterHref: isSuperAdminRole(user) ? "/ai-generator.html" : "/add-question.html",
  });
  ensureSidebarLink(sidebar, {
    href: "/generate-exam.html",
    label: "Generate Exam",
    afterHref: "/upload.html",
  });
  ensureSidebarLink(sidebar, {
    href: "/item-analysis-upload.html",
    label: "Item Analysis",
    afterHref: "/generate-exam.html",
  });
  if (canUseTeacherObeRole(user)) {
    ensureSidebarLink(sidebar, {
      href: "/obe-management.html",
      label: "OBE Management",
      afterHref: "/item-analysis-upload.html",
    });
  }
  ensureSidebarLink(sidebar, {
    href: "/profile.html",
    label: "Profile",
    afterHref: isSuperAdminRole(user)
      ? "/obe-management.html"
      : "/item-analysis-upload.html",
  });
  ensureSidebarLink(sidebar, {
    href: "/users.html",
    label: "Users",
    afterHref: "/profile.html",
  });
  ensureSidebarLink(sidebar, {
    href: "/reports.html",
    label: "Reports",
    afterHref: "/users.html",
  });
}

function initSidebar() {
  const sidebar = document.querySelector(".sidebar");

  if (!sidebar) {
    return;
  }

  sidebar.querySelectorAll('a[onclick*="logout"]').forEach((link) => {
    link.href = "/login.html";
    link.setAttribute("role", "button");
  });

  normalizeSidebarLinks(sidebar);
  ensureSupportLink(sidebar);
  syncDashboardLinks();
  setActiveSidebarLink(sidebar);

  if (document.querySelector(".sidebar-toggle")) {
    return;
  }

  const toggle = document.createElement("button");
  toggle.className = "sidebar-toggle";
  toggle.type = "button";
  toggle.setAttribute("aria-label", "Open navigation");
  toggle.setAttribute("aria-expanded", "false");
  toggle.innerHTML = "<span></span><span></span><span></span>";

  const backdrop = document.createElement("button");
  backdrop.className = "sidebar-backdrop";
  backdrop.type = "button";
  backdrop.setAttribute("aria-label", "Close navigation");

  const closeSidebar = () => {
    document.body.classList.remove("sidebar-open");
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Open navigation");
  };

  toggle.addEventListener("click", () => {
    const isOpen = document.body.classList.toggle("sidebar-open");
    toggle.setAttribute("aria-expanded", String(isOpen));
    toggle.setAttribute("aria-label", isOpen ? "Close navigation" : "Open navigation");
  });

  backdrop.addEventListener("click", closeSidebar);
  sidebar.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", (event) => {
      if (window.matchMedia("(max-width: 850px)").matches) {
        closeSidebar();
      }

      const href = link.getAttribute("href") || "";

      if (
        event.defaultPrevented ||
        !href.startsWith("/") ||
        link.matches('[onclick*="logout"]')
      ) {
        return;
      }

      const targetPath = new URL(href, location.origin).pathname;

      if (targetPath === location.pathname) {
        event.preventDefault();
        return;
      }

      if (isSidebarNavigationPending) {
        event.preventDefault();
        return;
      }

      isSidebarNavigationPending = true;
      stopNotificationConnections();
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeSidebar();
    }
  });

  document.body.prepend(toggle);
  document.body.append(backdrop);
}

async function apiRequest(
  endpoint,
  method = "GET",
  body = null,
  isForm = false,
) {
  const headers = {};

  if (!isForm) {
    headers["Content-Type"] = "application/json";
  }

  if (getToken()) {
    headers.Authorization = `Bearer ${getToken()}`;
  }

  const res = await fetch(API + endpoint, {
    method,
    headers,
    body: body ? (isForm ? body : JSON.stringify(body)) : null,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.message || "Request failed.");
  }

  return data;
}

function initTheme() {
  const savedTheme = localStorage.getItem("qb_theme");

  if (savedTheme === "dark") {
    document.body.classList.add("dark");
  }
}

function toggleTheme() {
  document.body.classList.toggle("dark");
  localStorage.setItem(
    "qb_theme",
    document.body.classList.contains("dark") ? "dark" : "light",
  );
}

function setMessage(elementId, message, isError = true) {
  const element = document.getElementById(elementId);

  if (!element) {
    return;
  }

  element.textContent = message;
  element.classList.toggle("wrong", isError);
  element.classList.toggle("correct", !isError);
}

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  initSidebar();
  ensureNotificationBell();
});

window.addEventListener("beforeunload", stopNotificationConnections);

const loginForm = document.getElementById("loginForm");

if (loginForm) {
  const registerForm = document.getElementById("registerForm");
  const verifyEmailForm = document.getElementById("verifyEmailForm");
  const showLoginTab = document.getElementById("showLoginTab");
  const showRegisterTab = document.getElementById("showRegisterTab");
  const resendVerificationButton = document.getElementById(
    "resendVerificationButton",
  );
  let pendingVerificationEmail = "";

  const showAuthPanel = (panel) => {
    loginForm.classList.toggle("hidden", panel !== "login");
    registerForm?.classList.toggle("hidden", panel !== "register");
    verifyEmailForm?.classList.toggle("hidden", panel !== "verify");
    showLoginTab?.classList.toggle("active", panel === "login");
    showRegisterTab?.classList.toggle("active", panel === "register");
    setMessage("authMessage", "", false);
  };

  showLoginTab?.addEventListener("click", () => showAuthPanel("login"));
  showRegisterTab?.addEventListener("click", () => showAuthPanel("register"));

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const body = {
      email: document.getElementById("email").value,
      password: document.getElementById("password").value,
    };

    try {
      const data = await apiRequest("/auth/login", "POST", body);
      setAuth(data.token, data.user);
      location.href = getDashboardUrl(data.user);
    } catch (error) {
      setMessage("authMessage", error.message);
    }
  });

  registerForm?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const body = {
      name: document.getElementById("registerName").value.trim(),
      email: document.getElementById("registerEmail").value.trim(),
      password: document.getElementById("registerPassword").value,
    };

    try {
      const data = await apiRequest("/auth/register", "POST", body);

      pendingVerificationEmail = data.email || body.email;
      document.getElementById("verifyEmail").value = pendingVerificationEmail;
      showAuthPanel("verify");
      setMessage("authMessage", data.message, false);
      document.getElementById("verifyOtp").focus();
    } catch (error) {
      setMessage("authMessage", error.message);
    }
  });

  verifyEmailForm?.addEventListener("submit", async (e) => {
    e.preventDefault();

    try {
      const data = await apiRequest("/auth/verify-email", "POST", {
        email:
          pendingVerificationEmail ||
          document.getElementById("verifyEmail").value,
        otp: document.getElementById("verifyOtp").value.trim(),
      });

      if (data.pendingApproval || !data.token) {
        showAuthPanel("login");
        setMessage("authMessage", data.message, false);
        return;
      }

      setAuth(data.token, data.user);
      location.href = getDashboardUrl(data.user);
    } catch (error) {
      setMessage("authMessage", error.message);
    }
  });

  resendVerificationButton?.addEventListener("click", async () => {
    try {
      const data = await apiRequest("/auth/resend-verification", "POST", {
        email:
          pendingVerificationEmail ||
          document.getElementById("verifyEmail").value,
      });

      setMessage("authMessage", data.message, false);
    } catch (error) {
      setMessage("authMessage", error.message);
    }
  });
}

const forgotPasswordForm = document.getElementById("forgotPasswordForm");

if (forgotPasswordForm) {
  const emailInput = document.getElementById("email");
  const sendResetCodeButton = document.getElementById("sendResetCodeButton");
  const resetPasswordPanel = document.getElementById("resetPasswordPanel");
  const resetPasswordButton = document.getElementById("resetPasswordButton");
  const resendResetCodeButton = document.getElementById("resendResetCodeButton");

  const requestResetCode = async () => {
    const data = await apiRequest("/auth/forgot-password", "POST", {
      email: emailInput.value,
    });

    sendResetCodeButton.classList.add("hidden");
    resetPasswordPanel.classList.remove("hidden");
    emailInput.disabled = true;
    setMessage("authMessage", data.message, false);
    document.getElementById("resetOtp").focus();
  };

  forgotPasswordForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (!resetPasswordPanel.classList.contains("hidden")) {
      resetPasswordButton.click();
      return;
    }

    try {
      await requestResetCode();
    } catch (error) {
      setMessage("authMessage", error.message);
    }
  });

  resetPasswordButton.addEventListener("click", async () => {
    const password = document.getElementById("newPassword").value;
    const confirmPassword = document.getElementById("confirmPassword").value;

    if (password !== confirmPassword) {
      setMessage("authMessage", "Passwords do not match.");
      return;
    }

    try {
      const data = await apiRequest("/auth/reset-password", "POST", {
        email: emailInput.value,
        otp: document.getElementById("resetOtp").value,
        password,
      });

      setMessage("authMessage", data.message, false);

      setTimeout(() => {
        location.href = "/login.html";
      }, 1200);
    } catch (error) {
      setMessage("authMessage", error.message);
    }
  });

  resendResetCodeButton.addEventListener("click", async () => {
    try {
      await requestResetCode();
    } catch (error) {
      setMessage("authMessage", error.message);
    }
  });
}
