import { NextRequest, NextResponse } from "next/server";
import { normalizeSource, type NormalizedRow } from "@/lib/accounting/bankCardImportPrep/normalize";
import { parseBank } from "@/lib/accounting/bankCardImportPrep/parseBank";
import { parseCard } from "@/lib/accounting/bankCardImportPrep/parseCard";
import { parseOtherBank } from "@/lib/accounting/bankCardImportPrep/parseOtherBank";
import type { ParseResult, ParsedRow } from "@/lib/accounting/bankCardImportPrep/parseShared";
import { applyRules, buildRules, parseCodedWorkbook } from "@/lib/accounting/bankCardImportPrep/rulesEngine/learnRules";
import { validateRows, type ValidatedRow } from "@/lib/accounting/bankCardImportPrep/validate";
import { buildWorkbook } from "@/lib/accounting/bankCardImportPrep/buildWorkbook";
import { applyAmazonOrderMapping, parseAmazonOrders } from "@/lib/accounting/bankCardImportPrep/amazonOrderMapping";
import { createJob, getJob, updateJob, SOURCE_KEYS, type SourceKey, type SourceSummary } from "../jobStore";

export const runtime = "nodejs";
const DIGITS_ONLY = /^\d+$/;
const envDefaultCashAccount =
  process.env.BANK_IMPORT_DEFAULT_CASH_ACCOUNT?.trim() ||
  process.env.DEFAULT_CASH_ACCOUNT?.trim() ||
  "";
const BILL_PAY_PATTERNS = [/^Draft\b/i, /Withdrawal\s+STORE[\s\W]*MANAGEMENT/i, /STORE[\s\W]*MANAGEMENT/i];
const SOURCE_LABELS: Record<SourceKey, string> = {
  bank: "Bank",
  card: "Credit Card",
  otherBank: "Other Bank Activity",
};
const SOURCE_REFERENCE_PREFIX: Record<SourceKey, string> = {
  bank: "Bank Import",
  card: "Credit Card Import",
  otherBank: "Other Bank Activity",
};

type UploadPayload = {
  bank: Buffer;
  card?: Buffer | null;
  otherBank?: Buffer | null;
  reference?: Buffer | null;
  exceptions?: Buffer | null;
  codedTemplateFile?: Buffer | null;
  amazonOrders?: Buffer | null;
  filenames: Record<string, string>;
  defaultProperty: string;
  cashAccount?: string;
};

const REQUIRED_FILES = {
  bank: ["csv"],
} as const;

const OPTIONAL_FILES = {
  card: ["csv", "xlsx"],
  otherBank: ["xlsx", "csv"],
  reference: ["csv", "xlsx"],
  exceptions: ["csv"],
  codedTemplateFile: ["xlsx"],
  amazonOrders: ["csv", "xlsx"],
} as const;

function getExtension(name: string | undefined): string {
  if (!name) return "";
  const parts = name.split(".");
  return parts.length > 1 ? parts.pop()!.toLowerCase() : "";
}

function isAllowed(name: string | undefined, allowed: readonly string[]): boolean {
  const ext = getExtension(name);
  return allowed.includes(ext);
}

function isBillPayRow(row: ParsedRow): boolean {
  const raw = row.raw ?? {};
  const description = String((raw as Record<string, unknown>).description ?? "");
  const memo = String((raw as Record<string, unknown>).memo ?? "");
  const combined = `${description} ${memo}`.trim();
  return BILL_PAY_PATTERNS.some((pattern) => pattern.test(description) || pattern.test(memo) || pattern.test(combined));
}

function filterBankBillPay(result: ParseResult): { result: ParseResult; removed: number } {
  const filteredRows = result.rows.filter((row) => !isBillPayRow(row));
  const removed = result.rows.length - filteredRows.length;
  return { result: { ...result, rows: filteredRows }, removed };
}

