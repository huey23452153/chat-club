const { test, expect } = require("@playwright/test");
const { signup, login } = require("./helpers");

test("a name with a space in it can sign up and log back in", async ({ page }) => {
  const name = "Sam Lee " + Math.floor(Math.random() * 1e8);
  await signup(page, name);
  await expect(page.locator("#meName")).toHaveText(name);
  await page.click("#logoutBtn");
  await page.waitForSelector("#authSubmitBtn", { state: "visible" });
  await login(page, name);
});
