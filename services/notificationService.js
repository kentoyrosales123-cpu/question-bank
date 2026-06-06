const Notification = require("../models/Notification");
const User = require("../models/User");
const { normalizeRole } = require("../utils/roles");

const uniqueIds = (ids = []) => [
  ...new Set(ids.filter(Boolean).map((id) => id.toString())),
];

const notifyUsers = async (recipientIds, payload) => {
  const recipients = uniqueIds(recipientIds);

  if (recipients.length === 0) {
    return [];
  }

  return Notification.insertMany(
    recipients.map((recipient) => ({
      recipient,
      actor: payload.actor,
      title: payload.title,
      message: payload.message,
      type: payload.type || "info",
      link: payload.link || "",
    })),
  );
};

const notifyRoles = async (roles, payload) => {
  const normalizedRoles = roles.map(normalizeRole);
  const users = await User.find({ role: { $in: normalizedRoles } }).select("_id");

  return notifyUsers(
    users.map((user) => user._id),
    payload,
  );
};

module.exports = {
  notifyUsers,
  notifyRoles,
};
