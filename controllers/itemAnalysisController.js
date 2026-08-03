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
  TableLayoutType,
} = require("docx");
const ItemAnalysisExam = require("../models/ItemAnalysisExam");
const ItemAnalysisStudentResult = require("../models/ItemAnalysisStudentResult");
const CqiInterventionPlan = require("../models/CqiInterventionPlan");
const Exam = require("../models/Exam");
const Question = require("../models/Question");
const { getObeSettings } = require("../services/obeSettingsService");
const {
  normalizeAssessmentMethod,
} = require("../utils/assessmentMethods");
const { isAdmin } = require("../utils/roles");

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

const questionDifficultyFromInterpretation = (interpretation) =>
  interpretation === "Very Difficult" ? "Difficult" : interpretation;

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
const omrGridColor = "000000";
const omrItemsPerPage = 100;
const omrRowsPerBlock = 25;
const omrMaxBlocksPerPage = 4;
const cellBorders = {
  top: { style: BorderStyle.SINGLE, size: 1, color: borderColor },
  bottom: { style: BorderStyle.SINGLE, size: 1, color: borderColor },
  left: { style: BorderStyle.SINGLE, size: 1, color: borderColor },
  right: { style: BorderStyle.SINGLE, size: 1, color: borderColor },
};
const omrGridBorders = {
  top: { style: BorderStyle.SINGLE, size: 4, color: omrGridColor },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: omrGridColor },
  left: { style: BorderStyle.SINGLE, size: 4, color: omrGridColor },
  right: { style: BorderStyle.SINGLE, size: 4, color: omrGridColor },
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

const spacerParagraph = (size = 4) =>
  new Paragraph({
    spacing: { before: 0, after: size * 4 },
    children: [new TextRun({ text: "", size })],
  });

const markerCell = () =>
  new TableCell({
    borders: {
      top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    },
    margins: { top: 40, bottom: 40, left: 40, right: 40 },
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            text: "■",
            bold: true,
            size: 42,
            color: "000000",
          }),
        ],
      }),
    ],
  });

