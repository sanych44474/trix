// Minimal entry point for the vitest-plugin pool's `main` (see vitest.config.ts). Deliberately
// NOT src/index.ts -- these tests exercise db/repos/* directly against a real D1 binding and
// never call a handler, so importing the whole app would add startup cost for no benefit.
export default {
  async fetch() {
    return new Response("test stub", { status: 200 });
  },
};
