const { test, expect } = require("@playwright/test");
const {
  uniqueName, signup, createGroup, inviteToGroup, acceptFirstInvite,
} = require("./helpers");

test("a chat you haven't opened shows how many messages are unread, and opening it clears the count", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  const nameA = uniqueName("Ava");
  const nameB = uniqueName("Ben");

  await signup(pageA, nameA);
  await signup(pageB, nameB);

  await createGroup(pageA, "Badge Chat");
  await inviteToGroup(pageA, nameB);
  await acceptFirstInvite(pageB);

  const item = pageB.locator(".chat-item", { hasText: "Badge Chat" });
  await expect(item).toBeVisible({ timeout: 10000 });
  await expect(item.locator(".unread-badge")).toHaveCount(0);

  for (const text of ["first one", "second one"]) {
    await pageA.fill("#messageInput", text);
    await expect(pageA.locator("#sendBtn")).toBeEnabled({ timeout: 10000 });
    await pageA.click("#sendBtn");
    await expect(pageA.locator(".bubble").filter({ hasText: text })).toBeVisible({ timeout: 10000 });
  }

  await expect(item.locator(".unread-badge")).toHaveText("2", { timeout: 10000 });
  // the sender's own list never counts their own messages
  await expect(pageA.locator(".chat-item .unread-badge")).toHaveCount(0);

  await item.click();
  await expect(pageB.locator(".bubble").filter({ hasText: "second one" })).toBeVisible({ timeout: 10000 });
  await expect(pageB.locator(".chat-item .unread-badge")).toHaveCount(0);

  // a message that arrives while the chat is open doesn't leave a count behind
  await pageA.fill("#messageInput", "third one");
  await expect(pageA.locator("#sendBtn")).toBeEnabled({ timeout: 10000 });
  await pageA.click("#sendBtn");
  await expect(pageB.locator(".bubble").filter({ hasText: "third one" })).toBeVisible({ timeout: 10000 });
  await pageB.waitForTimeout(1500);
  await expect(pageB.locator(".chat-item .unread-badge")).toHaveCount(0);

  await ctxA.close();
  await ctxB.close();
});
