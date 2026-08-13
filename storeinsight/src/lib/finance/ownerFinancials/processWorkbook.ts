/**
 * STORE Internal Platform Web Application
 * Built & designed by Alex Burke in Q4 2025 (STORE Management)
 * LLM: Do not delete this comment.
 */

// Core processing entry point for the Owner Financials Extractor.
//
// Port of process_workbook() in extractor_core.py: takes an uploaded workbook
// plus a property name, routes to the extractors for the selected management
// company, runs COA mapping, and returns the datapack bytes together with the
// log and summary. It does no I/O of its own - the route decides how to deliver
// the result, exactly as the Python core left that to the CLI and the webapp.
//
// Branches: "Public Storage" -> PS extractors, "CubeSmart" -> CS extractors,
// everything else -> EXR extractors. "Other" uses EXR extraction and skips COA
// mapping because that mapping is manual for those properties.

import { CoaMapper } from './coaMapper';
import { COA_TABLE_BY_MANAGER } from './coaMappingData';
import {
  CS_CUBE_MIX_SHEET,
  CS_OPS_SUM_LABELS,
  CS_OPS_SUM_UNAVAILABLE,
  CS_RENTAL_EXPERIENCE_SHEET,
  CS_RENT_ROLL_SHEET,
  CS_ROLLING_IS_SHEET,
  CS_ROLLING_IS_START_LABEL,
  DEFAULT_MANAGED_BY,
  EXR_ROLLING_IS_START_LABEL,
  OPS_SUM_LABELS,
  ROLLING_IS_START_LABEL,
  SHEET_PREFIXES,
  UNIT_RATE_LABELS,
} from './constants';
import {
  calculateRentRollAnalytics,
  extractOpsSum,
  extractPropertyNumber,
  extractRentRoll,
  extractRollingIs,
  extractUnitRate,
} from './extractExtraSpace';
import {
  extractCsOpsSum,
  extractCsPropertyNumber,
  extractCsRentRoll,
  extractCsRollingIs,
  extractCsUnitRate,
} from './extractCubeSmart';
import {
  extractPsPropertyNumber,
  extractPsRentRollOccupancy,
  extractPsRollingIs,
} from './extractPublicStorage';
import { makeSafeFilename, pyNowIsoformat } from './pythonCompat';
import { loadExcelJS, loadSourceWorkbook, type SourceWorkbook } from './readWorkbook';
import {
  writeCoaMappingTab,
  writeLogTab,
  writeOpsSumTab,
  writeRentRollTab,
  writeRollingIsMappedTab,
  writeRollingIsTab,
  writeUnitRateTab,
} from './writeWorkbook';
import type {
  CellValue,
  CoaMappingResult,
  LogEntry,
  ManagedBy,
  OpsSumData,
  ProcessWorkbookResult,
  RentRollData,
  RollingIsData,
  SheetGrid,
  SummaryEntry,
  UnitRateData,
} from './types';

export type ProcessWorkbookInput = {
  /** Raw bytes of the uploaded .xlsx. */
  fileBytes: ArrayBuffer | Buffer;
  /** Original upload filename - recorded in the datapack's Source File cell. */
  filename: string;
  /** Name used in the output filename and the Rolling IS tab. */
  propertyName: string;
  managedBy?: ManagedBy;
  /** Injectable so the log timestamps are deterministic under test. */
  now?: () => Date;
};

/**
 * Labels present in `expected` but missing from `found`, in declaration order.
 *
 * The Python helper builds this from a set difference, so its ordering varies
 * between runs. Declaration order is used here so the same input always
 * produces the same warning text.
 */
function missingLabels(expected: readonly string[], found: ReadonlySet<string>): string[] {
  return expected.filter((label) => !found.has(label));
}

