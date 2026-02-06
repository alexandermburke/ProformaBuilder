import fs from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import PizZip from "pizzip";
import { createCanvas } from "canvas";
import { Chart, registerables, type ChartConfiguration, type Plugin } from "chart.js";
import ChartDataLabels from "chartjs-plugin-datalabels";
import "@/lib/chartFonts";
import type { PropertyConfig } from "@/types/dailySummary";
import { stripHiddenTokenCharacters } from "@/lib/pptTokens";
import { getMoMSeries, type MoMSeries } from "@/lib/flash/momSeries";

export type TokenMap = Record<string, string | number | unknown[]>;

const chartWidth = 1200;
const chartHeight = 650;
const chartPixelRatio = 2;
const whiteBackgroundPlugin: Plugin = {
  id: "customCanvasBackgroundColor",
  beforeDraw: (chart, _args, opts) => {
    const { ctx, width, height } = chart;
    ctx.save();
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = (opts as { color?: string }).color || "#FFFFFF";
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  },
};

Chart.register(...registerables, whiteBackgroundPlugin, ChartDataLabels);
Chart.defaults.responsive = false;
Chart.defaults.animation = false;
Chart.defaults.devicePixelRatio = chartPixelRatio;
Chart.defaults.font.size = 18;
Chart.defaults.font.family = "Inter";
Chart.defaults.color = "#111827";
console.log("[flash-charts] Chart font family:", Chart.defaults.font.family);

export type FlashGenerationOptions = {
  propertyCode: string;
  reportDate: string; // YYYY-MM-DD
  propertyConfig?: PropertyConfig;
  templatePath?: string;
  asOfDateOverride?: string;
};

export type FlashGenerationResult = {
  pptxBuffer: Buffer;
  pptxFilename: string;
  tokens: TokenMap;
  propertyName: string;
};

const DEFAULT_TEMPLATE = path.join(process.cwd(), "public", "FLASHTEMPLATE.pptx");

export async function generateFlashFromMsr(
  msrBuffer: ArrayBuffer | ArrayBufferView,
  options: FlashGenerationOptions,
): Promise<FlashGenerationResult> {
  const workbook = new ExcelJS.Workbook();
  const workbookBuffer =
    msrBuffer instanceof ArrayBuffer
      ? msrBuffer
      : new Uint8Array(msrBuffer.buffer, msrBuffer.byteOffset, msrBuffer.byteLength).slice().buffer;
  await workbook.xlsx.load(workbookBuffer);

  const msrSheet = workbook.getWorksheet("MSR");
  const delinquenciesSheet = workbook.getWorksheet("Delinquencies");

  if (!msrSheet) {
    throw new Error('Workbook is missing required "MSR" worksheet.');
  }
  if (!delinquenciesSheet) {
    throw new Error('Workbook is missing required "Delinquencies" worksheet.');
  }

  const tokens = buildTokenMap(msrSheet, delinquenciesSheet);
  const facilityOpenDate = options.propertyConfig?.facilityOpenDate;
  if (facilityOpenDate) {
    tokens.FACILITYOPENDATE = facilityOpenDate;
  }
  if (options.asOfDateOverride) {
    tokens.ASOFDATE = options.asOfDateOverride;
  }

  const propertyId =
    options.propertyConfig?.propertyId ||
    options.propertyConfig?.tenantPropertyId ||
    options.propertyConfig?.id ||
    options.propertyConfig?.propertyCode ||
    options.propertyCode;
  const momSeries = getMoMSeries(propertyId);
  if (!momSeries) {
    throw new Error(`No month-over-month series configured for propertyId "${propertyId}".`);
  }

  const [rentChartJpeg, occupancyChartJpeg] = await Promise.all([
    renderMoMGrossAccruedRentChart(momSeries, propertyId),
    renderMoMOccupancyChart(momSeries, propertyId),
  ]);

  const templatePath = options.templatePath ?? DEFAULT_TEMPLATE;
  const templateBuffer = await fs.readFile(templatePath);
  const zip = new PizZip(templateBuffer);

  const imageData =
    options.propertyConfig?.propertyImageData || options.propertyConfig?.imagePath || options.propertyConfig?.heroImageUrl;
  if (imageData) {
    const heroImage = await loadImageBufferFromData(imageData);
    if (heroImage) {
      zip.file("ppt/media/image2.jpeg", heroImage);
    }
  }
  zip.file("ppt/media/image3.jpeg", rentChartJpeg);
  zip.file("ppt/media/image4.jpeg", occupancyChartJpeg);

  scrubHiddenCharactersFromZip(zip);
  const pptxBuffer = await renderTokensIntoZip(zip, tokens);

  const propertyName = resolvePropertyName(tokens, options.propertyConfig);
  const reportDate = options.reportDate || (tokens.ASOFDATE as string) || "latest";
  const pptxFilename = `Daily Flash - ${propertyName} - ${reportDate}.pptx`;

  return {
    pptxBuffer,
    pptxFilename,
    tokens,
    propertyName,
  };
}

