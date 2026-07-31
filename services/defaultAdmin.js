const bcrypt = require("bcryptjs");
const User = require("../models/User");
const { normalizeEmail } = require("../config/loginAccess");

const seedDefaultAdmin = async () => {
  const email = normalizeEmail(process.env.ADMIN_EMAIL);
  const password = process.env.ADMIN_PASSWORD;
  const name = String(process.env.ADMIN_NAME || "System Administrator").trim();

  if (!email || !password) {
    console.log("Default admin skipped: ADMIN_EMAIL or ADMIN_PASSWORD is missing.");
    return;
  }

  const user = await User.findOne({ email }).select("+password");
  const hashedPassword = await bcrypt.hash(password, 10);

  if (!user) {
    await User.create({
      name,
      email,
      password: hashedPassword,
      role: "super_admin",
      isEmailVerified: true,
      accountStatus: "approved",
      approvedAt: new Date(),
    });

    console.log(`Default super admin created: ${email}`);
    return;
  }

  const passwordMatches = await bcrypt.compare(password, user.password);

  user.name = user.name || name;
  user.role = "super_admin";
  user.isEmailVerified = true;
  user.accountStatus = "approved";
  user.approvedAt = user.approvedAt || new Date();

  if (!passwordMatches) {
    user.password = hashedPassword;
  }

  user.emailVerificationOtpHash = undefined;
  user.emailVerificationOtpExpires = undefined;
  user.emailVerificationLastSentAt = undefined;
  user.passwordResetOtpHash = undefined;
  user.passwordResetOtpExpires = undefined;
  user.passwordResetLastSentAt = undefined;

  await user.save();
  console.log(`Default super admin ready: ${email}`);
};

module.exports = seedDefaultAdmin;
