const { test, expect } = require("@playwright/test");
const { PASSWORD, uniqueName, signup, createGroup, inviteToGroup, acceptFirstInvite } = require("./helpers");

// logs in as huey (the admin), making the account if this emulator doesn't have it yet
async function loginAsAdmin(page) {
  for (let i = 0; i < 3; i++) {
    await page.goto("/");
    if (i === 1) await page.click("#switchModeLink");
    await page.fill("#nameInput", "huey");
    await page.fill("#passwordInput", PASSWORD);
    await page.click("#authSubmitBtn");
    const r = await Promise.race([
      page.waitForSelector("#appScreen.active", { timeout: 15000 }).then(() => "in"),
      page.waitForSelector("#authMsg.show", { timeout: 15000 }).then(() => "error"),
    ]);
    if (r === "in") return;
  }
  throw new Error("couldn't log in as huey");
}

test("huey can remove anyone's message; other people only get the button on nothing but their own", async ({ browser }) => {
  test.setTimeout(90000);
  const ctxH = await browser.newContext(), ctxF = await browser.newContext();
  const huey = await ctxH.newPage(), friend = await ctxF.newPage();
  const friendName = uniqueName("Fred");
  await loginAsAdmin(huey);
  await signup(friend, friendName);
  const group = uniqueName("Mod Chat");
  await createGroup(huey, group);
  await inviteToGroup(huey, friendName);
  await acceptFirstInvite(friend);
  await friend.locator(".chat-item-name", { hasText: group }).click();
  await friend.waitForSelector("#chatView", { state: "visible" });

  await friend.fill("#messageInput", "a message huey will remove");
  await friend.click("#sendBtn");
  await huey.fill("#messageInput", "hi from huey");
  await huey.click("#sendBtn");

  const fromFriend = huey.locator(".msg-row", { hasText: "a message huey will remove" });
  await expect(fromFriend).toBeVisible({ timeout: 15000 });
  // the friend never sees a remove button on huey's message
  await expect(friend.locator(".msg-row", { hasText: "hi from huey" })).toBeVisible({ timeout: 15000 });
  await expect(friend.locator('[data-action="admin-delete"]')).toHaveCount(0);

  huey.once("dialog", (d) => d.accept());
  await fromFriend.locator('[data-action="admin-delete"]').click();
  await expect(huey.locator(".msg-row", { hasText: "a message huey will remove" })).toHaveCount(0, { timeout: 15000 });
  await expect(friend.locator(".msg-row", { hasText: "a message huey will remove" })).toHaveCount(0, { timeout: 15000 });
  await ctxH.close(); await ctxF.close();
});
