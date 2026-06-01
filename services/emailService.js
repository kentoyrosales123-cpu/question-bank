const nodemailer = require("nodemailer");

const hasSmtpConfig = () =>
  Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

const createTransporter = () =>
  nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

const escapeHTML = (value) =>
  String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const sendVerificationOtp = async ({ to, name, otp }) => {
  if (!hasSmtpConfig()) {
    console.log(`[email verification] OTP for ${to}: ${otp}`);
    return;
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;

  await createTransporter().sendMail({
    from,
    to,
    subject: "Verify your Question Bank account",
    text: `Hello ${name},\n\nYour Question Bank verification code is ${otp}. It expires in 10 minutes.\n\nIf you did not request this account, you can ignore this email.`,
    html: `
      <p>Hello ${escapeHTML(name)},</p>
      <p>Your Question Bank verification code is:</p>
      <p style="font-size:24px;font-weight:700;letter-spacing:4px;">${otp}</p>
      <p>This code expires in 10 minutes.</p>
      <p>If you did not request this account, you can ignore this email.</p>
    `,
  });
};

module.exports = { sendVerificationOtp };
