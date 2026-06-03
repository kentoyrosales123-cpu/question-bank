const { Readable } = require("stream");
const ExcelJS = require("exceljs");
const QRCode = require("qrcode");
const {
  AlignmentType,
  BorderStyle,
  Document,
  ImageRun,
  PageBreak,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} = require("docx");
const ItemAnalysisExam = require("../models/ItemAnalysisExam");
const ItemAnalysisStudentResult = require("../models/ItemAnalysisStudentResult");
const Exam = require("../models/Exam");

const normalizeHeader = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

const normalizeValue = (value) => String(value ?? "").trim();

const isCorrectValue = (value) => {
  const normalized = normalizeValue(value).toUpperCase();
  return normalized === "1" || normalized === "C";
};

const isValidItemValue = (value) => {
  const normalized = normalizeValue(value).toUpperCase();
  return ["", "1", "0", "C", "W"].includes(normalized);
};

const difficultyInterpretation = (index) => {
  if (index >= 0.8) return "Easy";
  if (index >= 0.5) return "Average";
  if (index >= 0.3) return "Difficult";
  return "Very Difficult";
};

const discriminationInterpretation = (index) => {
  if (index < 0) return "Check Item / Possible Miskey";
  if (index >= 0.4) return "Excellent";
  if (index >= 0.3) return "Good";
  if (index >= 0.2) return "Fair";
  return "Poor";
};

const recommendationFor = (difficultyIndex, discriminationIndex) => {
  if (discriminationIndex < 0) return "Check Answer Key";
  if (difficultyIndex < 0.3 && discriminationIndex < 0.2) return "Revise";
  if (discriminationIndex >= 0.3) return "Keep";
  return "Review";
};

const actionForRecommendation = (recommendation) => {
  if (recommendation === "Check Answer Key") {
    return "Verify the keyed answer and inspect student response patterns before reusing this item.";
  }

  if (recommendation === "Revise") {
    return "Rewrite the item, choices, or lesson alignment before adding it to another exam.";
  }

  if (recommendation === "Review") {
    return "Review wording and distractors; keep only if the teacher confirms the item is valid.";
  }

  return "Keep this item in the question bank and consider using it again.";
};

const roundMetric = (value) => Math.round(value * 1000) / 1000;

const getCellValue = (row, index) => {
  const value = row.getCell(index).value;

  if (value && typeof value === "object" && "text" in value) {
    return value.text;
  }

  if (value && typeof value === "object" && "result" in value) {
    return value.result;
  }

  return value;
};

const readWorkbook = async (file) => {
  const workbook = new ExcelJS.Workbook();
  const isCsv =
    file.originalname.toLowerCase().endsWith(".csv") ||
    file.mimetype.includes("csv");

  if (isCsv) {
    await workbook.csv.read(Readable.from(file.buffer.toString("utf8")));
  } else {
    await workbook.xlsx.load(file.buffer);
  }

  return workbook;
};

const parseAnswerKey = async (manualInput = "", file) => {
  const manualValues = normalizeValue(manualInput)
    .split(/[\s,;|]+/)
    .map((value) => value.trim())
    .filter(Boolean);

  if (manualValues.length > 0) {
    return manualValues.map((answer, index) => ({
      itemNo: index + 1,
      answer,
    }));
  }

  if (!file) {
    return [];
  }

  const workbook = await readWorkbook(file);
  const sheet = workbook.worksheets[0];
  const answers = [];

  if (!sheet) {
    return answers;
  }

  sheet.eachRow((row) => {
    row.eachCell((cell) => {
      const value = normalizeValue(cell.value);
      if (value) answers.push(value);
    });
  });

  return answers.map((answer, index) => ({
    itemNo: index + 1,
    answer,
  }));
};

const sanitizeFileName = (name) =>
  `${name || "omr-answer-sheet"}.docx`
    .replace(/[^a-z0-9.]/gi, "_")
    .toLowerCase();

const maroon = "8A0013";
const gold = "F2B705";
const lightGold = "FFF7DF";
const borderColor = "D7C6C6";
const omrFirstPageItems = 17;
const omrNextPageItems = 20;
const cellBorders = {
  top: { style: BorderStyle.SINGLE, size: 1, color: borderColor },
  bottom: { style: BorderStyle.SINGLE, size: 1, color: borderColor },
  left: { style: BorderStyle.SINGLE, size: 1, color: borderColor },
  right: { style: BorderStyle.SINGLE, size: 1, color: borderColor },
};

