/** Dry run of the intake: reads the mailbox, records nothing. */
import path from "node:path";
import dotenv from "dotenv";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
const main = async () => {
  const { runFaciliqInvoiceIntake } = await import("../src/lib/accounting/faciliqInvoiceIntake/runFaciliqInvoiceIntake");
  const s = await runFaciliqInvoiceIntake({ dryRun: true });
  console.log(JSON.stringify({
    mailbox: s.mailbox,
    messagesScanned: s.messagesScanned,
    skippedOtherSenders: s.skippedOtherSenders,
    alreadyRecorded: s.alreadyRecorded,
    parsed: s.parsed,
    duplicates: s.duplicates,
    rejected: s.rejected,
    failed: s.failed,
  }, null, 2));
};
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
