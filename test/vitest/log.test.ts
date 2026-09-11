// Confirms AsyncLocalStorage-backed request-id propagation actually works under REAL workerd
// (nodejs_compat) -- this is the one part of src/log.ts that node:test's plain-Node harness can't
// meaningfully verify, since Node's own async_hooks would trivially "work" regardless of whether
// workerd's polyfill does.
import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { currentRequestId, logError, logInfo, runWithRequestId } from "../../src/log";
import type { Env } from "../../src/types";

// This pool's miniflare config (vitest.config.ts) doesn't declare an analytics_engine_datasets
// binding -- env.ANALYTICS is genuinely absent here, exactly like a harness/mock Env that models
// only what it needs. Good for exercising the "no binding configured" path for free; the
// binding's own behavior is exercised below via a fake object instead.
const bareEnv = env as unknown as Env;

function fakeEnvWithAnalytics() {
  const writeDataPoint = vi.fn();
  return { env: { ...bareEnv, ANALYTICS: { writeDataPoint } } as Env, writeDataPoint };
}

describe("log: request-id propagation under workerd", () => {
  it("is undefined outside any request context", () => {
    expect(currentRequestId()).toBeUndefined();
  });

  it("is visible inside runWithRequestId, including across an await", async () => {
    const seen = await runWithRequestId("req-1", bareEnv, async () => {
      await Promise.resolve();
      return currentRequestId();
    });
    expect(seen).toBe("req-1");
  });

  it("does not leak into a context run after it, or into a concurrent sibling", async () => {
    const [a, b] = await Promise.all([
      runWithRequestId("req-a", bareEnv, async () => {
        await new Promise((r) => setTimeout(r, 10));
        return currentRequestId();
      }),
      runWithRequestId("req-b", bareEnv, async () => {
        return currentRequestId();
      }),
    ]);
    expect(a).toBe("req-a");
    expect(b).toBe("req-b");
    expect(currentRequestId()).toBeUndefined();
  });

  it("logError emits one JSON line carrying the ambient reqId, scope, and error message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await runWithRequestId("req-log", bareEnv, async () => {
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

describe("log: Analytics Engine data points", () => {
  it("writes nothing when there is no ambient context at all", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    // No runWithRequestId wrapper -- must not throw just because env is unavailable.
    logInfo("no-context-event", {});
    spy.mockRestore();
  });

  it("writes nothing when the ambient env has no ANALYTICS binding configured", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await runWithRequestId("req-x", bareEnv, async () => {
      logInfo("unconfigured-event", {});
    });
    logSpy.mockRestore();
    // bareEnv.ANALYTICS is genuinely undefined in this pool -- if writeAnalytics didn't guard on
    // it, this whole test would have thrown instead of reaching this line.
    expect(bareEnv.ANALYTICS).toBeUndefined();
  });

  it("logInfo writes a data point with the event name as the index and a level=info blob", async () => {
    const { env: withAnalytics, writeDataPoint } = fakeEnvWithAnalytics();
    await runWithRequestId("req-y", withAnalytics, async () => {
      logInfo("workout_completed", { exerciseCount: 3 });
    });
    expect(writeDataPoint).toHaveBeenCalledTimes(1);
    const point = writeDataPoint.mock.calls[0][0];
    expect(point.indexes).toEqual(["workout_completed"]);
    expect(point.blobs[0]).toBe("workout_completed");
    expect(point.blobs[1]).toBe("info");
    expect(JSON.parse(point.blobs[2])).toEqual({ exerciseCount: 3 });
    expect(point.doubles).toEqual([1]);
  });

  it("logError writes a data point with a level=error blob", async () => {
    const { env: withAnalytics, writeDataPoint } = fakeEnvWithAnalytics();
    await runWithRequestId("req-z", withAnalytics, async () => {
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      logError("cron_failure", new Error("boom"));
      errSpy.mockRestore();
    });
    expect(writeDataPoint).toHaveBeenCalledTimes(1);
    expect(writeDataPoint.mock.calls[0][0].blobs[1]).toBe("error");
  });

  it("a throwing writeDataPoint is swallowed, not propagated to the caller", async () => {
    const env2 = { ...bareEnv, ANALYTICS: { writeDataPoint: () => { throw new Error("AE down"); } } } as Env;
    await runWithRequestId("req-w", env2, async () => {
      expect(() => logInfo("some-event", {})).not.toThrow();
    });
  });
});