function resolvePropertyName(tokens: TokenMap, propertyConfig?: PropertyConfig): string {
  const tokenName =
    (tokens.PROPERTYDISPLAYNAME as string) ||
    (tokens.FACILITYSHORTNAME as string) ||
    (tokens.FACILITYCODE as string) ||
    "";
  const configName =
    propertyConfig?.name || propertyConfig?.propertyId || propertyConfig?.tenantPropertyId || propertyConfig?.id || "";
  const raw = tokenName || configName || "Property";
  return raw.replace(/[\\/]/g, "-").trim() || "Property";
}

function renderChartBuffer(
  configuration: ChartConfiguration<"line", Array<number | null>, string>,
  mimeType: "image/png" | "image/jpeg",
): Buffer {
  const canvas = createCanvas(chartWidth, chartHeight);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  new Chart(ctx as unknown as CanvasRenderingContext2D, configuration);
  return mimeType === "image/png" ? canvas.toBuffer("image/png") : canvas.toBuffer("image/jpeg");
}

function formatMonthLabel(yyyyMm: string): string {
  const [yStr, mStr] = yyyyMm.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const date = new Date(Date.UTC(y, m - 1, 1));
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }).format(date);
}

const computePaddedBounds = (
  values: Array<number | null>,
  options?: { paddingRatio?: number; floor?: number; ceil?: number; minRange?: number; ignoreZeros?: boolean },
): { min: number; max: number } => {
  const finite = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!finite.length) {
    return { min: options?.floor ?? 0, max: options?.ceil ?? 1 };
  }
  const sample =
    options?.ignoreZeros && finite.some((value) => value !== 0)
      ? finite.filter((value) => value !== 0)
      : finite;
  const minValue = Math.min(...sample);
  const maxValue = Math.max(...sample);
  const baseRange = Math.max(maxValue - minValue, options?.minRange ?? 0);
  const range = baseRange > 0 ? baseRange : Math.max(Math.abs(maxValue) * 0.05, 1);
  const padding = range * (options?.paddingRatio ?? 0.18);
  let min = minValue - padding;
  let max = maxValue + padding;
  if (options?.floor != null) min = Math.max(options.floor, min);
  if (options?.ceil != null) max = Math.min(options.ceil, max);
  if (max <= min) {
    max = min + Math.max(range, 1);
  }
  return { min, max };
};

