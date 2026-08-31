import assert from "node:assert/strict";
import test from "node:test";

import { authorizeCronRequest } from "../src/lib/cronAuth";
import { isLiveCreateEnabled, liveCreateScope } from "../src/lib/accounting/quickbooks/config";

const SECRET = "cron-secret-for-unit-tests";

/** Only the headers matter, so a plain object standing in for NextRequest is enough. */
const requestWith = (headers: Record<string, string>) =>
  ({
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
  }) as unknown as Parameters<typeof authorizeCronRequest>[0];

const withEnv = <T>(vars: Record<string, string | undefined>, run: () => T): T => {
  const previous = new Map(Object.keys(vars).map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(vars)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

// ---------------------------------------------------------------------------
// Cron authorization. Every cron route used to accept any caller whose
// user-agent began with "vercel-cron", which a caller sets for free. These
// routes create bills in a QuickBooks company, so that had to stop being
// enough before pointing at a real company file.
// ---------------------------------------------------------------------------

test("a spoofed vercel-cron user-agent is not a credential", () => {
  withEnv({ CRON_SECRET: SECRET }, () => {
    const result = authorizeCronRequest(requestWith({ "user-agent": "vercel-cron/1.0" }));
    assert.equal(result.ok, false);
  });
});

test("Vercel's own Authorization bearer header is accepted", () => {
  withEnv({ CRON_SECRET: SECRET }, () => {
    const result = authorizeCronRequest(requestWith({ authorization: `Bearer ${SECRET}` }));
    assert.deepEqual(result, { ok: true, via: "bearer" });
  });
});

test("the manual x-cron-secret header is still accepted, so the runbook keeps working", () => {
  withEnv({ CRON_SECRET: SECRET }, () => {
    const result = authorizeCronRequest(requestWith({ "x-cron-secret": SECRET }));
    assert.deepEqual(result, { ok: true, via: "header" });
  });
});

test("a wrong secret is refused in either header form", () => {
  withEnv({ CRON_SECRET: SECRET }, () => {
    assert.equal(authorizeCronRequest(requestWith({ authorization: "Bearer nope" })).ok, false);
    assert.equal(authorizeCronRequest(requestWith({ "x-cron-secret": "nope" })).ok, false);
    // A prefix of the real secret must not pass.
    assert.equal(
      authorizeCronRequest(requestWith({ "x-cron-secret": SECRET.slice(0, -1) })).ok,
      false,
    );
  });
});

test("no credential at all is refused", () => {
  withEnv({ CRON_SECRET: SECRET }, () => {
    assert.equal(authorizeCronRequest(requestWith({})).ok, false);
  });
});

test("a deployment with no CRON_SECRET fails closed rather than open", () => {
  withEnv({ CRON_SECRET: undefined }, () => {
    const result = authorizeCronRequest(requestWith({ "x-cron-secret": SECRET }));
    assert.equal(result.ok, false);
    assert.match(result.ok === false ? result.reason : "", /CRON_SECRET/);
  });
});

// ---------------------------------------------------------------------------
// Live bill creation. One global boolean meant every property went live at
// once; a staged rollout needs one facility at a time. Writes are also refused
// off Vercel, because .env.local aims a laptop at the same Firestore and the
// same Intuit app as production.
// ---------------------------------------------------------------------------

const ON_VERCEL = { VERCEL: "1", QUICKBOOKS_ALLOW_LOCAL_WRITES: undefined };

test("live creation is off unless it is switched on", () => {
  withEnv({ ...ON_VERCEL, QUICKBOOKS_LIVE_CREATE: undefined }, () => {
    assert.equal(isLiveCreateEnabled("W003"), false);
  });
  withEnv({ ...ON_VERCEL, QUICKBOOKS_LIVE_CREATE: "false" }, () => {
    assert.equal(isLiveCreateEnabled("W003"), false);
  });
  // Anything that is not true and not a matching code is not permission.
  withEnv({ ...ON_VERCEL, QUICKBOOKS_LIVE_CREATE: "yes" }, () => {
    assert.equal(isLiveCreateEnabled("W003"), false);
  });
});

test("a property list enables exactly those properties", () => {
  withEnv({ ...ON_VERCEL, QUICKBOOKS_LIVE_CREATE: "W003, L001" }, () => {
    assert.equal(isLiveCreateEnabled("W003"), true);
    assert.equal(isLiveCreateEnabled("l001"), true, "the match is case insensitive");
    assert.equal(isLiveCreateEnabled("W002"), false, "a property not on the list stays dry");
    assert.equal(isLiveCreateEnabled("P006"), false);
    assert.deepEqual(liveCreateScope(), ["W003", "L001"]);
  });
});

test("true still means every property, for when the rollout is finished", () => {
  withEnv({ ...ON_VERCEL, QUICKBOOKS_LIVE_CREATE: "true" }, () => {
    assert.equal(isLiveCreateEnabled("W002"), true);
    assert.equal(isLiveCreateEnabled("P006"), true);
    assert.equal(liveCreateScope(), "all");
  });
});

test("a laptop cannot create real bills, even with the flag set", () => {
  withEnv(
    { VERCEL: undefined, QUICKBOOKS_ALLOW_LOCAL_WRITES: undefined, QUICKBOOKS_LIVE_CREATE: "true" },
    () => {
      assert.equal(isLiveCreateEnabled("W003"), false);
      assert.equal(liveCreateScope(), "none");
    },
  );
});

test("a local override exists for a deliberate one-off", () => {
  withEnv(
    { VERCEL: undefined, QUICKBOOKS_ALLOW_LOCAL_WRITES: "true", QUICKBOOKS_LIVE_CREATE: "W003" },
    () => {
      assert.equal(isLiveCreateEnabled("W003"), true);
      assert.equal(isLiveCreateEnabled("W002"), false);
    },
  );
});
