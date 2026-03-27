import fs from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import PizZip from 'pizzip';
import * as XLSX from 'xlsx';

export type ProformaCoaCatalogEntry = {
  standardizedCoaName: string;
  topTier: string | null;
  header: string | null;
  accountType: string | null;
};

export const PUBLIC_PROFORMA_TEMPLATE_PATH = path.join(process.cwd(), 'templates', 'PublicProformaTemplate3.18.xlsx');
export const PUBLIC_PROFORMA_MASTER_TEMPLATE_PATH = path.join(
  process.cwd(),
  'templates',
  'PublicProformaTemplate3.18.master.xlsx',
);
export const PROFORMA_RUN_ID_PLACEHOLDER = '__RUN_ID__';
export const PROFORMA_RUN_ID_DEFINED_NAME = 'proforma_run_id';
export const PROFORMA_EXCEL_CONNECTION_GUIDE_URL = '/finance/proforma-excel-connection.md';

let cachedCoaCatalog: ProformaCoaCatalogEntry[] | null = null;

function cleanCell(value: unknown): string {
  return String(value ?? '')
    .replace(/\u00A0/g, ' ')
    .replace(/\r?\n/g, ' ')
    .trim();
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function ensureWorkbookDefinedName(workbookXml: string): string {
  const definedNameTag = `<definedName name="${PROFORMA_RUN_ID_DEFINED_NAME}">'DB Config'!$B$2</definedName>`;
  if (workbookXml.includes(`name="${PROFORMA_RUN_ID_DEFINED_NAME}"`)) {
    return workbookXml;
  }
  if (workbookXml.includes('<definedNames>')) {
    return workbookXml.replace('</definedNames>', `${definedNameTag}</definedNames>`);
  }
  if (workbookXml.includes('<calcPr')) {
    return workbookXml.replace('<calcPr', `<definedNames>${definedNameTag}</definedNames><calcPr`);
  }
  return workbookXml.replace('</workbook>', `<definedNames>${definedNameTag}</definedNames></workbook>`);
}

function buildExcelFileName(propertyName: string | null, runId: string): string {
  const safePropertyName = (propertyName ?? 'property')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return `Public_Proforma_${safePropertyName || 'property'}_${runId}.xlsx`;
}

function stampPlaceholderInZipBuffer(templateBuffer: Buffer, runId: string): Buffer {
  const zip = new PizZip(templateBuffer);
  let replaced = false;

  Object.keys(zip.files).forEach((fileName) => {
    if (!/\.(xml|rels)$/i.test(fileName)) return;
    const file = zip.file(fileName);
    if (!file) return;
    const contents = file.asText();
    if (!contents.includes(PROFORMA_RUN_ID_PLACEHOLDER)) return;
    zip.file(fileName, contents.replaceAll(PROFORMA_RUN_ID_PLACEHOLDER, runId));
    replaced = true;
  });

  const workbookXml = zip.file('xl/workbook.xml')?.asText();
  if (workbookXml) {
    zip.file('xl/workbook.xml', ensureWorkbookDefinedName(workbookXml));
  }

  if (!replaced) {
    throw new Error(
      `Workbook template is missing the ${PROFORMA_RUN_ID_PLACEHOLDER} placeholder on the DB Config sheet.`,
    );
  }

  return Buffer.from(zip.generate({ type: 'uint8array' }));
}

async function buildFallbackWorkbookBuffer(runId: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(PUBLIC_PROFORMA_TEMPLATE_PATH);

  const existingSheet = workbook.getWorksheet('DB Config');
  if (existingSheet) {
    workbook.removeWorksheet(existingSheet.id);
  }

  const configSheet = workbook.addWorksheet('DB Config');
  configSheet.state = 'veryHidden';
  configSheet.getCell('A1').value = 'Setting';
  configSheet.getCell('B1').value = 'Value';
  configSheet.getCell('A2').value = 'Run ID';
  configSheet.getCell('B2').value = PROFORMA_RUN_ID_PLACEHOLDER;
  configSheet.getCell('A3').value = 'Guide URL';
  configSheet.getCell('B3').value = PROFORMA_EXCEL_CONNECTION_GUIDE_URL;

  const workbookBuffer = (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
  return stampPlaceholderInZipBuffer(Buffer.from(workbookBuffer), runId);
}

export async function loadPublicTemplateCoaCatalog(
  templatePath = PUBLIC_PROFORMA_TEMPLATE_PATH,
): Promise<ProformaCoaCatalogEntry[]> {
  if (cachedCoaCatalog && templatePath === PUBLIC_PROFORMA_TEMPLATE_PATH) {
    return cachedCoaCatalog;
  }

  const workbook = XLSX.readFile(templatePath, { cellDates: true });
  const sheet = workbook.Sheets['COA Translation'];
  if (!sheet) {
    throw new Error('Public proforma template is missing the COA Translation sheet.');
  }

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false,
  });

  const seen = new Set<string>();
  const catalog: ProformaCoaCatalogEntry[] = [];

  for (let index = 1; index < rows.length; index += 1) {
    const row = Array.isArray(rows[index]) ? rows[index] : [];
    const standardizedCoaName = cleanCell(row[1]);
    if (!standardizedCoaName) continue;

    const normalized = normalizeKey(standardizedCoaName);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);

    catalog.push({
      standardizedCoaName,
      topTier: cleanCell(row[2]) || null,
      header: cleanCell(row[3]) || null,
      accountType: cleanCell(row[4]) || null,
    });
  }

  catalog.sort((left, right) => left.standardizedCoaName.localeCompare(right.standardizedCoaName));

  if (templatePath === PUBLIC_PROFORMA_TEMPLATE_PATH) {
    cachedCoaCatalog = catalog;
  }

  return catalog;
}

export async function buildPublicProformaWorkbookExport(runId: string, propertyName: string | null): Promise<{
  buffer: Buffer;
  fileName: string;
}> {
  try {
    const masterTemplate = await fs.readFile(PUBLIC_PROFORMA_MASTER_TEMPLATE_PATH);
    return {
      buffer: stampPlaceholderInZipBuffer(masterTemplate, runId),
      fileName: buildExcelFileName(propertyName, runId),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to read the Public master template.';
    if (!message.includes('ENOENT')) {
      throw error;
    }
  }

  return {
    buffer: await buildFallbackWorkbookBuffer(runId),
    fileName: buildExcelFileName(propertyName, runId),
  };
}
