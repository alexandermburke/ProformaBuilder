import { NextRequest, NextResponse } from 'next/server';
import {
  isWorkbookFilename,
  profileWorkbook,
  sanitizeStoragePathPart,
  type LakehouseTemplateType,
} from '@/lib/lakehouse/proformaLakehouse';
import { getSupabaseAdmin } from '@/server/supabase';

export const runtime = 'nodejs';

type UploadInsertRow = {
  template_type: string;
  property_name: string | null;
  report_month: string | null;
  normalized_family: string | null;
  original_file_name: string;
  storage_bucket: string;
  storage_path: string;
  source_format: string;
  raw_row_count: number;
  normalized_row_count: number;
  status: string;
  sheet_names: string[];
  detected_sections: string[];
  preview_payload: Record<string, unknown>;
};

function parseTemplateType(value: FormDataEntryValue | null): LakehouseTemplateType {
  const raw = String(value ?? 'extra-space').trim().toLowerCase();
  switch (raw) {
    case 'public-storage':
    case 'extra-space':
    case 'cubesmart':
    case 'wentworth-results':
    case 'storquest':
    case 'custom-other':
      return raw;
    default:
      return 'custom-other';
  }
}

function buildStoragePath(templateType: string, reportMonth: string | null, originalFileName: string): string {
  const monthPart = reportMonth ? sanitizeStoragePathPart(reportMonth) : 'undated';
  const safeName = sanitizeStoragePathPart(originalFileName || 'upload.xlsx');
  return `${templateType}/${monthPart}/${Date.now()}-${safeName}`;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const form = await request.formData();
  const file = form.get('file');
  const templateType = parseTemplateType(form.get('templateType'));
  const propertyName = String(form.get('propertyName') ?? '').trim() || null;
  const reportMonthRaw = String(form.get('reportMonth') ?? '').trim() || null;

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 });
  }

  if (!isWorkbookFilename(file.name)) {
    return NextResponse.json(
      {
        error:
          'This intake now expects operator financial workbooks (.xlsx, .xls, .xlsm). Upload the same workbook family you would use as raw input for P-Builder.',
      },
      { status: 400 },
    );
  }

  try {
    const supabase = getSupabaseAdmin();
    const buffer = Buffer.from(await file.arrayBuffer());
    const storagePath = buildStoragePath(templateType, reportMonthRaw, file.name);

    const profile = profileWorkbook(buffer);

    const uploadRecord: UploadInsertRow = {
      template_type: templateType,
      property_name: propertyName,
      report_month: reportMonthRaw ? `${reportMonthRaw}-01` : null,
      normalized_family: 'operator_workbook',
      original_file_name: file.name,
      // Raw workbook storage is intentionally disabled in this first slice so
      // profiling is not blocked by bucket configuration issues.
      storage_bucket: 'disabled',
      storage_path: storagePath,
      source_format: 'workbook',
      raw_row_count: profile.totalNonEmptyRows,
      normalized_row_count: profile.detectedSections.length,
      status: 'profiled',
      sheet_names: profile.sheetNames,
      detected_sections: profile.detectedSections,
      preview_payload: {
        workbookTitle: profile.workbookTitle,
        sheetCount: profile.sheetNames.length,
        sheetProfiles: profile.sheetProfiles,
      },
    };

    const { data: insertedUpload, error: uploadInsertError } = await supabase
      .from('proforma_uploads')
      .insert(uploadRecord)
      .select('id, created_at')
      .single();
    if (uploadInsertError) throw uploadInsertError;

    if (profile.sheetProfiles.length > 0) {
      const sectionRows = profile.sheetProfiles.map((sheetProfile, index) => ({
        upload_id: insertedUpload.id,
        sheet_name: sheetProfile.sheetName,
        section_key: sheetProfile.sectionKey,
        sheet_order: index,
        non_empty_row_count: sheetProfile.nonEmptyRowCount,
        preview_rows: sheetProfile.previewRows,
      }));
      const { error: sectionInsertError } = await supabase.from('proforma_workbook_sections').insert(sectionRows);
      if (sectionInsertError) throw sectionInsertError;
    }

    return NextResponse.json({
      uploadId: insertedUpload.id,
      createdAt: insertedUpload.created_at,
      templateType,
      propertyName,
      reportMonth: reportMonthRaw,
      originalFileName: file.name,
      storageBucket: 'disabled',
      storagePath,
      rawRowCount: profile.totalNonEmptyRows,
      normalizedRowCount: profile.detectedSections.length,
      workbookTitle: profile.workbookTitle,
      sheetNames: profile.sheetNames,
      detectedSections: profile.detectedSections,
      sheetProfiles: profile.sheetProfiles,
    });
  } catch (error) {
    console.error('[finance/proforma-lakehouse/upload] failed', error);
    const message = error instanceof Error ? error.message : 'Unable to store proforma lakehouse upload.';
    const errorCode =
      typeof error === 'object' && error !== null && 'code' in error ? String((error as { code?: unknown }).code ?? '') : '';
    const schemaHint =
      errorCode === 'PGRST205' || message.includes('relation') || message.includes('does not exist')
        ? ' Run supabase/proforma_lakehouse_schema.sql in the Supabase SQL editor first.'
        : '';
    return NextResponse.json({ error: `${message}${schemaHint}` }, { status: 500 });
  }
}
