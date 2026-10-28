const { test, expect } = require("@playwright/test");
const { uniqueName, signup, createGroup, inviteToGroup, acceptFirstInvite } = require("./helpers");

// When Firebase's free limit runs out, Chat Club switches to the backup chat on the
// relay server. (?backup turns it on, to test it; this uses the real relay.)
test("backup chat: messages still go between friends when the backup is on", async ({ browser }) => {
  test.setTimeout(120000);
  const ctxA = await browser.newContext(), ctxB = await browser.newContext();
  const a = await ctxA.newPage(), b = await ctxB.newPage();
  const nameA = uniqueName("Ava"), nameB = uniqueName("Ben"), group = uniqueName("Backup Chat");
  await signup(a, nameA); await signup(b, nameB);
  await createGroup(a, group); await inviteToGroup(a, nameB); await acceptFirstInvite(b);
  await expect(b.locator(".chat-item-name", { hasText: group })).toBeVisible({ timeout: 15000 });

  for (const p of [a, b]) {
    await p.goto("/?backup");
    await p.waitForSelector("#appScreen.active", { timeout: 20000 });
    await expect(p.locator("#backupBanner")).toHaveClass(/show/, { timeout: 15000 });
    await p.locator(".chat-item-name", { hasText: group }).click();
    await p.waitForSelector("#chatView", { state: "visible" });
  }
  const text = "backup hello " + Date.now();
  await expect.poll(async () => {
    await a.fill("#messageInput", text); await a.click("#sendBtn"); await a.waitForTimeout(3500);
    return b.locator(".bubble", { hasText: text }).count();
  }, { timeout: 90000, intervals: [1000] }).toBeGreaterThan(0);
  await ctxA.close(); await ctxB.close();
});
