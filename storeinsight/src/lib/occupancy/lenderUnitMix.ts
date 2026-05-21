import { createRequire } from "node:module";
import path from "node:path";

export type OccupancyCleanupResult = {
  filename: string;
  mimeType: string;
  base64: string;
  propertyName: string;
  standardStorageRows: number;
  parkingRows: number;
};

type ExcelJSImport = typeof import("exceljs") extends { default: infer T }
  ? T
  : typeof import("exceljs");

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

function loadExcelJS(): ExcelJSImport {
  const mod = getRuntimeRequire()("exceljs") as ExcelJSImport | { default: ExcelJSImport };
  return ((mod as { default?: ExcelJSImport }).default ?? mod) as ExcelJSImport;
}

const HEADERS = [
  "Unit Size",
  "Total Units",
  "Occupied Units",
  "Vacant Units",
  "Average Rental Rate",
  "Total Square Footage",
  "Rented Square Footage",
  "Vacant Square Footage",
  "Occupancy %",
] as const;

type AggregatedRow = {
  unitSize: string;
  totalUnits: number;
  occupiedUnits: number;
  vacantUnits: number;
  averageRentalRate: number;
  totalSquareFootage: number;
  rentedSquareFootage: number;
  vacantSquareFootage: number;
};

type Accumulator = {
  unitSize: string;
  totalUnits: number;
  occupiedUnits: number;
  vacantUnits: number;
  rateUnitsWeighted: number;
  rateUnitsWeight: number;
  totalSquareFootage: number;
  rentedSquareFootage: number;
  vacantSquareFootage: number;
};

function toNumber(value: unknown): number {
  if (value === null || value === undefined || value === "") {
    return 0;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "string") {
    const cleaned = value.replace(/[$,%]/g, "").replace(/\((.*)\)/, "-$1").trim();
    if (cleaned === "" || cleaned === "-") return 0;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof value === "object" && value && "result" in value) {
    return toNumber((value as { result: unknown }).result);
  }
  return 0;
}

function toText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (typeof value === "object" && value && "text" in value) {
    return String((value as { text: unknown }).text ?? "").trim();
  }
  if (typeof value === "object" && value && "richText" in value) {
    const segments = (value as { richText: Array<{ text?: string }> }).richText;
    return segments.map((s) => s.text ?? "").join("").trim();
  }
  if (typeof value === "object" && value && "result" in value) {
    return toText((value as { result: unknown }).result);
  }
  return String(value).trim();
}

type WorksheetCell = { value: unknown };
type Worksheet = {
  name: string;
  getCell: (ref: string) => WorksheetCell;
};

function findHeaderRow(ws: Worksheet, maxRow = 20): number {
  for (let r = 1; r <= maxRow; r += 1) {
    const cellA = toText(ws.getCell(`A${r}`).value);
    if (cellA.toLowerCase() === "size/area tier") {
      return r;
    }
  }
  return 8;
}

