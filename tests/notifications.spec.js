const { test, expect } = require("@playwright/test");
const { uniqueName, signup } = require("./helpers");

// Headless Chromium doesn't actually grant Notification permission even via
// context.grantPermissions, so stand in for the whole API like the
// remote-control test stands in for the screen-share/helper APIs.
function installFakeNotifications() {
  window.__notifs = [];
  function FakeNotification(title, opts) {
    window.__notifs.push({ title, body: opts?.body });
    return { close(){} };
  }
  FakeNotification.permission = "default";
  FakeNotification.requestPermission = async () => { FakeNotification.permission = "granted"; return "granted"; };
  window.Notification = FakeNotification;
}

test("turning on notifications asks for permission and remembers the choice", async ({ page }) => {
  await page.addInitScript(installFakeNotifications);
  await signup(page, uniqueName("Nora"));

  await page.click("#customizeBtn");
  await expect(page.locator("#notifsToggleBtn")).toHaveText("Turn on notifications");

  await page.click("#notifsToggleBtn");
  await expect(page.locator("#notifsToggleBtn")).toHaveText("Turn off notifications");

  // Reopening the modal should still show it's on.
  await page.click('#customizeModal [data-close="customizeModal"]');
  await page.click("#customizeBtn");
  await expect(page.locator("#notifsToggleBtn")).toHaveText("Turn off notifications");

  await page.click("#notifsToggleBtn");
  await expect(page.locator("#notifsToggleBtn")).toHaveText("Turn on notifications");
});

test("a message from someone else pops a desktop notification when the tab is hidden", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  await pageA.addInitScript(installFakeNotifications);

  const nameA = uniqueName("Otto");
  const nameB = uniqueName("Pia");
  await signup(pageA, nameA);
  await signup(pageB, nameB);

  await pageA.click("#customizeBtn");
  await pageA.click("#notifsToggleBtn");
  await pageA.click('#customizeModal [data-close="customizeModal"]');

  await pageA.click("#newGroupBtn");
  await pageA.fill("#newGroupName", "Notif Chat");
  await pageA.click("#createGroupBtn");
  await pageA.click("#addPersonBtn");
  await pageA.fill("#addPersonName", nameB);
  await pageA.click("#confirmAddPersonBtn");

  await pageB.waitForSelector(".invite-item .accept", { timeout: 15000 });
  await pageB.click(".invite-item .accept");
  await pageB.locator(".chat-item-name", { hasText: "Notif Chat" }).click();
  await pageB.waitForSelector("#chatView", { state: "visible" });

  // Pretend A's tab is in the background.
  await pageA.evaluate(() => {
    Object.defineProperty(document, "hidden", { get: () => true, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });

  await pageB.fill("#messageInput", "you awake?");
  await pageB.click("#sendBtn");

  await expect.poll(() => pageA.evaluate(() => window.__notifs.length)).toBeGreaterThan(0);
  const n = await pageA.evaluate(() => window.__notifs[0]);
  expect(n.title).toBe(nameB);
  expect(n.body).toBe("you awake?");

  await ctxA.close();
  await ctxB.close();
});

test("on a small phone screen, the bottom of Customize is reachable and ✕ closes it", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.addInitScript(installFakeNotifications);
  await signup(page, uniqueName("Quinn"));

  await page.click("#customizeBtn");
  await expect(page.locator("#customizeModal")).toHaveClass(/show/);

  // The toggle at the very bottom can be scrolled to and used.
  await page.locator("#notifsToggleBtn").scrollIntoViewIfNeeded();
  await page.click("#notifsToggleBtn");
  await expect(page.locator("#notifsToggleBtn")).toHaveText("Turn off notifications");

  // Even scrolled all the way down, the ✕ is still on screen and closes it.
  await expect(page.locator("#customizeModal .modal-x")).toBeInViewport();
  await page.click("#customizeModal .modal-x");
  await expect(page.locator("#customizeModal")).not.toHaveClass(/show/);
});
