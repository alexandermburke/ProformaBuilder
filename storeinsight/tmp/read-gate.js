const fs = require('fs');
const raw = fs.readFileSync(process.argv[2], 'utf8');
let s = raw;
try {
  const p = JSON.parse(raw);
  s = p.gate ?? p.result?.gate ?? raw;
} catch {
  const m = raw.match(/"gate"\s*:\s*"/);
  if (m) {
    // Walk the JSON string manually to survive escapes.
    let out = '';
    for (let i = m.index + m[0].length; i < raw.length; i += 1) {
      const c = raw[i];
      if (c === '\') {
        const n = raw[i + 1];
        out += n === 'n' ? '\n' : n === 't' ? '\t' : n === '"' ? '"' : n === '\' ? '\' : n;
        i += 1;
      } else if (c === '"') break;
      else out += c;
    }
    s = out;
  }
}
const from = process.argv[3] || '';
const i = from ? s.indexOf(from) : 0;
console.log(s.slice(i < 0 ? 0 : i, (i < 0 ? 0 : i) + Number(process.argv[4] || 6000)));
