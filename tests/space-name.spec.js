const { test, expect } = require("@playwright/test");
const { signup } = require("./helpers");

test("a name with a space in it can sign up and log back in", async ({ page }) => {
  const name = "Sam Lee " + Math.floor(Math.random() * 1e8);
  await signup(page, name);
  await expect(page.locator("#meName")).toHaveText(name);
  await page.click("#logoutBtn");
  await page.waitForSelector("#authSubmitBtn", { state: "visible" });
  // Enter logs in too
  await page.fill("#nameInput", name);
  await page.fill("#passwordInput", "testpass123");
  await page.press("#passwordInput", "Enter");
  await page.waitForSelector("#appScreen.active", { timeout: 15000 });
});
