const { Readable } = require("stream");
const ExcelJS = require("exceljs");
const ItemAnalysisExam = require("../models/ItemAnalysisExam");
const ItemAnalysisStudentResult = require("../models/ItemAnalysisStudentResult");

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
    };
  });

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

    [summarySheet, itemSheet, scoreSheet].forEach((sheet) => {
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
