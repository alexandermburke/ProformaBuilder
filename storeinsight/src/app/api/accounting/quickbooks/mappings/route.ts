/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

/**
 * Saves an explicit vendor or account mapping for one property, for the case where the
 * FacilIQ text will never match the QuickBooks record by name.
 *
 * The usual fix for `needs_mapping` is to add the vendor or account in QuickBooks and hit
 * retry, which the cache picks up on the next attempt. This route exists for the cases
 * where that is not possible, and requires the QuickBooks id explicitly so nothing is
 * inferred.
 */

import { NextResponse, type NextRequest } from 'next/server';
import {
  QUICKBOOKS_PROPERTY_CODES,
  type QuickBooksPropertyCode,
} from '@/lib/accounting/faciliqInvoiceImport/properties';
import type { QuickBooksMappingResponse } from '@/lib/accounting/quickbooks/apiContract';
import { setManualMapping } from '@/lib/accounting/quickbooks/resolveRefs';

export const runtime = 'nodejs';

const isPropertyCode = (value: unknown): value is QuickBooksPropertyCode =>
  typeof value === 'string' && (QUICKBOOKS_PROPERTY_CODES as readonly string[]).includes(value);

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = (await request.json().catch(() => ({}))) as {
    propertyCode?: string;
    kind?: string;
    sourceValue?: string;
    quickBooksId?: string;
    label?: string;
  };

  if (!isPropertyCode(body.propertyCode)) {
    return NextResponse.json(
      { error: `Expected propertyCode to be one of ${QUICKBOOKS_PROPERTY_CODES.join(', ')}.` },
      { status: 400 },
    );
  }
  if (body.kind !== 'vendor' && body.kind !== 'account') {
    return NextResponse.json({ error: 'Expected kind to be "vendor" or "account".' }, { status: 400 });
  }
  const sourceValue = typeof body.sourceValue === 'string' ? body.sourceValue.trim() : '';
  const quickBooksId = typeof body.quickBooksId === 'string' ? body.quickBooksId.trim() : '';
  if (!sourceValue || !quickBooksId) {
    return NextResponse.json(
      { error: 'Expected both sourceValue (the FacilIQ text) and quickBooksId.' },
      { status: 400 },
    );
  }

  try {
    await setManualMapping({
      propertyCode: body.propertyCode,
      kind: body.kind,
      sourceValue,
      quickBooksId,
      label: typeof body.label === 'string' && body.label.trim() ? body.label.trim() : sourceValue,
    });
    return NextResponse.json({
      saved: true,
      propertyCode: body.propertyCode,
      kind: body.kind,
      sourceValue,
    } satisfies QuickBooksMappingResponse);
  } catch (err) {
    console.error('[quickbooks/mappings] save failed', { propertyCode: body.propertyCode }, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unable to save that mapping.' },
      { status: 500 },
    );
  }
}
