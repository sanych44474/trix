// Node-only resolver for the "cloudflare:workers" virtual module. The Workers runtime provides it,
// but plain node:test cannot resolve that specifier, and src/index.ts (which re-exports the
// Durable Object classes) is loaded by several node tests. This hook maps it to a stub that
// only has the one base class the DO modules extend.
import { register } from "node:module";

const STUB = "export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }";

const HOOK = `
export async function resolve(specifier, context, next) {
  if (specifier === "cloudflare:workers") {
    return { url: "data:text/javascript," + encodeURIComponent(${JSON.stringify(STUB)}), shortCircuit: true, format: "module" };
  }
  return next(specifier, context);
}
`;

register("data:text/javascript," + encodeURIComponent(HOOK));