const omrCell = (text, options = {}) =>
  new TableCell({
    ...(options.width ? { width: options.width } : {}),
    borders: options.borders || cellBorders,
    verticalAlign: VerticalAlign.CENTER,
    shading: options.fill ? { fill: options.fill } : undefined,
    margins: {
      top: options.margin || 80,
      bottom: options.margin || 80,
      left: 100,
      right: 100,
    },
    children: [
      new Paragraph({
        alignment: options.align || AlignmentType.CENTER,
        children: [
          new TextRun({
            text,
            bold: Boolean(options.bold),
            size: options.size || 22,
            color: options.color || "1F1418",
          }),
        ],
      }),
    ],
  });

const textCell = (children, options = {}) =>
  new TableCell({
    ...(options.width ? { width: options.width } : {}),
    borders: options.borders || cellBorders,
    verticalAlign: VerticalAlign.CENTER,
    shading: options.fill ? { fill: options.fill } : undefined,
    margins: {
      top: options.margin || 120,
      bottom: options.margin || 120,
      left: 140,
      right: 140,
    },
    children,
  });

const infoLine = (label, value = "") =>
  new Paragraph({
    children: [
      new TextRun({ text: `${label}: `, bold: true, size: 20, color: maroon }),
      new TextRun({
        text: value || "________________________________",
        size: 20,
      }),
    ],
  });

