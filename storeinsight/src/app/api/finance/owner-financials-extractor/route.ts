/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

import { NextResponse, type NextRequest } from 'next/server';
import {
  DEFAULT_MANAGED_BY,
  MANAGED_BY_OPTIONS,
  XLSX_MIME_TYPE,
} from '@/lib/finance/ownerFinancials/constants';
import { processWorkbook } from '@/lib/finance/ownerFinancials/processWorkbook';
import type { OwnerFinancialsExtractResponse } from '@/lib/finance/ownerFinancials/clientReport';
import type { ManagedBy } from '@/lib/finance/ownerFinancials/types';

export const runtime = 'nodejs';

const MAX_BYTES = 25 * 1024 * 1024;

function isManagedBy(value: string): value is ManagedBy {
  return (MANAGED_BY_OPTIONS as readonly string[]).includes(value);
}

/**
 * Extracts an owner financial workbook into a datapack.
 *
 * Stateless on purpose: one upload in, one workbook out, so there is no job
 * store that can hand back a datapack other than the one the operator just
 * generated. The log is returned alongside the artifact because a partially
 * extracted workbook is still useful and the operator has to be able to see
 * which sheets were skipped.
 */
export async function POST(request: NextRequest) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Could not read the upload.' }, { status: 400 });
  }

  const upload = form.getAll('files').find((entry) => entry instanceof Blob);
  if (!(upload instanceof Blob)) {
    return NextResponse.json(
      { error: 'Upload an owner financial workbook (.xlsx) first.' },
      { status: 400 },
    );
  }

  const blobWithName = upload as Blob & { name?: string };
  const sourceName =
    typeof blobWithName.name === 'string' && blobWithName.name
      ? blobWithName.name
      : 'owner-financials.xlsx';

  if (!/\.xlsx$/i.test(sourceName)) {
    return NextResponse.json(
      { error: 'Upload must be an .xlsx owner financial workbook.' },
      { status: 400 },
    );
  }

  if (upload.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `Workbook is larger than ${Math.floor(MAX_BYTES / (1024 * 1024))} MB.` },
      { status: 413 },
    );
  }

  const propertyNameRaw = form.get('propertyName');
  const propertyName = typeof propertyNameRaw === 'string' ? propertyNameRaw.trim() : '';
  if (!propertyName) {
    return NextResponse.json({ error: 'Enter a property name.' }, { status: 400 });
  }

  const managedByRaw = form.get('managedBy');
  const managedByValue = typeof managedByRaw === 'string' ? managedByRaw : '';
  let managedBy: ManagedBy = DEFAULT_MANAGED_BY;
  if (managedByValue) {
    if (!isManagedBy(managedByValue)) {
      return NextResponse.json({ error: 'Unrecognized management company.' }, { status: 400 });
    }
    managedBy = managedByValue;
  }

  try {
    const arrayBuffer = await upload.arrayBuffer();
    const result = await processWorkbook({
      fileBytes: arrayBuffer,
      filename: sourceName,
      propertyName,
      managedBy,
    });

    const payload: OwnerFinancialsExtractResponse = {
      log: result.log,
      summary: result.summary,
      managedBy: result.managedBy,
    };

    if (result.outputBytes && result.outputFilename) {
      payload.artifactName = result.outputFilename;
      payload.artifactMimeType = XLSX_MIME_TYPE;
      payload.artifactBase64 = result.outputBytes.toString('base64');
    }

    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Unable to process the uploaded workbook.',
      },
      { status: 400 },
    );
  }
}
