import { NextRequest, NextResponse } from "next/server";
import { normalizeAll } from "@/lib/accounting/bankCardImportPrep/normalize";
import { parseBank } from "@/lib/accounting/bankCardImportPrep/parseBank";
import { parseCard } from "@/lib/accounting/bankCardImportPrep/parseCard";
import { parseOtherBank } from "@/lib/accounting/bankCardImportPrep/parseOtherBank";
import { applyRules, buildRules, parseCodedWorkbook } from "@/lib/accounting/bankCardImportPrep/rulesEngine/learnRules";
import { validateRows } from "@/lib/accounting/bankCardImportPrep/validate";
import { createJob, getJob, updateJob } from "../jobStore";

export const runtime = "nodejs";
const DIGITS_ONLY = /^\d+$/;
const envDefaultCashAccount =
  process.env.BANK_IMPORT_DEFAULT_CASH_ACCOUNT?.trim() ||
  process.env.DEFAULT_CASH_ACCOUNT?.trim() ||
  "";

type UploadPayload = {
  bank: Buffer;
  card: Buffer;
  otherBank: Buffer;
  reference?: Buffer | null;
  exceptions?: Buffer | null;
  codedTemplateFile?: Buffer | null;
  filenames: Record<string, string>;
  defaultProperty: string;
  cashAccount?: string;
};

const REQUIRED_FILES = {
  bank: ["csv", "xlsx"],
  card: ["csv", "xlsx"],
  otherBank: ["xlsx", "csv"],
} as const;