const markerBlockCell = () =>
  new TableCell({
    width: { size: 360, type: WidthType.DXA },
    borders: {
      top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    },
    shading: { fill: "000000" },
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 0 },
        children: [new TextRun({ text: "", size: 4 })],
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
    const pageSize = omrItemsPerPage;
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
            errorCorrectionLevel: "H",
            margin: 1,
            width: 220,
          })
        : "";
      const qrImage = qrDataUrl
        ? Buffer.from(qrDataUrl.split(",")[1], "base64")
        : null;
      const blockCount = Math.min(
        omrMaxBlocksPerPage,
        Math.max(1, Math.ceil(pageItemCount / omrRowsPerBlock)),
      );
      const answerTableDxa = 8200;
      const blockDxa = Math.floor(answerTableDxa / blockCount);
      const itemNumberDxa = Math.floor(blockDxa * 0.16);
      const answerDxa = Math.floor((blockDxa - itemNumberDxa) / 4);

      const itemNumberWidth = {
        size: itemNumberDxa,
        type: WidthType.DXA,
      };

      const answerWidth = {
        size: answerDxa,
        type: WidthType.DXA,
      };
      const bubbleSize = blockCount <= 2 ? 30 : 28;
      const answerHeaderRow = new TableRow({
        tableHeader: true,
        children: Array.from({ length: blockCount }, () => [
          omrCell("No.", {
            borders: omrGridBorders,
            bold: true,
            color: maroon,
            fill: lightGold,
            margin: 14,
            size: 14,
            width: itemNumberWidth,
          }),
          ...["A", "B", "C", "D"].map((choice) =>
            omrCell(choice, {
              borders: omrGridBorders,
              bold: true,
              color: maroon,
              fill: lightGold,
              margin: 14,
              size: 14,
              width: answerWidth,
            }),
          ),
        ]).flat(),
      });
      const rows = Array.from({ length: omrRowsPerBlock }, (_, rowIndex) => {
        const fill = rowIndex % 2 === 0 ? "FFFFFF" : "FCF7F7";

        return new TableRow({
          children: Array.from({ length: blockCount }, (_, blockIndex) => {
            const itemIndex = blockIndex * omrRowsPerBlock + rowIndex;
            const itemNo = startItem + itemIndex;
            const hasItem = itemIndex < pageItemCount && itemNo <= endItem;

            return [
              omrCell(hasItem ? String(itemNo) : "", {
                borders: omrGridBorders,
                bold: true,
                fill,
                margin: 14,
                size: 18,
                width: itemNumberWidth,
              }),
              omrCell(hasItem ? "○" : "", {
                borders: omrGridBorders,
                fill,
                margin: 10,
                size: bubbleSize,
                width: answerWidth,
              }),
              omrCell(hasItem ? "○" : "", {
                borders: omrGridBorders,
                fill,
                margin: 10,
                size: bubbleSize,
                width: answerWidth,
              }),
              omrCell(hasItem ? "○" : "", {
                borders: omrGridBorders,
                fill,
                margin: 10,
                size: bubbleSize,
                width: answerWidth,
              }),
              omrCell(hasItem ? "○" : "", {
                borders: omrGridBorders,
                fill,
                margin: 10,
                size: bubbleSize,
                width: answerWidth,
              }),
            ];
          }).flat(),
        });
      });
      const answerTable = new Table({
        width: {
          size: answerTableDxa,
          type: WidthType.DXA,
        },
        alignment: AlignmentType.CENTER,
        layout: TableLayoutType.FIXED,
        rows: [answerHeaderRow, ...rows],
      });
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
                        text: "Question Bank System",
                        bold: true,
                        color: maroon,
                        size: 18,
                      }),
                    ],
                  }),
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: "OMR Answer Sheet",
                        bold: true,
                        color: "1F1418",
                        size: 24,
                      }),
                    ],
                  }),
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: `Question Bank System | OMR Sheet | Page ${pageNo} of ${pageCount} | Items ${startItem}-${endItem}`,
                        color: "5A3B40",
                        italics: true,
                        size: 16,
                      }),
                    ],
                  }),
                ],
                {
                  fill: lightGold,
                  margin: 35,
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
                            size: 14,
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
                            size: 12,
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
                              width: 58,
                              height: 58,
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
                  margin: 30,
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
                margin: 28,
                width: { size: 34, type: WidthType.PERCENTAGE },
              }),
              textCell([infoLine("Section", section)], {
                margin: 28,
                width: { size: 33, type: WidthType.PERCENTAGE },
              }),
              textCell(
                [infoLine("Items", `${startItem}-${endItem} of ${itemCount}`)],
                {
                  margin: 28,
                  width: { size: 33, type: WidthType.PERCENTAGE },
                },
              ),
            ],
          }),
          new TableRow({
            children: [
              textCell([infoLine("Student Name")], {
                margin: 28,
                width: { size: 42, type: WidthType.PERCENTAGE },
              }),
              textCell([infoLine("Student ID")], {
                margin: 28,
                width: { size: 34, type: WidthType.PERCENTAGE },
              }),
              textCell([infoLine("Date")], {
                margin: 28,
                width: { size: 24, type: WidthType.PERCENTAGE },
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
                        size: 16,
                      }),
                      new TextRun({
                        text: `Scan the page QR before capture. Keep the answer table and its grid lines inside the camera frame. Shade one circle per item.`,
                        size: 16,
                      }),
                    ],
                  }),
                ],
                { fill: lightGold, margin: 24 },
              ),
            ],
          }),
        ],
      });

      const markerTable = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: [
              markerBlockCell(),
              textCell(
                [
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [
                      new TextRun({
                        text: "",
                        bold: true,
                        size: 14,
                        color: "666666",
                      }),
                    ],
                  }),
                ],
                {
                  borders: {
                    top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
                    bottom: {
                      style: BorderStyle.NONE,
                      size: 0,
                      color: "FFFFFF",
                    },
                    left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
                    right: {
                      style: BorderStyle.NONE,
                      size: 0,
                      color: "FFFFFF",
                    },
                  },
                  width: { size: 80, type: WidthType.PERCENTAGE },
                },
              ),
              markerBlockCell(),
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
          ? [spacerParagraph(), infoTable, spacerParagraph(), instructionTable]
          : []),
        spacerParagraph(10),
        markerTable,
        spacerParagraph(4),
        answerTable,
        spacerParagraph(4),
        markerTable,
      ];
    }),
  );

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 360,
              right: 360,
              bottom: 360,
              left: 360,
            },
          },
        },
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

    const studentName = normalizeValue(
      getCellValue(row, headers["student name"]),
    );
    const studentId = normalizeValue(getCellValue(row, headers["student id"]));
    const section = normalizeValue(getCellValue(row, headers.section));

    if (!studentName && !studentId && !section) {
      return;
    }

    if (!studentName || !studentId || !section) {
      validationErrors.push(
        `Row ${rowNumber}: student name, ID, and section are required.`,
      );
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

  const itemResults = Array.from({ length: exam.numberOfItems }, (_, index) => {
    const itemNo = index + 1;
    const value = answerValues[index] || "";
    const correctAnswer = answerKeyByItem.get(itemNo) || "";

    return {
      itemNo,
      value,
      isCorrect: Boolean(value && correctAnswer && value === correctAnswer),
    };
  });

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
  const sortedResults = [...results].sort(
    (a, b) => b.totalScore - a.totalScore,
  );
  const groupSize = Math.max(1, Math.ceil(totalStudents * 0.27));
  const upperGroup = sortedResults.slice(0, groupSize);
  const lowerGroup = sortedResults.slice(-groupSize);

  const items = Array.from({ length: exam.numberOfItems }, (_, index) => {
    const itemNo = index + 1;
    const correctCount = results.filter(
      (result) => result.itemResults[index]?.isCorrect,
    ).length;
    const incorrectCount = totalStudents - correctCount;
    const difficultyIndex =
      totalStudents > 0 ? correctCount / totalStudents : 0;
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
    const difficultyLabel = difficultyInterpretation(difficultyIndex);
    const recommendation = recommendationFor(
      difficultyIndex,
      discriminationIndex,
    );

    return {
      itemNo,
      correctCount,
      incorrectCount,
      difficultyIndex: roundMetric(difficultyIndex),
      difficultyInterpretation: difficultyLabel,
      questionDifficulty: questionDifficultyFromInterpretation(difficultyLabel),
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
          ["Check Answer Key", "Revise", "Review"].includes(
            item.recommendation,
          ),
        )
        .slice(0, 8),
    },
    items,
  };
};

