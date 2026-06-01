const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { isAllowedEmail } = require("../config/loginAccess");

const protect = async (req, res, next) => {
  try {
    let token;

    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer")
    ) {
      token = req.headers.authorization.split(" ")[1];
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Not authorized. No token provided.",
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.user = await User.findById(decoded.id).select(
      "-password -profileImage.data",
    );

    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "User not found.",
      });
    }

    if (!isAllowedEmail(req.user.email)) {
      return res.status(403).json({
        success: false,
        message: "This system is restricted to the authorized account only.",
      });
    }

    next();
  } catch (error) {
    res.status(401).json({
      success: false,
      message: "Invalid or expired token.",
    });
  }
};

const adminOnly = (req, res, next) => {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({
      success: false,
      message: "Admin access only.",
    });
  }

  next();
};

module.exports = { protect, adminOnly };
