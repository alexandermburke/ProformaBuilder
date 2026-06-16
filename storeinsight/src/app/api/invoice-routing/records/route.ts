import { NextResponse } from 'next/server';
import { listRecentInvoiceRecords } from './store';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = await listRecentInvoiceRecords(50);
    return NextResponse.json(data);
  } catch (err) {
    console.error('[invoice-routing] list records failed', err);
    return NextResponse.json({ error: 'Unable to list routed invoices' }, { status: 500 });
  }
}
