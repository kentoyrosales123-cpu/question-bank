const { canCreateContent } = require("../utils/roles");

const allowedRoles = ["admin", "super_admin", "exam_creator", "cee_cac_coordinator"];

const itemAnalysisAccess = (req, res, next) => {
  if (!canCreateContent(req.user)) {
    return res.status(403).json({
      success: false,
      message: "Item analysis access is for content managers only.",
    });
  }

  next();
};

module.exports = { itemAnalysisAccess, allowedRoles };
