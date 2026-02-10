import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import { parseMsrWorkbook } from "../src/lib/historical/msrSnapshotParser";

const buildWorkbookBuffer = (): Buffer => {
  const workbook = XLSX.utils.book_new();

  const msrGrid = [
    ["Revenue Statistics"],
    [],
    ["Occupied Rate Variance", "-13688.83", "-9.33%"],
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(msrGrid), "MSR");

  const occupancyGrid = [
    [
      "Space Number",
      "Space Type",
      "Rentable Sq Ft",
      "Occupancy Status",
      "Sell Rate",
      "Current Rent",
    ],
    ["A101", "5x5", 25, "Occupied", 200, 220],
    ["A102", "5x5", 25, "Occupied", 212.04, 236.2],
    ["B201", "5x10", 50, "Vacant", 210, 0],
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(occupancyGrid), "Occupancy");

  const overlockGrid = [
    ["Space", "Days Late", "Balance"],
    ["A101", 5, "$100.00"],
    ["A101", 5, "$100.00"],
    ["B202", 45, "$200.00"],
    ["Total", "", "300"],
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(overlockGrid), "Overlocked Spaces");

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
};

test("parseMsrWorkbook derives occupied averages, variance, and deduped overlock metrics", () => {
  const buffer = buildWorkbookBuffer();
  const result = parseMsrWorkbook(buffer);
  const pricing = result.snapshot.pricing ?? {};
  const revenue = result.snapshot.revenue ?? {};
  const ar = result.snapshot.ar ?? {};

  assert.ok(Math.abs((pricing.avgCurrentRentOccupied ?? 0) - 228.1) < 0.001);
  assert.ok(Math.abs((pricing.avgSellRateOccupied ?? 0) - 206.02) < 0.001);
  assert.ok(Math.abs((pricing.occupiedActualAvg ?? 0) - 228.1) < 0.001);
  assert.ok(Math.abs((pricing.occupiedTargetAvg ?? 0) - 206.02) < 0.001);

  assert.equal(pricing.occupiedRateVarianceAmount, -13688.83);
  assert.equal(revenue.occupiedRateVarianceAmount, -13688.83);
  assert.ok(Math.abs((pricing.occupiedRateVariancePct ?? 0) + 0.0933) < 0.0001);
  assert.ok(Math.abs((revenue.occupiedRateVariancePct ?? 0) + 0.0933) < 0.0001);

  assert.equal(ar.overlockedUnitCount, 2);
  assert.equal(ar.overlockTotalBalance, 300);
  assert.ok(Math.abs((ar.overlockAvgDaysLate ?? 0) - 25) < 0.001);
  const bucketShare = ar.overlockBucketShare ?? [];
  const bucketLookup = new Map(bucketShare.map((bucket) => [bucket.label, bucket.percent]));
  assert.equal(bucketLookup.get("0-10"), 50);
  assert.equal(bucketLookup.get("31-60"), 50);
});
