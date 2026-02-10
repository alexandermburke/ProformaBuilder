import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { parseMsrWorkbook } from '@/lib/historical/msrSnapshotParser';
import { getPropertyMsrSnapshotStatus } from '@/lib/historical/firebaseStore';

export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ ok: false, message: 'Invalid form data.' }, { status: 400 });
  }

  const propertyId = formData.get('propertyId')?.toString().trim() ?? '';
  const file = formData.get('file');

  if (!propertyId) {
    return NextResponse.json({ ok: false, message: 'propertyId is required.' }, { status: 400 });
  }

  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ ok: false, message: 'Upload a .xlsx file.' }, { status: 400 });
  }

  const filename = 'name' in file ? String(file.name) : '';
  if (!filename.toLowerCase().endsWith('.xlsx')) {
    return NextResponse.json({ ok: false, message: 'Upload must be a .xlsx file.' }, { status: 400 });
  }

  let parsed;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    parsed = parseMsrWorkbook(buffer);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to parse the MSR workbook.';
    return NextResponse.json({ ok: false, message }, { status: 400 });
  }

  const snapshot = {
    ...parsed.snapshot,
    propertyId,
  };

  if (!snapshot.reportMonthIso) {
    return NextResponse.json(
      { ok: false, message: 'Unable to determine reportMonthIso from the workbook.' },
      { status: 400 },
    );
  }

  const status = await getPropertyMsrSnapshotStatus(propertyId, snapshot.reportMonthIso);

  if (process.env.NODE_ENV !== 'production') {
    console.info('[msr-preview] parsed snapshot', {
      propertyId,
      reportMonthIso: snapshot.reportMonthIso,
      reportDate: snapshot.reportDate,
      warnings: parsed.warnings.length,
      occupancy: {
        rsfOccPct: snapshot.occupancy?.rsfOccPct,
        occupiedCount: snapshot.occupancy?.occupiedCount,
        occupiedRsf: snapshot.occupancy?.occupiedRsf,
        totalRsf: snapshot.occupancy?.totalRsf,
      },
      revenue: {
        netRevenueMtd: snapshot.revenue?.netRevenueMtd,
        grossPotentialRevenue: snapshot.revenue?.grossPotentialRevenue,
        economicOccupancy: snapshot.revenue?.economicOccupancy,
        occupiedRateVarianceAmount: snapshot.revenue?.occupiedRateVarianceAmount,
        occupiedRateVariancePct: snapshot.revenue?.occupiedRateVariancePct,
      },
      rentals: {
        moveInsMtd: snapshot.rentals?.moveInsMtd,
        moveOutsMtd: snapshot.rentals?.moveOutsMtd,
        netMoveInsMtd: snapshot.rentals?.netMoveInsMtd,
      },
      leads: {
        totalMtd: snapshot.leads?.totalMtd,
      },
      ar: {
        totalPastDue: snapshot.ar?.totalPastDue,
        delinquentTenantCount: snapshot.ar?.delinquentTenantCount,
        overlockedUnitCount: snapshot.ar?.overlockedUnitCount,
        overlockTotalBalance: snapshot.ar?.overlockTotalBalance,
        overlockAvgDaysLate: snapshot.ar?.overlockAvgDaysLate,
      },
      pricing: {
        avgCurrentRentOccupied: snapshot.pricing?.avgCurrentRentOccupied,
        avgSellRateOccupied: snapshot.pricing?.avgSellRateOccupied,
        occupiedActualAvg: snapshot.pricing?.occupiedActualAvg,
        occupiedTargetAvg: snapshot.pricing?.occupiedTargetAvg,
        occupiedRateVarianceAmount: snapshot.pricing?.occupiedRateVarianceAmount,
        occupiedRateVariancePct: snapshot.pricing?.occupiedRateVariancePct,
      },
    });
    if (parsed.occupancyDiagnostics) {
      console.info('[msr-preview] occupancy diagnostics', {
        sheetName: parsed.occupancyDiagnostics.sheetName,
        headerRowIndex: parsed.occupancyDiagnostics.headerRowIndex,
        columnMapping: parsed.occupancyDiagnostics.columnMapping,
        rowCounts: parsed.occupancyDiagnostics.rowCounts,
        error: parsed.occupancyDiagnostics.error,
      });
    }
    if (parsed.dataSources) {
      console.info('[msr-preview] data sources', parsed.dataSources);
    }
  }

  return NextResponse.json({
    ok: true,
    snapshot,
    warnings: parsed.warnings,
    sections: parsed.sections,
    exists: status.exists,
    occupancyDiagnostics: parsed.occupancyDiagnostics ?? null,
    dataSources: parsed.dataSources ?? null,
    msrTableDiagnostics: parsed.msrTableDiagnostics ?? null,
  });
}