const createObeBucket = (code, targetRate) => ({
  code,
  targetRate,
  itemCount: 0,
  responseCount: 0,
  correctCount: 0,
  totalWeight: 0,
  earnedWeight: 0,
  attainmentRate: 0,
  status: "Not assessed",
});

const finalizeObeBucket = (bucket) => {
  const totalWeight = Number(bucket.totalWeight || 0);
  const earnedWeight = Number(bucket.earnedWeight || 0);
  const attainmentRate =
    totalWeight > 0 ? Math.round((earnedWeight / totalWeight) * 100) : 0;

  return {
    ...bucket,
    totalWeight: Math.round(totalWeight * 100) / 100,
    earnedWeight: Math.round(earnedWeight * 100) / 100,
    attainmentRate,
    status:
      totalWeight <= 0
        ? "Not assessed"
        : attainmentRate >= Number(bucket.targetRate ?? 75)
          ? "Attained"
          : "Not attained",
  };
};

const ensureObeBucket = (map, code, targetRate) => {
  if (!map.has(code)) {
    map.set(code, createObeBucket(code, targetRate));
  }

  return map.get(code);
};

const addOutcomeResponse = (map, code, itemResult, weight, targetRate) => {
  const bucket = ensureObeBucket(map, code, targetRate);

  bucket.responseCount += 1;
  bucket.totalWeight += weight;

  if (itemResult?.isCorrect) {
    bucket.correctCount += 1;
    bucket.earnedWeight += weight;
  }
};

const formatCqiPlan = (plan) =>
  plan
    ? {
        _id: plan._id,
        outcomeType: plan.outcomeType,
        outcomeCode: plan.outcomeCode,
        rootCause: plan.rootCause || "",
        intervention: plan.intervention || "",
        responsiblePerson: plan.responsiblePerson || "",
        targetDate: plan.targetDate,
        evidence: plan.evidence || "",
        remarks: plan.remarks || "",
        implementationDate: plan.implementationDate,
        reassessmentResult: plan.reassessmentResult || "",
        verificationRemarks: plan.verificationRemarks || "",
        followUpDecision: plan.followUpDecision || "",
        verifiedBy: plan.verifiedBy,
        verifiedAt: plan.verifiedAt,
        status: plan.status || "Planned",
        createdAt: plan.createdAt,
        updatedAt: plan.updatedAt,
      }
    : null;