function aggregateGroup(sheets: Worksheet[]): AggregatedRow[] {
  const order: string[] = [];
  const map = new Map<string, Accumulator>();

  for (const ws of sheets) {
    const headerRow = findHeaderRow(ws);
    const startRow = headerRow + 1;
    for (let r = startRow; r < startRow + 500; r += 1) {
      const aRaw = ws.getCell(`A${r}`).value;
      if (aRaw === null || aRaw === undefined || aRaw === "") {
        break;
      }
      const unitSize = toText(aRaw);
      if (unitSize === "" ) break;
      const lower = unitSize.toLowerCase();
      if (lower === "total" || lower === "subtotal" || lower === "grand total") {
        break;
      }

      const areaPerSpace = toNumber(ws.getCell(`D${r}`).value);
      const totalArea = toNumber(ws.getCell(`E${r}`).value);
      const occSpaces = toNumber(ws.getCell(`F${r}`).value);
      const vacantSpaces = toNumber(ws.getCell(`G${r}`).value);
      const totalSpaces = toNumber(ws.getCell(`I${r}`).value);
      // The Updated example uses Avg Rent (col L) for "Average Rental Rate".
      // Source column M (col 13) maps to "Avg Rent". exceljs cell ref "L" matches column L = index 12.
      // Looking at headers: A=1 Size/Area Tier, B=2, C=3, D=4 Area per Space, E=5 Total Area,
      // F=6 Occ Spaces, G=7 Vacant Spaces, H=8 Offline, I=9 Total Spaces, J=10 Avg Set Rate,
      // K=11 Avg Sell Rate, L=12 Avg Rent. Yes, L = Avg Rent.
      const avgRent = toNumber(ws.getCell(`L${r}`).value);

      const existing = map.get(unitSize);
      if (existing) {
        existing.totalUnits += totalSpaces;
        existing.occupiedUnits += occSpaces;
        existing.vacantUnits += vacantSpaces;
        existing.totalSquareFootage += totalArea;
        existing.rentedSquareFootage += areaPerSpace * occSpaces;
        existing.vacantSquareFootage += areaPerSpace * vacantSpaces;
        existing.rateUnitsWeighted += avgRent * totalSpaces;
        existing.rateUnitsWeight += totalSpaces;
      } else {
        order.push(unitSize);
        map.set(unitSize, {
          unitSize,
          totalUnits: totalSpaces,
          occupiedUnits: occSpaces,
          vacantUnits: vacantSpaces,
          totalSquareFootage: totalArea,
          rentedSquareFootage: areaPerSpace * occSpaces,
          vacantSquareFootage: areaPerSpace * vacantSpaces,
          rateUnitsWeighted: avgRent * totalSpaces,
          rateUnitsWeight: totalSpaces,
        });
      }
    }
  }

  return order.map((key) => {
    const acc = map.get(key);
    if (!acc) {
      return {
        unitSize: key,
        totalUnits: 0,
        occupiedUnits: 0,
        vacantUnits: 0,
        averageRentalRate: 0,
        totalSquareFootage: 0,
        rentedSquareFootage: 0,
        vacantSquareFootage: 0,
      };
    }
    return {
      unitSize: acc.unitSize,
      totalUnits: acc.totalUnits,
      occupiedUnits: acc.occupiedUnits,
      vacantUnits: acc.vacantUnits,
      averageRentalRate: acc.rateUnitsWeight > 0 ? acc.rateUnitsWeighted / acc.rateUnitsWeight : 0,
      totalSquareFootage: acc.totalSquareFootage,
      rentedSquareFootage: acc.rentedSquareFootage,
      vacantSquareFootage: acc.vacantSquareFootage,
    };
  });
}

function extractAsOfDate(sheets: Worksheet[]): string {
  for (const ws of sheets) {
    const a3 = toText(ws.getCell("A3").value);
    if (a3) return a3;
  }
  return "";
}

const PROPERTY_HEADER_PATTERN = /^[A-Z0-9-]+\s*-\s*STORE\s+(?:on|at|in)\s+(.+)$/i;
const FILENAME_PROPERTY_PATTERN = /Occupancy Statistics Report\s*-\s*STORE\s+(?:on|at|in)\s+(.+?)(?:\s*-\s*\d{4}-\d{2}-\d{2})?\.xlsx$/i;
const FILENAME_FALLBACK_PATTERN = /Occupancy Statistics Report\s*-\s*(.+?)(?:\s*-\s*\d{4}-\d{2}-\d{2})?\.xlsx$/i;

function extractPropertyName(
  workbook: { worksheets: Worksheet[] },
  filename: string,
): { shortName: string; fullName: string } {
  for (const ws of workbook.worksheets) {
    for (let r = 1; r <= 6; r += 1) {
      for (const col of ["K", "L", "J", "I", "H"]) {
        const v = toText(ws.getCell(`${col}${r}`).value);
        const match = v.match(PROPERTY_HEADER_PATTERN);
        if (match) {
          const short = match[1].trim();
          return { shortName: short, fullName: `STORE on ${short}` };
        }
      }
    }
  }

  const headerMatch = filename.match(FILENAME_PROPERTY_PATTERN);
  if (headerMatch) {
    const short = headerMatch[1].trim();
    return { shortName: short, fullName: `STORE on ${short}` };
  }
  const fallback = filename.match(FILENAME_FALLBACK_PATTERN);
  if (fallback) {
    const value = fallback[1].trim();
    return { shortName: value, fullName: value };
  }
  return { shortName: "Property", fullName: "Property" };
}

const HEADER_FILL = "FF5B9BD5";
const SECTION_FILL = "FF1F4E78";
const TITLE_FILL = "FF1F4E78";
const SUBTITLE_FILL = "FFD9EAF7";
const WHITE_FONT = "FFFFFFFF";
const TOTAL_BORDER_COLOR = "FF1F4E78";

