const express = require("express");
const router = express.Router();

const fs = require("fs");
const path = require("path");

const { Document, Packer, Paragraph, TextRun, ImageRun } = require("docx");

const Exam = require("../models/Exam");

const {
  generateExam,
  submitExam,
  getExam,
  downloadExamDocx,
} = require("../controllers/examController");

const { protect } = require("../middleware/authMiddleware");

router.post("/generate", protect, generateExam);
router.post("/submit", protect, submitExam);
router.get("/:id/download-docx", protect, downloadExamDocx);
router.get("/:id", protect, getExam);

module.exports = router;

router.get("/:examId/download-docx", async (req, res) => {
  try {
    const exam = await Exam.findById(req.params.examId).populate("questions");

    if (!exam) {
      return res.status(404).json({
        message: "Exam not found",
      });
    }

    const children = [];

    // Title
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: exam.title,
            bold: true,
            size: 32,
          }),
        ],
      }),
    );

    children.push(new Paragraph(""));

    exam.questions.forEach((q, index) => {
      // Question
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `${index + 1}. ${q.questionText}`,
              bold: true,
            }),
          ],
        }),
      );

      // IMAGE SUPPORT
      if (q.image) {
        const cleanPath = q.image.replace(/^\/+/, "");

        const imagePath = path.join(__dirname, "..", cleanPath);

        if (fs.existsSync(imagePath)) {
          const imageBuffer = fs.readFileSync(imagePath);

          const extension = path.extname(imagePath).toLowerCase();

          let imageType = "png";

          if (extension === ".jpg" || extension === ".jpeg") {
            imageType = "jpg";
          }

          children.push(
            new Paragraph({
              children: [
                new ImageRun({
                  data: imageBuffer,
                  type: imageType,
                  transformation: {
                    width: 400,
                    height: 250,
                  },
                }),
              ],
            }),
          );
        }
      }

      // TABLE DATA
      if (q.tableData) {
        children.push(new Paragraph(q.tableData));
      }

      // Choices
      ["A", "B", "C", "D"].forEach((letter) => {
        children.push(new Paragraph(`${letter}. ${q.choices[letter]}`));
      });

      children.push(new Paragraph(""));
    });

    const doc = new Document({
      sections: [
        {
          children,
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${exam.title}.docx"`,
    );

    res.send(buffer);
  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: "Failed to generate DOCX",
    });
  }
});
