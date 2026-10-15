const { test, expect } = require("@playwright/test");
const { uniqueName, signup } = require("./helpers");

// The someone's looking alert is a desktop app feature; in a browser the setting only says so.
test("someone's looking alert is app-only in a browser", async ({ page }) => {
  await signup(page, uniqueName("La").slice(0, 24));
  await page.click("#customizeBtn");
  await expect(page.locator("#lookAlertStatus")).toContainText("Only in the Chat Club desktop app");
  await expect(page.locator("#lookAlertToggle")).toBeDisabled();
  await expect(page.locator("#lookAlertAppOptions")).toBeHidden();
});
