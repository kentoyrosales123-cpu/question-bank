const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const {
  sendVerificationOtp,
  sendPasswordResetOtp,
} = require("../services/emailService");
const { logActivity } = require("../services/activityLogger");
const {
  normalizeEmail,
} = require("../config/loginAccess");

const OTP_EXPIRY_MINUTES = 10;
const OTP_RESEND_SECONDS = 60;

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });
};

const createOtp = () => String(Math.floor(100000 + Math.random() * 900000));

const buildAuthUser = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
});

const setAndSendVerificationOtp = async (user) => {
  const otp = createOtp();

  user.emailVerificationOtpHash = await bcrypt.hash(otp, 10);
  user.emailVerificationOtpExpires = new Date(
    Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000,
  );
  user.emailVerificationLastSentAt = new Date();

  await user.save();
  await sendVerificationOtp({ to: user.email, name: user.name, otp });
};

const setAndSendPasswordResetOtp = async (user) => {
  const otp = createOtp();

  user.passwordResetOtpHash = await bcrypt.hash(otp, 10);
  user.passwordResetOtpExpires = new Date(
    Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000,
  );
  user.passwordResetLastSentAt = new Date();

  await user.save();
  await sendPasswordResetOtp({ to: user.email, name: user.name, otp });
};

exports.register = async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const normalizedEmail = normalizeEmail(email);

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Name, email, and password are required.",
      });
    }

    const existingUser = await User.findOne({ email: normalizedEmail }).select(
      "+emailVerificationOtpHash +emailVerificationOtpExpires +emailVerificationLastSentAt",
    );

    if (existingUser && existingUser.isEmailVerified !== false) {
      return res.status(400).json({
        success: false,
        message: "Email already registered.",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user =
      existingUser ||
      new User({
        email: normalizedEmail,
        role: "user",
      });

    user.name = String(name).trim();
    user.password = hashedPassword;
    user.isEmailVerified = false;

    await setAndSendVerificationOtp(user);

    res.status(201).json({
      success: true,
      requiresVerification: true,
      message: "Verification code sent to your email.",
      email: user.email,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.verifyEmail = async (req, res) => {
  try {
    const { email, otp } = req.body;
    const normalizedEmail = normalizeEmail(email);

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: "Email and verification code are required.",
      });
    }

    const user = await User.findOne({ email: normalizedEmail }).select(
      "+emailVerificationOtpHash +emailVerificationOtpExpires",
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Account not found.",
      });
    }

    if (user.isEmailVerified) {
      await logActivity(req, {
        user,
        action: "login",
        description: "Logged in after email verification check",
      });

      return res.json({
        success: true,
        message: "Email already verified.",
        token: generateToken(user._id),
        user: buildAuthUser(user),
      });
    }

    if (
      !user.emailVerificationOtpHash ||
      !user.emailVerificationOtpExpires ||
      user.emailVerificationOtpExpires < new Date()
    ) {
      return res.status(400).json({
        success: false,
        message: "Verification code expired. Request a new code.",
      });
    }

    const isOtpValid = await bcrypt.compare(String(otp), user.emailVerificationOtpHash);

    if (!isOtpValid) {
      return res.status(400).json({
        success: false,
        message: "Invalid verification code.",
      });
    }

    user.isEmailVerified = true;
    user.emailVerificationOtpHash = undefined;
    user.emailVerificationOtpExpires = undefined;
    user.emailVerificationLastSentAt = undefined;

    await user.save();

    await logActivity(req, {
      user,
      action: "login",
      description: "Logged in after verifying email",
    });

    res.json({
      success: true,
      message: "Email verified successfully.",
      token: generateToken(user._id),
      user: buildAuthUser(user),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.resendVerification = async (req, res) => {
  try {
    const { email } = req.body;
    const normalizedEmail = normalizeEmail(email);

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required.",
      });
    }

    const user = await User.findOne({ email: normalizedEmail }).select(
      "+emailVerificationLastSentAt",
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Account not found.",
      });
    }

    if (user.isEmailVerified) {
      return res.status(400).json({
        success: false,
        message: "Email is already verified.",
      });
    }

    const lastSentAt = user.emailVerificationLastSentAt?.getTime() || 0;
    const secondsSinceLastSend = (Date.now() - lastSentAt) / 1000;

    if (secondsSinceLastSend < OTP_RESEND_SECONDS) {
      return res.status(429).json({
        success: false,
        message: `Please wait ${Math.ceil(
          OTP_RESEND_SECONDS - secondsSinceLastSend,
        )} seconds before requesting another code.`,
      });
    }

    await setAndSendVerificationOtp(user);

    res.json({
      success: true,
      message: "Verification code resent.",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const normalizedEmail = normalizeEmail(email);

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required.",
      });
    }

    const user = await User.findOne({ email: normalizedEmail }).select(
      "+passwordResetLastSentAt",
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Account not found.",
      });
    }

    const lastSentAt = user.passwordResetLastSentAt?.getTime() || 0;
    const secondsSinceLastSend = (Date.now() - lastSentAt) / 1000;

    if (secondsSinceLastSend < OTP_RESEND_SECONDS) {
      return res.status(429).json({
        success: false,
        message: `Please wait ${Math.ceil(
          OTP_RESEND_SECONDS - secondsSinceLastSend,
        )} seconds before requesting another reset code.`,
      });
    }

    await setAndSendPasswordResetOtp(user);

    res.json({
      success: true,
      message: "Password reset code sent to your email.",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const { email, otp, password } = req.body;
    const normalizedEmail = normalizeEmail(email);

    if (!email || !otp || !password) {
      return res.status(400).json({
        success: false,
        message: "Email, reset code, and new password are required.",
      });
    }

    const user = await User.findOne({ email: normalizedEmail }).select(
      "+passwordResetOtpHash +passwordResetOtpExpires",
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Account not found.",
      });
    }

    if (
      !user.passwordResetOtpHash ||
      !user.passwordResetOtpExpires ||
      user.passwordResetOtpExpires < new Date()
    ) {
      return res.status(400).json({
        success: false,
        message: "Reset code expired. Request a new code.",
      });
    }

    const isOtpValid = await bcrypt.compare(String(otp), user.passwordResetOtpHash);

    if (!isOtpValid) {
      return res.status(400).json({
        success: false,
        message: "Invalid reset code.",
      });
    }

    user.password = await bcrypt.hash(password, 10);
    user.isEmailVerified = true;
    user.passwordResetOtpHash = undefined;
    user.passwordResetOtpExpires = undefined;
    user.passwordResetLastSentAt = undefined;
    user.emailVerificationOtpHash = undefined;
    user.emailVerificationOtpExpires = undefined;
    user.emailVerificationLastSentAt = undefined;

    await user.save();

    res.json({
      success: true,
      message: "Password reset successfully. You can now log in.",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = normalizeEmail(email);

    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    if (user.isEmailVerified === false) {
      return res.status(403).json({
        success: false,
        requiresVerification: true,
        message: "Please verify your email before logging in.",
      });
    }

    await logActivity(req, {
      user,
      action: "login",
      description: "Logged in",
    });

    res.json({
      success: true,
      message: "Login successful.",
      token: generateToken(user._id),
      user: buildAuthUser(user),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.me = async (req, res) => {
  res.json({
    success: true,
    user: req.user,
  });
};
