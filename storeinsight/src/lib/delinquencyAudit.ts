import type {
  DelinquencyTokenProvenance,
  DelinquencyTokens,
} from "@/lib/extractDelinquency";
import { REQUIRED_DELINQUENCY_TOKENS } from "@/lib/pptTokens";

export type DelinquencyAuditRow = {
  token: string;
  value: string;
  sheet: string;
  cells: string[];
};

type BuildAuditRowsInput = {
  tokens: DelinquencyTokens;
  provenance: DelinquencyTokenProvenance;
};

type BuildAuditRowsOptions = {
  placeholder?: string;
};

export function buildDelinquencyAuditRows(
  input: BuildAuditRowsInput,
  options?: BuildAuditRowsOptions,
): DelinquencyAuditRow[] {
  const placeholder = options?.placeholder ?? "\u2013";
  return REQUIRED_DELINQUENCY_TOKENS.map((token) => {
    const key = token as keyof DelinquencyTokens;
    const provenance = input.provenance[key];
    const uniqueCells = Array.from(
      new Set((provenance?.cells ?? []).filter(Boolean)),
    );
    return {
      token,
      value: String(input.tokens[key] ?? ""),
      sheet: provenance?.sheet?.trim() || placeholder,
      cells: uniqueCells,
    };
  });
}
