import assert from "node:assert/strict";
import test from "node:test";
import { REQUIRED_DELINQUENCY_TOKENS, scanPptTokens } from "../src/lib/pptTokens";

test(
  "fast - MICROTEMPLATE contains required delinquency placeholders",
  { timeout: 2_000 },
  async () => {
    const scan = await scanPptTokens();
    const missing = REQUIRED_DELINQUENCY_TOKENS.filter((token) => !scan.tokens.includes(token));
    assert.strictEqual(
      missing.length,
      0,
      `public/MICROTEMPLATE.pptx is missing delinquency placeholders: ${missing.join(", ")}`,
    );
  },
);
