import assert from "node:assert/strict";
import test from "node:test";
import { resolveDashboardEmailPropertyId } from "../src/lib/flash/dashboardEmailConfig";

test("resolves Plymouth/Vicksburg daily flash aliases to the P006 historical dashboard", () => {
  assert.equal(resolveDashboardEmailPropertyId("P006"), "P006");
  assert.equal(resolveDashboardEmailPropertyId("storeinplymouth"), "P006");
  assert.equal(resolveDashboardEmailPropertyId("STORE on Vicksburg"), "P006");
});

test("keeps existing daily flash dashboard mappings", () => {
  assert.equal(resolveDashboardEmailPropertyId("L001"), "L001");
  assert.equal(resolveDashboardEmailPropertyId("storeonbaseline"), "W003");
  assert.equal(resolveDashboardEmailPropertyId("prop-pittman"), "prop-pittman");
});
