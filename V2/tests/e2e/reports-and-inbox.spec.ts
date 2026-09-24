/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * E2E — the screens that were placeholders before Phase 8.
 *
 * Reports returned empty records and 404s for view/edit/delete; campaign status
 * read process globals; the inbox loaded every message ever sent. These tests open
 * the real screens against seeded data, because "the endpoint returns rows" and
 * "the operator can see the rows" are different claims.
 */
import { expect, test } from "@playwright/test";
import { openTab, signIn } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test.describe("delivery report", () => {
  test.beforeEach(async ({ page }) => {
    await openTab(page, "Reports");
  });

  test("shows the seeded deliveries rather than an empty table", async ({ page }) => {
    await expect(page.getByText("Bright Smile Clinic 2").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Bright Smile Clinic 3").first()).toBeVisible();
  });

  test("never shows another workspace's deliveries", async ({ page }) => {
    await expect(page.getByText("Beta Workspace Business")).toHaveCount(0);
  });

  test("filters the table down to failures", async ({ page }) => {
    await expect(page.getByText("Bright Smile Clinic 2").first()).toBeVisible({ timeout: 20_000 });

    // The status filter is a native select; its FAILED option must narrow the table.
    const statusFilter = page.locator("select").filter({ hasText: /All Status|SENT|FAILED/i }).first();
    await statusFilter.selectOption("FAILED");

    await expect(page.getByText("Bright Smile Clinic 3").first()).toBeVisible();
    await expect(page.getByText("Bright Smile Clinic 2")).toHaveCount(0);
  });

  test("exports the filtered rows as a real CSV download", async ({ page }) => {
    await expect(page.getByText("Bright Smile Clinic 2").first()).toBeVisible({ timeout: 20_000 });

    const download = page.waitForEvent("download");
    // The export menu is opened from the toolbar, then CSV is chosen.
    await page.getByRole("button", { name: /export/i }).first().click();
    await page.getByRole("button", { name: /csv/i }).first().click();

    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.csv$/);
  });

  test("serves an export from the API with the workspace's own rows", async ({ page }) => {
    const response = await page.request.get("/api/campaign/history/export?format=csv");

    expect(response.ok()).toBeTruthy();
    const csv = await response.text();
    expect(csv).toContain("Bright Smile Clinic 2");
    expect(csv).not.toContain("Beta Workspace Business");
  });
});

test.describe("inbox", () => {
  test("shows a seeded thread with both sides of the conversation", async ({ page }) => {
    await openTab(page, "Inbox");

    // The thread list renders one button per conversation.
    const thread = page.locator("button").filter({ hasText: "Bright Smile Clinic 2" }).first();
    await expect(thread).toBeVisible({ timeout: 20_000 });
    await thread.click();

    // Each text appears twice: once as the list preview, once as the message in
    // the open thread. The last match is the message itself.
    await expect(page.getByText("Yes, please send more detail.").last()).toBeVisible();
    await expect(page.getByText("Hello, a short note about online bookings.").last()).toBeVisible();
  });

  test("paginates rather than returning the whole history", async ({ page }) => {
    const response = await page.request.get("/api/conversations?pageSize=1");

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.conversations.length).toBeLessThanOrEqual(1);
    expect(body).toHaveProperty("total");
    expect(body).toHaveProperty("totalUnread");
  });
});

test.describe("campaign review and status", () => {
  test("shows the message waiting for review", async ({ page }) => {
    await openTab(page, "Campaigns");

    await expect(page.getByText("Spring outreach").first()).toBeVisible({ timeout: 20_000 });
  });

  test("reports idle campaign status from durable state, not a process global", async ({ page }) => {
    const response = await page.request.get("/api/campaign/status");

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    // No job was ever enqueued for this workspace, so the answer is a clean idle
    // rather than another workspace's progress.
    expect(body.isRunning).toBe(false);
    expect(body.jobId).toBeNull();
    expect(body.progress.status).toBe("Idle");
  });

  test("refuses the retired legacy send path", async ({ page }) => {
    const response = await page.request.post("/api/campaign/start", { data: {} });

    expect(response.status()).toBe(410);
    expect((await response.json()).code).toBe("legacy_campaign_retired");
  });
});

test.describe("public endpoints", () => {
  test("health and readiness answer without a session and leak no workspace state", async ({ request }) => {
    const health = await request.get("/api/health");
    const ready = await request.get("/api/ready");

    expect(health.ok()).toBeTruthy();
    expect(ready.ok()).toBeTruthy();
    const body = await ready.json();
    expect(body).not.toHaveProperty("campaignRunning");
  });
});