const buildOmrTemplateBuffer = async ({
  title = "OMR Answer Sheet",
  subject = "",
  section = "",
  numberOfItems = 50,
  qrPayload = null,
}) => {
  const itemCount = Math.max(1, Math.min(200, Number(numberOfItems) || 50));
  const itemRanges = [];
  let currentStartItem = 1;

  while (currentStartItem <= itemCount) {
    const pageSize =
      currentStartItem === 1 ? omrFirstPageItems : omrNextPageItems;
    const currentEndItem = Math.min(itemCount, currentStartItem + pageSize - 1);

    itemRanges.push({
      startItem: currentStartItem,
      endItem: currentEndItem,
    });
    currentStartItem = currentEndItem + 1;
  }

  const pageCount = itemRanges.length;
  const pages = await Promise.all(
    itemRanges.map(async ({ startItem, endItem }, pageIndex) => {
      const pageNo = pageIndex + 1;
      const pageItemCount = endItem - startItem + 1;
      const pagePayload = qrPayload
        ? {
            ...qrPayload,
            pageNo,
            pageCount,
            startItem,
            endItem,
            itemsOnPage: pageItemCount,
          }
        : null;
      const qrDataUrl = pagePayload
        ? await QRCode.toDataURL(JSON.stringify(pagePayload), {
            errorCorrectionLevel: "M",
            margin: 1,
            width: 220,
          })
        : "";
      const qrImage = qrDataUrl
        ? Buffer.from(qrDataUrl.split(",")[1], "base64")
        : null;
      const rows = [
        new TableRow({
          children: [
            omrCell("No.", {
              bold: true,
              color: "FFFFFF",
              fill: maroon,
              width: { size: 12, type: WidthType.PERCENTAGE },
            }),
            omrCell("A", {
              bold: true,
              color: "FFFFFF",
              fill: maroon,
              width: { size: 22, type: WidthType.PERCENTAGE },
            }),
            omrCell("B", {
              bold: true,
              color: "FFFFFF",
              fill: maroon,
              width: { size: 22, type: WidthType.PERCENTAGE },
            }),
            omrCell("C", {
              bold: true,
              color: "FFFFFF",
              fill: maroon,
              width: { size: 22, type: WidthType.PERCENTAGE },
            }),
            omrCell("D", {
              bold: true,
              color: "FFFFFF",
              fill: maroon,
              width: { size: 22, type: WidthType.PERCENTAGE },
            }),
          ],
        }),
        ...Array.from({ length: pageItemCount }, (_, index) => {
          const itemNo = startItem + index;
          const fill = index % 2 === 0 ? "FFFFFF" : "FCF7F7";

          return new TableRow({
            children: [
              omrCell(String(itemNo), {
                bold: true,
                fill,
                width: { size: 12, type: WidthType.PERCENTAGE },
              }),
              omrCell("○", {
                fill,
                size: 26,
                width: { size: 22, type: WidthType.PERCENTAGE },
              }),
              omrCell("○", {
                fill,
                size: 26,
                width: { size: 22, type: WidthType.PERCENTAGE },
              }),
              omrCell("○", {
                fill,
                size: 26,
                width: { size: 22, type: WidthType.PERCENTAGE },
              }),
              omrCell("○", {
                fill,
                size: 26,
                width: { size: 22, type: WidthType.PERCENTAGE },
              }),
            ],
          });
        }),
      ];
      const headerTable = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: [
              textCell(
                [
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: "UNIVERSITY OF MINDANAO",
                        bold: true,
                        color: maroon,
                        size: 24,
                      }),
                    ],
                  }),
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: "OMR Answer Sheet",
                        bold: true,
                        color: "1F1418",
                        size: 32,
                      }),
                    ],
                  }),
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: `Question Bank System | OMR Sheet | Page ${pageNo} of ${pageCount} | Items ${startItem}-${endItem}`,
                        color: "5A3B40",
                        italics: true,
                        size: 20,
                      }),
                    ],
                  }),
                ],
                {
                  fill: lightGold,
                  width: { size: 80, type: WidthType.PERCENTAGE },
                },
              ),
              textCell(
                qrImage
                  ? [
                      new Paragraph({
                        alignment: AlignmentType.CENTER,
                        children: [
                          new TextRun({
                            text: `Scan Page ${pageNo} QR`,
                            bold: true,
                            color: maroon,
                            size: 18,
                          }),
                        ],
                      }),
                      new Paragraph({
                        alignment: AlignmentType.CENTER,
                        children: [
                          new TextRun({
                            text: `Items ${startItem}-${endItem}`,
                            bold: true,
                            color: "1F1418",
                            size: 16,
                          }),
                        ],
                      }),
                      new Paragraph({
                        alignment: AlignmentType.CENTER,
                        children: [
                          new ImageRun({
                            data: qrImage,
                            type: "png",
                            transformation: {
                              width: 95,
                              height: 95,
                            },
                          }),
                        ],
                      }),
                    ]
                  : [
                      new Paragraph({
                        alignment: AlignmentType.CENTER,
                        children: [
                          new TextRun({
                            text: `Scan Page ${pageNo} QR`,
                            bold: true,
                            color: maroon,
                            size: 18,
                          }),
                        ],
                      }),
                      new Paragraph({
                        alignment: AlignmentType.CENTER,
                        children: [
                          new TextRun({
                            text: "Unavailable",
                            color: "666666",
                            size: 18,
                          }),
                        ],
                      }),
                    ],
                {
                  width: { size: 20, type: WidthType.PERCENTAGE },
                },
              ),
            ],
          }),
        ],
      });
      const infoTable = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: [
              textCell([infoLine("Subject", subject)], {
                width: { size: 50, type: WidthType.PERCENTAGE },
              }),
              textCell([infoLine("Section", section)], {
                width: { size: 50, type: WidthType.PERCENTAGE },
              }),
            ],
          }),
          new TableRow({
            children: [
              textCell([infoLine("Student Name")], {
                width: { size: 50, type: WidthType.PERCENTAGE },
              }),
              textCell([infoLine("Student ID")], {
                width: { size: 50, type: WidthType.PERCENTAGE },
              }),
            ],
          }),
          new TableRow({
            children: [
              textCell([infoLine("Items", `${startItem}-${endItem} of ${itemCount}`)], {
                width: { size: 50, type: WidthType.PERCENTAGE },
              }),
              textCell([infoLine("Date")], {
                width: { size: 50, type: WidthType.PERCENTAGE },
              }),
            ],
          }),
        ],
      });
      const instructionTable = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: [
              textCell(
                [
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: "Instructions: ",
                        bold: true,
                        color: maroon,
                        size: 20,
                      }),
                      new TextRun({
                        text:
                          `Scan each page QR before capture. Page 1 contains up to ${omrFirstPageItems} items; next pages contain up to ${omrNextPageItems} items. Shade one circle per item.`,
                        size: 20,
                      }),
                    ],
                  }),
                ],
                { fill: lightGold },
              ),
            ],
          }),
        ],
      });

      return [
        ...(pageIndex > 0
          ? [new Paragraph({ children: [new PageBreak()] })]
          : []),
        headerTable,
        ...(pageIndex === 0
          ? [
              new Paragraph(""),
              infoTable,
              new Paragraph(""),
              instructionTable,
            ]
          : []),
        new Paragraph(""),
        new Table({
          width: {
            size: 100,
            type: WidthType.PERCENTAGE,
          },
          rows,
        }),
      ];
    }),
  );

  const doc = new Document({
    sections: [
      {
        children: pages.flat(),
      },
    ],
  });

  return Packer.toBuffer(doc);
};

