const { test, expect } = require("@playwright/test");
const { uniqueName, signup } = require("./helpers");

// The test browser's camera is a fake moving pattern (no faces), so this checks the alert can be
// switched on, keeps going, remembers itself, and switches off; not that it spots a real face.
test("someone's looking alert switches on and off in the browser, and is remembered", async ({ page, context }) => {
  await context.grantPermissions(["camera", "notifications"]);
  await signup(page, uniqueName("La").slice(0, 24));
  await page.click("#customizeBtn");
  await expect(page.locator("#lookAlertStatus")).toContainText("open in a tab");

  await page.check("#lookAlertToggle");
  await expect(page.locator("#lookAlertToggle")).toBeEnabled({ timeout: 30000 });
  await expect(page.locator("#lookAlertToggle")).toBeChecked();
  await expect(page.locator("#lookAlertMsg")).not.toHaveClass(/show/);
  expect(await page.evaluate(() => localStorage.getItem("chatclub.lookAlert"))).toBe("on");

  await page.reload();
  await page.waitForSelector("#appScreen.active", { timeout: 15000 });
  await expect(page.locator("#lookAlertToggle")).toBeChecked({ timeout: 30000 });

  await page.click("#customizeBtn");
  await page.uncheck("#lookAlertToggle");
  expect(await page.evaluate(() => localStorage.getItem("chatclub.lookAlert"))).toBe("off");
});
