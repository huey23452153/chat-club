const { test, expect } = require("@playwright/test");
const { PASSWORD, uniqueName, signup } = require("./helpers");

const OOB_CODES = "http://localhost:9099/emulator/v1/projects/school-chat-9e4d8/oobCodes";

// the emails the Auth emulator "sent": the newest one of a kind to an address
async function latestCode(request, email, requestType) {
  const { oobCodes } = await (await request.get(OOB_CODES)).json();
  return oobCodes.filter((c) => (c.newEmail || c.email) === email && c.requestType === requestType).pop();
}

test("forgot password with no email on the account says who to ask", async ({ page }) => {
  await page.goto("/");
  await page.fill("#nameInput", "somebody");
  await page.click("#forgotLink");
  await expect(page.locator("#authMsg")).toContainText("Ask huey to reset your password");
});

test("the forgot password link is only on the log in form", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#forgotLink")).toBeVisible();
  await page.click("#switchModeLink");
  await expect(page.locator("#forgotLink")).toBeHidden();
});

test("adding a recovery email lets you log in with it and reset your password", async ({ page, request }) => {
  const name = uniqueName("Rec");
  const email = `${name.toLowerCase()}@example.com`;
  await signup(page, name);

  await page.click("#customizeBtn");
  await expect(page.locator("#recoveryEmailStatus")).toContainText("Optional");
  await page.fill("#recoveryEmailInput", "not an email");
  await page.click("#saveRecoveryEmailBtn");
  await expect(page.locator("#recoveryEmailMsg")).toContainText("doesn't look like an email");
  await page.fill("#recoveryEmailInput", email);
  await page.click("#saveRecoveryEmailBtn");
  await expect(page.locator("#recoveryEmailMsg")).toContainText(`We sent a link to ${email}`, { timeout: 10000 });

  // "click" the link in the email
  const verify = await latestCode(request, email, "VERIFY_AND_CHANGE_EMAIL");
  expect(verify).toBeTruthy();
  expect((await request.get(verify.oobLink)).ok()).toBeTruthy();

  // a fresh device: the name alone no longer finds the account, the email does
  await page.evaluate(() => localStorage.clear());
  await page.context().clearCookies();
  await page.evaluate(() => indexedDB.databases().then((dbs) => Promise.all(dbs.map((d) => new Promise((r) => { const q = indexedDB.deleteDatabase(d.name); q.onsuccess = q.onerror = q.onblocked = r; })))));
  await page.goto("/");
  await page.waitForSelector("#authSubmitBtn");
  await page.fill("#nameInput", name);
  await page.fill("#passwordInput", PASSWORD);
  await page.click("#authSubmitBtn");
  await expect(page.locator("#authMsg")).toContainText("log in with that email", { timeout: 10000 });

  await page.fill("#nameInput", email);
  await page.click("#forgotLink");
  await expect(page.locator("#authMsg")).toContainText("reset link is on its way", { timeout: 10000 });
  await expect.poll(async () => !!(await latestCode(request, email, "PASSWORD_RESET")), { timeout: 10000 }).toBeTruthy();

  await page.fill("#passwordInput", PASSWORD);
  await page.click("#authSubmitBtn");
  await page.waitForSelector("#appScreen.active", { timeout: 15000 });
  // still the same person in chats
  await page.click("#customizeBtn");
  await expect(page.locator("#recoveryEmailStatus")).toContainText(email);
  await expect(page.locator("#renameMeInput")).toHaveValue(name);

  // and now this device knows the email: the name works again
  await page.click('#customizeModal [data-close="customizeModal"]');
  await page.click("#logoutBtn");
  await page.waitForSelector("#authSubmitBtn");
  await page.fill("#nameInput", name);
  await page.fill("#passwordInput", PASSWORD);
  await page.click("#authSubmitBtn");
  await page.waitForSelector("#appScreen.active", { timeout: 15000 });
});
