const { test, expect } = require("@playwright/test");
const { uniqueName, signup, createGroup, inviteToGroup, acceptFirstInvite } = require("./helpers");

// a small red PNG made on the fly
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC", "base64");

test("profile pictures show for friends, and tapping a photo opens it full screen", async ({ browser }) => {
  test.setTimeout(90000);
  const ctxA = await browser.newContext(), ctxB = await browser.newContext();
  const a = await ctxA.newPage(), b = await ctxB.newPage();
  const nameA = uniqueName("Ava"), nameB = uniqueName("Ben");
  await signup(a, nameA); await signup(b, nameB);

  // A picks a profile picture in Customize
  await a.click("#customizeBtn");
  await a.setInputFiles("#pfpInput", { name: "me.png", mimeType: "image/png", buffer: PNG });
  await expect(a.locator("#meAvatar")).toHaveClass(/has-photo/, { timeout: 10000 });
  await a.click('[data-close="customizeModal"]');

  const group = uniqueName("Pic Chat");
  await createGroup(a, group); await inviteToGroup(a, nameB); await acceptFirstInvite(b);
  await b.locator(".chat-item-name", { hasText: group }).click();
  await b.waitForSelector("#chatView", { state: "visible" });

  // A sends a photo; B sees A's picture next to A's name
  await a.setInputFiles("#photoInput", { name: "pic.png", mimeType: "image/png", buffer: PNG });
  await expect(a.locator("#imagePreviewStrip")).toHaveClass(/show/);
  await a.click("#sendBtn");
  const row = b.locator(".msg-row.theirs").last();
  await expect(row.locator(".msg-pfp")).toBeVisible({ timeout: 15000 });
  // ...and A sees their own picture next to their own name
  await expect(a.locator(".msg-row.mine").last().locator(".msg-who .msg-pfp")).toBeVisible({ timeout: 15000 });
  await expect(a.locator(".msg-row.mine").last().locator(".msg-who")).toContainText(nameA);

  // tapping the photo fills the screen; tapping again closes it
  await row.locator("img.msg-image").click();
  await expect(b.locator("#imageViewer")).toHaveClass(/show/);
  await b.locator("#imageViewer").click();
  await expect(b.locator("#imageViewer")).not.toHaveClass(/show/);
  await ctxA.close(); await ctxB.close();
});
