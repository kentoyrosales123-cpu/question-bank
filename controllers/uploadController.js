const Upload = require("../models/Upload");
const fs = require("fs");
const path = require("path");

exports.uploadQuestionnaire = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Please upload a file.",
      });
    }

    const uploadedFile = await Upload.create({
      originalName: req.file.originalname,
      fileName: req.file.filename,
      filePath: `/uploads/${req.file.filename}`,
      fileType: req.file.mimetype,
      uploadedBy: req.user._id,
    });

    res.status(201).json({
      success: true,
      message: "Questionnaire uploaded successfully.",
      upload: uploadedFile,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getUploads = async (req, res) => {
  try {
    const isAdmin = ["admin", "super_admin"].includes(req.user.role);
    const query = isAdmin ? {} : { uploadedBy: req.user._id };
    const uploads = await Upload.find(query)
      .populate("uploadedBy", "name email")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      count: uploads.length,
      uploads,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.deleteUpload = async (req, res) => {
  try {
    const upload = await Upload.findById(req.params.id);

    if (!upload) {
      return res.status(404).json({
        success: false,
        message: "Uploaded file not found.",
      });
    }

    const isOwner =
      upload.uploadedBy && upload.uploadedBy.toString() === req.user._id.toString();

    if (!["admin", "super_admin"].includes(req.user.role) && !isOwner) {
      return res.status(403).json({
        success: false,
        message: "You do not have access to this uploaded file.",
      });
    }

    const filePath = path.join(__dirname, "..", upload.filePath);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    await upload.deleteOne();

    res.json({
      success: true,
      message: "Uploaded file deleted successfully.",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
