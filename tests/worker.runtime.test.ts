/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PHASE 8 — worker process lifecycle.
 *
 * The three failure modes covered here are all invisible in a happy-path run and
 * expensive in production: one process quietly running many concurrent cycles, a
 * deploy severing an in-flight send, and a database outage turning into a hot
 * loop or a dead worker.
 */
import { describe, expect, it, vi } from "vitest";
import { createWorkerRuntime } from "../src/workerRuntime";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("single flight", () => {
  it("does not start a second cycle while one is still running", async () => {
    const gate = deferred();
    const runCycle = vi.fn(() => gate.promise);
    const runtime = createWorkerRuntime({ workerId: "w1", runCycle, pollMs: 1, drainTimeoutMs: 100 });

    const first = runtime.poll();
    await runtime.poll();
    await runtime.poll();

    expect(runCycle).toHaveBeenCalledTimes(1);
    expect(runtime.isBusy()).toBe(true);

    gate.resolve();
    await first;

    // Once the cycle finishes the next poll proceeds normally.
    await runtime.poll();
    expect(runCycle).toHaveBeenCalledTimes(2);
    expect(runtime.isBusy()).toBe(false);
  });

  it("keeps the interval from stacking cycles", async () => {
    const gate = deferred();
    const runCycle = vi.fn(() => gate.promise);
    let tick: (() => void) | null = null;
    const runtime = createWorkerRuntime({
      workerId: "w1",
      runCycle,
      pollMs: 1,
      drainTimeoutMs: 100,
      setIntervalFn: ((fn: () => void) => {
        tick = fn;
        return { unref() {} } as any;
      }) as any,
      clearIntervalFn: (() => {}) as any,
    });

    runtime.start();
    tick!();
    tick!();
    tick!();
    await flush();

    expect(runCycle).toHaveBeenCalledTimes(1);
    gate.resolve();
    await flush();
  });
});

describe("graceful shutdown", () => {
  it("waits for the in-flight cycle before reporting a clean drain", async () => {
    const gate = deferred();
    const order: string[] = [];
    const runCycle = vi.fn(async () => {
      await gate.promise;
      order.push("cycle-finished");
    });
    const runtime = createWorkerRuntime({ workerId: "w1", runCycle, pollMs: 1, drainTimeoutMs: 500 });

    const cycle = runtime.poll();
    const stopping = runtime.stop("SIGTERM").then((result) => {
      order.push("stop-returned");
      return result;
    });

    // Shutdown must still be waiting at this point.
    await flush();
    expect(order).toEqual([]);

    gate.resolve();
    const result = await stopping;
    await cycle;

    expect(result.drained).toBe(true);
    expect(order).toEqual(["cycle-finished", "stop-returned"]);
  });

  it("gives up after the drain timeout instead of hanging the process", async () => {
    const gate = deferred();
    const runtime = createWorkerRuntime({ workerId: "w1", runCycle: () => gate.promise, pollMs: 1, drainTimeoutMs: 20 });

    const cycle = runtime.poll();
    const result = await runtime.stop("SIGTERM");

    expect(result.drained).toBe(false);
    gate.resolve();
    await cycle;
  });

  it("starts no further cycles after stopping", async () => {
    const runCycle = vi.fn(async () => undefined);
    const runtime = createWorkerRuntime({ workerId: "w1", runCycle, pollMs: 1, drainTimeoutMs: 20 });

    await runtime.stop("SIGINT");
    await runtime.poll();

    expect(runCycle).not.toHaveBeenCalled();
  });
});

describe("database failure resilience", () => {
  it("backs off exponentially and skips polls until the backoff expires", async () => {
    let clock = 1_000;
    const runCycle = vi.fn(async () => {
      throw new Error("lost connection to MySQL server");
    });
    const runtime = createWorkerRuntime({
      workerId: "w1",
      runCycle,
      pollMs: 1,
      drainTimeoutMs: 20,
      now: () => clock,
    });

    await runtime.poll();
    expect(runtime.consecutiveFailures()).toBe(1);

    // Immediately polling again must not hammer the database.
    await runtime.poll();
    expect(runCycle).toHaveBeenCalledTimes(1);

    // After the first backoff window it tries again, and the window widens.
    clock += 1_000;
    await runtime.poll();
    expect(runCycle).toHaveBeenCalledTimes(2);
    expect(runtime.consecutiveFailures()).toBe(2);

    clock += 1_000;
    await runtime.poll();
    expect(runCycle).toHaveBeenCalledTimes(2);
  });

  it("caps the backoff so a long outage does not stall recovery indefinitely", async () => {
    let clock = 0;
    const runtime = createWorkerRuntime({
      workerId: "w1",
      runCycle: async () => {
        throw new Error("database is down");
      },
      pollMs: 1,
      drainTimeoutMs: 20,
      maxFailureBackoffMs: 5_000,
      now: () => clock,
    });

    for (let attempt = 0; attempt < 10; attempt++) {
      clock += 60_000;
      await runtime.poll();
    }

    expect(runtime.consecutiveFailures()).toBe(10);
    // Still alive and still polling: the process survived the outage.
    clock += 5_000;
    await runtime.poll();
    expect(runtime.consecutiveFailures()).toBe(11);
  });

  it("clears the failure count once a cycle succeeds", async () => {
    let clock = 0;
    let shouldFail = true;
    const runtime = createWorkerRuntime({
      workerId: "w1",
      runCycle: async () => {
        if (shouldFail) throw new Error("transient");
      },
      pollMs: 1,
      drainTimeoutMs: 20,
      now: () => clock,
    });

    await runtime.poll();
    expect(runtime.consecutiveFailures()).toBe(1);

    shouldFail = false;
    clock += 2_000;
    await runtime.poll();

    expect(runtime.consecutiveFailures()).toBe(0);
  });
});
