// The text of one string field read out of a JSON answer that is still arriving — for the live
// coach draft: the model streams `{"reply":"Bench went well. Next time…` and the user should see
// "Bench went well. Next time…" growing, not raw JSON. Handles escapes (\n, \", \\, \uXXXX) and
// stops cleanly at a cut-off escape. Returns null until the field's value has started.
// Pure; test/partial-json.test.ts.

const SIMPLE: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", '"': '"', "\\": "\\", "/": "/" };

export function partialJsonString(raw: string, field: string): string | null {
  const key = new RegExp(`"${field}"\\s*:\\s*"`).exec(raw);
  if (!key) return null;
  let out = "";
  for (let i = key.index + key[0].length; i < raw.length; i++) {
    const ch = raw[i]!;
    if (ch === '"') return out; // the value is complete
    if (ch !== "\\") { out += ch; continue; }
    const next = raw[i + 1];
    if (next === undefined) break; // escape cut off mid-stream
    if (next === "u") {
      const hex = raw.slice(i + 2, i + 6);
      if (hex.length < 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) break;
      out += String.fromCharCode(parseInt(hex, 16));
      i += 5;
      continue;
    }
    out += SIMPLE[next] ?? next;
    i++;
  }
  return out;
}
