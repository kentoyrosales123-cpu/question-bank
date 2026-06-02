const allowedRoles = ["admin", "super_admin", "professor", "user"];

const itemAnalysisAccess = (req, res, next) => {
  if (!req.user || !allowedRoles.includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: "Item analysis access is for admins and professors only.",
    });
  }

  next();
};

module.exports = { itemAnalysisAccess, allowedRoles };