async function renderMoMGrossAccruedRentChart(series: MoMSeries, propertyId: string): Promise<Buffer> {
  const monthsRecent = series.months.slice(0, 7);
  const dataRecent = series.grossAccruedRent.slice(0, 7);
  const monthsAsc = monthsRecent.slice().reverse();
  const dataAsc = dataRecent.slice().reverse();
  const labels = monthsAsc.map(formatMonthLabel);
  const data = dataAsc.map((value) => (typeof value === "number" && Number.isFinite(value) ? value : 0));
  const rentBounds = computePaddedBounds(data, { paddingRatio: 0.2, floor: 0, ignoreZeros: true });
  console.log("[MoM debug]", { propertyId, monthsRecent, monthsAsc, labels });
  const expectedLatestMonth = monthsRecent[0];
  const expectedLatestLabel = expectedLatestMonth ? formatMonthLabel(expectedLatestMonth) : "";
  if (!expectedLatestMonth) {
    throw new Error("Expected newest month to be available, got empty series");
  }
  if (labels[labels.length - 1] !== expectedLatestLabel) {
    throw new Error(`Expected last label ${expectedLatestLabel}, got ${labels[labels.length - 1]}`);
  }
  if (labels.length !== data.length) {
    throw new Error("MoM series length mismatch");
  }

  const storeManagedPlugin = isPittmanProperty(propertyId) ? buildStoreManagedMarkerPlugin() : null;
  const configuration: ChartConfiguration<"line", Array<number | null>, string> = {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Gross Accrued Rent ($)",
          data,
          borderColor: "#3b52a1",
          backgroundColor: "#3b52a1",
          borderWidth: 2,
          fill: false,
          pointRadius: 3,
          pointHoverRadius: 4,
          pointBackgroundColor: "#3b52a1",
        },
      ],
    },
    plugins: storeManagedPlugin ? [storeManagedPlugin] : [],
    options: {
      responsive: false,
      plugins: {
        legend: { display: false },
        title: { display: false },
        datalabels: {
          display: true,
          anchor: "end",
          align: "top",
          offset: 4,
          clamp: true,
          clip: true,
          color: "#111827",
          font: { size: 16, weight: 600 },
          formatter: (value) => {
            const numeric = typeof value === "number" ? value : Number(value);
            return Number.isFinite(numeric) ? formatCurrencyNoDecimals(numeric) : "";
          },
        },
      },
      layout: { padding: { top: 70, right: 140, bottom: 24, left: 60 } },
      scales: {
        y: {
          min: rentBounds.min,
          max: rentBounds.max,
          title: { display: true, text: "Dollars ($)" },
          ticks: { font: { size: 16, weight: 600 }, color: "#111827", padding: 8 },
          grid: { lineWidth: 1, color: "rgba(0,0,0,0.1)" },
          border: { display: true, color: "#111827" },
        },
        x: {
          offset: true,
          title: { display: true, text: "Month" },
          ticks: {
            autoSkip: false,
            maxRotation: 0,
            minRotation: 0,
            padding: 12,
            font: { size: 16, weight: 600 },
            color: "#111827",
          },
          grid: { lineWidth: 1, color: "rgba(0,0,0,0.08)" },
          border: { display: true, color: "#111827" },
        },
      },
    },
  };

  return renderChartBuffer(configuration, "image/jpeg");
}

async function renderMoMOccupancyChart(series: MoMSeries, propertyId: string): Promise<Buffer> {
  const monthsRecent = series.months.slice(0, 7);
  const dataRecent = series.occupiedPct.slice(0, 7);
  const monthsAsc = monthsRecent.slice().reverse();
  const dataAsc = dataRecent.slice().reverse();
  const labels = monthsAsc.map(formatMonthLabel);
  const data = dataAsc.map((value) => (typeof value === "number" && Number.isFinite(value) ? value : null));
  const occupancyBounds = computePaddedBounds(data, { paddingRatio: 0.2, floor: 0, ceil: 100, minRange: 2 });
  console.log("[MoM debug]", { propertyId, monthsRecent, monthsAsc, labels });
  const expectedLatestMonth = monthsRecent[0];
  const expectedLatestLabel = expectedLatestMonth ? formatMonthLabel(expectedLatestMonth) : "";
  if (!expectedLatestMonth) {
    throw new Error("Expected newest month to be available, got empty series");
  }
  if (labels[labels.length - 1] !== expectedLatestLabel) {
    throw new Error(`Expected last label ${expectedLatestLabel}, got ${labels[labels.length - 1]}`);
  }
  if (labels.length !== data.length) {
    throw new Error("MoM series length mismatch");
  }

  const storeManagedPlugin = isPittmanProperty(propertyId) ? buildStoreManagedMarkerPlugin() : null;
  const configuration: ChartConfiguration<"line", Array<number | null>, string> = {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Overall Occupancy (%)",
          data,
          borderColor: "#4a4a4a",
          backgroundColor: "#4a4a4a",
          borderWidth: 2,
          fill: false,
          pointRadius: 3,
          pointHoverRadius: 4,
          pointBackgroundColor: "#4a4a4a",
        },
      ],
    },
    plugins: storeManagedPlugin ? [storeManagedPlugin] : [],
    options: {
      responsive: false,
      plugins: {
        legend: { display: false },
        title: { display: false },
        datalabels: {
          display: true,
          anchor: "end",
          align: "top",
          offset: 4,
          color: "#111827",
          font: { size: 16, weight: 600 },
          formatter: (value) => {
            const numeric = typeof value === "number" ? value : Number(value);
            return Number.isFinite(numeric) ? formatPercentLabel(numeric) : "";
          },
        },
      },
      layout: { padding: { top: 40, right: 120, bottom: 24, left: 60 } },
      scales: {
        y: {
          min: occupancyBounds.min,
          max: occupancyBounds.max,
          title: { display: true, text: "Percent" },
          ticks: { font: { size: 16, weight: 600 }, color: "#111827", padding: 8 },
          grid: { lineWidth: 1, color: "rgba(0,0,0,0.1)" },
          border: { display: true, color: "#111827" },
        },
        x: {
          offset: true,
          title: { display: true, text: "Month" },
          ticks: {
            autoSkip: false,
            maxRotation: 0,
            minRotation: 0,
            padding: 12,
            font: { size: 16, weight: 600 },
            color: "#111827",
          },
          grid: { lineWidth: 1, color: "rgba(0,0,0,0.08)" },
          border: { display: true, color: "#111827" },
        },
      },
    },
  };

  return renderChartBuffer(configuration, "image/jpeg");
}

