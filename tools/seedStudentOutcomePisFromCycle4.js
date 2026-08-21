require("dotenv").config();

const ExcelJS = require("exceljs");
const mongoose = require("mongoose");
const StudentOutcome = require("../models/StudentOutcome");

const DEFAULT_FILE =
  "C:\\Users\\Administrator\\Downloads\\Cycle 4 Assessment Plan.xlsx";
const DEFAULT_DEPARTMENT = "Electronics Engineering";

const args = process.argv.slice(2);

const getArg = (name, fallback) => {
  const prefix = `--${name}=`;
  const match = args.find((arg) => arg.startsWith(prefix));

  return match ? match.slice(prefix.length).trim() : fallback;
};

const filePath = getArg("file", DEFAULT_FILE);
const department = getArg("department", DEFAULT_DEPARTMENT);
const dryRun = args.includes("--dry-run");

const cleanText = (value = "") =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim();

const parsePerformanceIndicators = (value = "") =>
  String(value || "")
    .split(/\r?\n|;/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const match = line.match(/^(\d+)[.)]?\s*(.+)$/);

      return {
        piNumber: match ? Number(match[1]) : index + 1,
        description: match ? match[2].trim() : line,
        weight: 1,
      };
    });

const getCellText = (row, index) => {
  const value = row.getCell(index).value;

  if (value && typeof value === "object" && "text" in value) {
    return cleanText(value.text);
  }

  if (value && typeof value === "object" && "result" in value) {
    return cleanText(value.result);
  }

  if (value && typeof value === "object" && "richText" in value) {
    return cleanText(value.richText.map((part) => part.text || "").join(""));
  }

  return cleanText(value);
};

const sheetCode = (name = "") => {
  const match = String(name).match(/^SO\s*\(?\s*([a-m])\s*\)?\s*$/i);

  return match ? `SO ${match[1].toLowerCase()}` : "";
};

const escapeRegex = (value = "") =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const findRow = (worksheet, predicate) => {
  for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    if (predicate(row, rowNumber)) return rowNumber;
  }

  return 0;
};

const extractOutcome = (worksheet) => {
  const outcomeRow = findRow(worksheet, (row) =>
    /^Student Outcome/i.test(getCellText(row, 1)),
  );

  return outcomeRow ? getCellText(worksheet.getRow(outcomeRow), 3) : "";
};

const extractPerformanceIndicators = (worksheet) => {
  const headerRow = findRow(
    worksheet,
    (row) => getCellText(row, 1) === "PI#" && /Performance Indicator/i.test(getCellText(row, 2)),
  );

  if (!headerRow) return "";

  const lines = [];

  for (let rowNumber = headerRow + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const firstCell = getCellText(row, 1);
    const indicator = getCellText(row, 2);

    if (/^Part II\b/i.test(firstCell)) break;
    if (!firstCell && !indicator) continue;
    if (!/^\d+$/.test(firstCell) || !indicator) continue;

    lines.push(`${firstCell}. ${indicator}`);
  }

  return lines.join("\n");
};

const run = async () => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const rows = workbook.worksheets
    .map((worksheet) => ({
      code: sheetCode(worksheet.name),
      description: extractOutcome(worksheet),
      performanceIndicators: extractPerformanceIndicators(worksheet),
    }))
    .filter((row) => row.code && row.description && row.performanceIndicators);

  if (rows.length === 0) {
    throw new Error("No SO a-m performance indicators were found.");
  }

  if (dryRun) {
    rows.forEach((row) => {
      const piCount = row.performanceIndicators.split(/\n/).filter(Boolean).length;
      console.log(`${row.code}: ${piCount} PI(s)`);
    });
    console.log(`Dry run complete. ${rows.length} SO rows found.`);
    return;
  }

  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is not set.");
  }

  await mongoose.connect(process.env.MONGODB_URI);

  let updated = 0;
  let created = 0;

  for (const row of rows) {
    const codePattern = new RegExp(
      `^${escapeRegex(row.code).replace(/\s+/g, "\\s+")}$`,
      "i",
    );
    const existing =
      (await StudentOutcome.findOne({
        department,
        code: codePattern,
      })) ||
      (await StudentOutcome.findOne({
        code: codePattern,
      }).sort({ department: 1 }));

    if (existing) {
      existing.description = row.description;
      existing.performanceIndicators = row.performanceIndicators;
      existing.performanceIndicatorDetails = parsePerformanceIndicators(
        row.performanceIndicators,
      );
      await existing.save();
      updated += 1;
      console.log(`Updated ${existing.department} - ${existing.code}`);
      continue;
    }

    await StudentOutcome.create({
      department,
      code: row.code,
      description: row.description,
      performanceIndicators: row.performanceIndicators,
      performanceIndicatorDetails: parsePerformanceIndicators(
        row.performanceIndicators,
      ),
    });
    created += 1;
    console.log(`Created ${department} - ${row.code}`);
  }

  await mongoose.disconnect();

  console.log(
    `Done. ${updated} updated, ${created} created, ${rows.length} total SO rows processed.`,
  );
};

run().catch(async (error) => {
  console.error(error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