const OPTIONAL_FILES = {
  reference: ["csv", "xlsx"],
  exceptions: ["csv"],
  codedTemplateFile: ["xlsx"],
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

type NormalizeAllResult = Awaited<ReturnType<typeof normalizeAll>>;

function applyTenantDepositRule(rows: NormalizeAllResult["rows"]) {
  const tenantPattern = /^deposit\s+tenant/i;
  return rows.map((row) => {
    if (!row.notes || !tenantPattern.test(row.notes.trim())) return row;
    const ref = formatTenantDepositReference(row.postMonth, row.journalDate) || row.reference || row.detailNotes;
    return {
      ...row,
      account: "4401",
      reference: ref,
      detailNotes: ref,
    };
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

  try {
    append(["[job] starting Bank & Card Import Prep"], [], "Validate inputs", 5);
    updateJob(jobId, {
      status: "running",
      defaultProperty: payload.defaultProperty,
      cashAccount: payload.cashAccount ?? "",
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
    const bankResult = await parseBank(payload.bank);
    append(bankResult.logs, bankResult.warnings, "Parse bank export", 20);

    const cardResult = await parseCard(payload.card);
    append(cardResult.logs, cardResult.warnings, "Parse card export", 40);

    const otherResult = await parseOtherBank(payload.otherBank);
    append(otherResult.logs, otherResult.warnings, "Parse other bank activity", 55);

    if (payload.reference) {
      append([`[reference] received (${payload.filenames.reference || "reference"})`]);
    }
    if (payload.exceptions) {
      append([`[exceptions] received (${payload.filenames.exceptions || "exceptions"})`]);
    }

    const normalized = await normalizeAll(bankResult, cardResult, otherResult, "");
    append(normalized.logs, normalized.warnings, "Normalize & map to Yardi", 65);

    const resolvedCashAccount = payload.cashAccount?.trim() || templateCashAccount || envDefaultCashAccount;
    const missingCashAccount = !resolvedCashAccount;

    let otherBankDropped = 0;
    let otherBankKept = 0;
    const filteredRows: typeof normalized.rows = [];
    normalized.rows.forEach((row) => {
      if (row.source !== "other-bank") {
        filteredRows.push(row);
        return;
      }
      if (!resolvedCashAccount) {
        otherBankKept += 1;
        filteredRows.push(row);
        return;
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
        return;
      }
      otherBankKept += 1;
      filteredRows.push(row);
    });

    if (resolvedCashAccount) {
      append([
        `[other-bank] dropped ${otherBankDropped} cash-side rows (Account=${resolvedCashAccount}) from Other Bank Activity to prevent duplicates`,
        `[other-bank] kept ${otherBankKept} offset rows → ${otherBankKept} transactions`,
      ]);
    }

    const knownProperties = new Set(
      normalized.rows
        .map((row) => row.propertyName?.trim())
        .filter((val): val is string => Boolean(val)),
    );
    const singleSourceProperty = knownProperties.size === 1 ? Array.from(knownProperties)[0] : "";
    const defaultProperty =
      templateProperty?.trim() ||
      (singleSourceProperty ? singleSourceProperty : "") ||
      (payload.defaultProperty?.trim() ?? "");

    let defaultApplied = 0;
    const rowsWithDefaults = filteredRows.map((row) => {
      if (row.propertyName?.trim()) return row;
      if (!defaultProperty) return row;
      defaultApplied += 1;
      return { ...row, propertyName: defaultProperty };
    });

    if (defaultApplied > 0) {
      append([`[normalize] applied default property to ${defaultApplied} rows`]);
    }

    const ruleApplied = applyRules(rowsWithDefaults, rules);
    const tenantAppliedRows = applyTenantDepositRule(ruleApplied.rows);
    templateSummary = {
      matched: ruleApplied.exactMatches + ruleApplied.signatureMatches,
      templateCount: rules.totalExamples,
      unmatchedSamples: ruleApplied.unmatchedSamples,
    };
    if (rules.totalExamples > 0) {
      append(
        [
          `[rules] exact matches: ${ruleApplied.exactMatches}, fuzzy matches: ${ruleApplied.signatureMatches}, unmatched: ${ruleApplied.unmatched}`,
        ],
        [],
        "Apply template mapping",
        70,
      );
    }

    const validated = validateRows(tenantAppliedRows);
    append(validated.logs, validated.warnings, "Validate rows & warnings", 85);

    const unmappedCount = validated.rows.reduce(
      (count, row) =>
        count +
        (isPropertyMissing(row.Property_Name) || isAccountInvalid(row.Account) ? 1 : 0),
      0,
    );
    if (unmappedCount > 0) {
      append([`[review] ${unmappedCount} rows need Property_Name and/or Account`], [], "Review unmapped rows", 95);
    }

    const baseUpdate = {
      percent: unmappedCount > 0 ? 95 : 100,
      step: unmappedCount > 0 ? "Review unmapped rows" : "Complete",
      downloadReady: false,
      rows: validated.rows,
      needsReview: unmappedCount > 0,
      unmappedCount,
      counts: {
        bank: bankResult.rows.length,
        card: cardResult.rows.length,
        otherBank: resolvedCashAccount ? otherBankKept : otherResult.rows.length,
        output: validated.transactions * 2 + validated.passthrough,
        transactions: validated.transactions,
      },
      templateCashAccount: templateCashAccount ?? undefined,
      templateTxCount: templateSummary.templateCount,
      matchedTxCount: templateSummary.matched,
      unmatchedSamples: templateSummary.unmatchedSamples,
      strictTemplate: false,
      missingCashAccount: false,
      defaultProperty,
      outputBuffer: undefined,
      outputFilename: undefined,
    } as const;

    updateJob(jobId, baseUpdate);

    if (missingCashAccount) {
      append(["[validate] missing cash account; unable to build workbook"]);
    }
    updateJob(jobId, {
      ...baseUpdate,
      cashAccount: resolvedCashAccount,
      missingCashAccount,
      needsReview: baseUpdate.needsReview || missingCashAccount,
    });

    if (unmappedCount > 0 || missingCashAccount) {
      updateJob(jobId, { status: "done" });
      return;
    }

    const { buffer, filename, emitted } = buildWorkbook(validated.rows, {
      cashAccount: resolvedCashAccount,
    });
    append(
      [`[build] emitted ${emitted} journal rows (cash + offset)`, `[build] workbook ready (${filename})`],
      [],
      "Build workbook",
      98,
    );

    updateJob(jobId, {
      ...baseUpdate,
      status: "done",
      percent: 100,
      step: "Complete",
      downloadReady: true,
      outputBuffer: buffer,
      outputFilename: filename,
      needsReview: false,
      unmappedCount: 0,
      counts: {
        ...baseUpdate.counts,
        output: emitted,
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
    card: (await readBlob(files.card))!,
    otherBank: (await readBlob(files.otherBank))!,
    reference: await readBlob(files.reference),
    exceptions: await readBlob(files.exceptions),
    codedTemplateFile: await readBlob(files.codedTemplateFile),
    filenames: {
      bank: files.bank?.name ?? "",
      card: files.card?.name ?? "",
      otherBank: files.otherBank?.name ?? "",
      reference: files.reference?.name ?? "",
      exceptions: files.exceptions?.name ?? "",
      template: files.codedTemplateFile?.name ?? "",
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
