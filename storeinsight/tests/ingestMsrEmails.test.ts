import assert from "node:assert/strict";
import test from "node:test";
import { extractViewerUrlFromHtml, isTenantViewerUrl } from "../src/lib/ingestMsrEmails";

const canonicalViewerUrl =
  "https://reportviewer.tenantinc.com/shared-reports/owners/owner-123/folders/folder-456?docIds=abc123";

test("extractViewerUrlFromHtml prefers the canonical Tenant viewer URL over tracking links", () => {
  const html = `
    <html>
      <body>
        <a href="https://track.pstmrk.it/3s/renter.link%2FLpdTT/fyQBAQ/sGzEAQ/Aw/token/5/hash">View report</a>
        <a href="${canonicalViewerUrl}">Open in Tenant</a>
      </body>
    </html>
  `;

  assert.equal(extractViewerUrlFromHtml(html), canonicalViewerUrl);
});

test("extractViewerUrlFromHtml unwraps Outlook safelinks to the Tenant viewer URL", () => {
  const wrapped = `https://nam12.safelinks.protection.outlook.com/?url=${encodeURIComponent(canonicalViewerUrl)}`;
  const html = `<a href="${wrapped}">Tenant report</a>`;

  assert.equal(extractViewerUrlFromHtml(html), canonicalViewerUrl);
});

test("extractViewerUrlFromHtml unwraps tracked Postmark links to the renter shortlink when no direct viewer URL exists", () => {
  const tracked = "https://track.pstmrk.it/3s/renter.link%2FLpdTT/fyQBAQ/sGzEAQ/Aw/token/5/hash";
  const html = `<a href="${tracked}">View and Download Reports</a>`;

  assert.equal(extractViewerUrlFromHtml(html), "https://renter.link/LpdTT");
});

test("isTenantViewerUrl rejects tracking links and accepts canonical viewer URLs", () => {
  assert.equal(isTenantViewerUrl(canonicalViewerUrl), true);
  assert.equal(
    isTenantViewerUrl("https://track.pstmrk.it/3s/renter.link%2FLpdTT/fyQBAQ/sGzEAQ/Aw/token/5/hash"),
    false,
  );
});
