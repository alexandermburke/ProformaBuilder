import assert from "node:assert/strict";
import test from "node:test";
import { AUTH_USERS_ENV } from "../src/lib/authConstants";
import { authenticateUser } from "../src/lib/internalAuth";

const originalUsers = process.env[AUTH_USERS_ENV];

const restoreAuthUsers = () => {
  if (originalUsers === undefined) {
    delete process.env[AUTH_USERS_ENV];
  } else {
    process.env[AUTH_USERS_ENV] = originalUsers;
  }
};

test.afterEach(() => {
  restoreAuthUsers();
});

test("authenticateUser supports multiple entries and delimiters", () => {
  process.env[AUTH_USERS_ENV] =
    "alex@storestorage.com:password1, ashley@storestorage.com:password2; lauren@storestorage.com:password3\nkathy@storestorage.com:password4";

  assert.equal(authenticateUser("alex@storestorage.com", "password1"), true);
  assert.equal(authenticateUser("ashley@storestorage.com", "password2"), true);
  assert.equal(authenticateUser("lauren@storestorage.com", "password3"), true);
  assert.equal(authenticateUser("kathy@storestorage.com", "password4"), true);
});

test("authenticateUser allows colons in passwords", () => {
  process.env[AUTH_USERS_ENV] = "alex@storestorage.com:pass:word";

  assert.equal(authenticateUser("alex@storestorage.com", "pass:word"), true);
});
