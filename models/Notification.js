const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    title: {
      type: String,
      required: true,
      trim: true,
    },

    message: {
      type: String,
      required: true,
      trim: true,
    },

    type: {
      type: String,
      default: "info",
      trim: true,
    },

    link: {
      type: String,
      default: "",
      trim: true,
    },

    readAt: Date,
  },
  { timestamps: true },
);

module.exports = mongoose.model("Notification", notificationSchema);
