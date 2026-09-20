/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared sign-in helper and fixture identifiers for the browser suite.
 */
import { expect, test, type Page } from "@playwright/test";

export const OWNER = {
  email: "e2e-owner@example.test",
  password: "E2ePassw0rd!",
  workspace: "Alpha Dental Group",
};

/**
 * The dashboard lives at /app; `/` serves the marketing landing page, which is a
 * separate Next.js export and not what this suite is testing.
 */
export const DASHBOARD_PATH = "/app";

/** Signs in through the real form and waits for the dashboard shell. */
export async function signIn(page: Page): Promise<void> {
  await page.goto(DASHBOARD_PATH);

  // The gate renders a loading state first, then either the form or the app.
  const emailField = page.getByPlaceholder("Email address");
  await expect(emailField).toBeVisible();

  await emailField.fill(OWNER.email);
  await page.getByPlaceholder("Password", { exact: true }).fill(OWNER.password);
  await page.locator('button[type="submit"]').click();

  // Sidebar navigation only exists once an authenticated workspace is resolved.
  await expect(page.getByRole("button", { name: "Overview" })).toBeVisible({ timeout: 30_000 });
}

/**
 * Opens a sidebar tab. Named as a step so a failure says which destination broke
 * rather than only that some click timed out.
 */
export async function openTab(page: Page, label: string): Promise<void> {
  await test.step(`open the ${label} tab`, async () => {
    // Some tabs carry a count badge inside the button ("Leads 3", "Inbox 1"), so
    // the accessible name is the label plus a number. Anchoring at the start
    // keeps "Leads" from also matching "Lead Finder".
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const button = page.getByRole("button", { name: new RegExp(`^${escaped}(\\s|$)`) });
    await expect(button, `sidebar button "${label}" should exist`).toHaveCount(1);
    await button.click();
  });
}
