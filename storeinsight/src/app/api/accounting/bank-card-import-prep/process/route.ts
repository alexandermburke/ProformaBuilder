import { NextRequest, NextResponse } from "next/server";
import { buildWorkbook } from "@/lib/accounting/bankCardImportPrep/buildWorkbook";
import { normalizeAll } from "@/lib/accounting/bankCardImportPrep/normalize";
import { parseBank } from "@/lib/accounting/bankCardImportPrep/parseBank";
import { parseCard } from "@/lib/accounting/bankCardImportPrep/parseCard";
import { parseOtherBank } from "@/lib/accounting/bankCardImportPrep/parseOtherBank";
import { validateRows } from "@/lib/accounting/bankCardImportPrep/validate";
import { createJob, getJob, updateJob } from "../jobStore";

export const runtime = "nodejs";
const DIGITS_ONLY = /^\d+$/;

type UploadPayload = {
  bank: Buffer;
  card: Buffer;
  otherBank: Buffer;
  reference?: Buffer | null;
  exceptions?: Buffer | null;
  filenames: Record<string, string>;
  defaultProperty: string;
};

const REQUIRED_FILES = {
  bank: ["csv", "xlsx"],
  card: ["csv", "xlsx"],
  otherBank: ["xlsx", "csv"],
} as const;

const OPTIONAL_FILES = {
  reference: ["csv", "xlsx"],
  exceptions: ["csv"],
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
    updateJob(jobId, { status: "running", defaultProperty: payload.defaultProperty });

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

    const normalized = await normalizeAll(bankResult, cardResult, otherResult, payload.defaultProperty);
    append(normalized.logs, normalized.warnings, "Normalize & map to Yardi", 70);

    const validated = validateRows(normalized.rows);
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
        otherBank: otherResult.rows.length,
        output: validated.rows.length,
      },
      outputBuffer: undefined,
      outputFilename: undefined,
    } as const;

    updateJob(jobId, baseUpdate);

    if (unmappedCount > 0) {
      updateJob(jobId, { status: "done" });
      return;
    }

    const { buffer, filename } = buildWorkbook(validated.rows);
    append([`[build] workbook ready (${filename}), rows: ${validated.rows.length}`], [], "Build workbook", 98);

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

  const files: Record<string, File | null> = {
    bank: (form.get("bank") as File) ?? null,
    card: (form.get("card") as File) ?? null,
    otherBank: (form.get("otherBank") as File) ?? null,
    reference: (form.get("reference") as File) ?? null,
    exceptions: (form.get("exceptions") as File) ?? null,
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

  if (!defaultProperty) {
    return NextResponse.json({ error: "defaultProperty is required" }, { status: 400 });
  }

  const job = createJob();

  const payload: UploadPayload = {
    bank: (await readBlob(files.bank))!,
    card: (await readBlob(files.card))!,
    otherBank: (await readBlob(files.otherBank))!,
    reference: await readBlob(files.reference),
    exceptions: await readBlob(files.exceptions),
    filenames: {
      bank: files.bank?.name ?? "",
      card: files.card?.name ?? "",
      otherBank: files.otherBank?.name ?? "",
      reference: files.reference?.name ?? "",
      exceptions: files.exceptions?.name ?? "",
    },
    defaultProperty,
  };

  // Start processing asynchronously
  runJob(job.id, payload).catch((err) => {
    const message = (err as Error)?.message ?? "Unknown error";
    updateJob(job.id, { status: "error", percent: 100, step: "Error", errorMessage: message });
  });

  return NextResponse.json({ jobId: job.id });
}
