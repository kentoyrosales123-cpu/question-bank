const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
    },

    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "Invalid email format"],
    },

    password: {
      type: String,
      required: [true, "Password is required"],
    },

    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
    },

    isEmailVerified: {
      type: Boolean,
      default: false,
    },

    emailVerificationOtpHash: {
      type: String,
      select: false,
    },

    emailVerificationOtpExpires: {
      type: Date,
      select: false,
    },

    emailVerificationLastSentAt: {
      type: Date,
      select: false,
    },

    profileImage: {
      data: {
        type: Buffer,
        select: false,
      },
      contentType: String,
      uploadedAt: Date,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("User", userSchema);