type ExcelWorkbook = {
  xlsx: {
    load: (data: ArrayBuffer | Buffer) => Promise<ExcelWorkbook>;
    writeBuffer: () => Promise<ArrayBuffer | Buffer>;
  };
  worksheets: Worksheet[];
  addWorksheet: (name: string) => Worksheet & {
    columns: Array<{ width?: number }>;
    getRow: (n: number) => { height?: number; eachCell?: (cb: (cell: unknown) => void) => void };
    mergeCells?: (ref: string) => void;
  };
};

type StyleableCell = {
  value: unknown;
  font?: Record<string, unknown>;
  fill?: Record<string, unknown>;
  alignment?: Record<string, unknown>;
  border?: Record<string, unknown>;
  numFmt?: string;
};

function setSolidFill(cell: StyleableCell, argb: string): void {
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
}

function setFont(
  cell: StyleableCell,
  options: { bold?: boolean; size?: number; color?: string; italic?: boolean } = {},
): void {
  cell.font = {
    name: "Calibri",
    size: options.size ?? 11,
    bold: options.bold ?? false,
    italic: options.italic ?? false,
    ...(options.color ? { color: { argb: options.color } } : {}),
  };
}

function setAlignment(cell: StyleableCell, horizontal: "left" | "center" | "right"): void {
  cell.alignment = { vertical: "middle", horizontal };
}

function setTotalBorder(cell: StyleableCell): void {
  cell.border = {
    top: { style: "thin", color: { argb: TOTAL_BORDER_COLOR } },
  };
}

const COLUMN_WIDTHS = [33.375, 12.625, 17, 14.375, 22.375, 23.5, 25.625, 25.25, 15.125];

