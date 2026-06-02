const API = "/api";

function getToken() {
  return localStorage.getItem("qb_token");
}

function getUser() {
  return JSON.parse(localStorage.getItem("qb_user") || "null");
}

function setAuth(token, user) {
  localStorage.setItem("qb_token", token);
  localStorage.setItem("qb_user", JSON.stringify(user));
}

function getDashboardUrl(user = getUser()) {
  return user && ["admin", "super_admin"].includes(user.role)
    ? "/dashboard.html"
    : "/user-dashboard.html";
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
    location.href = "/login.html";
  }
}

function adminOnlyPage() {
  const user = getUser();

  if (!user || !["admin", "super_admin"].includes(user.role)) {
    alert("Admin access only.");
    location.href = getDashboardUrl(user);
  }
}

function userOnlyPage() {
  const user = getUser();

  if (user && user.role === "admin") {
    location.href = "/dashboard.html";
  }
}

function syncDashboardLinks() {
  const dashboardUrl = getDashboardUrl();
  const user = getUser();

  document.querySelectorAll('a[href="/dashboard.html"]').forEach((link) => {
    link.href = dashboardUrl;
  });

  if (!user || user.role === "admin" || user.role === "super_admin") {
    return;
  }

  if (user.role === "student") {
    [
      "/item-analysis-upload.html",
      "/generate-exam.html",
      "/upload.html",
    ].forEach((href) => {
      document.querySelectorAll(`a[href="${href}"]`).forEach((link) => {
        link.classList.add("hidden");
      });
    });
  }

  [
    "/questions.html",
    "/add-question.html",
    "/parsed-questions.html",
    "/users.html",
    "/reports.html",
  ].forEach((href) => {
    document.querySelectorAll(`a[href="${href}"]`).forEach((link) => {
      link.classList.add("hidden");
    });
  });
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
  syncDashboardLinks();
});

const loginForm = document.getElementById("loginForm");

if (loginForm) {
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
