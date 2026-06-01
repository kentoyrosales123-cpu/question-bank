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
    location.href = "/generate-exam.html";
  }
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

document.addEventListener("DOMContentLoaded", initTheme);

const registerForm = document.getElementById("registerForm");

if (registerForm) {
  registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const body = {
      name: document.getElementById("name").value,
      email: document.getElementById("email").value,
      password: document.getElementById("password").value,
    };

    try {
      const data = await apiRequest("/auth/register", "POST", body);
      setAuth(data.token, data.user);
      location.href = "/dashboard.html";
    } catch (error) {
      document.getElementById("authMessage").textContent = error.message;
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
      location.href = "/dashboard.html";
    } catch (error) {
      document.getElementById("authMessage").textContent = error.message;
    }
  });
}