async function loadImageBufferFromData(data: string): Promise<Buffer | null> {
  if (!data) return null;
  try {
    if (data.startsWith("http://") || data.startsWith("https://")) {
      const res = await fetch(data);
      if (!res.ok) return null;
      const arrayBuffer = await res.arrayBuffer();
      return Buffer.from(arrayBuffer);
    }
    if (data.startsWith("data:")) {
      const base64 = data.split(",")[1];
      if (!base64) return null;
      return Buffer.from(base64, "base64");
    }
    return Buffer.from(data, "base64");
  } catch (err) {
    console.error("[flash/generate] unable to load property image", err);
    return null;
  }
}

export function buildTokenMap(msrSheet: ExcelJS.Worksheet, delinquenciesSheet: ExcelJS.Worksheet): TokenMap {
  const propertyDisplayName = readString(msrSheet, "K1", "Property display name (MSR!K1)");
  const [facilityCode, facilityShortName] = deriveFacilitySegments(propertyDisplayName);
  const asOfDateCell = readDate(msrSheet, "A3", "As-of date (MSR!A3)");

  const mtdRentals = readNumber(msrSheet, "E61", "MTD rentals (MSR!E61)");
  const netsqftmtd = readNumber(msrSheet, "E70", "Net SQ FT Activity\t(MSR!E70)");
  const dailyRentals = readNumber(msrSheet, "D61", "Daily rentals (MSR!D61)");
  const dailyReservations = readNumber(msrSheet, "D65", "Daily reservations (MSR!D65)");
  const rybtmi = readNumber(msrSheet, "F61", "YTD move-ins (MSR!F61)");
  const mtdVacates = readNumber(msrSheet, "E62", "MTD vacates (MSR!E62)");
  const dailyVacates = readNumber(msrSheet, "D62", "Daily vacates (MSR!D62)");
  const mtdNetRentals = readNumber(msrSheet, "E63", "MTD net rentals (MSR!E63)");
  const webLeadsMtd = readNumber(msrSheet, "M47", "Web leads MTD (MSR!M47)");
  const walkInLeadsMtd = readNumber(msrSheet, "M48", "Walk-in leads MTD (MSR!M48)");
  const phoneLeadsMtd = readNumber(msrSheet, "M49", "Phone leads MTD (MSR!M49)");
  const otherLeadsMtd = readNumber(msrSheet, "M50", "Other leads MTD (MSR!M50)");
  const leadsMtd = webLeadsMtd + walkInLeadsMtd + phoneLeadsMtd + otherLeadsMtd;
  const convRaw = readNumber(msrSheet, "O10", "Lead conversion % (MSR!O10)");
  const conv = formatPercent(convRaw);

  const totalRsf = readNumber(msrSheet, "M44", "Total RSF (MSR!M44)");
  const occRsf = readNumber(msrSheet, "M41", "Occupied RSF (MSR!M41)");
  const rsfOccPct = formatToTwo(readNumber(msrSheet, "N41", "RSF occupancy % (MSR!N41)"));
  const occUnits = readNumber(msrSheet, "K41", "Occupied units (MSR!K41)");
  const pmOccUnits = occUnits - mtdNetRentals;
  const coverage = formatPercent(readNumber(msrSheet, "N14", "Coverage enrollment % (MSR!N14)"));

  const totalArAll = formatToTwo(readNumber(msrSheet, "F47", "AR Balance (All leases) (MSR!F47)"));
  const ar30Plus = formatToTwo(sumArOverDays(delinquenciesSheet, 30));
  const ar60Plus = formatToTwo(sumArOverDays(delinquenciesSheet, 60));
  const arOver30Pct = formatPercent(totalArAll > 0 ? ar30Plus / totalArAll : 0);
  const arOver60Pct = formatPercent(totalArAll > 0 ? ar60Plus / totalArAll : 0);

  const occPctSqft = formatToTwo(readNumber(msrSheet, "E8", "SQ FT occupancy % (MSR!E8)"));
  const occPctSpaces = formatToTwo(readNumber(msrSheet, "E9", "Spaces occupancy % (MSR!E9)"));
  const occPctEcon = formatToTwo(readNumber(msrSheet, "E10", "Economic occupancy % (MSR!E10)"));

  const arAgingTokens: Record<string, number> = {
    ARAGING_0_10: formatToTwo(readNumber(msrSheet, "L72", "AR Aging 0-10 (MSR!L72)")),
    ARAGING_11_30: formatToTwo(readNumber(msrSheet, "L73", "AR Aging 11-30 (MSR!L73)")),
    ARAGING_31_60: formatToTwo(readNumber(msrSheet, "L74", "AR Aging 31-60 (MSR!L74)")),
    ARAGING_61_90: formatToTwo(readNumber(msrSheet, "L75", "AR Aging 61-90 (MSR!L75)")),
    ARAGING_91_120: formatToTwo(readNumber(msrSheet, "L76", "AR Aging 91-120 (MSR!L76)")),
    ARAGING_121_180: formatToTwo(readNumber(msrSheet, "L77", "AR Aging 121-180 (MSR!L77)")),
    ARAGING_181_360: formatToTwo(readNumber(msrSheet, "L78", "AR Aging 181-360 (MSR!L78)")),
    ARAGING_361_PLUS: formatToTwo(readNumber(msrSheet, "L79", "AR Aging 361+ (MSR!L79)")),
  };

  const projRent = readNumber(msrSheet, "L32", "Projected rent (MSR!L32)");
  const projRentPerSf = readNumber(msrSheet, "K32", "Projected rent per SF (MSR!K32)");
  const gpr = readNumber(msrSheet, "L26", "Gross potential rent (MSR!L26)");
  const gprPerSf = readNumber(msrSheet, "K26", "GPR per SF (MSR!K26)");
  const grossPotRentSf = readNumber(msrSheet, "N26", "Gross potential rent per SF (MSR!N26)");
  const grossVacantRevenue = readNumber(msrSheet, "I28", "Gross Vacant Revenue (MSR!I28)");
  const avgSfVaca = readNumber(msrSheet, "L38", "Average SF Vacant (MSR!L38)");
  const econOccPct = formatToTwo(readNumber(msrSheet, "J32", "Economic occupancy % (MSR!J32)"));
  const effPotRent = projRent + grossVacantRevenue;
  const effRentSf = totalRsf > 0 ? effPotRent / totalRsf : 0;

  const budgetLineKeys = [
    "RENTINC",
    "DISC",
    "TOTRENINC",
    "ADMFE",
    "LATEFEE",
    "INSURT",
    "OTHER",
    "RETSAL",
    "TOTALINC",
    "ADVER",
    "AUCT",
    "CAM",
    "CCM",
    "DUES",
    "FIRE",
    "INSUREXP",
    "PERM",
    "MGMT",
    "MGMSTF",
    "OFFSUP",
    "PROF",
    "REP",
    "RETPROD",
    "SEC",
    "SOFT",
    "SUPP",
    "INTER",
    "UTIL",
    "TOTALPROP",
    "OTHEREXP",
    "TOTOTHEREXP",
    "TOTEXP",
    "NETINC",
  ];
  const budgetTokenSuffixes = ["CM", "PTD", "VAR", "VARPER", "YTD", "YTDBUD", "YTDVAR", "YTDVARPER"] as const;
  const budgetTokens: Record<string, string> = {};

  budgetLineKeys.forEach((base, idx) => {
    const placeholderCell = `Z${100 + idx}`; // TODO: map ${base} tokens to the correct MSR cells once available
    const placeholderValue = readNumberOrZero(msrSheet, placeholderCell, `${base} placeholder value`);
    budgetTokenSuffixes.forEach((suffix) => {
      const tokenKey = `${base}${suffix}`;
      const formatted =
        suffix.endsWith("VARPER") || suffix === "VARPER" ? formatPercentDash(placeholderValue) : formatCurrencyDash(placeholderValue);
      budgetTokens[tokenKey] = formatted;
    });
  });

  return {
    PROPERTYDISPLAYNAME: propertyDisplayName,
    FACILITYCODE: facilityCode,
    FACILITYSHORTNAME: facilityShortName,
    ASOFDATE: formatDate(asOfDateCell),
    MTDRENTALS: mtdRentals,
    DAILYRENTALS: dailyRentals,
    DAILYRES: dailyReservations,
    RYTBMI: rybtmi,
    LEADSMTD: leadsMtd,
    CONV: conv,
    MTDVACATES: mtdVacates,
    DAILYVACATES: dailyVacates,
    MTDNETRENTALS: mtdNetRentals,
    TOTALRSF: formatNumberWithCommas(totalRsf),
    OCCRSF: formatNumberWithCommas(occRsf),
    RSFOCCPCT: formatPercent(rsfOccPct),
    OCCUNITS: occUnits,
    COVERAGE: coverage,
    PMOCCUNITS: pmOccUnits,
    MOMOCCGROWTHPCT: formatPercent(0),
    TOTALARALL: formatCurrency(totalArAll),
    AR30PLUS: formatCurrency(ar30Plus),
    AROVER30DAYSPCT: arOver30Pct,
    AROVER60DAYSPCT: arOver60Pct,
    NETSQFTACTMTD: formatNumberWithCommas(netsqftmtd),
    PROJRENT: formatCurrency(projRent),
    PROJRENTPERSF: formatCurrency(projRentPerSf),
    PROJRENTMOMPCT: formatPercent(0),
    GROSSPOTRENT: formatCurrency(gpr),
    GROSSPOTSFT: formatCurrency(grossPotRentSf),
    GROSSPOTRENTSF: formatCurrency(grossPotRentSf), // alias for template variations
    GPRPERSF: formatCurrency(gprPerSf),
    GPRMOMPCT: formatPercent(0),
    EFFPOTRENT: formatCurrency(effPotRent),
    EFFRENTSF: formatCurrency(effRentSf),
    EFFRENTPERSF: formatCurrency(effRentSf), // alias for template variations
    AVGSFVACA: formatCurrency(avgSfVaca),
    AVGRENTVACANTSF: formatCurrency(avgSfVaca), // alias for template variations
    ECONOCCPCT: formatPercent(econOccPct),
    OCCPCT_SQFT: occPctSqft,
    OCCPCT_SPACES: occPctSpaces,
    OCCPCT_ECON: occPctEcon,
    ...arAgingTokens,
    RENTALSBYMONTHSERIES: [],
    VACATESBYMONTHSERIES: [],
    RSFOCCUPANCYBYMONTHSERIES: [],
    PROJECTEDRENTALREVENUESERIES: [],
    FACILITYOPENDATE: "",
    ...budgetTokens,
  };
}

