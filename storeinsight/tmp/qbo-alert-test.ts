/** Dry run of the QuickBooks alerting: reports what it would email, writes nothing. */
import path from "node:path";
import dotenv from "dotenv";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });

const main = async () => {
  const { sendQuickBooksAlerts } = await import("../src/lib/accounting/quickbooks/alerts");
  const summary = await sendQuickBooksAlerts({ dryRun: true });
  console.log(`\nopen issues: ${summary.issues.length}`);
  for (const issue of summary.issues) {
    console.log(`\n  [${issue.kind}] ${issue.headline}`);
    console.log(`     key    ${issue.key}`);
    console.log(`     detail ${issue.detail}`);
    console.log(`     action ${issue.action}`);
  }
  console.log(`\nwould notify: ${summary.notified.length}`);
  console.log(`recovered:    ${summary.recovered.length}`);
  console.log(`skipped:      ${summary.skippedReason ?? "(sending)"}`);
  console.log(`recipients:   ${process.env.QUICKBOOKS_ALERT_TO ?? process.env.ALERT_EMAIL_TO ?? "(NOT SET)"}`);
};
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