async function readBlob(blob: Blob | null): Promise<Buffer | null> {
  if (!blob) return null;
  const arrayBuffer = await blob.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function formatTenantDepositReference(postMonth: string | null, journalDate: Date | null): string | null {
  const monthYear =
    (postMonth?.match(/^(\d{1,2})[/-](\d{2,4})$/) ?? null) ||
    (journalDate ? [null, String(journalDate.getMonth() + 1).padStart(2, "0"), String(journalDate.getFullYear())] : null);
  if (!monthYear) return null;
  const month = monthYear[1]?.padStart(2, "0");
  const year = monthYear[2]?.length === 2 ? `20${monthYear[2]}` : monthYear[2];
  if (!month || !year) return null;
  return `Tenant Deposits ${month}.${year}`;
}

function applyTenantDepositRule(rows: NormalizedRow[]) {
  const tenantPattern = /^deposit\s+tenant/i;
  const tenantNotes = "Deposit TENANT INC";
  return rows.map((row) => {
    if (!row.notes || !tenantPattern.test(row.notes.trim())) return row;
    const ref = formatTenantDepositReference(row.postMonth, row.journalDate) || row.reference || row.detailNotes;
    return {
      ...row,
      account: "4401",
      notes: tenantNotes,
      reference: ref,
      detailNotes: tenantNotes,
    };
  });
}

function applySourceReference(rows: NormalizedRow[], sourceKey: SourceKey): NormalizedRow[] {
  const prefix = SOURCE_REFERENCE_PREFIX[sourceKey];
  return rows.map((row) => {
    const existing = row.reference?.trim();
    if (existing) return row;
    const postMonth = row.postMonth?.trim();
    const suffix = postMonth ? ` ${postMonth}` : "";
    return { ...row, reference: `${prefix}${suffix}`.trim() };
  });
}

async function runJob(jobId: string, payload: UploadPayload): Promise<void> {
  const append = (logs: string[] = [], warnings: string[] = [], step?: string, percent?: number) => {
    const job = getJob(jobId);
    if (!job) return;
    updateJob(jobId, {
      step: step ?? job.step,
      percent: percent ?? job.percent,
      logs: logs.length ? [...job.logs, ...logs] : job.logs,
      warnings: warnings.length ? [...job.warnings, ...warnings] : job.warnings,
    });
  };

  const isPropertyMissing = (value: string | null | undefined) => !value || !value.trim();
  const isAccountInvalid = (value: string | null | undefined) => !value || !DIGITS_ONLY.test(value.trim());
  const emptyResult = (source: string): ParseResult => ({
    rows: [],
    logs: [],
    warnings: [`[${source}] optional file not provided; skipping parse`],
  });

  try {
    append(["[job] starting Bank & Card Import Prep"], [], "Validate inputs", 5);
    const exportTimestamp = Date.now();
    updateJob(jobId, {
      status: "running",
      defaultProperty: payload.defaultProperty,
      cashAccount: payload.cashAccount ?? "",
      exportTimestamp,
    });

    let templateCashAccount: string | null = null;
    let templateProperty: string | null = null;
    let templateSummary = {
      matched: 0,
      templateCount: 0,
      unmatchedSamples: [] as Array<{ journalDate: string | null; amount: number; notes: string | null }>,
    };
    let rules = buildRules([]);
    let training: ReturnType<typeof parseCodedWorkbook> | null = null;
    let templateSource = "coded template";
    if (payload.codedTemplateFile) {
      training = parseCodedWorkbook(payload.codedTemplateFile, payload.cashAccount);
    } else if (payload.reference) {
      const referenceTraining = parseCodedWorkbook(payload.reference, payload.cashAccount);
      if (referenceTraining.examples.length > 0) {
        training = referenceTraining;
        templateSource = "reference file";
      }
    }
    if (training) {
      templateCashAccount = training.cashAccount ?? null;
      templateProperty = training.propertyName ?? null;
      rules = buildRules(training.examples);
      append(
        [
          `[rules] learned ${rules.totalExamples} training examples (${templateSource})`,
          `[rules] detected template cash account: ${templateCashAccount ?? "none"}`,
          templateProperty ? `[rules] detected template property: ${templateProperty}` : "[rules] no template property detected",
          rules.totalExamples === 0 ? "[rules] no training examples detected; mapping skipped" : "",
        ].filter(Boolean),
        [],
        "Parse template",
        15,
      );
    }
    const parsedBank = await parseBank(payload.bank);
    append(parsedBank.logs, parsedBank.warnings, "Parse bank export", 20);
    const { result: bankResult, removed: billPayRemoved } = filterBankBillPay(parsedBank);
    append(
      [`[filter] removed ${billPayRemoved} bill pay transactions (Draft/Withdrawal STORE MANAGEMENT) from bank source`],
      [],
    );

    const cardResult = payload.card ? await parseCard(payload.card) : emptyResult("card");
    append(cardResult.logs, cardResult.warnings, "Parse card export", 40);

    const otherResult = payload.otherBank ? await parseOtherBank(payload.otherBank) : emptyResult("other-bank");
    append(otherResult.logs, otherResult.warnings, "Parse other bank activity", 55);

    if (payload.reference) {
      append([`[reference] received (${payload.filenames.reference || "reference"})`]);
    }
    if (payload.exceptions) {
      append([`[exceptions] received (${payload.filenames.exceptions || "exceptions"})`]);
    }
    if (payload.amazonOrders) {
      append([`[amazon-map] received (${payload.filenames.amazonOrders || "amazon-orders"})`]);
    }

    const bankNormalized = normalizeSource(bankResult.rows, "");
    const cardNormalized = normalizeSource(cardResult.rows, "");
    const otherNormalized = normalizeSource(otherResult.rows, "");
    append(
      [...bankNormalized.logs, ...cardNormalized.logs, ...otherNormalized.logs],
      [...bankNormalized.warnings, ...cardNormalized.warnings, ...otherNormalized.warnings],
      "Normalize & map to Yardi",
      65,
    );

    const resolvedCashAccount = payload.cashAccount?.trim() || templateCashAccount || envDefaultCashAccount;
    const missingCashAccount = !resolvedCashAccount;

    let otherBankDropped = 0;
    let otherBankKept = 0;
    const otherBankFiltered = otherNormalized.rows.filter((row) => {
      if (!resolvedCashAccount) {
        otherBankKept += 1;
        return true;
      }
      const account = row.account?.trim() ?? "";
      const debit = row.debit ?? 0;
      const credit = row.credit ?? 0;
      const debitPositive = debit > 0;
      const creditPositive = credit > 0;
      const isCashSide =
        account === resolvedCashAccount &&
        ((creditPositive && !debitPositive) || (debitPositive && !creditPositive));
      if (isCashSide) {
        otherBankDropped += 1;
        return false;
      }
      otherBankKept += 1;
      return true;
    });

    if (resolvedCashAccount) {
      append([
        `[other-bank] dropped ${otherBankDropped} cash-side rows (Account=${resolvedCashAccount}) from Other Bank Activity to prevent duplicates`,
        `[other-bank] kept ${otherBankKept} offset rows -> ${otherBankKept} transactions`,
      ]);
    }

    const allNormalizedRows = [
      ...bankNormalized.rows,
      ...cardNormalized.rows,
      ...otherBankFiltered,
    ];
    const knownProperties = new Set(
      allNormalizedRows
        .map((row) => row.propertyName?.trim())
        .filter((val): val is string => Boolean(val)),
    );
    const singleSourceProperty = knownProperties.size === 1 ? Array.from(knownProperties)[0] : "";
    const defaultProperty =
      templateProperty?.trim() ||
      (singleSourceProperty ? singleSourceProperty : "") ||
      (payload.defaultProperty?.trim() ?? "");

    const applyDefaultProperty = (rows: NormalizedRow[]) => {
      let applied = 0;
      const updated = rows.map((row) => {
        if (row.propertyName?.trim()) return row;
        if (!defaultProperty) return row;
        applied += 1;
        return { ...row, propertyName: defaultProperty };
      });
      return { rows: updated, applied };
    };

    let defaultApplied = 0;
    const bankWithDefaults = applyDefaultProperty(bankNormalized.rows);
    defaultApplied += bankWithDefaults.applied;
    const cardWithDefaults = applyDefaultProperty(cardNormalized.rows);
    defaultApplied += cardWithDefaults.applied;
    const otherWithDefaults = applyDefaultProperty(otherBankFiltered);
    defaultApplied += otherWithDefaults.applied;

    if (defaultApplied > 0) {
      append([`[normalize] applied default property to ${defaultApplied} rows`]);
    }

    const ruleApplied = {
      bank: applyRules(bankWithDefaults.rows, rules),
      card: applyRules(cardWithDefaults.rows, rules),
      otherBank: applyRules(otherWithDefaults.rows, rules),
    };

    const tenantApplied = {
      bank: applyTenantDepositRule(ruleApplied.bank.rows),
      card: applyTenantDepositRule(ruleApplied.card.rows),
      otherBank: applyTenantDepositRule(ruleApplied.otherBank.rows),
    };
    const referencedRows = {
      bank: applySourceReference(tenantApplied.bank, "bank"),
      card: applySourceReference(tenantApplied.card, "card"),
      otherBank: applySourceReference(tenantApplied.otherBank, "otherBank"),
    };

    if (payload.amazonOrders) {
      const parsedAmazonOrders = parseAmazonOrders(payload.amazonOrders);
      append(parsedAmazonOrders.logs, parsedAmazonOrders.warnings);
      const amazonMap = applyAmazonOrderMapping(referencedRows.bank, parsedAmazonOrders.rows);
      referencedRows.bank = amazonMap.rows;
      append(amazonMap.logs, [], "Apply Amazon order mapping", 73);
    }

    const totalExact =
      ruleApplied.bank.exactMatches + ruleApplied.card.exactMatches + ruleApplied.otherBank.exactMatches;
    const totalSignature =
      ruleApplied.bank.signatureMatches +
      ruleApplied.card.signatureMatches +
      ruleApplied.otherBank.signatureMatches;
    const totalUnmatched =
      ruleApplied.bank.unmatched + ruleApplied.card.unmatched + ruleApplied.otherBank.unmatched;

    const combinedUnmatchedSamples: Array<{ journalDate: string | null; amount: number; notes: string | null }> = [];
    [ruleApplied.bank.unmatchedSamples, ruleApplied.card.unmatchedSamples, ruleApplied.otherBank.unmatchedSamples].forEach(
      (samples) => {
        samples.forEach((sample) => {
          if (combinedUnmatchedSamples.length < 10) {
            combinedUnmatchedSamples.push(sample);
          }
        });
      },
    );

    templateSummary = {
      matched: totalExact + totalSignature,
      templateCount: rules.totalExamples,
      unmatchedSamples: combinedUnmatchedSamples,
    };
    if (rules.totalExamples > 0) {
      append(
        [`[rules] exact matches: ${totalExact}, fuzzy matches: ${totalSignature}, unmatched: ${totalUnmatched}`],
        [],
        "Apply template mapping",
        70,
      );
    }

    const validated = {
      bank: validateRows(referencedRows.bank),
      card: validateRows(referencedRows.card),
      otherBank: validateRows(referencedRows.otherBank),
    };
    append(
      [...validated.bank.logs, ...validated.card.logs, ...validated.otherBank.logs],
      [...validated.bank.warnings, ...validated.card.warnings, ...validated.otherBank.warnings],
      "Validate rows & warnings",
      85,
    );

    const buildReviewCounts = (rows: ValidatedRow[]) => {
      let missingAccount = 0;
      let missingProperty = 0;
      let invalidAccount = 0;
      rows.forEach((row) => {
        if (isPropertyMissing(row.Property_Name)) missingProperty += 1;
        if (!row.Account || !row.Account.trim()) {
          missingAccount += 1;
          return;
        }
        if (!DIGITS_ONLY.test(row.Account.trim())) invalidAccount += 1;
      });
      const unmapped = rows.reduce(
        (count, row) =>
          count +
          (isPropertyMissing(row.Property_Name) || isAccountInvalid(row.Account) ? 1 : 0),
        0,
      );
      return { missingAccount, missingProperty, invalidAccount, unmapped };
    };

    const sourceSummaries: Record<SourceKey, SourceSummary> = {
      bank: {
        key: "bank",
        rows: validated.bank.rows,
        downloadReady: false,
        counts: {
          input: bankNormalized.rows.length,
          output: validated.bank.transactions * 2 + validated.bank.passthrough,
          transactions: validated.bank.transactions,
          passthrough: validated.bank.passthrough,
        },
        review: buildReviewCounts(validated.bank.rows),
        needsReview: false,
      },
      card: {
        key: "card",
        rows: validated.card.rows,
        downloadReady: false,
        counts: {
          input: cardNormalized.rows.length,
          output: validated.card.transactions * 2 + validated.card.passthrough,
          transactions: validated.card.transactions,
          passthrough: validated.card.passthrough,
        },
        review: buildReviewCounts(validated.card.rows),
        needsReview: false,
      },
      otherBank: {
        key: "otherBank",
        rows: validated.otherBank.rows,
        downloadReady: false,
        counts: {
          input: otherWithDefaults.rows.length,
          output: validated.otherBank.transactions * 2 + validated.otherBank.passthrough,
          transactions: validated.otherBank.transactions,
          passthrough: validated.otherBank.passthrough,
        },
        review: buildReviewCounts(validated.otherBank.rows),
        needsReview: false,
      },
    };

    SOURCE_KEYS.forEach((key) => {
      const summary = sourceSummaries[key];
      summary.needsReview = summary.review.unmapped > 0;
    });

    const unmappedCount = SOURCE_KEYS.reduce((total, key) => total + sourceSummaries[key].review.unmapped, 0);
    if (unmappedCount > 0) {
      const reviewSummary = SOURCE_KEYS.map((key) => `${SOURCE_LABELS[key]}: ${sourceSummaries[key].review.unmapped}`).join(", ");
      append([`[review] ${unmappedCount} rows need Property_Name and/or Account (${reviewSummary})`], [], "Review unmapped rows", 95);
    }

    const counts = {
      bank: bankNormalized.rows.length,
      card: cardNormalized.rows.length,
      otherBank: otherWithDefaults.rows.length,
      output: SOURCE_KEYS.reduce((total, key) => total + sourceSummaries[key].counts.output, 0),
      transactions: validated.bank.transactions + validated.card.transactions + validated.otherBank.transactions,
    };

    const needsReview = SOURCE_KEYS.some((key) => sourceSummaries[key].needsReview) || missingCashAccount;

    const baseUpdate = {
      percent: needsReview ? 95 : 100,
      step: needsReview ? "Review unmapped rows" : "Complete",
      downloadReady: false,
      sources: sourceSummaries,
      needsReview,
      unmappedCount,
      counts,
      templateCashAccount: templateCashAccount ?? undefined,
      templateTxCount: templateSummary.templateCount,
      matchedTxCount: templateSummary.matched,
      unmatchedSamples: templateSummary.unmatchedSamples,
      strictTemplate: false,
      missingCashAccount,
      defaultProperty,
      outputBuffer: undefined,
      outputFilename: undefined,
    } as const;

    updateJob(jobId, {
      ...baseUpdate,
      cashAccount: resolvedCashAccount,
      exportTimestamp,
    });

    if (missingCashAccount) {
      append(["[validate] missing cash account; unable to build workbook"]);
    }

    if (needsReview) {
      updateJob(jobId, { status: "done" });
      return;
    }

    const buildLogs: string[] = [];
    const updatedSources: Record<SourceKey, SourceSummary> = { ...sourceSummaries };

    SOURCE_KEYS.forEach((key) => {
      const source = updatedSources[key];
      const filename = `yardi_import_${key === "otherBank" ? "otherbank" : key}_${exportTimestamp}.xlsx`;
      const { buffer, emitted } = buildWorkbook(source.rows, {
        cashAccount: resolvedCashAccount,
        filename,
      });
      updatedSources[key] = {
        ...source,
        downloadReady: true,
        outputBuffer: buffer,
        outputFilename: filename,
        counts: {
          ...source.counts,
          output: emitted,
        },
      };
      buildLogs.push(`[build] ${SOURCE_LABELS[key]} emitted ${emitted} journal rows (cash + offset)`);
      buildLogs.push(`[build] ${SOURCE_LABELS[key]} workbook ready (${filename})`);
    });

    const totalEmitted = SOURCE_KEYS.reduce((total, key) => total + (updatedSources[key].counts.output || 0), 0);
    const zipName = `yardi_import_${exportTimestamp}.zip`;

    append(buildLogs, [], "Build workbook", 98);

    updateJob(jobId, {
      ...baseUpdate,
      status: "done",
      percent: 100,
      step: "Complete",
      downloadReady: true,
      sources: updatedSources,
      outputFilename: zipName,
      needsReview: false,
      unmappedCount: 0,
      counts: {
        ...counts,
        output: totalEmitted,
      },
    });
  } catch (err) {
    const message = (err as Error)?.message ?? "Unknown error";
    append([`[error] ${message}`]);
    updateJob(jobId, { status: "error", percent: 100, step: "Error", errorMessage: message });
  }
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const defaultEntry = form.get("defaultProperty");
  const defaultProperty = typeof defaultEntry === "string" ? defaultEntry.trim() : "";
  const cashEntry = form.get("cashAccount");
  const cashAccount = typeof cashEntry === "string" ? cashEntry.trim() : "";

  const files: Record<string, File | null> = {
    bank: (form.get("bank") as File) ?? null,
    card: (form.get("card") as File) ?? null,
    otherBank: (form.get("otherBank") as File) ?? null,
    reference: (form.get("reference") as File) ?? null,
    exceptions: (form.get("exceptions") as File) ?? null,
    codedTemplateFile: (form.get("codedTemplateFile") as File) ?? null,
    amazonOrders: (form.get("amazonOrders") as File) ?? null,
  };

  for (const key of Object.keys(REQUIRED_FILES)) {
    const file = files[key];
    if (!(file instanceof File)) {
      return NextResponse.json({ error: `Missing required file: ${key}` }, { status: 400 });
    }
    if (!isAllowed(file.name, REQUIRED_FILES[key as keyof typeof REQUIRED_FILES])) {
      return NextResponse.json({ error: `Invalid file type for ${key}. Allowed: ${REQUIRED_FILES[key as keyof typeof REQUIRED_FILES].join(", ")}` }, { status: 400 });
    }
  }

  for (const key of Object.keys(OPTIONAL_FILES)) {
    const file = files[key];
    if (file && !isAllowed(file.name, OPTIONAL_FILES[key as keyof typeof OPTIONAL_FILES])) {
      return NextResponse.json({ error: `Invalid file type for ${key}. Allowed: ${OPTIONAL_FILES[key as keyof typeof OPTIONAL_FILES].join(", ")}` }, { status: 400 });
    }
  }

  const job = createJob();

  const payload: UploadPayload = {
    bank: (await readBlob(files.bank))!,
    card: await readBlob(files.card),
    otherBank: await readBlob(files.otherBank),
    reference: await readBlob(files.reference),
    exceptions: await readBlob(files.exceptions),
    codedTemplateFile: await readBlob(files.codedTemplateFile),
    amazonOrders: await readBlob(files.amazonOrders),
    filenames: {
      bank: files.bank?.name ?? "",
      card: files.card?.name ?? "",
      otherBank: files.otherBank?.name ?? "",
      reference: files.reference?.name ?? "",
      exceptions: files.exceptions?.name ?? "",
      template: files.codedTemplateFile?.name ?? "",
      amazonOrders: files.amazonOrders?.name ?? "",
    },
    defaultProperty,
    cashAccount,
  };

  // Start processing asynchronously
  runJob(job.id, payload).catch((err) => {
    const message = (err as Error)?.message ?? "Unknown error";
    updateJob(job.id, { status: "error", percent: 100, step: "Error", errorMessage: message });
  });

  return NextResponse.json({ jobId: job.id });
}







