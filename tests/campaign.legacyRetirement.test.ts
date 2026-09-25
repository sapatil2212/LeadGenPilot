import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const serverSource = fs.readFileSync(path.join(root, "server.ts"), "utf8");
const appSource = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");

describe("legacy campaign retirement", () => {
  it("returns Gone instead of dispatching from the legacy start endpoint", () => {
    const startRoute = serverSource.slice(
      serverSource.indexOf('app.post(\n  "/api/campaign/start"'),
      serverSource.indexOf("/**\n * GET /api/campaign/history")
    );

    expect(startRoute).toContain("legacyCampaignRetired(res)");
    expect(startRoute).not.toContain("runCampaignLoop(");
    expect(serverSource).toContain('code: "legacy_campaign_retired"');
  });

  it("removes the legacy campaign navigation entry and redirects stale preferences", () => {
    expect(appSource).not.toContain('label: "Legacy Campaigns"');
    expect(appSource).toContain('saved === "outreach" ? "campaigns"');
    expect(appSource).not.toContain('fetch("/api/campaign/start"');
  });

  it("retires the legacy stop endpoint as well", () => {
    const stopRoute = serverSource.slice(
      serverSource.indexOf('app.post(\n  "/api/campaign/stop"'),
      serverSource.indexOf("/**\n * GET /api/status")
    );

    expect(stopRoute).toContain("legacyCampaignRetired(res)");
    expect(stopRoute).not.toContain("campaignCancelRequested = true");
  });
});
