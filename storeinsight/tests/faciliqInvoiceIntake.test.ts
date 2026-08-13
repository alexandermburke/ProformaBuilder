import assert from "node:assert/strict";
import test from "node:test";
import type { GraphFileAttachment, GraphMailMessage } from "../src/lib/graphMail";
import {
  FACILIQ_DEFAULT_SENDERS,
  MAX_EXPORT_BYTES,
  isCsvAttachment,
  looksLikeExportFilename,
  looksLikeExportSubject,
  messageSender,
  recognizeFaciliqExportEmail,
  resolveAllowedSenders,
} from "../src/lib/accounting/faciliqInvoiceIntake/recognizeExportEmail";
import { intakeDocId, isRetryableStatus } from "../src/lib/accounting/faciliqInvoiceIntake/records";

/**
 * The sender, subject, and attachment name are taken from the real weekly FacilIQ
 * notification received 2026-08-10 (period 2026-08-03 to 2026-08-09).
 */
const FACILIQ_SENDER = "support@faciliqpro.com";
const EXPORT_FILENAME = "store-quickbooks-2026-08-03-to-2026-08-09.csv";

const allowed = new Set([FACILIQ_SENDER]);

const message = (overrides: Partial<GraphMailMessage> = {}): GraphMailMessage => ({
  id: "AAMkAGI2NGVhZTVl",
  receivedDateTime: "2026-08-10T14:00:00Z",
  subject: "Invoice export ready",
  from: { emailAddress: { address: FACILIQ_SENDER } },
  hasAttachments: true,
  ...overrides,
});

const attachment = (overrides: Partial<GraphFileAttachment> = {}): GraphFileAttachment => ({
  id: "att-1",
  name: EXPORT_FILENAME,
  contentType: "text/csv",
  size: 4096,
  isInline: false,
  ...overrides,
});

const recognize = (
  attachments: GraphFileAttachment[],
  messageOverrides: Partial<GraphMailMessage> = {},
) =>
  recognizeFaciliqExportEmail({
    message: message(messageOverrides),
    attachments,
    allowedSenders: allowed,
  });

test("the real weekly export email is recognized, with its period read from the filename", () => {
  const result = recognize([attachment()]);

  assert.equal(result.matched, true);
  if (!result.matched) return;
  assert.equal(result.attachment.name, EXPORT_FILENAME);
  assert.deepEqual(result.window, { startIso: "2026-08-03", endIso: "2026-08-09" });
  assert.deepEqual(result.signals, {
    senderAllowed: true,
    subjectMatched: true,
    filenameMatched: true,
    windowInFilename: true,
    csvAttachmentCount: 1,
  });
});

test("a sender outside the allow-list is rejected before anything else is considered", () => {
  const result = recognize([attachment()], {
    from: { emailAddress: { address: "vendor@example.com" } },
  });

  assert.equal(result.matched, false);
  if (result.matched) return;
  assert.equal(result.reason, "sender-not-allowed");
  assert.equal(result.signals.senderAllowed, false);
});

test("a message with no attachments is rejected rather than treated as an empty export", () => {
  const result = recognize([]);

  assert.equal(result.matched, false);
  if (result.matched) return;
  assert.equal(result.reason, "no-attachments");
});

test("a FacilIQ email carrying only a PDF is rejected and names what was attached", () => {
  const result = recognize([
    attachment({ name: "invoice-summary.pdf", contentType: "application/pdf" }),
  ]);

  assert.equal(result.matched, false);
  if (result.matched) return;
  assert.equal(result.reason, "no-csv-attachment");
  assert.match(result.detail, /invoice-summary\.pdf/);
});

test("the inline logo in FacilIQ's HTML body is never a candidate", () => {
  const logo = attachment({ id: "logo", name: "faciliq-logo.png", contentType: "image/png", isInline: true });
  assert.equal(isCsvAttachment(logo), false);

  const result = recognize([logo, attachment()]);
  assert.equal(result.matched, true);
  if (!result.matched) return;
  assert.equal(result.attachment.name, EXPORT_FILENAME);
  assert.equal(result.signals.csvAttachmentCount, 1);
});

test("the export-shaped CSV wins when another CSV rides along", () => {
  const result = recognize([
    attachment({ id: "other", name: "vendor-notes.csv" }),
    attachment(),
  ]);

  assert.equal(result.matched, true);
  if (!result.matched) return;
  assert.equal(result.attachment.name, EXPORT_FILENAME);
  assert.equal(result.signals.csvAttachmentCount, 2);
});

