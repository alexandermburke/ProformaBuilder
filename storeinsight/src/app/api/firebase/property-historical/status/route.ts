import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getPropertyHistoricalStatus } from '@/lib/historical/firebaseStore';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const propertyId = request.nextUrl.searchParams.get('propertyId')?.trim() ?? '';
  if (!propertyId) {
    return NextResponse.json(
      { exists: false, updatedAt: null, rangesAvailable: [], latestMonth: null },
      { status: 400 },
    );
  }

  try {
    const status = await getPropertyHistoricalStatus(propertyId);
    return NextResponse.json(status);
  } catch (error) {
    return NextResponse.json(
      { exists: false, updatedAt: null, rangesAvailable: [], latestMonth: null },
      { status: 500 },
    );
  }
}

