/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Per-job log capture.
 *
 * The console feed exists because the process log cannot be shown to a tenant:
 * it holds every workspace's queries and discovered business names. These tests
 * pin the two properties that make the per-job feed safe to expose — a line is
 * attributed to the run that emitted it even when runs overlap, and a reader
 * cannot see another workspace's buffer.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  captureJobLogLine,
  clearJobLogBuffer,
  currentJobLogContext,
  readJobLogLines,
  resetJobLogBuffers,
  runWithJobLogContext,
} from "../src/tenancy/jobLogStream";

const WORKSPACE_A = "ws_a";
const WORKSPACE_B = "ws_b";

beforeEach(() => {
  resetJobLogBuffers();
});

describe("attribution", () => {
  it("captures lines written inside a run", async () => {
    await runWithJobLogContext({ jobId: "job_1", tenantId: WORKSPACE_A }, async () => {
      captureJobLogLine("searching");
      captureJobLogLine("found a business");
    });

    const captured = readJobLogLines("job_1", WORKSPACE_A);
    expect(captured?.lines).toEqual(["searching", "found a business"]);
    expect(captured?.nextSeq).toBe(2);
  });

  it("ignores lines written outside any run", () => {
    captureJobLogLine("server booted");
    expect(currentJobLogContext()).toBeUndefined();
    expect(readJobLogLines("job_1", WORKSPACE_A)).toBeNull();
  });

  it("keeps two concurrent runs separate across awaits", async () => {
    // The regression this prevents: one process-wide logger sink would hand each
    // tenant the other's business names.
    const runA = runWithJobLogContext({ jobId: "job_a", tenantId: WORKSPACE_A }, async () => {
      captureJobLogLine("A: start");
      await new Promise((resolve) => setTimeout(resolve, 10));
      captureJobLogLine("A: lead one");
    });
    const runB = runWithJobLogContext({ jobId: "job_b", tenantId: WORKSPACE_B }, async () => {
      captureJobLogLine("B: start");
      await new Promise((resolve) => setTimeout(resolve, 5));
      captureJobLogLine("B: lead one");
    });
    await Promise.all([runA, runB]);

    expect(readJobLogLines("job_a", WORKSPACE_A)?.lines).toEqual(["A: start", "A: lead one"]);
    expect(readJobLogLines("job_b", WORKSPACE_B)?.lines).toEqual(["B: start", "B: lead one"]);
  });
});

describe("tenant isolation", () => {
  it("refuses a read from another workspace", async () => {
    await runWithJobLogContext({ jobId: "job_a", tenantId: WORKSPACE_A }, async () => {
      captureJobLogLine("A: confidential business name");
    });

    expect(readJobLogLines("job_a", WORKSPACE_B)).toBeNull();
    expect(readJobLogLines("job_a", WORKSPACE_A)?.lines).toHaveLength(1);
  });
});

describe("incremental reads", () => {
  it("returns only lines after the caller's sequence number", async () => {
    await runWithJobLogContext({ jobId: "job_1", tenantId: WORKSPACE_A }, async () => {
      captureJobLogLine("one");
      captureJobLogLine("two");
      captureJobLogLine("three");
    });

    const first = readJobLogLines("job_1", WORKSPACE_A, 0);
    expect(first?.lines).toEqual(["one", "two", "three"]);

    const next = readJobLogLines("job_1", WORKSPACE_A, first!.nextSeq);
    expect(next?.lines).toEqual([]);
    expect(next?.nextSeq).toBe(3);
  });
});

describe("bounded memory", () => {
  it("drops the oldest lines rather than growing without bound", async () => {
    await runWithJobLogContext({ jobId: "job_1", tenantId: WORKSPACE_A }, async () => {
      for (let i = 0; i < 1_200; i++) captureJobLogLine(`line ${i}`);
    });

    const captured = readJobLogLines("job_1", WORKSPACE_A, 0);
    expect(captured?.lines).toHaveLength(1_000);
    expect(captured?.lines[0]).toBe("line 200");
    expect(captured?.nextSeq).toBe(1_200);
  });

  it("tells a reader when lines it had not seen were already dropped", async () => {
    await runWithJobLogContext({ jobId: "job_1", tenantId: WORKSPACE_A }, async () => {
      for (let i = 0; i < 1_200; i++) captureJobLogLine(`line ${i}`);
    });

    expect(readJobLogLines("job_1", WORKSPACE_A, 5)?.dropped).toBe(true);
    expect(readJobLogLines("job_1", WORKSPACE_A, 1_100)?.dropped).toBe(false);
  });

  it("retains a bounded number of runs", async () => {
    for (let i = 0; i < 30; i++) {
      await runWithJobLogContext({ jobId: `job_${i}`, tenantId: WORKSPACE_A }, async () => {
        captureJobLogLine(`run ${i}`);
      });
    }

    // The oldest runs are evicted; the most recent remain readable.
    expect(readJobLogLines("job_0", WORKSPACE_A)).toBeNull();
    expect(readJobLogLines("job_29", WORKSPACE_A)?.lines).toEqual(["run 29"]);
  });

  it("releases a buffer on request", async () => {
    await runWithJobLogContext({ jobId: "job_1", tenantId: WORKSPACE_A }, async () => {
      captureJobLogLine("one");
    });

    clearJobLogBuffer("job_1");
    expect(readJobLogLines("job_1", WORKSPACE_A)).toBeNull();
  });
});
