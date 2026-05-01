import * as XLSX from 'xlsx';

export type SheetSummary = {
  name: string;
  rows: number;
  cols: number;
  preview: string[][];
};

export type WorkbookSummary = {
  filename: string;
  sheets: SheetSummary[];
};

export type DealRecommendation = 'pursue' | 'pass' | 'investigate';
export type DealConfidence = 'low' | 'medium' | 'high';

export type DealAnalysis = {
  recommendation: DealRecommendation;
  confidence: DealConfidence;
  summary: string;
  strengths: string[];
  concerns: string[];
  keyMetrics: { label: string; value: string }[];
  followUps: string[];
};

const MAX_PREVIEW_ROWS = 60;
const MAX_PREVIEW_COLS = 20;

function isRecord(u: unknown): u is Record<string, unknown> {
  return typeof u === 'object' && u !== null;
}

function stringArray(u: unknown): string[] {
  return Array.isArray(u) ? u.filter((x): x is string => typeof x === 'string') : [];
}

function coerceCell(cell: unknown): string {
  if (cell === null || cell === undefined) return '';
  if (cell instanceof Date) return cell.toISOString().slice(0, 10);
  return String(cell);
}

export function summarizeWorkbook(buffer: Buffer, filename: string): WorkbookSummary {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheets: SheetSummary[] = workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      blankrows: false,
      defval: '',
    }) as unknown[][];
    const preview = aoa
      .slice(0, MAX_PREVIEW_ROWS)
      .map((row) => row.slice(0, MAX_PREVIEW_COLS).map(coerceCell));
    const cols = aoa.reduce((max, row) => Math.max(max, row.length), 0);
    return { name, rows: aoa.length, cols, preview };
  });
  return { filename, sheets };
}

export type AnalysisPromptInputs = {
  summary?: WorkbookSummary | null;
  trackerContext?: string | null;
  notes: string;
};

export function buildAnalysisPrompt(inputs: AnalysisPromptInputs): {
  system: string;
  user: string;
} {
  const { summary, trackerContext, notes } = inputs;
  const sheetText = summary
    ? summary.sheets
        .map((s) => {
          const previewLines = s.preview.map((row) => row.join(' | ')).join('\n');
          return `### Sheet: ${s.name} (${s.rows} rows x ${s.cols} cols)\n${previewLines}`;
        })
        .join('\n\n')
    : '';

  const system = [
    'You are an investment analyst at STORE Management — a Phoenix, Arizona-based self-storage operator (https://storestoragemanagement.com) that both acquires self-storage properties and runs third-party management contracts for owners.',
    'Your job is to filter deals so business development and BI analysts do not waste time building proformas or deal packages on properties that are not worth pursuing.',
    'The deal tracker has a "Deal Type" field. Adapt your evaluation lens accordingly:',
    '- If Deal Type indicates ACQUISITION (or similar buy-side intent), evaluate cap rate vs market, basis per SF, NOI durability and growth, value-add potential, market quality, and exit risk.',
    '- If Deal Type indicates MANAGEMENT (or similar third-party management contract), evaluate operator quality of the current manager, fee economics, owner sophistication, portfolio fit with STORE\'s footprint, ramp-up runway, and termination risk.',
    '- If Deal Type is missing or ambiguous, evaluate both lenses and call this out as a follow-up.',
    'Focus on: revenue trend, occupancy, expense ratio, NOI trend, submarket strength, anomalies, data quality, and red flags.',
    'Return strict JSON matching the requested schema. Be concise and specific.',
    'Tracker fields are master-list metadata maintained by STORE; treat them as authoritative for what was logged about the deal, not as audited financials.',
    'Workbook preview values are LLM-inferred from a truncated preview, not extracted from named cells. Caveat any number whose source row is not visible.',
    'If data is insufficient to confidently say pursue or pass, recommend "investigate" and list the specific items needed in followUps.',
  ].join(' ');

  const sections: string[] = [
    'Analyze the inputs below and recommend whether STORE Management should pursue this property.',
  ];
  if (notes) sections.push(`User notes: ${notes}`);
  if (trackerContext) {
    sections.push('', '## Deal Tracker entry (master list)', trackerContext);
  }
  if (summary) {
    sections.push('', `## Uploaded workbook: ${summary.filename}`);
    sections.push('Preview of each sheet (truncated to the first rows/columns):', '', sheetText);
  }
  sections.push(
    '',
    'Respond ONLY with JSON of shape:',
    '{',
    '  "recommendation": "pursue" | "pass" | "investigate",',
    '  "confidence": "low" | "medium" | "high",',
    '  "summary": string,',
    '  "strengths": string[],',
    '  "concerns": string[],',
    '  "keyMetrics": [{"label": string, "value": string}],',
    '  "followUps": string[]',
    '}',
  );

  return { system, user: sections.join('\n') };
}

export function parseAnalysisJson(content: string): DealAnalysis | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  const rec = parsed.recommendation;
  if (rec !== 'pursue' && rec !== 'pass' && rec !== 'investigate') return null;

  const conf = parsed.confidence;
  if (conf !== 'low' && conf !== 'medium' && conf !== 'high') return null;

  const metrics = Array.isArray(parsed.keyMetrics)
    ? parsed.keyMetrics
        .filter(isRecord)
        .map((m) => ({
          label: typeof m.label === 'string' ? m.label : '',
          value: typeof m.value === 'string' ? m.value : '',
        }))
        .filter((m) => m.label && m.value)
    : [];

  return {
    recommendation: rec,
    confidence: conf,
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    strengths: stringArray(parsed.strengths),
    concerns: stringArray(parsed.concerns),
    keyMetrics: metrics,
    followUps: stringArray(parsed.followUps),
  };
}
