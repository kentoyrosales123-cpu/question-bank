const express = require("express");
const router = express.Router();

const SupportTicket = require("../models/SupportTicket");
const User = require("../models/User");
const { protect } = require("../middleware/authMiddleware");
const { ROLES, isSuperAdmin } = require("../utils/roles");
const { notifyRoles, notifyUsers } = require("../services/notificationService");

router.post("/", protect, async (req, res) => {
  try {
    const subject = String(req.body.subject || "").trim();
    const message = String(req.body.message || "").trim();
    const pageUrl = String(req.body.pageUrl || "").trim();

    if (!subject || !message) {
      return res.status(400).json({
        success: false,
        message: "Subject and message are required.",
      });
    }

    const superAdmins = await User.find({ role: ROLES.SUPER_ADMIN }).select("_id");
    const assignedSuperAdmin = superAdmins[0];
    const ticket = await SupportTicket.create({
      subject,
      message,
      pageUrl,
      createdBy: req.user._id,
      assignedTo: assignedSuperAdmin?._id,
    });

    const populatedTicket = await SupportTicket.findById(ticket._id)
      .populate("createdBy", "name email role")
      .populate("assignedTo", "name email role")
      .populate("replies.repliedBy", "name email role");

    await notifyUsers(
      superAdmins.map((user) => user._id),
      {
      actor: req.user._id,
      title: "New support ticket",
      message: `${req.user.name} submitted: ${subject}`,
      type: "support_ticket",
      link: "#support",
      },
    );

    await notifyUsers([req.user._id], {
      actor: req.user._id,
      title: "Support ticket submitted",
      message: `Your ticket "${subject}" was sent to the Super Admin.`,
      type: "support_ticket_submitted",
      link: "#support",
    });

    res.status(201).json({
      success: true,
      message: "Support ticket sent to the Super Admin.",
      ticket: populatedTicket,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

router.get("/", protect, async (req, res) => {
  try {
    const query = isSuperAdmin(req.user) ? {} : { createdBy: req.user._id };
    const tickets = await SupportTicket.find(query)
      .populate("createdBy", "name email role")
      .populate("assignedTo", "name email role")
      .populate("replies.repliedBy", "name email role")
      .sort({ createdAt: -1 })
      .limit(30);

    res.json({
      success: true,
      tickets,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

router.patch("/:id/resolve", protect, async (req, res) => {
  try {
    if (!isSuperAdmin(req.user)) {
      return res.status(403).json({
        success: false,
        message: "Super Admin access only.",
      });
    }

    const ticket = await SupportTicket.findByIdAndUpdate(
      req.params.id,
      {
        status: "Resolved",
        resolvedAt: new Date(),
      },
      { new: true },
    )
      .populate("createdBy", "name email role")
      .populate("assignedTo", "name email role");

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: "Support ticket not found.",
      });
    }

    res.json({
      success: true,
      message: "Support ticket marked as resolved.",
      ticket,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

router.post("/:id/reply", protect, async (req, res) => {
  try {
    const message = String(req.body.message || "").trim();

    if (!message) {
      return res.status(400).json({
        success: false,
        message: "Reply message is required.",
      });
    }

    const ticket = await SupportTicket.findById(req.params.id);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: "Support ticket not found.",
      });
    }

    const isTicketOwner =
      ticket.createdBy && ticket.createdBy.toString() === req.user._id.toString();

    if (!isSuperAdmin(req.user) && !isTicketOwner) {
      return res.status(403).json({
        success: false,
        message: "You can only reply to your own support tickets.",
      });
    }

    ticket.replies.push({
      message,
      repliedBy: req.user._id,
    });

    await ticket.save();

    if (isSuperAdmin(req.user)) {
      await notifyUsers([ticket.createdBy], {
        actor: req.user._id,
        title: "Support ticket reply",
        message: `Super Admin replied to: ${ticket.subject}`,
        type: "support_reply",
        link: "#support",
      });
    } else {
      await notifyRoles([ROLES.SUPER_ADMIN], {
        actor: req.user._id,
        title: "Support ticket reply",
        message: `${req.user.name} replied to: ${ticket.subject}`,
        type: "support_reply",
        link: "#support",
      });
    }

    const populatedTicket = await SupportTicket.findById(ticket._id)
      .populate("createdBy", "name email role")
      .populate("assignedTo", "name email role")
      .populate("replies.repliedBy", "name email role");

    res.json({
      success: true,
      message: "Reply sent.",
      ticket: populatedTicket,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

module.exports = router;
