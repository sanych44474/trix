// Runtime input validation for the Mini App API. TypeScript checks nothing at the Worker
// boundary — a client can send any JSON shape, any field type, any string length — and until
// now every handler hand-rolled its own `Number(body.x)` / `typeof` / range checks inline,
// inconsistently, with several fields not checked at all (see the priority-fixes review this
// closes item #2 of). This is deliberately NOT a dependency (no zod/valibot): the validation
// surface this app actually needs — bounded strings, bounded numbers, enums, optional fields,
// nested objects — is small enough that a purpose-built ~150-line module is easier to audit and
// keep in this project's own house style than a general-purpose schema library would be.
//
// Usage:
//   const schema = object({ weekday: num({ min: 1, max: 7, int: true }), action: oneOf(["weight", "sets", "del"] as const) });
//   const parsed = validateBody(rawBody, schema);
//   if (!parsed.ok) return parsed.response; // already a 400 Response.json({ error, field })
//   parsed.value.weekday; // typed number, in range

export interface FieldSchema<T> {
  parse(value: unknown, path: string): { ok: true; value: T } | { ok: false; error: string };
}

export function str(opts: { min?: number; max?: number; pattern?: RegExp } = {}): FieldSchema<string> {
  return {
    parse(value, path) {
      if (typeof value !== "string") return { ok: false, error: `${path}: expected a string` };
      if (opts.min !== undefined && value.length < opts.min) return { ok: false, error: `${path}: too short (min ${opts.min})` };
      if (opts.max !== undefined && value.length > opts.max) return { ok: false, error: `${path}: too long (max ${opts.max})` };
      if (opts.pattern && !opts.pattern.test(value)) return { ok: false, error: `${path}: does not match the expected format` };
      return { ok: true, value };
    },
  };
}

export function num(opts: { min?: number; max?: number; int?: boolean } = {}): FieldSchema<number> {
  return {
    parse(value, path) {
      // Mirrors the codebase's existing convention of accepting a numeric string off the wire
      // (many current handlers do `Number(body.x)`) rather than forcing the client to send a
      // JSON number literal — but NaN/Infinity from a bad string must not silently become 0.
      const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
      if (!Number.isFinite(n)) return { ok: false, error: `${path}: expected a number` };
      if (opts.int && !Number.isInteger(n)) return { ok: false, error: `${path}: expected an integer` };
      if (opts.min !== undefined && n < opts.min) return { ok: false, error: `${path}: below minimum (${opts.min})` };
      if (opts.max !== undefined && n > opts.max) return { ok: false, error: `${path}: above maximum (${opts.max})` };
      return { ok: true, value: n };
    },
  };
}

export function bool(): FieldSchema<boolean> {
  return {
    parse(value, path) {
      if (typeof value !== "boolean") return { ok: false, error: `${path}: expected a boolean` };
      return { ok: true, value };
    },
  };
}

export function oneOf<T extends readonly string[]>(values: T): FieldSchema<T[number]> {
  return {
    parse(value, path) {
      if (typeof value !== "string" || !(values as readonly string[]).includes(value)) {
        return { ok: false, error: `${path}: expected one of ${values.join(", ")}` };
      }
      return { ok: true, value: value as T[number] };
    },
  };
}

export function optional<T>(schema: FieldSchema<T>): FieldSchema<T | undefined> {
  return {
    parse(value, path) {
      if (value === undefined || value === null) return { ok: true, value: undefined };
      return schema.parse(value, path);
    },
  };
}

/** A bounded array of a given element schema. `maxItems` guards against an unbounded payload
 * (e.g. a client sending 10,000 set entries) turning into an unbounded D1 write. */
export function arrayOf<T>(schema: FieldSchema<T>, opts: { maxItems?: number } = {}): FieldSchema<T[]> {
  return {
    parse(value, path) {
      if (!Array.isArray(value)) return { ok: false, error: `${path}: expected an array` };
      if (opts.maxItems !== undefined && value.length > opts.maxItems) {
        return { ok: false, error: `${path}: too many items (max ${opts.maxItems})` };
      }
      const out: T[] = [];
      for (let i = 0; i < value.length; i++) {
        const r = schema.parse(value[i], `${path}[${i}]`);
        if (!r.ok) return r;
        out.push(r.value);
      }
      return { ok: true, value: out };
    },
  };
}

type ObjectShape = Record<string, FieldSchema<unknown>>;
type Infer<S extends ObjectShape> = { [K in keyof S]: S[K] extends FieldSchema<infer T> ? T : never };

export function object<S extends ObjectShape>(shape: S): FieldSchema<Infer<S>> {
  return {
    parse(value, path) {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return { ok: false, error: `${path}: expected an object` };
      }
      const src = value as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(shape)) {
        const r = shape[key].parse(src[key], path === "$" ? key : `${path}.${key}`);
        if (!r.ok) return r;
        out[key] = r.value;
      }
      return { ok: true, value: out as Infer<S> };
    },
  };
}

// Hard cap on request body size, checked BEFORE JSON.parse — an oversized body (accidental or
// malicious) must not be parsed at all. 256 KB comfortably covers the largest legitimate payload
// today (a full day's plan edit or meal log) with headroom; bump it deliberately if a real
// feature needs more, not as a silent side effect of a bug.
const MAX_BODY_BYTES = 256 * 1024;

/** Read and JSON-parse a request body with a size cap, returning a uniform 400 Response on any
 * failure (too large / not valid JSON) so callers don't each reinvent this. */
export async function readJsonBody(req: Request): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  const len = req.headers.get("content-length");
  if (len && Number(len) > MAX_BODY_BYTES) {
    return { ok: false, response: Response.json({ error: "payload too large" }, { status: 413 }) };
  }
  let text: string;
  try {
    text = await req.text();
  } catch {
    return { ok: false, response: Response.json({ error: "bad request" }, { status: 400 }) };
  }
  // Content-Length can be absent/wrong (chunked encoding); check the actual decoded size too.
  if (text.length > MAX_BODY_BYTES) {
    return { ok: false, response: Response.json({ error: "payload too large" }, { status: 413 }) };
  }
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, response: Response.json({ error: "bad request" }, { status: 400 }) };
  }
}

/** Validate an already-parsed body against a schema, returning a uniform 400 Response with the
 * offending field on failure. `validateBody(await readJsonBody(req), schema)`-style two-step
 * (read then validate) lets a handler size-cap and JSON-parse once for the whole request even
 * when it only validates part of the body against a schema (e.g. a discriminated `action` field
 * routes to a different sub-schema per branch). */
export function validateBody<T>(body: unknown, schema: FieldSchema<T>): { ok: true; value: T } | { ok: false; response: Response } {
  const r = schema.parse(body, "$");
  if (r.ok) return r;
  return { ok: false, response: Response.json({ error: "invalid request", detail: r.error }, { status: 400 }) };
}
