// Confirms AsyncLocalStorage-backed request-id propagation actually works under REAL workerd
// (nodejs_compat) -- this is the one part of src/log.ts that node:test's plain-Node harness can't
// meaningfully verify, since Node's own async_hooks would trivially "work" regardless of whether
// workerd's polyfill does.
import { describe, expect, it, vi } from "vitest";
import { currentRequestId, logError, logInfo, runWithRequestId } from "../../src/log";

describe("log: request-id propagation under workerd", () => {
  it("is undefined outside any request context", () => {
    expect(currentRequestId()).toBeUndefined();
  });

  it("is visible inside runWithRequestId, including across an await", async () => {
    const seen = await runWithRequestId("req-1", async () => {
      await Promise.resolve();
      return currentRequestId();
    });
    expect(seen).toBe("req-1");
  });

  it("does not leak into a context run after it, or into a concurrent sibling", async () => {
    const [a, b] = await Promise.all([
      runWithRequestId("req-a", async () => {
        await new Promise((r) => setTimeout(r, 10));
        return currentRequestId();
      }),
      runWithRequestId("req-b", async () => {
        return currentRequestId();
      }),
    ]);
    expect(a).toBe("req-a");
    expect(b).toBe("req-b");
    expect(currentRequestId()).toBeUndefined();
  });

  it("logError emits one JSON line carrying the ambient reqId, scope, and error message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await runWithRequestId("req-log", async () => {
      logError("test-scope", new Error("boom"), { userId: 42 });
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const line = JSON.parse(spy.mock.calls[0][0] as string);
    expect(line).toMatchObject({ level: "error", scope: "test-scope", message: "boom", userId: 42, reqId: "req-log" });
    spy.mockRestore();
  });

  it("logInfo omits reqId entirely when there's no ambient request context", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logInfo("test-scope", { status: 200 });
    expect(spy).toHaveBeenCalledTimes(1);
    const line = JSON.parse(spy.mock.calls[0][0] as string);
    expect(line).toMatchObject({ level: "info", scope: "test-scope", status: 200 });
    expect(line.reqId).toBeUndefined();
    spy.mockRestore();
  });
});
