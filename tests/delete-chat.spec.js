const { test, expect } = require("@playwright/test");
const { uniqueName, signup, createGroup, inviteToGroup, acceptFirstInvite } = require("./helpers");

// The person who made a chat can delete it for everyone; anyone else can leave it.
test("deleting a chat (owner) and leaving one (member)", async ({ browser }) => {
  test.setTimeout(90000);
  const ctxA = await browser.newContext(), ctxB = await browser.newContext();
  const a = await ctxA.newPage(), b = await ctxB.newPage();
  const nameB = uniqueName("Ben"), g1 = uniqueName("Gone Chat"), g2 = uniqueName("Leave Chat");
  await signup(a, uniqueName("Ava")); await signup(b, nameB);
  for (const g of [g1, g2]) {
    await createGroup(a, g); await inviteToGroup(a, nameB); await acceptFirstInvite(b);
    await expect(b.locator(".chat-item-name", { hasText: g })).toBeVisible({ timeout: 15000 });
  }
  // A (owner) deletes g1
  await a.locator(".chat-item-name", { hasText: g1 }).click();
  a.once("dialog", (d) => d.accept());
  await a.click("#deleteChatBtn");
  await expect(a.locator(".chat-item-name", { hasText: g1 })).toHaveCount(0, { timeout: 10000 });
  await expect(b.locator(".chat-item-name", { hasText: g1 })).toHaveCount(0, { timeout: 10000 });
  // B (member) leaves g2
  await b.locator(".chat-item-name", { hasText: g2 }).click();
  await b.click("#renameBtn");
  await expect(b.locator("#deleteChatBtn")).toBeHidden();
  await b.click("#leaveChatBtn"); await b.click("#leaveChatBtn");
  await expect(b.locator(".chat-item-name", { hasText: g2 })).toHaveCount(0, { timeout: 10000 });
  await expect(a.locator(".chat-item-name", { hasText: g2 })).toHaveCount(1);
  await ctxA.close(); await ctxB.close();
});
