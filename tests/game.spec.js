const { test, expect } = require("@playwright/test");
const {
  uniqueName, signup, createGroup, inviteToGroup, acceptFirstInvite,
} = require("./helpers");

// The 🎮 button in a call opens Dust Crawler over the app, and everyone in
// the same call lands in the same game room (the game is loaded from the
// live site, so this test needs the internet).
test("game button: both people in a call end up in the same Dust Crawler room", async ({ browser }) => {
  test.setTimeout(120000);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  const nameA = uniqueName("Ava");
  const nameB = uniqueName("Ben");
  await signup(pageA, nameA);
  await signup(pageB, nameB);
  await createGroup(pageA, "Game Chat");
  await inviteToGroup(pageA, nameB);
  await acceptFirstInvite(pageB);
  await pageB.locator(".chat-item-name", { hasText: "Game Chat" }).click();
  await pageB.waitForSelector("#chatView", { state: "visible" });

  await pageA.click("#callBtn");
  await pageB.click("#acceptCallBtn");
  await expect(pageA.locator("#callStatusText")).toHaveText("Connected", { timeout: 15000 });

  for(const page of [pageA, pageB]){
    await page.click("#gameBtn");
    await expect(page.locator("#gamePanel")).toBeVisible();
    // the call shrinks into a corner so the game can be seen
    await expect(page.locator("#callOverlay")).toHaveClass(/pip/);
  }
  const srcA = await pageA.locator("#gameFrame").getAttribute("src");
  const srcB = await pageB.locator("#gameFrame").getAttribute("src");
  const room = (src) => new URL(src).searchParams.get("cc");
  expect(room(srcA)).toMatch(/^[A-Z]{4}$/);
  expect(room(srcB)).toBe(room(srcA));

  // inside the games: one made the room, the other joined it, and each sees the other
  const inGame = async (page) => {
    const frame = page.frame({ url: /dust-crawler/ });
    await expect.poll(() => frame.evaluate(() => window.game && window.game.remotes.size), { timeout: 60000 }).toBe(1);
    return frame.evaluate(() => ({ code: window.game.net.code, host: window.game.net.isHost }));
  };
  const gA = await inGame(pageA), gB = await inGame(pageB);
  expect(gA.code).toBe(room(srcA));
  expect(gB.code).toBe(room(srcA));
  expect(gA.host).not.toBe(gB.host);

  // leaving the game keeps the call; hanging up closes the game too
  await pageA.click("#gameCloseBtn");
  await expect(pageA.locator("#gamePanel")).toBeHidden();
  await expect(pageA.locator("#callOverlay")).toHaveClass(/show/);
  await pageB.click("#endCallBtn");
  await expect(pageB.locator("#gamePanel")).toBeHidden();

  await ctxA.close();
  await ctxB.close();
});
