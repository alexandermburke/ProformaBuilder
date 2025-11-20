import fs from 'fs/promises';
import path from 'path';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';

export type BuildFlashOptions = {
  propertyId?: string;
  reportDate?: string;
  templateName?: string;
};

export class TemplateNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateNotFoundError';
  }
}

export class TemplateRenderError extends Error {
  details?: string[];
  fallbackBuffer?: Buffer;
  constructor(message: string, details?: string[]) {
    super(message);
    this.name = 'TemplateRenderError';
    this.details = details;
  }
}

export async function buildFlashReportPptx(
  msrBuffer: Buffer,
  options: BuildFlashOptions,
): Promise<Buffer> {
  const { templateName = 'FLASHTEMPLATE' } = options;

  const parseNumeric = (value: unknown): number | null => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string') return null;
    const cleaned = value.replace(/[^0-9.-]/g, '');
    const numeric = Number(cleaned);
    return Number.isFinite(numeric) ? numeric : null;
  };
  const fmtNumber = (value: number): string =>
    value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Basic token defaults so the output never shows "undefined" when source data is missing.
  // We currently only receive the MSR XLSX buffer and a couple of identifiers; a richer
  // parser can populate these later.
  const tokens: Record<string, string | number> = {
    FACILITYCODE: options.propertyId ?? '',
    FACILITYSHORTNAME: options.propertyId ?? '',
    FACILITYOPENDATE: '',
    ASOFDATE: options.reportDate ?? '',
    CURRENTDATE: new Date().toISOString().slice(0, 10),
    MTDRENTALS: 0,
    DAILYRENTALS: 0,
    LEADSMTD: 0,
    CONV: '0%',
    MTDVACATES: 0,
    DAILYVACATES: 0,
    MTDNETRENTALS: 0,
    TOTALRSF: 0,
    OCCRSF: 0,
    RSFOCCPCT: '0%',
    OCCUNITS: 0,
    COVERAGE: '0%',
    AROVER30DAYSPCT: '0%',
    AROVER60DAYSPCT: '0%',
    PROJRENT: 0,
    PROJRENTPERSF: 0,
    PROJRENTMOMPCT: '0%',
    GROSSPOTRENT: 0,
    GPRPERSF: 0,
    GPRMOMPCT: '0%',
    ECONOCCPCT: '0%',
  };

  const candidateDirs = [path.join(process.cwd(), 'templates'), path.join(process.cwd(), 'public')];
  let templatePath: string | null = null;

  for (const dir of candidateDirs) {
    const candidate = path.join(dir, `${templateName}.pptx`);
    try {
      await fs.access(candidate);
      templatePath = candidate;
      break;
    } catch {
      // keep searching other dirs
    }
  }

  if (!templatePath) {
    const foundNames: string[] = [];
    for (const dir of candidateDirs) {
      const files = await fs.readdir(dir).catch(() => []);
      foundNames.push(...files.filter((file) => file.toLowerCase().endsWith('.pptx')));
    }
    const optionsHint =
      foundNames.length > 0
        ? ` Available templates: ${foundNames.join(', ')}.`
        : ' No .pptx templates found in templates/ or public/.';
    const triedPaths = candidateDirs.map((dir) => path.join(dir, `${templateName}.pptx`)).join(' | ');
    throw new TemplateNotFoundError(`Template not found in expected locations (${triedPaths}).${optionsHint}`);
  }

  const pptxTemplate = await fs.readFile(templatePath);
  const zip = new PizZip(pptxTemplate);

  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    // Some PPT text runs bundle multiple tags together, which Docxtemplater can
    // misinterpret as duplicate delimiters. Relax the delimiter checks so valid
    // templates render instead of halting with duplicate open/close errors.
    syntax: {
      allowUnclosedTag: true,
      allowUnopenedTag: true,
    },
  });

  // Apply requested adjustments
  const grossPotentialRent = parseNumeric(tokens.GROSSPOTRENT);
  if (grossPotentialRent != null) {
    tokens.GROSSPOTRENT = fmtNumber(grossPotentialRent * 1.1);
  }

  try {
    console.info('[flash-report] rendering PPTX with tokens', tokens);
    doc.render(tokens);
  } catch (err) {
    type DocxError = { properties?: { errors?: Array<Record<string, unknown>> } };
    const docxError = err as DocxError;
    const details = Array.isArray(docxError.properties?.errors)
      ? docxError.properties.errors.map((e) => {
          const context = typeof e.context === 'string' ? e.context : '';
          const explanation =
            typeof e.explanation === 'string'
              ? e.explanation
              : typeof e.message === 'string'
                ? e.message
              : '';
          const file = typeof e.file === 'string' ? ` (${e.file})` : '';
          return `${context}${file}: ${explanation}`.trim();
        })
      : undefined;
    const renderErr = new TemplateRenderError(
      'Failed to render PPTX template. Fix placeholder syntax.',
      details,
    );
    renderErr.fallbackBuffer = pptxTemplate;
    throw renderErr;
  }

  const outBuffer: Buffer = doc.getZip().generate({ type: 'nodebuffer' });
  return outBuffer;
}