function deriveFacilitySegments(input: string): [string, string] {
  if (!input.includes(" - ")) {
    return [input, input];
  }
  const [code, name] = input.split(" - ");
  return [code?.trim() ?? input, name?.trim() ?? input];
}

function readString(sheet: ExcelJS.Worksheet, address: string, label: string): string {
  const value = normalizeCellValue(sheet.getCell(address).value);
  if (value == null) {
    throw new Error(`${label} is missing.`);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) throw new Error(`${label} is empty.`);
    return trimmed;
  }
  if (typeof value === "number" || value instanceof Date || typeof value === "boolean") {
    return String(value);
  }
  throw new Error(`${label} is invalid.`);
}

function readNumber(sheet: ExcelJS.Worksheet, address: string, label: string): number {
  const value = normalizeCellValue(sheet.getCell(address).value);
  if (value == null) {
    throw new Error(`${label} is missing.`);
  }
  const numeric = coerceNumber(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(`${label} is not a number.`);
  }
  return numeric;
}

function readNumberOrZero(sheet: ExcelJS.Worksheet, address: string, label: string): number {
  try {
    return readNumber(sheet, address, label);
  } catch (err) {
    console.warn(`[flash-report] ${label} unavailable at ${address}; defaulting to 0`, err);
    return 0;
  }
}

