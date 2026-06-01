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
  return user && user.role === "admin" ? "/dashboard.html" : "/user-dashboard.html";
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

  if (!user || user.role !== "admin") {
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

  if (!user || user.role === "admin") {
    return;
  }

  [
    "/add-question.html",
    "/upload.html",
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

const registerForm = document.getElementById("registerForm");

if (registerForm) {
  const registerButton = document.getElementById("registerButton");
  const verificationPanel = document.getElementById("verificationPanel");
  const verifyEmailButton = document.getElementById("verifyEmailButton");
  const resendOtpButton = document.getElementById("resendOtpButton");

  registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (!verificationPanel.classList.contains("hidden")) {
      verifyEmailButton.click();
      return;
    }

    const body = {
      name: document.getElementById("name").value,
      email: document.getElementById("email").value,
      password: document.getElementById("password").value,
    };

    try {
      const data = await apiRequest("/auth/register", "POST", body);

      if (data.requiresVerification) {
        registerButton.classList.add("hidden");
        verificationPanel.classList.remove("hidden");
        setMessage("authMessage", data.message, false);
        document.getElementById("name").disabled = true;
        document.getElementById("email").disabled = true;
        document.getElementById("password").disabled = true;
        document.getElementById("otp").focus();
        return;
      }

      if (data.token && data.user) {
        setAuth(data.token, data.user);
        location.href = getDashboardUrl(data.user);
      }
    } catch (error) {
      setMessage("authMessage", error.message);
    }
  });

  verifyEmailButton.addEventListener("click", async () => {
    const body = {
      email: document.getElementById("email").value,
      otp: document.getElementById("otp").value,
    };

    try {
      const data = await apiRequest("/auth/verify-email", "POST", body);
      setAuth(data.token, data.user);
      location.href = getDashboardUrl(data.user);
    } catch (error) {
      setMessage("authMessage", error.message);
    }
  });

  resendOtpButton.addEventListener("click", async () => {
    try {
      const data = await apiRequest("/auth/resend-verification", "POST", {
        email: document.getElementById("email").value,
      });

      setMessage("authMessage", data.message, false);
    } catch (error) {
      setMessage("authMessage", error.message);
    }
  });
}

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
