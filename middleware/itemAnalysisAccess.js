const { canCreateContent } = require("../utils/roles");

const allowedRoles = ["admin", "super_admin", "exam_creator"];

const itemAnalysisAccess = (req, res, next) => {
  if (!canCreateContent(req.user)) {
    return res.status(403).json({
      success: false,
      message: "Item analysis access is for Admins and Exam Creators only.",
    });
  }

  next();
};

module.exports = { itemAnalysisAccess, allowedRoles };
