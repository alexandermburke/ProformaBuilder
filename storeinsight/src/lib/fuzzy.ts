// Lightweight string similarity for header auto-mapping (no deps).
// Implements Jaro–Winkler and a tiny tokenizer-based booster.

export function jaroWinkler(aIn: string, bIn: string): number {
  const a = aIn.toLowerCase();
  const b = bIn.toLowerCase();
  if (a === b) return 1;

  const m = Math.floor(Math.max(a.length, b.length) / 2) - 1;
  let matches = 0;
  const aMatches = new Array(a.length).fill(false);
  const bMatches = new Array(b.length).fill(false);

  for (let i = 0; i < a.length; i++) {
    const start = Math.max(0, i - m);
    const end = Math.min(i + m + 1, b.length);
    for (let j = start; j < end; j++) {
      if (bMatches[j]) continue;
      if (a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;

  let t = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  const transpositions = t / 2;
  const jaro =
    (matches / a.length + matches / b.length + (matches - transpositions) / matches) / 3;

  // Winkler prefix boost (common 0.1)
  let l = 0;
  const maxPrefix = 4;
  while (l < Math.min(a.length, b.length, maxPrefix) && a[l] === b[l]) l++;
  const jw = jaro + l * 0.1 * (1 - jaro);
  return Math.max(0, Math.min(1, jw));
}

export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export function tokenBoost(a: string, b: string): number {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  ta.forEach((tok) => {
    if (tb.has(tok)) inter++;
  });
  const j = inter / Math.max(ta.size, tb.size);
  return j * 0.15; // small boost
}

export function similarity(a: string, b: string): number {
  const base = jaroWinkler(a, b);
  return Math.max(0, Math.min(1, base + tokenBoost(a, b)));
}