const parseResultRows = async (file, numberOfItems) => {
  const workbook = await readWorkbook(file);
  const sheet = workbook.worksheets[0];

  if (!sheet) {
    throw new Error("The uploaded file does not contain a worksheet.");
  }

  const headerRow = sheet.getRow(1);
  const headers = {};

  headerRow.eachCell((cell, colNumber) => {
    headers[normalizeHeader(cell.value)] = colNumber;
  });

  const requiredHeaders = ["student name", "student id", "section"];
  const missingHeaders = requiredHeaders.filter((header) => !headers[header]);

  if (missingHeaders.length > 0) {
    throw new Error(`Missing required columns: ${missingHeaders.join(", ")}.`);
  }

  const itemColumns = [];

  for (let itemNo = 1; itemNo <= numberOfItems; itemNo++) {
    const column = headers[`item ${itemNo}`];

    if (!column) {
      throw new Error(`Missing item column: Item ${itemNo}.`);
    }

    itemColumns.push(column);
  }

  const totalScoreColumn = headers["total score"];
  const validationErrors = [];
  const rows = [];

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const studentName = normalizeValue(getCellValue(row, headers["student name"]));
    const studentId = normalizeValue(getCellValue(row, headers["student id"]));
    const section = normalizeValue(getCellValue(row, headers.section));

    if (!studentName && !studentId && !section) {
      return;
    }

    if (!studentName || !studentId || !section) {
      validationErrors.push(`Row ${rowNumber}: student name, ID, and section are required.`);
      return;
    }

    const itemResults = itemColumns.map((column, index) => {
      const rawValue = normalizeValue(getCellValue(row, column)).toUpperCase();

      if (!isValidItemValue(rawValue)) {
        validationErrors.push(
          `Row ${rowNumber}, Item ${index + 1}: invalid value "${rawValue}".`,
        );
      }

      return {
        itemNo: index + 1,
        value: rawValue,
        isCorrect: isCorrectValue(rawValue),
      };
    });

    const computedTotal = itemResults.filter((item) => item.isCorrect).length;
    const rawTotal = totalScoreColumn
      ? normalizeValue(getCellValue(row, totalScoreColumn))
      : "";
    const totalScore = rawTotal === "" ? computedTotal : Number(rawTotal);

    if (!Number.isFinite(totalScore)) {
      validationErrors.push(`Row ${rowNumber}: Total Score must be numeric.`);
    } else if (totalScore !== computedTotal) {
      validationErrors.push(
        `Row ${rowNumber}: Total Score ${totalScore} does not match computed score ${computedTotal}.`,
      );
    }

    rows.push({
      studentName,
      studentId,
      section,
      itemResults,
      totalScore: computedTotal,
    });
  });

  if (validationErrors.length > 0) {
    throw new Error(validationErrors.slice(0, 10).join(" "));
  }

  if (rows.length === 0) {
    throw new Error("No student rows found in the uploaded file.");
  }

  return rows;
};

const buildStudentResultFromAnswers = (exam, student, answers) => {
  const answerValues = Array.isArray(answers)
    ? answers.map((answer) => normalizeValue(answer).toUpperCase())
    : [];
  const answerKeyByItem = new Map(
    (exam.answerKey || []).map((item) => [
      Number(item.itemNo),
      normalizeValue(item.answer).toUpperCase(),
    ]),
  );

  const itemResults = Array.from(
    { length: exam.numberOfItems },
    (_, index) => {
      const itemNo = index + 1;
      const value = answerValues[index] || "";
      const correctAnswer = answerKeyByItem.get(itemNo) || "";

      return {
        itemNo,
        value,
        isCorrect: Boolean(value && correctAnswer && value === correctAnswer),
      };
    },
  );

  return {
    analysisExamId: exam._id,
    studentName: student.studentName,
    studentId: student.studentId,
    section: student.section || exam.section,
    itemResults,
    totalScore: itemResults.filter((item) => item.isCorrect).length,
  };
};

