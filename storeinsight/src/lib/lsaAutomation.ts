import { createRequire } from "node:module";
import path from "node:path";

const PAGE_MARKER_PATTERN = /^-- \d+ of \d+ --$/;
const DOT_VALUE_PATTERN = /\.{10,}\s*\t?([^\n]+)/g;
const MONEY_PATTERN = /-?\$[\d,]+\.\d{2}/;
export type LsaStatementCharge = {
  description: string;
  quantity: string;
  units: string;
  amount: string;
};

export type LsaStatementPayment = {
  date: string;
  description: string;
  amount: string;
};

export type LsaStatement = {
  sourceFilename: string;
  statementToLines: string[];
  accountId: string;
  paymentsAccountId: string;
  paymentsProfileId: string;
  statementIssueDate: string;
  summaryRange: string;
  startingBalance: string;
  totalNewActivity: string;
  totalPaymentsReceived: string;
  endingBalance: string;
  accountName: string;
  statementRange: string;
  charges: LsaStatementCharge[];
  payments: LsaStatementPayment[];
};

export type LsaAutomationResult = {
  sourceFilename: string;
  outputFilename: string;
  accountName: string;
  statementRange: string;
  charges: number;
  payments: number;
  totalNewActivity: string;
  totalPaymentsReceived: string;
  success: boolean;
  error?: string;
};

export type LsaAutomationExport = {
  artifactBuffer: Buffer;
  artifactName: string;
  artifactMimeType: string;
  results: LsaAutomationResult[];
};

type NamedBuffer = {
  name: string;
  buffer: Buffer;
};

type WorksheetLike = {
  columns: Array<{ width?: number }>;
  getCell: (ref: string) => CellLike;
  getRow: (row: number) => { height?: number };
};

type CellLike = {
  value?: unknown;
  font?: Record<string, unknown>;
  alignment?: Record<string, unknown>;
};

type AdmZipClass = typeof import("adm-zip") extends { default: infer T }
  ? T
  : typeof import("adm-zip");

type ExcelJSImport = typeof import("exceljs") extends { default: infer T }
  ? T
  : typeof import("exceljs");

type PdfParseCtor = new (options: { data: Buffer }) => {
  getText: () => Promise<{ text: string }>;
  destroy: () => Promise<void>;
};

function getRuntimeRequire(): (id: string) => unknown {
  const moduleBuiltin = typeof process.getBuiltinModule === "function"
    ? (process.getBuiltinModule("node:module") as { createRequire?: typeof createRequire } | undefined)
    : undefined;
  const candidate = moduleBuiltin?.createRequire
    ? moduleBuiltin.createRequire(path.join(process.cwd(), "package.json"))
    : createRequire(path.join(process.cwd(), "package.json"));
  if (typeof candidate !== "function") {
    throw new Error("Node require loader is unavailable in this runtime.");
  }
  return candidate as (id: string) => unknown;
}

