import { expect, test, type Page } from "@playwright/test";

// APP-2026-1035 is stalled with three pending documents and nothing expired.
const APP = "/applications/APP-2026-1035";
const DOC = "Lease Agreement";

async function expectNeedsDocs(page: Page) {
  await expect(page.getByText("Needs docs", { exact: true })).toBeVisible();
  await expect(page.getByText("Stalled", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel(`Status for ${DOC}`)).toHaveValue("Received");
  await expect(page.getByLabel(`Received date for ${DOC}`)).not.toHaveValue("");
}

test("marking a pending document Received clears Stalled and drops the outstanding item", async ({ page }) => {
  await page.goto(APP);
  await expect(page.getByText("Stalled", { exact: true })).toBeVisible();

  await page.getByLabel(`Status for ${DOC}`).selectOption("Received");
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
  await expectNeedsDocs(page);

  await page.reload();
  await expectNeedsDocs(page);

  await page.goto("/outstanding");
  const card = page.getByRole("link").filter({ has: page.getByRole("heading", { name: "Oasis Spa & Salon" }) });
  await expect(card.getByText("MEDIUM", { exact: true })).toBeVisible();
  await expect(card.getByText("HIGH", { exact: true })).toHaveCount(0);
  await expect(card.getByText(`${DOC} —`)).toHaveCount(0);
  await expect(card.getByText("Ownership Verification —")).toBeVisible();
});
