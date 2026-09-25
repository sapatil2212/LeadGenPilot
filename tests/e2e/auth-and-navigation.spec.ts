/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * E2E — the gate and the lazily loaded tabs.
 *
 * Phase 8 split the dashboard into one chunk per tab. That is invisible to every
 * layer below the browser: a panel whose dynamic import fails, or whose Suspense
 * boundary never resolves, still typechecks, still builds, and still passes every
 * unit test. Only opening the tab in a browser proves it renders.
 */
import { expect, test } from "@playwright/test";
import { DASHBOARD_PATH, OWNER, openTab, signIn } from "./fixtures";

test.describe("authentication gate", () => {
  test("shows the sign-in form to an anonymous visitor and no dashboard", async ({ page }) => {
    await page.goto(DASHBOARD_PATH);

    await expect(page.getByPlaceholder("Email address")).toBeVisible();
    await expect(page.getByRole("button", { name: "Overview" })).toHaveCount(0);
  });

  test("refuses a wrong password and stays on the form", async ({ page }) => {
    await page.goto(DASHBOARD_PATH);
    await page.getByPlaceholder("Email address").fill(OWNER.email);
    await page.getByPlaceholder("Password", { exact: true }).fill("definitely-not-the-password");
    await page.locator('button[type="submit"]').click();

    await expect(page.getByText(/invalid|incorrect|failed/i).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Overview" })).toHaveCount(0);
  });

  test("signs in and lands on the workspace dashboard", async ({ page }) => {
    await signIn(page);

    await expect(page.getByText(OWNER.workspace).first()).toBeVisible();
    await expect(page.getByText("Dashboard Overview")).toBeVisible();
  });

  test("keeps the session across a reload", async ({ page }) => {
    await signIn(page);
    await page.reload();

    await expect(page.getByRole("button", { name: "Overview" })).toBeVisible();
    await expect(page.getByPlaceholder("Email address")).toHaveCount(0);
  });

  test("returns an anonymous API caller 401 rather than data", async ({ request }) => {
    const suppressions = await request.get("/api/suppressions");
    const conversations = await request.get("/api/conversations");

    expect(suppressions.status()).toBe(401);
    expect(conversations.status()).toBe(401);
  });
});

test.describe("lazily loaded tabs all render", () => {
  // Each of these is a separate chunk fetched on first open. The assertion is
  // deliberately about visible content, not about the network.
  const tabs: Array<[string, RegExp]> = [
    ["Business", /business/i],
    ["Knowledge", /knowledge/i],
    ["Assistant", /assistant/i],
    ["Targeting", /targeting|ideal customer/i],
    ["Lead Finder", /lead finder|search/i],
    ["Leads", /leads/i],
    ["Campaigns", /campaign/i],
    ["Inbox", /conversation|inbox|message/i],
    ["Templates", /template/i],
    ["Reports", /report|dispatch|history/i],
    ["Do Not Contact", /do not contact/i],
    ["Integrations", /integration|outreach/i],
  ];

  test("every sidebar destination loads without an error boundary", async ({ page }) => {
    const failures: string[] = [];
    page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") {
        const text = message.text();
        // A failed dynamic import surfaces here, which is exactly what this test
        // is looking for. Favicon and other noise is ignored.
        if (/Failed to fetch dynamically imported module|ChunkLoadError|Loading chunk/i.test(text)) {
          failures.push(`console: ${text}`);
        }
      }
    });

    await signIn(page);

    for (const [label, heading] of tabs) {
      await openTab(page, label);
      await expect(page.getByText(heading).first()).toBeVisible({ timeout: 20_000 });
      // The chunk-loading fallback must resolve rather than linger. Scoped to the
      // Suspense boundary's own element, so a panel's internal loading state is
      // not mistaken for a stuck import.
      await expect(page.getByTestId("panel-loading")).toHaveCount(0);
    }

    expect(failures, `client-side failures while navigating: ${failures.join(" | ")}`).toEqual([]);
  });
});
