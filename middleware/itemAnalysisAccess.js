const { canUseItemAnalysis } = require("../utils/roles");

const allowedRoles = [
  "admin",
  "super_admin",
  "exam_creator",
  "exam_requestor",
  "cee_cac_coordinator",
];

const itemAnalysisAccess = (req, res, next) => {
  if (!canUseItemAnalysis(req.user)) {
    return res.status(403).json({
      success: false,
      message: "Item analysis access is for exam users only.",
    });
  }

  next();
};

module.exports = { itemAnalysisAccess, allowedRoles };
