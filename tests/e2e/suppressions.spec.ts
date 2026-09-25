/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * E2E — the Do Not Contact screen.
 *
 * This is the screen that answers "why was this person not contacted?" during a
 * complaint, and the one that lets an operator honour a request made by phone. The
 * round trip that matters is: type an address, see it listed, and have the server
 * actually enforce it afterwards.
 */
import { expect, test } from "@playwright/test";
import { openTab, signIn } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await signIn(page);
  await openTab(page, "Do Not Contact");
  await expect(page.getByRole("heading", { name: "Do not contact" })).toBeVisible();
});

test("lists the opt-out recorded from an inbound reply, with its provenance", async ({ page }) => {
  const row = page.getByRole("row", { name: /optedout@brightsmile\.test/ });

  await expect(row).toBeVisible();
  await expect(row).toContainText("Replied STOP / unsubscribe");
  await expect(row).toContainText("inbound_email");
});

test("never shows another workspace's suppressions", async ({ page }) => {
  await expect(page.getByText("beta-secret@other.test")).toHaveCount(0);
});

test("adds a contact, shows it, and the API enforces it", async ({ page }) => {
  const contact = `walk-in-${Date.now()}@brightsmile.test`;

  await page.getByLabel("Email address").fill(contact);
  await page.getByLabel("Note (optional)").fill("Asked us to stop while on a call.");
  await page.getByRole("button", { name: "Add" }).click();

  await expect(page.getByText(`${contact} will no longer be contacted on email.`)).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(contact) })).toBeVisible();

  // page.request carries the browser's session cookie, so this reads the same
  // workspace the screen just wrote to. The bare `request` fixture would not.
  const listed = await page.request.get(`/api/suppressions?search=${encodeURIComponent(contact)}`);
  expect(listed.ok()).toBeTruthy();
  const body = await listed.json();
  expect(body.records.map((row: { contactKey: string }) => row.contactKey)).toContain(contact);
});

test("normalises a phone number so formatting does not create a second entry", async ({ page }) => {
  await page.getByLabel("Channel").selectOption("whatsapp");
  await page.getByLabel("Phone number").fill("+1 (555) 010-7777");
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByRole("row", { name: /15550107777/ })).toBeVisible();

  // The same person, typed differently, must update the existing record.
  await page.getByLabel("Phone number").fill("15550107777");
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByRole("row", { name: /15550107777/ })).toHaveCount(1);
});

test("rejects an empty contact instead of creating a blank entry", async ({ page }) => {
  await expect(page.getByRole("button", { name: "Add" })).toBeDisabled();
});

test("filters by channel", async ({ page }) => {
  await page.getByRole("button", { name: "WhatsApp", exact: true }).click();
  await expect(page.getByText("optedout@brightsmile.test")).toHaveCount(0);

  await page.getByRole("button", { name: "Email", exact: true }).click();
  await expect(page.getByText("optedout@brightsmile.test")).toBeVisible();
});

test("removes an entry so outreach is allowed again", async ({ page }) => {
  const contact = `temporary-${Date.now()}@brightsmile.test`;
  await page.getByLabel("Email address").fill(contact);
  await page.getByRole("button", { name: "Add" }).click();
  const row = page.getByRole("row", { name: new RegExp(contact) });
  await expect(row).toBeVisible();

  page.once("dialog", (dialog) => void dialog.accept());
  await row.getByRole("button", { name: `Allow outreach to ${contact} again` }).click();

  await expect(page.getByText(`${contact} can be contacted again on email.`)).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(contact) })).toHaveCount(0);
});
