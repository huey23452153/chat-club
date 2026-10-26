const { test, expect } = require("@playwright/test");
const {
  uniqueName, signup, createGroup, inviteToGroup, acceptFirstInvite,
} = require("./helpers");

// The 🎮 button in a call opens Dust Crawler over the app, and everyone in
// the same call lands in the same game room (the game is loaded from the
// live site, so this test needs the internet).
test("game button: both people in a call end up in the same Dust Crawler room", async ({ browser }) => {
  test.setTimeout(240000);
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
    // pick a map (B picks a different one: the game moves B to the room's map)
    await page.click(`#gameMaps button[data-map="${page === pageA ? "valley" : "outback"}"]`);
    await expect(page.locator("#gameMaps")).toBeHidden();
  }
  // the game inside the page (asked for fresh each time: B's reloads when it switches map)
  const inFrame = (page, fn) => {
    const frame = page.frames().find((f) => /dust-crawler/.test(f.url()));
    return frame ? frame.evaluate(fn).catch(() => null) : Promise.resolve(null);
  };
  // the games start on their menus; START ENGINE joins the call's room
  for(const page of [pageA, pageB]){
    await expect.poll(() => inFrame(page, () => !!(window.game && window.game.G.state === "menu")), { timeout: 60000 }).toBe(true);
    await inFrame(page, () => document.getElementById("start").click());
    if(page === pageA) await expect.poll(() => inFrame(page, () => window.game.net.code), { timeout: 60000 }).not.toBeNull();
  }
  const srcA = await pageA.locator("#gameFrame").getAttribute("src");
  const srcB = await pageB.locator("#gameFrame").getAttribute("src");
  const room = (src) => new URL(src).searchParams.get("cc");
  expect(room(srcA)).toMatch(/^[A-Z]{4}$/);
  expect(room(srcB)).toBe(room(srcA));

  // inside the games: one made the room, the other joined it, and each sees the other
  const inGame = async (page) => {
    await expect.poll(() => inFrame(page, () => window.game && [...window.game.remotes.values()].filter((r) => r.have).length), { timeout: 90000 }).toBe(1);
    return inFrame(page, () => ({ code: window.game.net.code, host: window.game.net.isHost, map: window.game.W.MAP }));
  };
  const gA = await inGame(pageA), gB = await inGame(pageB);
  expect(gA.code).toBe(room(srcA));
  expect(gB.code).toBe(room(srcA));
  expect(gA.host).not.toBe(gB.host);
  // B picked a different map, and got moved onto the room's map
  expect(gB.map).toBe(gA.map);

  // leaving the game keeps the call; hanging up closes the game too
  await pageA.click("#gameCloseBtn");
  await expect(pageA.locator("#gamePanel")).toBeHidden();
  await expect(pageA.locator("#callOverlay")).toHaveClass(/show/);
  await pageB.click("#endCallBtn");
  await expect(pageB.locator("#gamePanel")).toBeHidden();

  await ctxA.close();
  await ctxB.close();
});