function applyLenderSheet(
  workbook: ExcelWorkbook,
  propertyName: string,
  propertyFullName: string,
  asOfDate: string,
  standardRows: AggregatedRow[],
  parkingRows: AggregatedRow[],
): { totalProperty: { totalUnits: number; occupiedUnits: number; occupancy: number } } {
  const sheetName = `Lender Unit Mix - ${propertyName}`.slice(0, 31);
  const ws = workbook.addWorksheet(sheetName);
  ws.columns = COLUMN_WIDTHS.map((width) => ({ width }));

  // Row 1: title
  const titleCell = ws.getCell("A1") as StyleableCell;
  titleCell.value = `${propertyFullName} - Unit Mix Summary`;
  setFont(titleCell, { bold: true, size: 14, color: WHITE_FONT });
  setSolidFill(titleCell, TITLE_FILL);
  setAlignment(titleCell, "left");

  // Row 2: subtitle
  const subtitleCell = ws.getCell("A2") as StyleableCell;
  subtitleCell.value = asOfDate ? `As of ${asOfDate}` : "As of -";
  setFont(subtitleCell, { bold: true, size: 12 });
  setSolidFill(subtitleCell, SUBTITLE_FILL);
  setAlignment(subtitleCell, "left");

  // Row 4: Standard Storage section header
  const ssSectionCell = ws.getCell("A4") as StyleableCell;
  ssSectionCell.value = "Standard Storage";
  setFont(ssSectionCell, { bold: true, size: 13, color: WHITE_FONT });
  setSolidFill(ssSectionCell, SECTION_FILL);
  setAlignment(ssSectionCell, "left");

  // Row 5: column headers
  HEADERS.forEach((header, index) => {
    const colLetter = String.fromCharCode("A".charCodeAt(0) + index);
    const cell = ws.getCell(`${colLetter}5`) as StyleableCell;
    cell.value = header;
    setFont(cell, { bold: true, size: 12, color: WHITE_FONT });
    setSolidFill(cell, HEADER_FILL);
    setAlignment(cell, index === 0 ? "left" : "center");
  });

  // Standard Storage rows from row 6
  const ssStart = 6;
  standardRows.forEach((row, index) => {
    writeAggregatedRow(ws, ssStart + index, row);
  });

  // Standard Storage Total row
  const ssTotalRow = ssStart + standardRows.length;
  const ssTotal = sumAggregated(standardRows);
  writeTotalRow(ws, ssTotalRow, ssTotal);

  // Parking section starts after a blank row
  const parkingSectionRow = ssTotalRow + 2;
  const parkingSectionCell = ws.getCell(`A${parkingSectionRow}`) as StyleableCell;
  parkingSectionCell.value = "Parking";
  setFont(parkingSectionCell, { bold: true, size: 13, color: WHITE_FONT });
  setSolidFill(parkingSectionCell, SECTION_FILL);
  setAlignment(parkingSectionCell, "left");

  // Parking headers
  const parkingHeaderRow = parkingSectionRow + 1;
  HEADERS.forEach((header, index) => {
    const colLetter = String.fromCharCode("A".charCodeAt(0) + index);
    const cell = ws.getCell(`${colLetter}${parkingHeaderRow}`) as StyleableCell;
    cell.value = header;
    setFont(cell, { bold: true, size: 12, color: WHITE_FONT });
    setSolidFill(cell, HEADER_FILL);
    setAlignment(cell, index === 0 ? "left" : "center");
  });

  const parkingStart = parkingHeaderRow + 1;
  parkingRows.forEach((row, index) => {
    writeAggregatedRow(ws, parkingStart + index, row);
  });

  const parkingTotalRow = parkingStart + parkingRows.length;
  const parkingTotal = sumAggregated(parkingRows);
  writeTotalRow(ws, parkingTotalRow, parkingTotal);

  // Total Property Occupancy row
  const propertyTotalRow = parkingTotalRow + 2;
  const propertyTotalUnits = ssTotal.totalUnits + parkingTotal.totalUnits;
  const propertyOccupied = ssTotal.occupiedUnits + parkingTotal.occupiedUnits;
  const propertyVacant = ssTotal.vacantUnits + parkingTotal.vacantUnits;
  const propertyTotalSqft = ssTotal.totalSquareFootage + parkingTotal.totalSquareFootage;
  const propertyRentedSqft = ssTotal.rentedSquareFootage + parkingTotal.rentedSquareFootage;
  const propertyVacantSqft = ssTotal.vacantSquareFootage + parkingTotal.vacantSquareFootage;
  const propertyOccupancy = propertyTotalUnits > 0 ? propertyOccupied / propertyTotalUnits : 0;

  const propertyValues: Array<[string, unknown, string]> = [
    [`A${propertyTotalRow}`, "Total Property Occupancy %", "@"],
    [`B${propertyTotalRow}`, propertyTotalUnits, "#,##0"],
    [`C${propertyTotalRow}`, propertyOccupied, "#,##0"],
    [`D${propertyTotalRow}`, propertyVacant, "#,##0"],
    [`E${propertyTotalRow}`, null, "$#,##0.00"],
    [`F${propertyTotalRow}`, propertyTotalSqft, "#,##0"],
    [`G${propertyTotalRow}`, propertyRentedSqft, "#,##0"],
    [`H${propertyTotalRow}`, propertyVacantSqft, "#,##0"],
    [`I${propertyTotalRow}`, propertyOccupancy, "0.0%"],
  ];
  propertyValues.forEach(([ref, value, fmt]) => {
    const cell = ws.getCell(ref) as StyleableCell;
    cell.value = value;
    setFont(cell, { bold: true, size: 12 });
    cell.numFmt = fmt;
    setAlignment(cell, ref.startsWith("A") ? "left" : "right");
    setTotalBorder(cell);
  });

  return {
    totalProperty: {
      totalUnits: propertyTotalUnits,
      occupiedUnits: propertyOccupied,
      occupancy: propertyOccupancy,
    },
  };
}

function writeAggregatedRow(ws: Worksheet, rowNumber: number, row: AggregatedRow): void {
  const cells: Array<[string, unknown, string, "left" | "right"]> = [
    [`A${rowNumber}`, row.unitSize, "@", "left"],
    [`B${rowNumber}`, row.totalUnits, "#,##0", "right"],
    [`C${rowNumber}`, row.occupiedUnits, "#,##0", "right"],
    [`D${rowNumber}`, row.vacantUnits, "#,##0", "right"],
    [`E${rowNumber}`, row.averageRentalRate, "$#,##0.00", "right"],
    [`F${rowNumber}`, row.totalSquareFootage, "#,##0", "right"],
    [`G${rowNumber}`, row.rentedSquareFootage, "#,##0", "right"],
    [`H${rowNumber}`, row.vacantSquareFootage, "#,##0", "right"],
    [
      `I${rowNumber}`,
      row.totalUnits > 0 ? row.occupiedUnits / row.totalUnits : 0,
      "0.0%",
      "right",
    ],
  ];
  cells.forEach(([ref, value, fmt, align]) => {
    const cell = ws.getCell(ref) as StyleableCell;
    cell.value = value;
    cell.numFmt = fmt;
    setFont(cell, { size: 11 });
    setAlignment(cell, align);
  });
}