const computeAnalysis = (exam, results) => {
  const totalStudents = results.length;
  const scores = results.map((result) => result.totalScore);
  const averageScore =
    totalStudents > 0
      ? scores.reduce((sum, score) => sum + score, 0) / totalStudents
      : 0;
  const highestScore = scores.length > 0 ? Math.max(...scores) : 0;
  const lowestScore = scores.length > 0 ? Math.min(...scores) : 0;
  const sortedResults = [...results].sort((a, b) => b.totalScore - a.totalScore);
  const groupSize = Math.max(1, Math.ceil(totalStudents * 0.27));
  const upperGroup = sortedResults.slice(0, groupSize);
  const lowerGroup = sortedResults.slice(-groupSize);

  const items = Array.from({ length: exam.numberOfItems }, (_, index) => {
    const itemNo = index + 1;
    const correctCount = results.filter(
      (result) => result.itemResults[index]?.isCorrect,
    ).length;
    const incorrectCount = totalStudents - correctCount;
    const difficultyIndex = totalStudents > 0 ? correctCount / totalStudents : 0;
    const upperCorrectRate =
      upperGroup.length > 0
        ? upperGroup.filter((result) => result.itemResults[index]?.isCorrect)
            .length / upperGroup.length
        : 0;
    const lowerCorrectRate =
      lowerGroup.length > 0
        ? lowerGroup.filter((result) => result.itemResults[index]?.isCorrect)
            .length / lowerGroup.length
        : 0;
    const discriminationIndex = upperCorrectRate - lowerCorrectRate;
    const recommendation = recommendationFor(
      difficultyIndex,
      discriminationIndex,
    );

    return {
      itemNo,
      correctCount,
      incorrectCount,
      difficultyIndex: roundMetric(difficultyIndex),
      difficultyInterpretation: difficultyInterpretation(difficultyIndex),
      discriminationIndex: roundMetric(discriminationIndex),
      discriminationInterpretation:
        discriminationInterpretation(discriminationIndex),
      recommendation,
      action: actionForRecommendation(recommendation),
    };
  });
  const recommendationSummary = items.reduce((summary, item) => {
    summary[item.recommendation] = (summary[item.recommendation] || 0) + 1;
    return summary;
  }, {});

  return {
    exam,
    summary: {
      totalStudents,
      numberOfItems: exam.numberOfItems,
      averageScore: roundMetric(averageScore),
      highestScore,
      lowestScore,
      itemsForRevision: items.filter((item) => item.recommendation === "Revise")
        .length,
      weakItems: items.filter(
        (item) =>
          item.difficultyInterpretation === "Difficult" ||
          item.difficultyInterpretation === "Very Difficult" ||
          item.discriminationInterpretation === "Poor",
      ).length,
      recommendationSummary,
      priorityItems: items
        .filter((item) =>
          ["Check Answer Key", "Revise", "Review"].includes(item.recommendation),
        )
        .slice(0, 8),
    },
    items,
  };
};

const getExamWithResults = async (analysisExamId, user) => {
  const query = { _id: analysisExamId };

  if (!["admin", "super_admin"].includes(user.role)) {
    query.uploadedBy = user._id;
  }

  const exam = await ItemAnalysisExam.findOne(query).populate(
    "uploadedBy",
    "name email role",
  );

  if (!exam) {
    return null;
  }

  const results = await ItemAnalysisStudentResult.find({
    analysisExamId: exam._id,
  }).sort({ totalScore: -1, studentName: 1 });

  return { exam, results };
};