export async function processWorkbook({
  fileBytes,
  filename,
  propertyName,
  managedBy = DEFAULT_MANAGED_BY,
  now = () => new Date(),
}: ProcessWorkbookInput): Promise<ProcessWorkbookResult> {
  const log: LogEntry[] = [];
  const summary: SummaryEntry[] = [];
  const addSummary = (key: string, message: string) => {
    summary.push({ key, message });
  };

  let rollingIsData: RollingIsData | null = null;
  let unitRateData: UnitRateData | null = null;
  let opsSumData: OpsSumData | null = null;
  let rentRollData: RentRollData | null = null;

  // -- Open the input workbook --
  let workbook: SourceWorkbook;
  try {
    workbook = await loadSourceWorkbook(fileBytes);
  } catch (error) {
    log.push({
      sheet: '',
      status: 'ERROR',
      message: `Could not open: ${error instanceof Error ? error.message : String(error)}`,
    });
    return {
      outputBytes: null,
      outputFilename: null,
      log,
      summary,
      rollingIsData: null,
      unitRateData: null,
      opsSumData: null,
      rentRollData: null,
      coaLookup: new Map(),
      managedBy,
    };
  }

  if (managedBy === 'Public Storage') {
    // ---------------------------------------------------------------
    // PUBLIC STORAGE (PS) branch - IS sheet + Rent Roll occupancy count
    // ---------------------------------------------------------------
    let propNum = '';

    if (!workbook.hasSheet('IS')) {
      log.push({ sheet: 'IS', status: 'WARNING', message: 'IS sheet not found' });
    } else {
      const grid = workbook.getGrid('IS');
      propNum = extractPsPropertyNumber(grid);
      const { dates, rows } = extractPsRollingIs(grid);
      if (dates === null) {
        log.push({ sheet: 'IS', status: 'WARNING', message: 'Could not find date header row' });
      } else if (rows === null) {
        log.push({
          sheet: 'IS',
          status: 'WARNING',
          message: `Could not find '${ROLLING_IS_START_LABEL}' label`,
        });
      } else {
        rollingIsData = { propNum, dates, rows };
        const message = `Extracted ${rows.length} line items x ${dates.length} months`;
        log.push({ sheet: 'IS', status: 'OK', message });
        addSummary('rolling_is', message);
      }
    }

    // Unit Rate - derived from the Rent Roll occupancy count
    if (!workbook.hasSheet('Rent Roll')) {
      log.push({
        sheet: 'Rent Roll',
        status: 'WARNING',
        message: 'Rent Roll sheet not found — cannot derive occupancy',
      });
    } else {
      const occupied = extractPsRentRollOccupancy(workbook.getGrid('Rent Roll'));
      if (occupied === null) {
        log.push({
          sheet: 'Rent Roll',
          status: 'WARNING',
          message: 'Could not count occupied units',
        });
      } else {
        unitRateData = {
          propNum: rollingIsData ? propNum : '',
          metrics: { 'Units Rented': occupied },
        };
        const message = `Occupied units: ${occupied} (Units Available / Sq Ft not in PS format)`;
        log.push({ sheet: 'Rent Roll', status: 'OK', message });
        addSummary('unit_rate', message);
      }
    }

    // Ops Sum and full Rent Roll - not available in PS format
    log.push({
      sheet: 'Ops Sum',
      status: 'SKIP',
      message: 'Not available in Public Storage format',
    });
    log.push({
      sheet: 'Rent Roll detail',
      status: 'SKIP',
      message: 'PS Rent Roll does not include rates or move-in dates',
    });
  } else if (managedBy === 'CubeSmart') {
    // ---------------------------------------------------------------
    // CUBESMART (CS) branch - Rolling Details for the income statement,
    // Cube Mix for the unit and sq ft counts, Summary of Rental Experience
    // for rental activity, and Rent Roll for the tenant detail. Every CS tab
    // is named exactly, so each one is looked up by name.
    // ---------------------------------------------------------------
    const csGrid = (name: string): SheetGrid | null =>
      workbook.hasSheet(name) ? workbook.getGrid(name) : null;

    const rollingGrid = csGrid(CS_ROLLING_IS_SHEET);
    const cubeMixGrid = csGrid(CS_CUBE_MIX_SHEET);
    const rentalExperienceGrid = csGrid(CS_RENTAL_EXPERIENCE_SHEET);
    const rentRollGrid = csGrid(CS_RENT_ROLL_SHEET);

    // Every CS tab carries the store banner in row 1, so the property number is
    // still recoverable when the income statement sheet is the one missing.
    let propNum = '';
    for (const grid of [rollingGrid, rentRollGrid, cubeMixGrid, rentalExperienceGrid]) {
      if (propNum || !grid) continue;
      propNum = extractCsPropertyNumber(grid);
    }

    // Rolling Details
    if (!rollingGrid) {
      log.push({
        sheet: CS_ROLLING_IS_SHEET,
        status: 'WARNING',
        message: `${CS_ROLLING_IS_SHEET} sheet not found`,
      });
    } else {
      const { dates, rows } = extractCsRollingIs(rollingGrid);
      if (dates === null) {
        log.push({
          sheet: CS_ROLLING_IS_SHEET,
          status: 'WARNING',
          message: 'Could not find date header row',
        });
      } else if (rows === null) {
        log.push({
          sheet: CS_ROLLING_IS_SHEET,
          status: 'WARNING',
          message: `Could not find '${CS_ROLLING_IS_START_LABEL}' label`,
        });
      } else {
        rollingIsData = { propNum, dates, rows };
        const message = `Extracted ${rows.length} line items x ${dates.length} months`;
        log.push({ sheet: CS_ROLLING_IS_SHEET, status: 'OK', message });
        addSummary('rolling_is', message);
      }
    }

    // Unit Rate - from the Cube Mix totals row
    if (!cubeMixGrid) {
      log.push({
        sheet: CS_CUBE_MIX_SHEET,
        status: 'WARNING',
        message: `${CS_CUBE_MIX_SHEET} sheet not found — cannot derive unit and sq ft counts`,
      });
    } else {
      const metrics = extractCsUnitRate(cubeMixGrid);
      const metricKeys = Object.keys(metrics);
      if (metricKeys.length === 0) {
        log.push({
          sheet: CS_CUBE_MIX_SHEET,
          status: 'WARNING',
          message: 'No matching metrics found',
        });
      } else {
        const missing = missingLabels(UNIT_RATE_LABELS, new Set(metricKeys));
        if (missing.length > 0) {
          log.push({
            sheet: CS_CUBE_MIX_SHEET,
            status: 'WARNING',
            message: `Missing: ${missing.join(', ')}`,
          });
        }
        unitRateData = { propNum, metrics };
        const message = `Extracted ${metricKeys.length} metrics`;
        log.push({ sheet: CS_CUBE_MIX_SHEET, status: 'OK', message });
        addSummary('unit_rate', message);
      }
    }

    // Ops Sum - from the Summary of Rental Experience rental activity block
    if (!rentalExperienceGrid) {
      log.push({
        sheet: CS_RENTAL_EXPERIENCE_SHEET,
        status: 'WARNING',
        message: `${CS_RENTAL_EXPERIENCE_SHEET} sheet not found`,
      });
    } else {
      const { dates, rows } = extractCsOpsSum(rentalExperienceGrid);
      if (dates === null) {
        log.push({
          sheet: CS_RENTAL_EXPERIENCE_SHEET,
          status: 'WARNING',
          message: 'Could not find date header row',
        });
      } else if (rows === null || rows.length === 0) {
        log.push({
          sheet: CS_RENTAL_EXPERIENCE_SHEET,
          status: 'WARNING',
          message: 'Could not find the rental activity rows',
        });
      } else {
        const expected = CS_OPS_SUM_LABELS.map(([, canonical]) => canonical);
        const missing = missingLabels(expected, new Set(rows.map((row) => row.label)));
        if (missing.length > 0) {
          log.push({
            sheet: CS_RENTAL_EXPERIENCE_SHEET,
            status: 'WARNING',
            message: `Missing: ${missing.join(', ')}`,
          });
        }
        opsSumData = { propNum, dates, rows };
        const message = `Extracted ${rows.length} metrics x ${dates.length} months`;
        log.push({ sheet: CS_RENTAL_EXPERIENCE_SHEET, status: 'OK', message });
        addSummary('ops_sum', message);
        // The rental channel split is an EXR concept; saying so keeps it from
        // reading as data the extractor failed to find.
        log.push({
          sheet: CS_RENTAL_EXPERIENCE_SHEET,
          status: 'SKIP',
          message: `Not in CubeSmart format: ${CS_OPS_SUM_UNAVAILABLE.join(', ')}`,
        });
      }
    }

    // Rent Roll
    if (!rentRollGrid) {
      log.push({
        sheet: CS_RENT_ROLL_SHEET,
        status: 'WARNING',
        message: `${CS_RENT_ROLL_SHEET} sheet not found`,
      });
    } else {
      const { headers, dataRows } = extractCsRentRoll(rentRollGrid);
      if (headers === null) {
        log.push({
          sheet: CS_RENT_ROLL_SHEET,
          status: 'WARNING',
          message: 'Could not find header row',
        });
      } else if (dataRows === null || dataRows.length === 0) {
        log.push({
          sheet: CS_RENT_ROLL_SHEET,
          status: 'WARNING',
          message: 'No tenant/unit rows found',
        });
      } else {
        // ECRI / mark-to-market analytics - appends PSF and delta columns
        const analytics = calculateRentRollAnalytics(headers, dataRows);
        rentRollData = {
          propNum,
          headers: analytics.headers,
          dataRows: analytics.dataRows,
          summary: analytics.summary,
        };
        const message =
          `Extracted ${analytics.dataRows.length} tenants x ${analytics.headers.length} columns ` +
          `(${analytics.summary.belowStreetCount} below street rate)`;
        log.push({ sheet: CS_RENT_ROLL_SHEET, status: 'OK', message });
        addSummary('rent_roll', message);

        // The CubeSmart rent roll lists occupied cubes only, so its row count
        // has to equal the Cube Mix occupied count. They disagree when the rent
        // roll is truncated or its header was misread, and every mark-to-market
        // figure above is computed off those rows - which is exactly the kind of
        // wrong answer that still looks reasonable.
        const occupiedCubes = unitRateData?.metrics['Units Rented'];
        if (occupiedCubes !== undefined && occupiedCubes !== analytics.dataRows.length) {
          log.push({
            sheet: CS_RENT_ROLL_SHEET,
            status: 'WARNING',
            message:
              `${analytics.dataRows.length} tenant rows but ${CS_CUBE_MIX_SHEET} reports ` +
              `${occupiedCubes} occupied cubes — the rent roll summary is computed off the rows`,
          });
        }
      }
    }
  } else {
    // ---------------------------------------------------------------
    // EXTRA SPACE (EXR) branch (also used by "Other" until that format
    // gets its own extraction logic)
    // ---------------------------------------------------------------

    // Rolling IS
    const rollingIsSheet = workbook.findSheetByPrefix(SHEET_PREFIXES.rollingIs);
    if (!rollingIsSheet) {
      log.push({ sheet: 'Rolling IS', status: 'WARNING', message: 'Sheet not found' });
    } else {
      const propNum = extractPropertyNumber(rollingIsSheet.name, SHEET_PREFIXES.rollingIs);
      const { dates, rows } = extractRollingIs(rollingIsSheet.grid);
      if (dates === null) {
        log.push({
          sheet: rollingIsSheet.name,
          status: 'WARNING',
          message: 'Could not find date header row',
        });
      } else if (rows === null) {
        log.push({
          sheet: rollingIsSheet.name,
          status: 'WARNING',
          message: `Could not find '${EXR_ROLLING_IS_START_LABEL}' label`,
        });
      } else {
        rollingIsData = { propNum, dates, rows };
        const message = `Extracted ${rows.length} line items x ${dates.length} months`;
        log.push({ sheet: rollingIsSheet.name, status: 'OK', message });
        addSummary('rolling_is', message);
      }
    }

    // Unit Rate
    const unitRateSheet = workbook.findSheetByPrefix(SHEET_PREFIXES.unitRate);
    if (!unitRateSheet) {
      log.push({ sheet: 'Unit Rate', status: 'WARNING', message: 'Sheet not found' });
    } else {
      const propNum = extractPropertyNumber(unitRateSheet.name, SHEET_PREFIXES.unitRate);
      const metrics = extractUnitRate(unitRateSheet.grid);
      const metricKeys = Object.keys(metrics);
      if (metricKeys.length === 0) {
        log.push({
          sheet: unitRateSheet.name,
          status: 'WARNING',
          message: 'No matching metrics found',
        });
      } else {
        const missing = missingLabels(UNIT_RATE_LABELS, new Set(metricKeys));
        if (missing.length > 0) {
          log.push({
            sheet: unitRateSheet.name,
            status: 'WARNING',
            message: `Missing: ${missing.join(', ')}`,
          });
        }
        unitRateData = { propNum, metrics };
        const message = `Extracted ${metricKeys.length} metrics`;
        log.push({ sheet: unitRateSheet.name, status: 'OK', message });
        addSummary('unit_rate', message);
      }
    }

    // Ops Sum
    const opsSumSheet = workbook.findSheetByPrefix(SHEET_PREFIXES.opsSum);
    if (!opsSumSheet) {
      log.push({ sheet: 'Ops Sum', status: 'WARNING', message: 'Sheet not found' });
    } else {
      const propNum = extractPropertyNumber(opsSumSheet.name, SHEET_PREFIXES.opsSum);
      const { dates, rows } = extractOpsSum(opsSumSheet.grid);
      if (dates === null) {
        log.push({
          sheet: opsSumSheet.name,
          status: 'WARNING',
          message: 'Could not find date header row',
        });
      } else if (rows === null) {
        log.push({
          sheet: opsSumSheet.name,
          status: 'WARNING',
          message: 'Could not find label column',
        });
      } else {
        const missing = missingLabels(OPS_SUM_LABELS, new Set(rows.map((row) => row.label)));
        if (missing.length > 0) {
          log.push({
            sheet: opsSumSheet.name,
            status: 'WARNING',
            message: `Missing: ${missing.join(', ')}`,
          });
        }
        opsSumData = { propNum, dates, rows };
        const message = `Extracted ${rows.length} metrics x ${dates.length} months`;
        log.push({ sheet: opsSumSheet.name, status: 'OK', message });
        addSummary('ops_sum', message);
      }
    }

    // Rent Roll
    const rentRollSheet = workbook.findSheetByPrefix(SHEET_PREFIXES.rentRoll);
    if (!rentRollSheet) {
      log.push({ sheet: 'Rent Roll', status: 'WARNING', message: 'Sheet not found' });
    } else {
      const propNum = extractPropertyNumber(rentRollSheet.name, SHEET_PREFIXES.rentRoll);
      const { headers, dataRows } = extractRentRoll(rentRollSheet.grid);
      if (headers === null) {
        log.push({
          sheet: rentRollSheet.name,
          status: 'WARNING',
          message: 'Could not find header row',
        });
      } else if (dataRows === null || dataRows.length === 0) {
        log.push({
          sheet: rentRollSheet.name,
          status: 'WARNING',
          message: 'No tenant/unit rows found',
        });
      } else {
        // ECRI / mark-to-market analytics - appends PSF and delta columns
        const analytics = calculateRentRollAnalytics(headers, dataRows);
        rentRollData = {
          propNum,
          headers: analytics.headers,
          dataRows: analytics.dataRows,
          summary: analytics.summary,
        };
        const message =
          `Extracted ${analytics.dataRows.length} tenants x ${analytics.headers.length} columns ` +
          `(${analytics.summary.belowStreetCount} below street rate)`;
        log.push({ sheet: rentRollSheet.name, status: 'OK', message });
        addSummary('rent_roll', message);
      }
    }
  }

  // -- Run COA mapping on the extracted Rolling IS accounts --
  let coaLookup = new Map<string, CoaMappingResult>();
  const tableKey = COA_TABLE_BY_MANAGER[managedBy] ?? null;

  if (rollingIsData && managedBy === 'Other') {
    log.push({
      sheet: 'COA Mapper',
      status: 'SKIP',
      message: 'Managed By = Other — COA mapping is manual for this property',
    });
  } else if (rollingIsData && tableKey === null) {
    log.push({
      sheet: 'COA Mapper',
      status: 'SKIP',
      message: `No COA mapping file configured for '${managedBy}'`,
    });
  } else if (rollingIsData && tableKey !== null) {
    const mapper = new CoaMapper(tableKey);
    coaLookup = mapper.mapUniqueFromRows(rollingIsData.rows);
    let autoOk = 0;
    let needReview = 0;
    coaLookup.forEach((result) => {
      if (result.reviewRequired) needReview += 1;
      else autoOk += 1;
    });
    const message = `COA mapping: ${autoOk} auto-accepted, ${needReview} flagged for review`;
    log.push({ sheet: 'COA Mapper', status: 'OK', message });
    addSummary('coa_mapping', message);
  }

  // -- Build the output workbook --
  const ExcelJS = loadExcelJS();
  const outWorkbook = new ExcelJS.Workbook();

  if (rollingIsData) {
    writeRollingIsTab(
      outWorkbook,
      filename,
      rollingIsData.propNum,
      rollingIsData.dates,
      rollingIsData.rows,
      propertyName,
    );
    if (coaLookup.size > 0) {
      writeRollingIsMappedTab(
        outWorkbook,
        filename,
        rollingIsData.propNum,
        rollingIsData.dates,
        rollingIsData.rows,
        propertyName,
        coaLookup,
      );
    }
  }

  if (unitRateData) {
    writeUnitRateTab(outWorkbook, filename, unitRateData.propNum, unitRateData.metrics);
  }

  if (opsSumData) {
    writeOpsSumTab(
      outWorkbook,
      filename,
      opsSumData.propNum,
      opsSumData.dates,
      opsSumData.rows,
    );
  }

  if (rentRollData) {
    writeRentRollTab(
      outWorkbook,
      filename,
      rentRollData.propNum,
      rentRollData.headers,
      rentRollData.dataRows,
      rentRollData.summary,
    );
  }

  if (coaLookup.size > 0) {
    writeCoaMappingTab(outWorkbook, [...coaLookup.values()]);
  }

  const logRows: CellValue[][] = log.map((entry) => [
    pyNowIsoformat(now()),
    entry.sheet,
    entry.status,
    entry.message,
  ]);
  writeLogTab(outWorkbook, logRows);

  const written = (await outWorkbook.xlsx.writeBuffer()) as ArrayBuffer | Buffer;
  const outputBytes = Buffer.isBuffer(written) ? written : Buffer.from(written);

  const safeName = makeSafeFilename(propertyName);

  return {
    outputBytes,
    outputFilename: `${safeName}_datapack.xlsx`,
    log,
    summary,
    rollingIsData,
    unitRateData,
    opsSumData,
    rentRollData,
    coaLookup,
    managedBy,
  };
}