type SectionTotal = {
  totalUnits: number;
  occupiedUnits: number;
  vacantUnits: number;
  averageRentalRate: number;
  totalSquareFootage: number;
  rentedSquareFootage: number;
  vacantSquareFootage: number;
};

function sumAggregated(rows: AggregatedRow[]): SectionTotal {
  const totals: SectionTotal = {
    totalUnits: 0,
    occupiedUnits: 0,
    vacantUnits: 0,
    averageRentalRate: 0,
    totalSquareFootage: 0,
    rentedSquareFootage: 0,
    vacantSquareFootage: 0,
  };
  let rateWeighted = 0;
  let rateWeight = 0;
  for (const row of rows) {
    totals.totalUnits += row.totalUnits;
    totals.occupiedUnits += row.occupiedUnits;
    totals.vacantUnits += row.vacantUnits;
    totals.totalSquareFootage += row.totalSquareFootage;
    totals.rentedSquareFootage += row.rentedSquareFootage;
    totals.vacantSquareFootage += row.vacantSquareFootage;
    rateWeighted += row.averageRentalRate * row.occupiedUnits;
    rateWeight += row.occupiedUnits;
  }
  totals.averageRentalRate = rateWeight > 0 ? rateWeighted / rateWeight : 0;
  return totals;
}

function writeTotalRow(ws: Worksheet, rowNumber: number, total: SectionTotal): void {
  const occupancy = total.totalUnits > 0 ? total.occupiedUnits / total.totalUnits : 0;
  const cells: Array<[string, unknown, string, "left" | "right"]> = [
    [`A${rowNumber}`, "Total", "@", "left"],
    [`B${rowNumber}`, total.totalUnits, "#,##0", "right"],
    [`C${rowNumber}`, total.occupiedUnits, "#,##0", "right"],
    [`D${rowNumber}`, total.vacantUnits, "#,##0", "right"],
    [`E${rowNumber}`, total.averageRentalRate, "$#,##0.00", "right"],
    [`F${rowNumber}`, total.totalSquareFootage, "#,##0", "right"],
    [`G${rowNumber}`, total.rentedSquareFootage, "#,##0", "right"],
    [`H${rowNumber}`, total.vacantSquareFootage, "#,##0", "right"],
    [`I${rowNumber}`, occupancy, "0.0%", "right"],
  ];
  cells.forEach(([ref, value, fmt, align]) => {
    const cell = ws.getCell(ref) as StyleableCell;
    cell.value = value;
    cell.numFmt = fmt;
    setFont(cell, { bold: true, size: 11 });
    setAlignment(cell, align);
    setTotalBorder(cell);
  });
}

function toBuffer(input: ArrayBuffer | Buffer): Buffer {
  if (Buffer.isBuffer(input)) return input;
  return Buffer.from(input);
}

export async function processOccupancyWorkbook(
  input: ArrayBuffer | Buffer,
  uploadedFilename = "occupancy-report.xlsx",
): Promise<OccupancyCleanupResult> {
  const ExcelJS = loadExcelJS();
  const workbook = new ExcelJS.Workbook() as unknown as ExcelWorkbook;
  await workbook.xlsx.load(toBuffer(input));

  const standardSheets = workbook.worksheets.filter((ws) => /^SS\d+/i.test(ws.name));
  const parkingSheets = workbook.worksheets.filter((ws) => /^P\d+/i.test(ws.name));

  if (standardSheets.length === 0 && parkingSheets.length === 0) {
    throw new Error(
      "Could not find any Standard Storage (SS*) or Parking (P*) sheets in the uploaded workbook.",
    );
  }

  const standardRows = aggregateGroup(standardSheets);
  const parkingRows = aggregateGroup(parkingSheets);

  const asOfDate = extractAsOfDate([...standardSheets, ...parkingSheets, ...workbook.worksheets]);
  const { shortName, fullName } = extractPropertyName(workbook, uploadedFilename);

  applyLenderSheet(workbook, shortName, fullName, asOfDate, standardRows, parkingRows);

  const outputBuffer = toBuffer((await workbook.xlsx.writeBuffer()) as ArrayBuffer | Buffer);
  const baseName = uploadedFilename.replace(/\.xlsx$/i, "");
  const filename = `${baseName} - Lender Unit Mix.xlsx`;

  return {
    filename,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    base64: outputBuffer.toString("base64"),
    propertyName: shortName,
    standardStorageRows: standardRows.length,
    parkingRows: parkingRows.length,
  };
}
