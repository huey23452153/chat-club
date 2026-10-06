const { test, expect } = require("@playwright/test");
const { PASSWORD, uniqueName, signup } = require("./helpers");

const OOB_CODES = "http://localhost:9099/emulator/v1/projects/school-chat-9e4d8/oobCodes";

// the emails the Auth emulator "sent": the newest one of a kind to an address
async function latestCode(request, email, requestType) {
  const { oobCodes } = await (await request.get(OOB_CODES)).json();
  return oobCodes.filter((c) => (c.newEmail || c.email) === email && c.requestType === requestType).pop();
}

// logs in as huey (the admin), making the account if this emulator doesn't have it yet
async function loginAsAdmin(page) {
  await page.goto("/");
  await page.fill("#nameInput", "huey");
  await page.fill("#passwordInput", PASSWORD);
  await page.click("#authSubmitBtn");
  const inOrError = await Promise.race([
    page.waitForSelector("#appScreen.active", { timeout: 15000 }).then(() => "in"),
    page.waitForSelector("#authMsg.show", { timeout: 15000 }).then(() => "error"),
  ]);
  if (inOrError === "in") return;
  await page.click("#switchModeLink");
  await page.fill("#nameInput", "huey");
  await page.fill("#passwordInput", PASSWORD);
  await page.click("#authSubmitBtn");
  // (another test may have made it in the same moment: then just log in)
  const second = await Promise.race([
    page.waitForSelector("#appScreen.active", { timeout: 15000 }).then(() => "in"),
    page.waitForSelector("#authMsg.show", { timeout: 15000 }).then(() => "error"),
  ]);
  if (second === "in") return;
  await page.click("#switchModeLink");
  await page.fill("#nameInput", "huey");
  await page.fill("#passwordInput", PASSWORD);
  await page.click("#authSubmitBtn");
  await page.waitForSelector("#appScreen.active", { timeout: 15000 });
}

test("forgot password with no email: huey allows it, and they set a new password", async ({ browser }) => {
  const ctxAdmin = await browser.newContext();
  const admin = await ctxAdmin.newPage();
  await loginAsAdmin(admin);

  // someone with an account, who then forgets the password
  const who = uniqueName("Lo").slice(0, 24);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signup(page, who);
  await page.click("#logoutBtn");
  await page.waitForSelector("#authSubmitBtn", { state: "visible" });

  await page.click("#forgotLink");
  await expect(page.locator("#authMsg")).toContainText("Type your name");
  await page.fill("#nameInput", who);
  await page.click("#forgotLink");
  await expect(page.locator("#authMsg")).toContainText("huey has been asked", { timeout: 10000 });
  await expect(page.locator("#resetBox")).toBeHidden();

  // somebody else, signed in, sees nothing of it
  const ctxOther = await browser.newContext();
  const other = await ctxOther.newPage();
  await signup(other, uniqueName("Nosy"));
  await other.waitForTimeout(1500);
  await expect(other.locator(".reset-card")).toHaveCount(0);

  const card = admin.locator(".reset-card").filter({ hasText: who });
  await expect(card).toBeVisible({ timeout: 10000 });
  await card.locator("button.allow").click();
  await expect(card).toHaveCount(0, { timeout: 10000 });

  await expect(page.locator("#resetBox")).toBeVisible({ timeout: 10000 });
  await page.fill("#newPasswordInput", "brandnew456");
  await page.click("#setNewPasswordBtn");
  await page.waitForSelector("#appScreen.active", { timeout: 15000 });

  // the new password is the real one now, and the old one isn't
  await page.click("#logoutBtn");
  await page.waitForSelector("#authSubmitBtn", { state: "visible" });
  await page.fill("#nameInput", who);
  await page.fill("#passwordInput", PASSWORD);
  await page.click("#authSubmitBtn");
  await expect(page.locator("#authMsg")).toContainText("isn't right", { timeout: 10000 });
  await page.fill("#passwordInput", "brandnew456");
  await page.click("#authSubmitBtn");
  await page.waitForSelector("#appScreen.active", { timeout: 15000 });

  await ctxAdmin.close();
  await ctx.close();
  await ctxOther.close();
});

test("a denied request can't set a password, and neither can a different browser", async ({ browser, request, baseURL }) => {
  const ctxAdmin = await browser.newContext();
  const admin = await ctxAdmin.newPage();
  await loginAsAdmin(admin);

  const who = uniqueName("De").slice(0, 24);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signup(page, who);
  await page.click("#logoutBtn");
  await page.waitForSelector("#authSubmitBtn", { state: "visible" });
  await page.fill("#nameInput", who);
  await page.click("#forgotLink");
  await expect(page.locator("#authMsg")).toContainText("huey has been asked", { timeout: 10000 });
  const mine = await page.evaluate(() => JSON.parse(localStorage.getItem("chatclub_forgot_request")));

  // not allowed yet: the function refuses, even with the right secret
  let res = await request.post(baseURL + "/api/reset", { data: { id: mine.id, secret: mine.secret, password: "hacked123" } });
  expect((await res.json()).ok).toBeFalsy();
  // a wrong secret is refused too
  res = await request.post(baseURL + "/api/reset", { data: { id: mine.id, secret: "0".repeat(48), password: "hacked123" } });
  expect((await res.json()).ok).toBeFalsy();

  const card = admin.locator(".reset-card").filter({ hasText: who });
  await expect(card).toBeVisible({ timeout: 10000 });
  await card.locator("button.deny").click();
  await expect(page.locator("#authMsg")).toContainText("huey said no", { timeout: 10000 });
  await expect(page.locator("#resetBox")).toBeHidden();
  res = await request.post(baseURL + "/api/reset", { data: { id: mine.id, secret: mine.secret, password: "hacked123" } });
  expect((await res.json()).ok).toBeFalsy();

  // the old password still works
  await page.fill("#passwordInput", PASSWORD);
  await page.click("#authSubmitBtn");
  await page.waitForSelector("#appScreen.active", { timeout: 15000 });

  await ctxAdmin.close();
  await ctx.close();
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
