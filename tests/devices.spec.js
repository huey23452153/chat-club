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
  // minimised (and at the smallest size), the hang up button still fits inside the little call box
  await pageA.click("#pipToggleBtn");
  for (const w of [null, 160]) {
    if (w) await pageA.evaluate((w) => { document.getElementById("callOverlay").style.width = w + "px"; }, w);
    const fits = await pageA.evaluate(() => { const o = document.getElementById("callOverlay").getBoundingClientRect(), b = document.getElementById("endCallBtn").getBoundingClientRect(); return b.width > 0 && b.left >= o.left - 1 && b.right <= o.right + 1 && b.bottom <= o.bottom + 1; });
    expect(fits).toBe(true);
  }
  await ctxA.close(); await ctxB.close();
});