function loadRuntimeModule<T>(moduleName: string): T {
  try {
    return getRuntimeRequire()(moduleName) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to load ${moduleName}: ${message}`);
  }
}

function loadAdmZip(): AdmZipClass {
  const mod = loadRuntimeModule<AdmZipClass | { default: AdmZipClass }>("adm-zip");
  return ((mod as { default?: AdmZipClass }).default ?? mod) as AdmZipClass;
}

function loadExcelJS(): ExcelJSImport {
  const mod = loadRuntimeModule<ExcelJSImport | { default: ExcelJSImport }>("exceljs");
  return ((mod as { default?: ExcelJSImport }).default ?? mod) as ExcelJSImport;
}

function loadPdfParseCtor(): PdfParseCtor {
  const mod = loadRuntimeModule<{ PDFParse: PdfParseCtor } | { default: { PDFParse: PdfParseCtor } }>("pdf-parse");
  const candidate = "default" in mod ? mod.default : mod;
  return candidate.PDFParse;
}

function cleanPdfText(rawText: string): string {
  return rawText
    .replace(/\r/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

function toLines(rawText: string): string[] {
  return cleanPdfText(rawText)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !PAGE_MARKER_PATTERN.test(line) && !/^Page \d+ of \d+$/i.test(line));
}

function findMatch(text: string, pattern: RegExp, label: string): RegExpMatchArray {
  const match = text.match(pattern);
  if (!match) {
    throw new Error(`Unable to locate ${label}.`);
  }
  return match;
}

function parseChargeLine(line: string): LsaStatementCharge {
  const parts = line
    .split(/\t+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length >= 3) {
    const amount = parts[parts.length - 1];
    const quantityUnits = parts[parts.length - 2];
    const description = parts.slice(0, -2).join(" ");
    const quantityUnitMatch = quantityUnits.match(/^([\d,]+)\s+(.+)$/);
    if (quantityUnitMatch) {
      return {
        description,
        quantity: quantityUnitMatch[1],
        units: quantityUnitMatch[2],
        amount,
      };
    }
  }

  const trailingAmountMatch = line.match(new RegExp(`^(.*?)(?:\\t+|\\s{2,})(${MONEY_PATTERN.source.replace(/^\^?/, "")}|-?[\\d,]+\\.\\d{2})$`));
  if (!trailingAmountMatch) {
    throw new Error(`Unable to parse charge line: ${line}`);
  }
  return {
    description: trailingAmountMatch[1].trim(),
    quantity: "",
    units: "",
    amount: trailingAmountMatch[2].startsWith("$") || trailingAmountMatch[2].startsWith("-$")
      ? trailingAmountMatch[2]
      : trailingAmountMatch[2].startsWith("-")
        ? `-${trailingAmountMatch[2].slice(1)}`
        : trailingAmountMatch[2],
  };
}

function parsePaymentLine(line: string): LsaStatementPayment {
  const parts = line
    .split(/\t+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 3) {
    throw new Error(`Unable to parse payment line: ${line}`);
  }
  return {
    date: parts[0],
    description: parts.slice(1, -1).join(" "),
    amount: parts[parts.length - 1],
  };
}

export function parseLsaStatementText(text: string, sourceFilename = "statement.pdf"): LsaStatement {
  const normalizedText = cleanPdfText(text);
  const lines = toLines(normalizedText);

  const dottedValues = Array.from(normalizedText.matchAll(DOT_VALUE_PATTERN)).map((match) => match[1].trim());
  if (dottedValues.length < 4) {
    throw new Error("Unable to locate statement detail values.");
  }

  const summaryMatch = findMatch(
    normalizedText,
    new RegExp(
      `(${MONEY_PATTERN.source})\\n(${MONEY_PATTERN.source})\\n(${MONEY_PATTERN.source})\\n(${MONEY_PATTERN.source})\\nGoogle Ads\\nSummary for ([^\\n]+)\\nStarting balance\\nTotal new activity\\nTotal payments received\\nEnding balance in USD`,
    ),
    "summary totals",
  );

  const accountMatch = findMatch(
    normalizedText,
    /Account:\s*([^\n]+)\nAccount ID:\s*([^\n]+)\n([A-Z][a-z]{2} \d{1,2}, \d{4} - [A-Z][a-z]{2} \d{1,2}, \d{4})/,
    "account block",
  );

  const statementToIndex = lines.indexOf("To");
  const detailsIndex = lines.indexOf("Details");
  if (statementToIndex === -1 || detailsIndex === -1 || detailsIndex <= statementToIndex) {
    throw new Error("Unable to locate Statement To block.");
  }
  const firstDottedValueIndex = lines.findIndex((line, index) => index > statementToIndex && line.startsWith("."));
  const statementToEndIndex = firstDottedValueIndex !== -1 ? firstDottedValueIndex : detailsIndex;
  const statementToLines = lines.slice(statementToIndex + 1, statementToEndIndex);

  const accountLineIndex = lines.findIndex((line) => line.startsWith("Account: "));
  const chargesHeaderIndex = lines.findIndex(
    (line, index) => index > accountLineIndex && line.includes("Description") && line.includes("Amount($)"),
  );
  const paymentsIndex = lines.findIndex((line, index) => index > chargesHeaderIndex && line === "PAYMENTS RECEIVED");
  const paymentHeaderIndex = lines.findIndex(
    (line, index) => index > paymentsIndex && line.includes("Date") && line.includes("Amount($)"),
  );

  if (accountLineIndex === -1 || chargesHeaderIndex === -1 || paymentsIndex === -1 || paymentHeaderIndex === -1) {
    throw new Error("Unable to locate statement table sections.");
  }

  const chargeLines = lines.slice(chargesHeaderIndex + 1, paymentsIndex).filter(Boolean);
  const paymentLines = lines.slice(paymentHeaderIndex + 1).filter(Boolean);

  const charges = chargeLines.map(parseChargeLine);
  const payments = paymentLines.map(parsePaymentLine);

  return {
    sourceFilename,
    statementToLines,
    accountId: dottedValues[0] ?? accountMatch[2].trim(),
    paymentsAccountId: dottedValues[1] ?? "",
    paymentsProfileId: dottedValues[2] ?? "",
    statementIssueDate: dottedValues[3] ?? "",
    startingBalance: summaryMatch[1],
    totalNewActivity: summaryMatch[2],
    totalPaymentsReceived: summaryMatch[3],
    endingBalance: summaryMatch[4],
    summaryRange: summaryMatch[5],
    accountName: accountMatch[1].trim(),
    statementRange: accountMatch[3].trim(),
    charges,
    payments,
  };
}

export async function extractTextFromPdfBuffer(buffer: Buffer): Promise<string> {
  const PDFParseCtor = loadPdfParseCtor();
  const parser = new PDFParseCtor({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}

export async function parseLsaStatementPdf(buffer: Buffer, sourceFilename: string): Promise<LsaStatement> {
  const text = await extractTextFromPdfBuffer(buffer);
  return parseLsaStatementText(text, sourceFilename);
}

function setWorkbookLayout(worksheet: WorksheetLike): void {
  worksheet.columns = [
    { width: 34 },
    { width: 14 },
    { width: 14 },
    { width: 14 },
    { width: 20 },
    { width: 14 },
    { width: 8 },
    { width: 16 },
    { width: 8 },
    { width: 14 },
  ];
}

function applyCellStyle(cell: CellLike, options?: { bold?: boolean; alignRight?: boolean; wrap?: boolean }): void {
  cell.font = {
    name: "Aptos",
    size: 11,
    bold: options?.bold ?? false,
  };
  cell.alignment = {
    vertical: "top",
    horizontal: options?.alignRight ? "right" : "left",
    wrapText: options?.wrap ?? false,
  };
}

export async function buildLsaWorkbookBuffer(statement: LsaStatement): Promise<Buffer> {
  const ExcelJS = loadExcelJS();
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Table 1");
  setWorkbookLayout(worksheet);

  worksheet.getCell("A1").value = ["Statement", "To", ...statement.statementToLines].join("\n");
  applyCellStyle(worksheet.getCell("A1"), { wrap: true });
  worksheet.getRow(1).height = 90;

  worksheet.getCell("A2").value = [
    "Details",
    `Account ID                                       ${statement.accountId}`,
    `Payments account ID                    ${statement.paymentsAccountId}`,
    `Payments profile ID                       ${statement.paymentsProfileId}`,
    `Statement issue date                    ${statement.statementIssueDate}`,
  ].join("\n");
  applyCellStyle(worksheet.getCell("A2"), { wrap: true });

  worksheet.getCell("D2").value = [
    "Google Ads",
    `Summary for ${statement.summaryRange}`,
    "Starting balance",
    "Total new activity",
    "Total payments received",
    "Ending balance in USD",
  ].join("\n");
  applyCellStyle(worksheet.getCell("D2"), { wrap: true });

  worksheet.getCell("I2").value = [
    statement.startingBalance,
    statement.totalNewActivity,
    statement.totalPaymentsReceived,
    statement.endingBalance,
  ].join("\n");
  applyCellStyle(worksheet.getCell("I2"), { wrap: true, alignRight: true });
  worksheet.getRow(2).height = 95;

  worksheet.getCell("A3").value =
    "This is not a bill.\nThis is a summary of billing activity for the time period stated above.";
  applyCellStyle(worksheet.getCell("A3"), { wrap: true });
  worksheet.getRow(3).height = 36;

  worksheet.getCell("A5").value = "Statement";
  applyCellStyle(worksheet.getCell("A5"), { bold: true });

  worksheet.getCell("A6").value = `Account: ${statement.accountName} Account ID: ${statement.accountId}\n${statement.statementRange}`;
  applyCellStyle(worksheet.getCell("A6"), { wrap: true });
  worksheet.getRow(6).height = 32;

  worksheet.getCell("A7").value = "Description";
  worksheet.getCell("F7").value = "Quantity";
  worksheet.getCell("H7").value = "Units";
  worksheet.getCell("J7").value = "Amount($)";
  for (const ref of ["A7", "F7", "H7", "J7"]) {
    applyCellStyle(worksheet.getCell(ref), { bold: true });
  }

  let currentRow = 8;
  for (const charge of statement.charges) {
    worksheet.getCell(`A${currentRow}`).value = charge.description;
    worksheet.getCell(`F${currentRow}`).value = charge.quantity;
    worksheet.getCell(`H${currentRow}`).value = charge.units;
    worksheet.getCell(`J${currentRow}`).value = charge.amount;
    applyCellStyle(worksheet.getCell(`A${currentRow}`));
    applyCellStyle(worksheet.getCell(`F${currentRow}`), { alignRight: true });
    applyCellStyle(worksheet.getCell(`H${currentRow}`));
    applyCellStyle(worksheet.getCell(`J${currentRow}`), { alignRight: true });
    currentRow += 1;
  }

  worksheet.getCell(`E${currentRow}`).value = "Subtotal in USD";
  worksheet.getCell(`F${currentRow}`).value = statement.totalNewActivity;
  worksheet.getCell(`E${currentRow + 1}`).value = "Tax (0%)";
  worksheet.getCell(`F${currentRow + 1}`).value = "$0.00";
  worksheet.getCell(`E${currentRow + 2}`).value = "Total in USD";
  worksheet.getCell(`F${currentRow + 2}`).value = statement.totalNewActivity;
  for (const ref of [`E${currentRow}`, `F${currentRow}`, `E${currentRow + 1}`, `F${currentRow + 1}`, `E${currentRow + 2}`, `F${currentRow + 2}`]) {
    applyCellStyle(worksheet.getCell(ref), { alignRight: ref.startsWith("F") });
  }

  currentRow += 4;
  worksheet.getCell(`A${currentRow}`).value = "PAYMENTS RECEIVED";
  applyCellStyle(worksheet.getCell(`A${currentRow}`), { bold: true });
  currentRow += 1;

  worksheet.getCell(`A${currentRow}`).value = "Date";
  worksheet.getCell(`B${currentRow}`).value = "Description";
  worksheet.getCell(`F${currentRow}`).value = "Amount($)";
  for (const ref of [`A${currentRow}`, `B${currentRow}`, `F${currentRow}`]) {
    applyCellStyle(worksheet.getCell(ref), { bold: true });
  }

  currentRow += 1;
  for (const payment of statement.payments) {
    worksheet.getCell(`A${currentRow}`).value = payment.date;
    worksheet.getCell(`B${currentRow}`).value = payment.description;
    worksheet.getCell(`F${currentRow}`).value = payment.amount;
    applyCellStyle(worksheet.getCell(`A${currentRow}`));
    applyCellStyle(worksheet.getCell(`B${currentRow}`));
    applyCellStyle(worksheet.getCell(`F${currentRow}`), { alignRight: true });
    currentRow += 1;
  }

  worksheet.getCell(`E${currentRow}`).value = "Total payments received in USD";
  worksheet.getCell(`F${currentRow}`).value = statement.totalPaymentsReceived;
  applyCellStyle(worksheet.getCell(`E${currentRow}`));
  applyCellStyle(worksheet.getCell(`F${currentRow}`), { alignRight: true });

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function toOutputFileName(name: string): string {
  return name.replace(/\.pdf$/i, ".xlsx");
}

async function expandPdfInputs(inputs: NamedBuffer[]): Promise<NamedBuffer[]> {
  const pdfs: NamedBuffer[] = [];
  for (const input of inputs) {
    if (/\.zip$/i.test(input.name)) {
      const AdmZip = loadAdmZip();
      const zip = new AdmZip(input.buffer);
      for (const entry of zip.getEntries()) {
        if (entry.isDirectory || !/\.pdf$/i.test(entry.entryName)) {
          continue;
        }
        pdfs.push({
          name: entry.entryName.split("/").pop() ?? entry.entryName,
          buffer: entry.getData(),
        });
      }
      continue;
    }
    if (/\.pdf$/i.test(input.name)) {
      pdfs.push(input);
    }
  }
  return pdfs;
}

export async function buildLsaAutomationExport(inputs: NamedBuffer[]): Promise<LsaAutomationExport> {
  const pdfInputs = await expandPdfInputs(inputs);
  if (pdfInputs.length === 0) {
    throw new Error("Upload a ZIP with PDFs or one or more PDF statements.");
  }

  const results: LsaAutomationResult[] = [];
  const generatedFiles: Array<{ name: string; buffer: Buffer }> = [];

  for (const input of pdfInputs) {
    try {
      const statement = await parseLsaStatementPdf(input.buffer, input.name);
      const outputFilename = toOutputFileName(input.name);
      const workbookBuffer = await buildLsaWorkbookBuffer(statement);
      generatedFiles.push({ name: outputFilename, buffer: workbookBuffer });
      results.push({
        sourceFilename: input.name,
        outputFilename,
        accountName: statement.accountName,
        statementRange: statement.statementRange,
        charges: statement.charges.length,
        payments: statement.payments.length,
        totalNewActivity: statement.totalNewActivity,
        totalPaymentsReceived: statement.totalPaymentsReceived,
        success: true,
      });
    } catch (error) {
      results.push({
        sourceFilename: input.name,
        outputFilename: toOutputFileName(input.name),
        accountName: "",
        statementRange: "",
        charges: 0,
        payments: 0,
        totalNewActivity: "",
        totalPaymentsReceived: "",
        success: false,
        error: error instanceof Error ? error.message : "Unknown parsing error.",
      });
    }
  }

  if (generatedFiles.length === 0) {
    throw new Error(results[0]?.error ?? "Unable to parse any PDF statements.");
  }

  if (generatedFiles.length === 1) {
    return {
      artifactBuffer: generatedFiles[0].buffer,
      artifactName: generatedFiles[0].name,
      artifactMimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      results,
    };
  }

  const AdmZip = loadAdmZip();
  const zip = new AdmZip();
  for (const file of generatedFiles) {
    zip.addFile(file.name, file.buffer);
  }

  return {
    artifactBuffer: zip.toBuffer(),
    artifactName: "lsa-automation-export.zip",
    artifactMimeType: "application/zip",
    results,
  };
}

export const __internal = {
  cleanPdfText,
};