test("two equally export-shaped CSVs are reported as ambiguous instead of guessed at", () => {
  const result = recognize([
    attachment({ id: "a", name: "store-quickbooks-2026-08-03-to-2026-08-09.csv" }),
    attachment({ id: "b", name: "store-quickbooks-2026-07-27-to-2026-08-02.csv" }),
  ]);

  assert.equal(result.matched, false);
  if (result.matched) return;
  assert.equal(result.reason, "ambiguous-csv-attachment");
  assert.match(result.detail, /2026-07-27/);
});

test("two unremarkable CSVs are ambiguous, because neither is the weekly export", () => {
  const result = recognize([
    attachment({ id: "a", name: "notes.csv" }),
    attachment({ id: "b", name: "extra.csv" }),
  ]);

  assert.equal(result.matched, false);
  if (result.matched) return;
  assert.equal(result.reason, "ambiguous-csv-attachment");
});

test("a zero-byte attachment is rejected rather than parsed into an empty report", () => {
  const result = recognize([attachment({ size: 0 })]);

  assert.equal(result.matched, false);
  if (result.matched) return;
  assert.equal(result.reason, "attachment-empty");
});

test("the automated path enforces the same 10 MB ceiling as the manual upload", () => {
  const result = recognize([attachment({ size: MAX_EXPORT_BYTES + 1 })]);

  assert.equal(result.matched, false);
  if (result.matched) return;
  assert.equal(result.reason, "attachment-too-large");
  assert.match(result.detail, /10 MB/);
});

test("a renamed export is still accepted, and the missing period is reported as a signal", () => {
  const result = recognize([attachment({ name: "weekly-invoices.csv" })], {
    subject: "Invoice export ready",
  });

  assert.equal(result.matched, true);
  if (!result.matched) return;
  assert.equal(result.window, null);
  assert.equal(result.signals.filenameMatched, false);
  assert.equal(result.signals.windowInFilename, false);
});

test("filename and subject signals read FacilIQ's own naming", () => {
  assert.equal(looksLikeExportFilename(EXPORT_FILENAME), true);
  assert.equal(looksLikeExportFilename("store-quickbooks-latest.csv"), true);
  assert.equal(looksLikeExportFilename("random.csv"), false);

  assert.equal(looksLikeExportSubject("Invoice export ready"), true);
  assert.equal(looksLikeExportSubject("Approved Invoice OBR-1042"), false);
  assert.equal(looksLikeExportSubject(undefined), false);
});

test("the sender is compared case- and whitespace-insensitively", () => {
  assert.equal(
    messageSender(message({ from: { emailAddress: { address: "  Support@FaciliQPro.com " } } })),
    FACILIQ_SENDER,
  );
});

test("the sender allow-list falls back to FacilIQ, never to everyone", () => {
  const previous = process.env.FACILIQ_ALLOWED_SENDERS;
  try {
    delete process.env.FACILIQ_ALLOWED_SENDERS;
    assert.deepEqual([...resolveAllowedSenders()], [...FACILIQ_DEFAULT_SENDERS]);
    // An empty env value must not widen the filter to the whole mailbox.
    process.env.FACILIQ_ALLOWED_SENDERS = "";
    assert.deepEqual([...resolveAllowedSenders()], [...FACILIQ_DEFAULT_SENDERS]);

    process.env.FACILIQ_ALLOWED_SENDERS = "Billing@FaciliQPro.com , support@faciliqpro.com";
    assert.deepEqual(
      [...resolveAllowedSenders()],
      ["billing@faciliqpro.com", "support@faciliqpro.com"],
    );
    // An explicit argument wins over the environment.
    assert.deepEqual([...resolveAllowedSenders(["ops@faciliqpro.com"])], ["ops@faciliqpro.com"]);
  } finally {
    if (previous === undefined) delete process.env.FACILIQ_ALLOWED_SENDERS;
    else process.env.FACILIQ_ALLOWED_SENDERS = previous;
  }
});

test("Graph message ids are rewritten into legal Firestore document ids", () => {
  // Firestore forbids '/' in a document id; Graph ids can contain one.
  assert.equal(intakeDocId("AAMkAG/I2NGVh+ZTVl="), "AAMkAG_I2NGVh-ZTVl=");
  assert.equal(intakeDocId("AAMkAGI2NGVhZTVl"), "AAMkAGI2NGVhZTVl");
  // Deterministic: a retry has to resolve to the same document.
  assert.equal(intakeDocId("AAMkAG/I2"), intakeDocId("AAMkAG/I2"));
});

test("an interrupted run is retryable, a finished one is not", () => {
  assert.equal(isRetryableStatus("failed"), true);
  assert.equal(isRetryableStatus("claimed"), true);
  assert.equal(isRetryableStatus("parsed"), false);
  assert.equal(isRetryableStatus("duplicate"), false);
  assert.equal(isRetryableStatus("rejected"), false);
});
