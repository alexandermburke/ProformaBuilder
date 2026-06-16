import { NextRequest, NextResponse } from 'next/server';
import { deleteRule, listRules, upsertRule } from './store';
import type { InvoiceRoutingRule } from '@/types/invoiceRouting';

export async function GET() {
  try {
    const data = await listRules();
    return NextResponse.json(data);
  } catch (err) {
    console.error('[invoice-routing] list rules failed', err);
    return NextResponse.json({ error: 'Unable to list routing rules' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<InvoiceRoutingRule>;
    if (!body.propertyCode || !body.propertyCode.toString().trim()) {
      return NextResponse.json({ error: 'Property code is required.' }, { status: 400 });
    }
    const saved = await upsertRule(body);
    console.info('[invoice-routing] saved routing rule', saved);
    return NextResponse.json(saved);
  } catch (err) {
    console.error('[invoice-routing] unable to save rule', err);
    const message = err instanceof Error && err.message ? err.message : 'Unable to save routing rule.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = (await req.json()) as { id?: string };
    if (!body?.id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }
    await deleteRule(body.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[invoice-routing] unable to delete rule', err);
    return NextResponse.json({ error: 'Unable to delete routing rule.' }, { status: 400 });
  }
}
