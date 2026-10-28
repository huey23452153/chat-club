const { test, expect } = require("@playwright/test");
const { uniqueName, signup, createGroup, inviteToGroup, acceptFirstInvite } = require("./helpers");

// ⚙️ in a call lists the mics and cameras, and picking one swaps it in (and is remembered)
test("choosing the mic and camera in a call", async ({ browser }) => {
  test.setTimeout(120000);
  const ctxA = await browser.newContext(), ctxB = await browser.newContext();
  const pageA = await ctxA.newPage(), pageB = await ctxB.newPage();
  const nameB = uniqueName("Ben");
  await signup(pageA, uniqueName("Ava"));
  await signup(pageB, nameB);
  await createGroup(pageA, "Device Chat");
  await inviteToGroup(pageA, nameB);
  await acceptFirstInvite(pageB);
  await pageB.locator(".chat-item-name", { hasText: "Device Chat" }).click();
  await pageA.click("#callBtn");
  await pageB.click("#acceptCallBtn");
  await expect(pageA.locator("#callStatusText")).toHaveText("Connected", { timeout: 15000 });

  await pageA.click("#deviceBtn");
  await expect(pageA.locator("#devicePanel")).toBeVisible();
  await expect(pageA.locator("#micSelect option").first()).not.toHaveText(/No mic/, { timeout: 5000 });
  await expect(pageA.locator("#camSelect option").first()).not.toHaveText(/No camera/);
  const cam = await pageA.locator("#camSelect option").first().getAttribute("value");
  await pageA.selectOption("#camSelect", cam);
  await expect.poll(() => pageA.evaluate(() => localStorage.getItem("chatclub_cam"))).toBe(cam);
  // still sending video afterwards
  await expect.poll(() => pageA.evaluate(() => document.getElementById("localVideo").srcObject.getVideoTracks()[0]?.readyState)).toBe("live");
  await pageA.click("#deviceBtn");
  await expect(pageA.locator("#devicePanel")).toBeHidden();
  await ctxA.close(); await ctxB.close();
});
