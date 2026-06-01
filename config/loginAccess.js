const allowedEmail = String(
  process.env.ALLOWED_LOGIN_EMAIL || "geraldgonzaless123@gmail.com",
)
  .trim()
  .toLowerCase();

const allowedPassword = process.env.ALLOWED_LOGIN_PASSWORD || "";

const normalizeEmail = (email) => String(email || "").trim().toLowerCase();

const isAllowedEmail = (email) => normalizeEmail(email) === allowedEmail;

const isAllowedPassword = (password) =>
  !allowedPassword || String(password || "") === allowedPassword;

module.exports = {
  allowedEmail,
  normalizeEmail,
  isAllowedEmail,
  isAllowedPassword,
};