exports.listItemAnalysisExams = async (req, res) => {
  try {
    const query = {};

    if (!["admin", "super_admin"].includes(req.user.role)) {
      query.uploadedBy = req.user._id;
    }

    const exams = await ItemAnalysisExam.find(query)
      .select("title subject section semester schoolYear numberOfItems answerKey uploadedAt createdAt")
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      exams,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.createItemAnalysisExam = async (req, res) => {
  try {
    const {
      title,
      subject,
      section,
      semester,
      schoolYear,
      numberOfItems,
      answerKey,
    } = req.body;
    const itemCount = Number(numberOfItems);

    if (!title || !subject || !section || !itemCount) {
      return res.status(400).json({
        success: false,
        message: "Exam title, subject, section, and number of items are required.",
      });
    }

    if (!Number.isInteger(itemCount) || itemCount < 1) {
      return res.status(400).json({
        success: false,
        message: "Number of items must be a whole number greater than 0.",
      });
    }

    const parsedAnswerKey = await parseAnswerKey(answer);

    if (parsedAnswerKey.length !== itemCount) {
      return res.status(400).json({
        success: false,
        message: `Answer key must contain exactly ${itemCount} answers.`,
      });
    }

    const exam = await ItemAnalysisExam.create({
      title,
      subject,
      section,
      semester,
      schoolYear,
      numberOfItems: itemCount,
      answerKey: parsedAnswerKey,
      uploadedBy: req.user._id,
      uploadedAt: new Date(),
    });

    res.status(201).json({
      success: true,
      message: "OMR scanning exam created.",
      exam,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

exports.downloadTemplate = async (req, res) => {
  try {
    const items = Math.max(1, Number(req.query.items || 50));
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Student Results");
    const instructionSheet = workbook.addWorksheet("Instructions");

    sheet.columns = [
      { header: "Student Name", key: "studentName", width: 24 },
      { header: "Student ID", key: "studentId", width: 18 },
      { header: "Section", key: "section", width: 16 },
      ...Array.from({ length: items }, (_, index) => ({
        header: `Item ${index + 1}`,
        key: `item${index + 1}`,
        width: 10,
      })),
      { header: "Total Score", key: "totalScore", width: 14 },
    ];

    sheet.getRow(1).font = { bold: true };
    instructionSheet.addRows([
      ["Item Analysis Upload Instructions"],
      ["Enter 1 for correct"],
      ["Enter 0 for wrong"],
      ["C and W are also accepted"],
      ["Leave Total Score blank if you want the system to compute it"],
    ]);
    instructionSheet.getColumn(1).width = 72;
    instructionSheet.getRow(1).font = { bold: true };

    const buffer = await workbook.xlsx.writeBuffer();

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="item-analysis-template-${items}-items.xlsx"`,
    );
    res.send(Buffer.from(buffer));
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.createItemAnalysisFromGeneratedExam = async (req, res) => {
  try {
    const generatedExamQuery = { _id: req.params.examId };

    if (!["admin", "super_admin"].includes(req.user.role)) {
      generatedExamQuery.user = req.user._id;
    }

    const generatedExam = await Exam.findOne(generatedExamQuery).populate(
      "questions",
      "correctAnswer",
    );

    if (!generatedExam) {
      return res.status(404).json({
        success: false,
        message: "Generated exam not found.",
      });
    }

    const itemCount = Number(generatedExam.totalItems || 0);
    const questions = generatedExam.questions || [];

    if (!Number.isInteger(itemCount) || itemCount < 1) {
      return res.status(400).json({
        success: false,
        message: "Generated exam has an invalid item count.",
      });
    }

    if (questions.length !== itemCount) {
      return res.status(400).json({
        success: false,
        message:
          "Generated exam question count does not match the number of items.",
      });
    }

    const answerKey = questions.map((question, index) => ({
      itemNo: index + 1,
      answer: normalizeValue(question.correctAnswer).toUpperCase(),
    }));
    const missingAnswer = answerKey.find((item) => !item.answer);

    if (missingAnswer) {
      return res.status(400).json({
        success: false,
        message: `Generated exam is missing an answer for item ${missingAnswer.itemNo}.`,
      });
    }

    const title = normalizeValue(req.body.title) || generatedExam.title;
    const subject = normalizeValue(req.body.subject) || generatedExam.subject;
    const section = normalizeValue(req.body.section) || "No section";
    const semester = normalizeValue(req.body.semester);
    const schoolYear = normalizeValue(req.body.schoolYear);

    const exam = await ItemAnalysisExam.findOneAndUpdate(
      {
        generatedExamId: generatedExam._id,
        uploadedBy: req.user._id,
      },
      {
        title,
        subject,
        section,
        semester,
        schoolYear,
        numberOfItems: itemCount,
        answerKey,
        generatedExamId: generatedExam._id,
        uploadedBy: req.user._id,
        uploadedAt: new Date(),
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      },
    );

    res.status(201).json({
      success: true,
      message: "Generated exam linked to item analysis.",
      analysisExamId: exam._id,
      exam,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

exports.downloadOmrTemplate = async (req, res) => {
  try {
    const itemCount = Number(req.query.items || 50);

    if (!Number.isInteger(itemCount) || itemCount < 1 || itemCount > 200) {
      return res.status(400).json({
        success: false,
        message: "Number of items must be between 1 and 200.",
      });
    }

    const title = normalizeValue(req.query.title) || "OMR Answer Sheet";
    const analysisExamId = normalizeValue(req.query.examId);
    const subject = normalizeValue(req.query.subject);
    const section = normalizeValue(req.query.section);
    const studentId = normalizeValue(req.query.studentId);
    const qrPayload = {
      type: "UM_OMR_SHEET",
      analysisExamId,
      title,
      subject,
      section,
      studentId,
      numberOfItems: itemCount,
      generatedAt: new Date().toISOString(),
    };
    const buffer = await buildOmrTemplateBuffer({
      title,
      subject,
      section,
      numberOfItems: itemCount,
      qrPayload,
    });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${sanitizeFileName(`${title}-${itemCount}-items`)}"`,
    );
    res.send(buffer);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.saveScannedResult = async (req, res) => {
  try {
    const { studentName, studentId, section, answers } = req.body;
    const data = await getExamWithResults(req.params.id, req.user);

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Item analysis exam not found.",
      });
    }

    if (!studentName || !studentId) {
      return res.status(400).json({
        success: false,
        message: "Student name and student ID are required.",
      });
    }

    if (!Array.isArray(answers) || answers.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Scanned answers are required.",
      });
    }

    if (!data.exam.answerKey || data.exam.answerKey.length === 0) {
      return res.status(400).json({
        success: false,
        message: "This item analysis exam needs an answer key before scanned sheets can be scored.",
      });
    }

    const row = buildStudentResultFromAnswers(
      data.exam,
      {
        studentName: normalizeValue(studentName),
        studentId: normalizeValue(studentId),
        section: normalizeValue(section) || data.exam.section,
      },
      answers,
    );

    const result = await ItemAnalysisStudentResult.findOneAndUpdate(
      {
        analysisExamId: data.exam._id,
        studentId: row.studentId,
      },
      row,
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      },
    );

    res.status(201).json({
      success: true,
      message: "Scanned answers saved to item analysis.",
      result,
      analysisExamId: data.exam._id,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

exports.uploadItemAnalysis = async (req, res) => {
  try {
    const {
      title,
      subject,
      section,
      semester,
      schoolYear,
      numberOfItems,
      answerKey,
    } = req.body;
    const itemCount = Number(numberOfItems);
    const resultFile = req.files?.resultFile?.[0];
    const answerKeyFile = req.files?.answerKeyFile?.[0];

    if (!title || !subject || !section || !itemCount || !resultFile) {
      return res.status(400).json({
        success: false,
        message:
          "Exam title, subject, section, number of items, and result file are required.",
      });
    }

    if (!Number.isInteger(itemCount) || itemCount < 1) {
      return res.status(400).json({
        success: false,
        message: "Number of items must be a whole number greater than 0.",
      });
    }

    const [rows, parsedAnswerKey] = await Promise.all([
      parseResultRows(resultFile, itemCount),
      parseAnswerKey(answerKey, answerKeyFile),
    ]);

    const exam = await ItemAnalysisExam.create({
      title,
      subject,
      section,
      semester,
      schoolYear,
      numberOfItems: itemCount,
      answerKey: parsedAnswerKey,
      uploadedBy: req.user._id,
      uploadedAt: new Date(),
    });

    await ItemAnalysisStudentResult.insertMany(
      rows.map((row) => ({
        ...row,
        analysisExamId: exam._id,
      })),
    );

    res.status(201).json({
      success: true,
      message: "Item analysis uploaded successfully.",
      analysisExamId: exam._id,
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

exports.getItemAnalysis = async (req, res) => {
  try {
    const data = await getExamWithResults(req.params.id, req.user);

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Item analysis exam not found.",
      });
    }

    const analysis = computeAnalysis(data.exam, data.results);

    res.json({
      success: true,
      analysis,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.listItemAnalysisResults = async (req, res) => {
  try {
    const data = await getExamWithResults(req.params.id, req.user);

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Item analysis exam not found.",
      });
    }

    const results = data.results.map((result) => ({
      _id: result._id,
      studentName: result.studentName,
      studentId: result.studentId,
      section: result.section,
      totalScore: result.totalScore,
      itemResults: result.itemResults,
      createdAt: result.createdAt,
      updatedAt: result.updatedAt,
    }));

    res.json({
      success: true,
      exam: data.exam,
      results,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.exportItemAnalysis = async (req, res) => {
  try {
    const data = await getExamWithResults(req.params.id, req.user);

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Item analysis exam not found.",
      });
    }

    const analysis = computeAnalysis(data.exam, data.results);
    const workbook = new ExcelJS.Workbook();
    const summarySheet = workbook.addWorksheet("Summary");
    const itemSheet = workbook.addWorksheet("Item Analysis");
    const scoreSheet = workbook.addWorksheet("Student Scores");
    const perStudentSheet = workbook.addWorksheet("Per Student Analysis");

    summarySheet.addRows([
      ["Exam title", analysis.exam.title],
      ["Subject", analysis.exam.subject],
      ["Section", analysis.exam.section],
      ["Total students", analysis.summary.totalStudents],
      ["Number of items", analysis.summary.numberOfItems],
      ["Average score", analysis.summary.averageScore],
      ["Highest score", analysis.summary.highestScore],
      ["Lowest score", analysis.summary.lowestScore],
    ]);

    itemSheet.columns = [
      { header: "Item No.", key: "itemNo", width: 12 },
      { header: "Correct Count", key: "correctCount", width: 16 },
      { header: "Incorrect Count", key: "incorrectCount", width: 18 },
      { header: "Difficulty Index", key: "difficultyIndex", width: 18 },
      {
        header: "Difficulty Interpretation",
        key: "difficultyInterpretation",
        width: 28,
      },
      { header: "Discrimination Index", key: "discriminationIndex", width: 22 },
      {
        header: "Discrimination Interpretation",
        key: "discriminationInterpretation",
        width: 34,
      },
      { header: "Recommendation", key: "recommendation", width: 20 },
    ];
    itemSheet.addRows(analysis.items);

    scoreSheet.columns = [
      { header: "Student Name", key: "studentName", width: 24 },
      { header: "Student ID", key: "studentId", width: 18 },
      { header: "Section", key: "section", width: 16 },
      { header: "Total Score", key: "totalScore", width: 14 },
      { header: "Percentage", key: "percentage", width: 14 },
    ];
    scoreSheet.addRows(
      data.results.map((result) => ({
        studentName: result.studentName,
        studentId: result.studentId,
        section: result.section,
        totalScore: result.totalScore,
        percentage: roundMetric(
          (result.totalScore / analysis.exam.numberOfItems) * 100,
        ),
      })),
    );

    perStudentSheet.columns = [
      { header: "Student Name", key: "studentName", width: 24 },
      { header: "Student ID", key: "studentId", width: 18 },
      { header: "Section", key: "section", width: 16 },
      { header: "Total Score", key: "totalScore", width: 14 },
      { header: "Percentage", key: "percentage", width: 14 },
      ...Array.from({ length: analysis.exam.numberOfItems }, (_, index) => {
        const itemNo = index + 1;

        return [
          {
            header: `Item ${itemNo} Answer`,
            key: `item${itemNo}Answer`,
            width: 16,
          },
          {
            header: `Item ${itemNo} Result`,
            key: `item${itemNo}Result`,
            width: 16,
          },
        ];
      }).flat(),
    ];
    perStudentSheet.addRows(
      data.results.map((result) => {
        const row = {
          studentName: result.studentName,
          studentId: result.studentId,
          section: result.section,
          totalScore: result.totalScore,
          percentage: roundMetric(
            (result.totalScore / analysis.exam.numberOfItems) * 100,
          ),
        };

        Array.from({ length: analysis.exam.numberOfItems }, (_, index) => {
          const itemNo = index + 1;
          const itemResult = result.itemResults[index] || {};

          row[`item${itemNo}Answer`] = itemResult.value || "";
          row[`item${itemNo}Result`] = itemResult.isCorrect
            ? "Correct"
            : "Wrong";
        });

        return row;
      }),
    );

    [summarySheet, itemSheet, scoreSheet, perStudentSheet].forEach((sheet) => {
      sheet.getRow(1).font = { bold: true };
    });

    const buffer = await workbook.xlsx.writeBuffer();

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="item-analysis-${analysis.exam._id}.xlsx"`,
    );
    res.send(Buffer.from(buffer));
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