const attachCqiPlans = (rows, plans, outcomeType) => {
  const plansByCode = new Map(
    plans
      .filter((plan) => plan.outcomeType === outcomeType)
      .map((plan) => [plan.outcomeCode, formatCqiPlan(plan)]),
  );

  return rows.map((row) => ({
    ...row,
    cqiPlan: plansByCode.get(row.code) || null,
  }));
};

const buildObeAttainment = async (exam, results) => {
  const settings = await getObeSettings();

  if (!exam?.generatedExamId) {
    return {
      available: false,
      settings,
      message:
        "CO/SO attainment is available only when item analysis is linked to a generated exam.",
      courseOutcomes: [],
      studentOutcomes: [],
      bloomLevels: [],
    };
  }

  const generatedExam = await Exam.findById(exam.generatedExamId).populate({
    path: "questions",
    select:
      "courseOutcome programOutcome bloomLevel outcomeWeight questionText",
  });

  if (!generatedExam || !Array.isArray(generatedExam.questions)) {
    return {
      available: false,
      settings,
      message: "Linked generated exam was not found.",
      courseOutcomes: [],
      studentOutcomes: [],
      bloomLevels: [],
    };
  }

  const courseOutcomes = new Map();
  const studentOutcomes = new Map();
  const bloomLevels = new Map();
  (generatedExam.questions || []).forEach((question, index) => {
    const itemNo = index + 1;
    const weight = Math.max(0, Number(question.outcomeWeight || 1));
    const courseOutcome = question.courseOutcome || "Unmapped CLO";
    const studentOutcome = question.programOutcome || "Unmapped SO";
    const bloomLevel = question.bloomLevel || "Unmapped Bloom";

    ensureObeBucket(
      courseOutcomes,
      courseOutcome,
      settings.courseOutcomeTarget,
    ).itemCount += 1;
    ensureObeBucket(
      studentOutcomes,
      studentOutcome,
      settings.studentOutcomeTarget,
    ).itemCount += 1;
    ensureObeBucket(
      bloomLevels,
      bloomLevel,
      settings.courseOutcomeTarget,
    ).itemCount += 1;

    results.forEach((result) => {
      const itemResult =
        (result.itemResults || []).find((item) => Number(item.itemNo) === itemNo) ||
        result.itemResults?.[index];

      addOutcomeResponse(
        courseOutcomes,
        courseOutcome,
        itemResult,
        weight,
        settings.courseOutcomeTarget,
      );
      addOutcomeResponse(
        studentOutcomes,
        studentOutcome,
        itemResult,
        weight,
        settings.studentOutcomeTarget,
      );
      addOutcomeResponse(
        bloomLevels,
        bloomLevel,
        itemResult,
        weight,
        settings.courseOutcomeTarget,
      );
    });
  });

  const cqiPlans = await CqiInterventionPlan.find({
    analysisExamId: exam._id,
  }).lean();

  return {
    available: true,
    settings,
    message: "",
    courseOutcomes: attachCqiPlans(
      Array.from(courseOutcomes.values()).map(finalizeObeBucket),
      cqiPlans,
      "CO",
    ),
    studentOutcomes: attachCqiPlans(
      Array.from(studentOutcomes.values()).map(finalizeObeBucket),
      cqiPlans,
      "SO",
    ),
    bloomLevels: Array.from(bloomLevels.values()).map(finalizeObeBucket),
  };
};

