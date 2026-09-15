const { test, expect } = require("@playwright/test");
const { PASSWORD, uniqueName, signup, login } = require("./helpers");

test("signing up reaches the app screen with the right name", async ({ page }) => {
  const name = uniqueName("Alice");
  await signup(page, name);
  await expect(page.locator("#meName")).toHaveText(name);
});

test("wrong password on an existing account shows a friendly error", async ({ page }) => {
  const name = uniqueName("Bob");
  await signup(page, name);
  await page.click("#logoutBtn");
  await page.waitForSelector("#authScreen.active");

  await page.fill("#nameInput", name);
  await page.fill("#passwordInput", "wrongpassword");
  await page.click("#authSubmitBtn");

  await expect(page.locator("#authMsg")).toHaveClass(/show/);
  await expect(page.locator("#authMsg")).toContainText(/name or password/i);
});

test("signing up with a name that's already taken shows an error", async ({ page }) => {
  const name = uniqueName("Carl");
  await signup(page, name);
  await page.click("#logoutBtn");
  await page.waitForSelector("#authScreen.active");

  await page.click("#switchModeLink");
  await page.fill("#nameInput", name);
  await page.fill("#passwordInput", PASSWORD);
  await page.click("#authSubmitBtn");

  await expect(page.locator("#authMsg")).toHaveClass(/show/);
  await expect(page.locator("#authMsg")).toContainText(/already taken/i);
});

test("logging back in with the right password returns to the app", async ({ page }) => {
  const name = uniqueName("Dana");
  await signup(page, name);
  await page.click("#logoutBtn");
  await page.waitForSelector("#authScreen.active");

  await login(page, name);
  await expect(page.locator("#meName")).toHaveText(name);
});
