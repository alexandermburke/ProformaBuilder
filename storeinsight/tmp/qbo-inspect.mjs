// READ ONLY inspection of the QBO + FaciliQ Firestore state. Prints no token material.
import path from 'node:path';
import dotenv from 'dotenv';
import admin from 'firebase-admin';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\n/g, '\n'),
  }),
});
const db = admin.firestore();

const line = (s) => console.log(s);
const hr = (t) => { line(''); line('='.repeat(78)); line(t); line('='.repeat(78)); };

hr('quickbooksConnections');
const conns = await db.collection('quickbooksConnections').get();
line(`docs: ${conns.size}`);
for (const d of conns.docs) {
  const c = d.data();
  line('');
  line(`  ${d.id}  status=${c.status}  env=${c.environment}  realm=${c.realmId}`);
  line(`    company        ${c.companyName} / ${c.companyLegalName} (verified=${c.companyNameVerified})`);
  line(`    connectedAt    ${c.connectedAt}   by ${c.connectedBy}`);
  line(`    lastRefreshed  ${c.lastRefreshedAt}`);
  line(`    accessExpires  ${c.accessTokenExpiresAt}`);
  line(`    refreshExpires ${c.refreshTokenExpiresAt}`);
  line(`    updatedAt      ${c.updatedAt?.toDate?.().toISOString?.() ?? c.updatedAt}`);
  line(`    lastError      ${c.lastError ?? '(none)'}`);
  const acc = c.accessTokenEnc || '';
  const ref = c.refreshTokenEnc || '';
  line(`    ciphertext len access=${acc.length} refresh=${ref.length}`);
}

hr('faciliqInvoiceExports (intake ledger, newest 15 by receivedAt)');
const ex = await db.collection('faciliqInvoiceExports').orderBy('receivedAt', 'desc').limit(15).get();
line(`docs returned: ${ex.size}`);
for (const d of ex.docs) {
  const r = d.data();
  line('');
  line(`  ${r.receivedAt}  ${r.status.toUpperCase()}  upload=${r.uploadStatus}  dryRun=${r.lastUploadWasDryRun}`);
  line(`    subject      ${r.subject}`);
  line(`    from         ${r.from}   mailbox=${r.mailbox}`);
  line(`    period       ${r.periodStartIso} .. ${r.periodEndIso}   asOf=${r.asOfIso}`);
  line(`    attachment   ${r.attachmentName} (${r.attachmentBytes} bytes)`);
  line(`    totals       ${JSON.stringify(r.totals)}`);
  line(`    properties   ${(r.properties||[]).map(p => `${p.code}:ready=${p.readyRows}/$${p.readyAmount} review=${p.reviewRows}/$${p.reviewAmount}`).join('  ') || '(none)'}`);
  line(`    uploadCounts ${JSON.stringify(r.uploadCounts)}`);
  line(`    lastUploadAt ${r.lastUploadAt}`);
  line(`    lastUploadErr ${r.lastUploadError ?? '(none)'}`);
  line(`    error        ${r.error ?? '(none)'}   rejection=${r.rejectionReason ?? '(none)'}  headerError=${r.headerError ?? '(none)'}`);
  line(`    attempts     ${r.attempts}   processed=${r.processed}   firstSeen=${r.firstSeenAt}  lastRun=${r.lastRunAt}`);
  line(`    notes        ${JSON.stringify(r.notes)}`);
  line(`    docId        ${d.id}`);
  line(`    messageId    ${r.messageId}`);
}

hr('faciliqInvoiceBills (all, newest 40 by lastRunAt)');
const bills = await db.collection('faciliqInvoiceBills').orderBy('lastRunAt', 'desc').limit(40).get();
line(`docs returned: ${bills.size}`);
for (const d of bills.docs) {
  const b = d.data();
  line('');
  line(`  ${b.lastRunAt}  ${b.propertyCode}  ${b.status.toUpperCase()}  qboBillId=${b.quickBooksBillId ?? '-'}  dryRun=${b.lastRunWasDryRun}`);
  line(`    billKey      ${b.billKey}`);
  line(`    vendor       ${b.vendorName} (ref=${b.vendorRefId ?? '-'})  inv#${b.invoiceNumber}  ${b.invoiceDateIso}  $${b.amount}`);
  line(`    gl           ${JSON.stringify(b.glCodes)}  lines=${b.lineCount}  realm=${b.realmId ?? '-'} env=${b.environment ?? '-'}`);
  line(`    attempts     ${b.attempts}  uploadedAt=${b.uploadedAt ?? '-'}`);
  line(`    error        ${b.error ?? '(none)'}`);
  line(`    unresolved   vendor=${b.unresolvedVendor ?? '-'} accounts=${JSON.stringify(b.unresolvedAccounts)}`);
  line(`    exports      ${JSON.stringify(b.exportMessageIds)}`);
  line(`    source       ${b.sourceFilename}`);
}

hr('collection sizes');
for (const name of ['quickbooksConnections','quickbooksOAuthStates','faciliqInvoiceExports','faciliqInvoiceBills']) {
  const s = await db.collection(name).count().get();
  line(`  ${name}: ${s.data().count}`);
}

process.exit(0);
