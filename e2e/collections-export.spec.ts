import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { actAs } from "./helpers";

test("viewers can export the collections queue as CSV", async ({ page }) => {
  await page.goto("/collections");
  await actAs(page, "Priya Shah");
  await expect(page.getByRole("button", { name: "Run overdue sweep" })).toHaveCount(0);

  const downloading = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export CSV" }).click();
  const download = await downloading;

  expect(download.suggestedFilename()).toMatch(/^collections-\d{4}-\d{2}-\d{2}\.csv$/);
  const content = await readFile(await download.path(), "utf8");
  expect(content.split("\r\n")[0]).toBe("Customer,Invoice,Currency,Balance,Due date,Days late,Bucket,Next step");
});