const getExamWithResults = async (analysisExamId, user) => {
  const query = { _id: analysisExamId };

  if (!isAdmin(user)) {
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

const updateGeneratedExamQuestionDifficulties = async (exam, analysis) => {
  if (
    !exam?.generatedExamId ||
    !Array.isArray(analysis?.items) ||
    Number(analysis.summary?.totalStudents || 0) < 1
  ) {
    return { matchedCount: 0, modifiedCount: 0 };
  }

  const generatedExam = await Exam.findById(exam.generatedExamId)
    .select("questions")
    .lean();

  if (!generatedExam?.questions?.length) {
    return { matchedCount: 0, modifiedCount: 0 };
  }

  let matchedCount = 0;
  let modifiedCount = 0;

  for (const item of analysis.items) {
    const questionId = generatedExam.questions[item.itemNo - 1];
    const newDifficulty = questionDifficultyFromInterpretation(
      item.difficultyInterpretation,
    );

    if (
      !questionId ||
      !["Easy", "Average", "Difficult"].includes(newDifficulty)
    ) {
      continue;
    }

    const question = await Question.findById(questionId);

    if (!question) continue;

    matchedCount++;

    if (question.difficulty === newDifficulty) continue;

    const oldDifficulty = question.difficulty;

    question.versionHistory.push({
      editedBy: exam.uploadedBy,
      editedAt: new Date(),
      before: {
        difficulty: oldDifficulty,
      },
      after: {
        difficulty: newDifficulty,
      },
      changedFields: ["difficulty"],
    });

    question.difficulty = newDifficulty;

    await question.save();
    modifiedCount++;
  }

  return { matchedCount, modifiedCount };
};

exports.listItemAnalysisExams = async (req, res) => {
  try {
    const query = {};

    if (!isAdmin(req.user)) {
      query.uploadedBy = req.user._id;
    }

    const exams = await ItemAnalysisExam.find(query)
      .select(
        "title subject section semester schoolYear assessmentMethod numberOfItems answerKey uploadedAt createdAt",
      )
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
      assessmentMethod,
      numberOfItems,
      answerKey,
      generatedExamId,
      includeInObe,
    } = req.body;
    const itemCount = Number(numberOfItems);

    if (!title || !subject || !section || !itemCount) {
      return res.status(400).json({
        success: false,
        message:
          "Exam title, subject, section, and number of items are required.",
      });
    }

    if (!Number.isInteger(itemCount) || itemCount < 1) {
      return res.status(400).json({
        success: false,
        message: "Number of items must be a whole number greater than 0.",
      });
    }

    const parsedAnswerKey = await parseAnswerKey(answerKey);

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
      assessmentMethod: normalizeAssessmentMethod(assessmentMethod),
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

    if (!isAdmin(req.user)) {
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
    const section =
      normalizeValue(req.body.section) ||
      normalizeValue(generatedExam.section) ||
      "No section";
    const semester =
      normalizeValue(req.body.semester) ||
      normalizeValue(generatedExam.semester);
    const schoolYear =
      normalizeValue(req.body.schoolYear) ||
      normalizeValue(generatedExam.schoolYear);
    const assessmentMethod = normalizeAssessmentMethod(
      req.body.assessmentMethod || generatedExam.assessmentMethod,
    );

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
        assessmentMethod,
        numberOfItems: itemCount,
      answerKey,
      generatedExamId: generatedExam._id,
      includeInObe: true,
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
    const { studentName, studentId, section, answers, scanMetadata } = req.body;
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
        message:
          "This item analysis exam needs an answer key before scanned sheets can be scored.",
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
    row.scanMetadata =
      scanMetadata && typeof scanMetadata === "object"
        ? {
            processedWith: normalizeValue(scanMetadata.processedWith),
            scannedPages: scanMetadata.scannedPages || {},
            savedAt: new Date(),
          }
        : undefined;

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
    const results = await ItemAnalysisStudentResult.find({
      analysisExamId: data.exam._id,
    }).sort({ totalScore: -1, studentName: 1 });
    const analysis = computeAnalysis(data.exam, results);
    const difficultySync = await updateGeneratedExamQuestionDifficulties(
      data.exam,
      analysis,
    );

    res.status(201).json({
      success: true,
      message: "Scanned answers saved to item analysis.",
      result,
      analysisExamId: data.exam._id,
      difficultySync,
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
      assessmentMethod,
      numberOfItems,
      answerKey,
      generatedExamId,
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
    const linkedGeneratedExamId = normalizeValue(generatedExamId);
    const requiresObeLink =
      includeInObe === true ||
      String(includeInObe || "").trim().toLowerCase() === "true";
    let linkedGeneratedExam = null;
    let finalAnswerKey = parsedAnswerKey;

    if (requiresObeLink && !linkedGeneratedExamId) {
      return res.status(400).json({
        success: false,
        message:
          "OBE item analysis must be linked to a generated exam so the system can map items to CO/SO outcomes.",
      });
    }

    if (linkedGeneratedExamId) {
      const generatedExamQuery = { _id: linkedGeneratedExamId };

      if (!isAdmin(req.user)) {
        generatedExamQuery.user = req.user._id;
      }

      linkedGeneratedExam = await Exam.findOne(generatedExamQuery).populate(
        "questions",
        "correctAnswer",
      );

      if (!linkedGeneratedExam) {
        return res.status(404).json({
          success: false,
          message: "Linked generated exam not found.",
        });
      }

      if (Number(linkedGeneratedExam.totalItems || 0) !== itemCount) {
        return res.status(400).json({
          success: false,
          message:
            "Uploaded item count does not match the linked generated exam.",
        });
      }

      if (finalAnswerKey.length === 0) {
        finalAnswerKey = (linkedGeneratedExam.questions || []).map(
          (question, index) => ({
            itemNo: index + 1,
            answer: normalizeValue(question.correctAnswer).toUpperCase(),
          }),
        );
      }
    }

    const exam = linkedGeneratedExam
      ? await ItemAnalysisExam.findOneAndUpdate(
          {
            generatedExamId: linkedGeneratedExam._id,
            uploadedBy: req.user._id,
          },
          {
            title: title || linkedGeneratedExam.title,
            subject: subject || linkedGeneratedExam.subject,
            section:
              section ||
              normalizeValue(linkedGeneratedExam.section) ||
              "No section",
            semester:
              semester || normalizeValue(linkedGeneratedExam.semester),
            schoolYear:
              schoolYear || normalizeValue(linkedGeneratedExam.schoolYear),
            assessmentMethod: normalizeAssessmentMethod(
              assessmentMethod || linkedGeneratedExam.assessmentMethod,
            ),
            numberOfItems: itemCount,
            answerKey: finalAnswerKey,
            generatedExamId: linkedGeneratedExam._id,
            includeInObe: true,
            uploadedBy: req.user._id,
            uploadedAt: new Date(),
          },
          {
            new: true,
            upsert: true,
            runValidators: true,
            setDefaultsOnInsert: true,
          },
        )
      : await ItemAnalysisExam.create({
          title,
          subject,
          section,
          semester,
          schoolYear,
          assessmentMethod: normalizeAssessmentMethod(assessmentMethod),
          numberOfItems: itemCount,
          answerKey: finalAnswerKey,
          includeInObe: false,
          uploadedBy: req.user._id,
          uploadedAt: new Date(),
        });

    if (linkedGeneratedExam) {
      await ItemAnalysisStudentResult.deleteMany({
        analysisExamId: exam._id,
      });
    }

    await ItemAnalysisStudentResult.insertMany(
      rows.map((row) => ({
        ...row,
        analysisExamId: exam._id,
      })),
    );
    const results = await ItemAnalysisStudentResult.find({
      analysisExamId: exam._id,
    }).sort({ totalScore: -1, studentName: 1 });
    const analysis = computeAnalysis(exam, results);
    const difficultySync = await updateGeneratedExamQuestionDifficulties(
      exam,
      analysis,
    );

    res.status(201).json({
      success: true,
      message:
        difficultySync.modifiedCount > 0
          ? `Item analysis uploaded successfully. ${difficultySync.modifiedCount} question difficult${difficultySync.modifiedCount === 1 ? "y" : "ies"} updated.`
          : "Item analysis uploaded successfully.",
      analysisExamId: exam._id,
      difficultySync,
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
    analysis.obeAttainment = await buildObeAttainment(data.exam, data.results);
    const difficultySync = await updateGeneratedExamQuestionDifficulties(
      data.exam,
      analysis,
    );

    res.json({
      success: true,
      analysis,
      difficultySync,
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

exports.upsertCqiInterventionPlan = async (req, res) => {
  try {
    const data = await getExamWithResults(req.params.id, req.user);

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Item analysis exam not found.",
      });
    }

    const outcomeType = String(req.body.outcomeType || "").trim().toUpperCase();
    const outcomeCode = String(req.body.outcomeCode || "").trim();
    const intervention = String(req.body.intervention || "").trim();
    const responsiblePerson = String(req.body.responsiblePerson || "").trim();

    if (!["CO", "SO"].includes(outcomeType)) {
      return res.status(400).json({
        success: false,
        message: "CQI plan outcome type must be CO or SO.",
      });
    }

    if (!outcomeCode || !intervention || !responsiblePerson) {
      return res.status(400).json({
        success: false,
        message: "Outcome, intervention, and responsible person are required.",
      });
    }

    const allowedStatuses = ["Planned", "In Progress", "Completed", "Verified"];
    const status = allowedStatuses.includes(req.body.status)
      ? req.body.status
      : "Planned";
    const targetDate = req.body.targetDate
      ? new Date(req.body.targetDate)
      : undefined;
    const implementationDate = req.body.implementationDate
      ? new Date(req.body.implementationDate)
      : undefined;
    const followUpDecision = [
      "",
      "Closed",
      "Needs Further Action",
      "Reassess Next Cycle",
    ].includes(req.body.followUpDecision)
      ? req.body.followUpDecision
      : "";
    const reassessmentResult = String(req.body.reassessmentResult || "").trim();
    const verificationRemarks = String(
      req.body.verificationRemarks || "",
    ).trim();

    if (targetDate && Number.isNaN(targetDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: "Target date is invalid.",
      });
    }

    if (implementationDate && Number.isNaN(implementationDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: "Implementation date is invalid.",
      });
    }

    if (
      status === "Verified" &&
      (!implementationDate ||
        !reassessmentResult ||
        !verificationRemarks ||
        !followUpDecision)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Implementation date, reassessment result, verification remarks, and follow-up decision are required before closing the CQI loop.",
      });
    }

    const verificationUpdate =
      status === "Verified"
        ? {
            verifiedBy: req.user._id,
            verifiedAt: new Date(),
          }
        : {
            verifiedBy: null,
            verifiedAt: null,
          };

    const plan = await CqiInterventionPlan.findOneAndUpdate(
      {
        analysisExamId: data.exam._id,
        outcomeType,
        outcomeCode,
      },
      {
        $set: {
          analysisExamId: data.exam._id,
          outcomeType,
          outcomeCode,
          rootCause: String(req.body.rootCause || "").trim(),
          intervention,
          responsiblePerson,
          targetDate: targetDate || null,
          evidence: String(req.body.evidence || "").trim(),
          remarks: String(req.body.remarks || "").trim(),
          implementationDate: implementationDate || null,
          reassessmentResult,
          verificationRemarks,
          followUpDecision,
          status,
          updatedBy: req.user._id,
          ...verificationUpdate,
        },
        $setOnInsert: { createdBy: req.user._id },
      },
      { new: true, upsert: true, runValidators: true },
    ).lean();

    res.json({
      success: true,
      message: "CQI intervention plan saved.",
      plan: formatCqiPlan(plan),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

exports.updateCqiPlanStatus = async (req, res) => {
  try {
    const data = await getExamWithResults(req.params.id, req.user);

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Item analysis exam not found.",
      });
    }

    const outcomeType = String(req.body.outcomeType || "").trim().toUpperCase();
    const outcomeCode = String(req.body.outcomeCode || "").trim();
    const allowedStatuses = ["Planned", "In Progress", "Completed"];
    const status = String(req.body.status || "").trim();

    if (!["CO", "SO"].includes(outcomeType) || !outcomeCode) {
      return res.status(400).json({
        success: false,
        message: "Outcome type and outcome code are required.",
      });
    }

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Quick status can only set Planned, In Progress, or Completed.",
      });
    }

    const plan = await CqiInterventionPlan.findOneAndUpdate(
      {
        analysisExamId: data.exam._id,
        outcomeType,
        outcomeCode,
      },
      {
        $set: {
          status,
          updatedBy: req.user._id,
          verifiedBy: null,
          verifiedAt: null,
        },
      },
      { new: true, runValidators: true },
    ).lean();

    if (!plan) {
      return res.status(404).json({
        success: false,
        message: "Create the CQI plan before using quick status.",
      });
    }

    res.json({
      success: true,
      message: `CQI status updated to ${status}.`,
      plan: formatCqiPlan(plan),
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
    analysis.obeAttainment = await buildObeAttainment(data.exam, data.results);
    await updateGeneratedExamQuestionDifficulties(data.exam, analysis);
    const workbook = new ExcelJS.Workbook();
    const summarySheet = workbook.addWorksheet("Summary");
    const itemSheet = workbook.addWorksheet("Item Analysis");
    const scoreSheet = workbook.addWorksheet("Student Scores");
    const perStudentSheet = workbook.addWorksheet("Per Student Analysis");
    const coSheet = workbook.addWorksheet("CO Attainment");
    const soSheet = workbook.addWorksheet("SO Attainment");
    const bloomSheet = workbook.addWorksheet("Bloom Attainment");

    summarySheet.addRows([
      ["Exam title", analysis.exam.title],
      ["Subject", analysis.exam.subject],
      ["Assessment Method", analysis.exam.assessmentMethod || "Major Exam"],
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
      {
        header: "Question Difficulty",
        key: "questionDifficulty",
        width: 22,
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

    const attainmentColumns = [
      { header: "Outcome", key: "code", width: 18 },
      { header: "Items", key: "itemCount", width: 12 },
      { header: "Responses", key: "responseCount", width: 14 },
      { header: "Correct", key: "correctCount", width: 12 },
      { header: "Earned Weight", key: "earnedWeight", width: 16 },
      { header: "Total Weight", key: "totalWeight", width: 16 },
      { header: "Target %", key: "targetRate", width: 12 },
      { header: "Attainment %", key: "attainmentRate", width: 16 },
      { header: "Status", key: "status", width: 16 },
      { header: "CQI Status", key: "cqiStatus", width: 16 },
      { header: "Root Cause", key: "cqiRootCause", width: 28 },
      { header: "Intervention", key: "cqiIntervention", width: 36 },
      { header: "Responsible Person", key: "cqiResponsiblePerson", width: 22 },
      { header: "Target Date", key: "cqiTargetDate", width: 16 },
      { header: "Evidence", key: "cqiEvidence", width: 26 },
      { header: "Remarks", key: "cqiRemarks", width: 30 },
      { header: "Implementation Date", key: "cqiImplementationDate", width: 20 },
      { header: "Reassessment Result", key: "cqiReassessmentResult", width: 36 },
      { header: "Verification Remarks", key: "cqiVerificationRemarks", width: 36 },
      { header: "Follow-up Decision", key: "cqiFollowUpDecision", width: 22 },
      { header: "Verified Date", key: "cqiVerifiedAt", width: 18 },
    ];
    [
      [coSheet, analysis.obeAttainment.courseOutcomes],
      [soSheet, analysis.obeAttainment.studentOutcomes],
      [bloomSheet, analysis.obeAttainment.bloomLevels],
    ].forEach(([sheet, rows]) => {
      sheet.columns = attainmentColumns;
      sheet.addRows(
        (rows || []).map((row) => ({
          ...row,
          cqiStatus: row.cqiPlan?.status || "",
          cqiRootCause: row.cqiPlan?.rootCause || "",
          cqiIntervention: row.cqiPlan?.intervention || "",
          cqiResponsiblePerson: row.cqiPlan?.responsiblePerson || "",
          cqiTargetDate: row.cqiPlan?.targetDate
            ? new Date(row.cqiPlan.targetDate).toLocaleDateString()
            : "",
          cqiEvidence: row.cqiPlan?.evidence || "",
          cqiRemarks: row.cqiPlan?.remarks || "",
          cqiImplementationDate: row.cqiPlan?.implementationDate
            ? new Date(row.cqiPlan.implementationDate).toLocaleDateString()
            : "",
          cqiReassessmentResult: row.cqiPlan?.reassessmentResult || "",
          cqiVerificationRemarks: row.cqiPlan?.verificationRemarks || "",
          cqiFollowUpDecision: row.cqiPlan?.followUpDecision || "",
          cqiVerifiedAt: row.cqiPlan?.verifiedAt
            ? new Date(row.cqiPlan.verifiedAt).toLocaleDateString()
            : "",
        })),
      );
      if (!analysis.obeAttainment.available) {
        sheet.addRow({ code: analysis.obeAttainment.message });
      }
    });

    [
      summarySheet,
      itemSheet,
      scoreSheet,
      perStudentSheet,
      coSheet,
      soSheet,
      bloomSheet,
    ].forEach((sheet) => {
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
