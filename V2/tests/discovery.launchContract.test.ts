import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regression contract for the failure where the Finder accepted a discovery
 * job, then silently stopped because npm resolved the older @playwright/test
 * CLI and installed a browser revision the runtime Playwright could not use.
 */
describe("lead discovery launch contract", () => {
  const root = process.cwd();
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const appSource = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");
  const serverSource = fs.readFileSync(path.join(root, "server.ts"), "utf8");
  const scraperSource = fs.readFileSync(path.join(root, "src", "mapsScraper.ts"), "utf8");

  it("installs Chromium through the runtime playwright package, not an ambiguous npm bin", () => {
    expect(packageJson.scripts["install:browsers"]).toBe(
      "node node_modules/playwright/cli.js install chromium"
    );
    expect(packageJson.scripts["setup:browsers"]).toBe(
      "node node_modules/playwright/cli.js install --with-deps chromium"
    );
    // Browser installation failures must fail deployment rather than leave a
    // server that starts successfully but cannot ever discover a lead.
    expect(packageJson.scripts["install:browsers"]).not.toMatch(/\|\||echo/);
  });

  it("sends the current Finder criteria with the run request", () => {
    const start = appSource.indexOf("const handleStartScraper = async");
    const end = appSource.indexOf("const handleStopScraper", start);
    const handler = appSource.slice(start, end);

    expect(handler).toContain("const runCriteria =");
    expect(handler).toContain('fetch("/api/run-scraper"');
    expect(handler).toContain("body: JSON.stringify(runCriteria)");
    expect(handler).toContain("isStartingScraper");
  });

  it("returns persisted job failures and renders them in the Finder console", () => {
    const statusStart = serverSource.indexOf('"/api/status"');
    const statusEnd = serverSource.indexOf('"/api/jobs"', statusStart);
    const statusRoute = serverSource.slice(statusStart, statusEnd);

    expect(statusRoute).toContain("error: job && isTerminal(job.status) ? job.error : null");
    expect(appSource).toContain("[ERROR] Lead discovery failed: ${status.error");
    expect(appSource).toContain("reportedTerminalJobIdRef.current !== status.jobId");
  });

  it("binds the run to a per-job log context and exposes it tenant-scoped", () => {
    // The process log stays operator-only, so the console feed has to come from
    // a buffer attributed to this workspace's own job.
    expect(serverSource).toContain("runWithJobLogContext({ jobId: job.id, tenantId: ctx.tenantId }");

    const logsStart = serverSource.indexOf('"/api/jobs/:id/logs"');
    expect(logsStart).toBeGreaterThan(-1);
    const logsRoute = serverSource.slice(logsStart, logsStart + 900);
    expect(logsRoute).toContain("resolveTenantContext");
    expect(logsRoute).toContain('requirePermission("VIEW_LEADS")');
    expect(logsRoute).toContain("await getJob(ctx, req.params.id)");
    expect(logsRoute).toContain("readJobLogLines(job.id, ctx.tenantId");
  });

  it("streams the run feed into the Finder console incrementally", () => {
    expect(appSource).toContain("const fetchScrapeJobLogs = async ()");
    expect(appSource).toContain("/api/jobs/${jobId}/logs?after=${scrapeLogSeqRef.current}");
    expect(appSource).toContain("scrapeLogSeqRef.current = data.nextSeq");
    // A stale poll must not append another run's lines.
    expect(appSource).toContain("if (activeScrapeJobIdRef.current !== jobId) return;");
  });

  it("directs operators to the unambiguous browser setup command", () => {
    expect(scraperSource).toContain("Run 'npm run setup:browsers'");
    expect(scraperSource).toContain("Expected executable: ${chromium.executablePath()}");
  });
});
