import assert from "node:assert/strict";
import test from "node:test";
import { extractPropertyLookupCandidates, resolvePropertyFromLabels } from "../src/lib/dailySummaryPropertyMatch";
import type { PropertyConfig } from "../src/types/dailySummary";

const property = (overrides: Partial<PropertyConfig>): PropertyConfig => ({
  id: overrides.id ?? "P006",
  propertyCode: overrides.propertyCode ?? "storeinplymouth",
  propertyId: overrides.propertyId ?? "P006",
  name: overrides.name ?? "STORE on Vicksburg",
  tenantPropertyId: overrides.tenantPropertyId ?? overrides.propertyId ?? "P006",
  timezone: "America/Phoenix",
  sendTimeLocal: "08:00",
  ownerEmails: [],
  enabled: true,
});

test("extracts code and compact property name from Tenant MSR labels", () => {
  assert.deepEqual(extractPropertyLookupCandidates("P006 - STORE in Plymouth"), [
    "p006 - store in plymouth",
    "p006storeinplymouth",
    "p006",
    "store in plymouth",
    "storeinplymouth",
  ]);
});

test("resolves configured property by leading Tenant property id", () => {
  const match = resolvePropertyFromLabels(
    [
      property({ id: "L001", propertyCode: "storeatthegrove", propertyId: "L001", name: "STORE at the Grove" }),
      property({}),
    ],
    ["P006 - STORE in Plymouth"],
  );

  assert.equal(match?.id, "P006");
});

test("resolves configured property by compact slug-like label", () => {
  const match = resolvePropertyFromLabels(
    [
      property({ id: "L001", propertyCode: "storeatthegrove", propertyId: "L001", name: "STORE at the Grove" }),
      property({}),
    ],
    ["STORE in Plymouth"],
  );

  assert.equal(match?.id, "P006");
});