function readDate(sheet: ExcelJS.Worksheet, address: string, label: string): Date {
  const value = normalizeCellValue(sheet.getCell(address).value);
  if (value == null) {
    throw new Error(`${label} is missing.`);
  }
  if (value instanceof Date) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    return excelSerialDateToJsDate(value);
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  throw new Error(`${label} is not a valid date.`);
}

function sumArOverDays(sheet: ExcelJS.Worksheet, minDays: number): number {
  let total = 0;
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // header row
    const days = coerceNumber(normalizeCellValue(row.getCell("D").value));
    const amount = coerceNumber(normalizeCellValue(row.getCell("E").value));
    if (Number.isFinite(days) && Number.isFinite(amount) && days >= minDays) {
      total += amount;
    }
  });
  return total;
}

function formatToTwo(value: number): number {
  if (!Number.isFinite(value)) return value;
  const factor = 100;
  return Math.round(value * factor) / factor;
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "";
  return `${formatToTwo(value)}%`;
}

function formatPercentDash(value: number): string {
  if (!Number.isFinite(value)) return "";
  if (value === 0) return "-";
  return formatPercent(value);
}

function formatCurrency(value: number): string {
  if (!Number.isFinite(value)) return "";
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatCurrencyDash(value: number): string {
  if (!Number.isFinite(value)) return "";
  if (value === 0) return "-";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatNumberWithCommas(value: number): string {
  if (!Number.isFinite(value)) return "";
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function normalizeCellValue(value: ExcelJS.CellValue): ExcelJS.CellValue | null {
  if (value && typeof value === "object" && "result" in value && value.result != null) {
    return value.result as ExcelJS.CellValue;
  }
  return value ?? null;
}

function coerceNumber(value: ExcelJS.CellValue | null): number {
  if (value == null) return 0;
  if (typeof value === "number") return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    if (!value.trim()) return 0;
    const negative = /^\(.*\)$/.test(value);
    const cleaned = value.replace(/[,$\s]/g, "").replace(/%/g, "");
    const parsed = Number(cleaned);
    if (!Number.isFinite(parsed)) return Number.NaN;
    return negative ? -parsed : parsed;
  }
  return Number.NaN;
}

function excelSerialDateToJsDate(serial: number): Date {
  const epoch = new Date(Date.UTC(1899, 11, 30));
  const date = new Date(epoch.getTime() + serial * 24 * 60 * 60 * 1000);
  return date;
}

function formatDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const year = date.getFullYear();
  return `${month}/${day}/${year}`;
}

function formatPercentLabel(value: number): string {
  if (!Number.isFinite(value)) return "";
  const formatted = Number.isInteger(value) ? value.toString() : value.toFixed(1);
  return `${formatted}%`;
}

function formatCurrencyNoDecimals(value: number): string {
  if (!Number.isFinite(value)) return "";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

const normalizePropertyKey = (value: string): string => value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
const isPittmanProperty = (propertyId: string): boolean => {
  const key = normalizePropertyKey(propertyId);
  return key === "PITTMAN" || key === "PROP_PITTMAN";
};

function buildStoreManagedMarkerPlugin(targetLabel = "Nov 25", text = "STORE Managed"): Plugin<"line"> {
  return {
    id: "store-managed-marker",
    afterDraw(chart) {
      const labels = chart.data.labels;
      if (!Array.isArray(labels)) return;
      const idx = labels.indexOf(targetLabel);
      if (idx === -1) return;
      const xScale = chart.scales.x;
      if (!xScale) return;
      const x = xScale.getPixelForValue(idx);
      const yScale = chart.scales.y;
      const dataset = chart.data.datasets?.[0];
      const rawValue = dataset?.data?.[idx];
      const yVal = typeof rawValue === "number" ? rawValue : Number(rawValue);
      if (!Number.isFinite(yVal) || !yScale) return;
      const yLine = yScale.getPixelForValue(yVal);
      const textY = yLine + 16;
      const lineTop = yLine + 2;
      const lineBottom = yLine + 14;
      const { ctx } = chart;
      ctx.save();
      ctx.strokeStyle = "#4b5563";
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.moveTo(x, lineTop);
      ctx.lineTo(x, lineBottom);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.font = "600 14px Inter";
      ctx.fillStyle = "#374151";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(text, x, textY);
      ctx.restore();
    },
  };
}

function scrubHiddenCharactersFromZip(zip: PizZip): void {
  const xmlPaths = Object.keys(zip.files).filter((filename) => filename.startsWith("ppt/") && filename.endsWith(".xml") && !filename.startsWith("ppt/embeddings/"));
  for (const filename of xmlPaths) {
    const file = zip.file(filename);
    if (!file) continue;
    const original = file.asText();
    const sanitized = normalizeTemplateXml(original);
    if (sanitized !== original) {
      zip.file(filename, sanitized);
    }
  }
}

const TOKEN_SPAN_PATTERN = /\{\{[\s\S]*?\}\}/g;
const XML_TAG_PATTERN = /<[^>]+>/g;

function normalizeTemplateXml(xml: string): string {
  const withoutHidden = stripHiddenTokenCharacters(xml);
  return withoutHidden.replace(TOKEN_SPAN_PATTERN, (segment) => {
    const withoutTags = segment.replace(XML_TAG_PATTERN, "");
    const tokenText = withoutTags.replace(/[{}]/g, "").replace(/\s+/g, "");
    if (!tokenText) return segment;
    return `{{${tokenText}}}`;
  });
}

async function renderTokensIntoZip(zip: PizZip, tokens: TokenMap): Promise<Buffer> {
  const normalizedTokens: Record<string, string> = {};
  for (const [key, value] of Object.entries(tokens)) {
    const normalizedKey = normalizeKey(key);
    if (!normalizedKey) continue;
    if (value == null) {
      normalizedTokens[normalizedKey] = "";
      continue;
    }
    normalizedTokens[normalizedKey] = typeof value === "number" ? String(value) : String(value);
  }

  const pptXmlPaths = Object.keys(zip.files).filter(
    (filename) => filename.startsWith("ppt/") && filename.endsWith(".xml") && !filename.startsWith("ppt/embeddings/"),
  );
  for (const filename of pptXmlPaths) {
    const file = zip.file(filename);
    if (!file) continue;
    const original = file.asText();
    const replaced = replaceTokensInContent(original, normalizedTokens);
    if (replaced !== original) {
      zip.file(filename, replaced);
    }
  }

  await processEmbeddedWorkbooks(zip, normalizedTokens);

  return zip.generate({ type: "nodebuffer" });
}

function replaceTokensInContent(content: string, normalizedTokens: Record<string, string>): string {
  return content.replace(/{{\s*([^{}]+?)\s*}}/g, (match, rawKey) => {
    const key = normalizeKey(String(rawKey));
    if (!key) return "";
    const value = normalizedTokens[key];
    return value ?? "";
  });
}

async function processEmbeddedWorkbooks(zip: PizZip, normalizedTokens: Record<string, string>): Promise<void> {
  const embeddedPaths = Object.keys(zip.files).filter(
    (p) => p.startsWith("ppt/embeddings/") && p.endsWith(".xlsx"),
  );

  for (const embeddedPath of embeddedPaths) {
    const file = zip.file(embeddedPath);
    if (!file) continue;
    const buffer =
      typeof file.asUint8Array === "function"
        ? file.asUint8Array()
        : file.asNodeBuffer
          ? file.asNodeBuffer()
          : new Uint8Array(Buffer.from(file.asBinary(), "binary"));
    const workbookZip = new PizZip(buffer);
    const innerXmlPaths = Object.keys(workbookZip.files).filter(
      (innerPath) => innerPath.startsWith("xl/") && innerPath.endsWith(".xml"),
    );
    let mutated = false;
    for (const innerPath of innerXmlPaths) {
      const workbookFile = workbookZip.file(innerPath);
      if (!workbookFile) continue;
      const original = workbookFile.asText();
      const replaced = replaceTokensInContent(original, normalizedTokens);
      if (replaced !== original) {
        workbookZip.file(innerPath, replaced);
        mutated = true;
      }
    }
    if (mutated) {
      const updatedBuffer = workbookZip.generate({ type: "uint8array" });
      zip.file(embeddedPath, updatedBuffer);
    }
  }
}

function normalizeKey(key: string): string {
  return stripHiddenTokenCharacters(key).replace(/\s+/g, "").toUpperCase();
}
