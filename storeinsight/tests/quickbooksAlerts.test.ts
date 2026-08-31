import assert from "node:assert/strict";
import test from "node:test";

process.env.AUTH_SECRET = process.env.AUTH_SECRET || "test-secret-for-quickbooks-unit-tests";

import {
  selectDueIssues,
  type AlertIssueMemory,
  type QuickBooksIssue,
} from "../src/lib/accounting/quickbooks/alerts";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-09-10T17:00:00.000Z");

const issue = (key: string, headline = `about ${key}`): QuickBooksIssue => ({
  key,
  kind: "needs_reauth",
  propertyCode: "W002",
  headline,
  detail: "detail",
  action: "action",
});

const remembered = (lastNotifiedAt: string, headline = "about a:1"): AlertIssueMemory => ({
  firstSeenAt: "2026-09-01T17:00:00.000Z",
  lastNotifiedAt,
  headline,
});

// ---------------------------------------------------------------------------
// The point of this logic is that a person keeps reading the emails. Seven
// identical alerts about one dead connection trains them not to, and silence
// is what let the August 2026 outage run for a week.
// ---------------------------------------------------------------------------

test("a problem nobody has been told about is reported", () => {
  const { due, recovered } = selectDueIssues([issue("a:1")], {}, NOW);
  assert.deepEqual(due.map((d) => d.key), ["a:1"]);
  assert.deepEqual(recovered, []);
});

test("the same problem tomorrow is not reported again", () => {
  const yesterday = new Date(NOW - DAY).toISOString();
  const { due } = selectDueIssues([issue("a:1")], { "a:1": remembered(yesterday) }, NOW);
  assert.deepEqual(due, [], "a daily cron must not send a daily email about one unchanged problem");
});

test("an unresolved problem is raised again after the renotify window", () => {
  const fourDaysAgo = new Date(NOW - 4 * DAY).toISOString();
  const { due } = selectDueIssues([issue("a:1")], { "a:1": remembered(fourDaysAgo) }, NOW);
  assert.deepEqual(due.map((d) => d.key), ["a:1"], "three days of silence is long enough");
});

test("a new problem is reported even while an older one is being suppressed", () => {
  const yesterday = new Date(NOW - DAY).toISOString();
  const { due } = selectDueIssues(
    [issue("a:1"), issue("b:2")],
    { "a:1": remembered(yesterday) },
    NOW,
  );
  assert.deepEqual(due.map((d) => d.key), ["b:2"]);
});

test("a problem that has cleared is reported once, by its old wording", () => {
  const yesterday = new Date(NOW - DAY).toISOString();
  const { due, recovered } = selectDueIssues(
    [],
    { "a:1": remembered(yesterday, "W002 is disconnected from QuickBooks") },
    NOW,
  );
  assert.deepEqual(due, []);
  assert.deepEqual(recovered, ["W002 is disconnected from QuickBooks"]);
});

test("an issue seen but never successfully emailed is still due", () => {
  // sendQuickBooksAlerts records the epoch when a send failed, so the next run retries.
  const { due } = selectDueIssues(
    [issue("a:1")],
    { "a:1": remembered("1970-01-01T00:00:00.000Z") },
    NOW,
  );
  assert.deepEqual(due.map((d) => d.key), ["a:1"]);
});

test("an unreadable last-notified timestamp fails toward telling someone", () => {
  const { due } = selectDueIssues([issue("a:1")], { "a:1": remembered("not a date") }, NOW);
  assert.deepEqual(due.map((d) => d.key), ["a:1"]);
});

test("nothing wrong and nothing remembered produces no email at all", () => {
  const { due, recovered } = selectDueIssues([], {}, NOW);
  assert.deepEqual(due, []);
  assert.deepEqual(recovered, []);
});
