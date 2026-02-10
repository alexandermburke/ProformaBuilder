import assert from "node:assert/strict";
import test from "node:test";
import { authenticateUser } from "../src/lib/internalAuth";

test("authenticateUser returns false when firestore is unavailable", async () => {
  assert.equal(await authenticateUser("alex@storestorage.com", "password1"), false);
});

test("authenticateUser rejects empty credentials", async () => {
  assert.equal(await authenticateUser("", "password1"), false);
  assert.equal(await authenticateUser("alex@storestorage.com", ""), false);
});
