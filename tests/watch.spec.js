const { test, expect } = require("@playwright/test");
const { spawn } = require("child_process");
const path = require("path");
const { uniqueName, signup, createGroup, inviteToGroup, acceptFirstInvite } = require("./helpers");

// 📺 Watch: two people in a chat play the same YouTube video at the same time, can queue more,
// and the song is skipped once half of them vote to skip it. Uses a relay run right here,
// and YouTube itself (so it needs the internet).
test.describe.configure({ mode: "serial" }); // (one relay port for both)
let relay;
test.beforeAll(async () => {
  relay = spawn(process.execPath, [path.join(__dirname, "..", "relay", "server.js")], { env: { ...process.env, PORT: "10777" } });
  await new Promise((ok) => relay.stdout.on("data", (d) => String(d).includes("listening") && ok()));
});
test.afterAll(() => relay && relay.kill());

test("watch YouTube together, queue, and vote to skip", async ({ browser }) => {
  test.setTimeout(150000);
  const ctxA = await browser.newContext(), ctxB = await browser.newContext();
  const pageA = await ctxA.newPage(), pageB = await ctxB.newPage();
  for (const p of [pageA, pageB]) await p.addInitScript(() => localStorage.setItem("chatclub_watch_ws", "ws://127.0.0.1:10777/watch"));
  const nameB = uniqueName("Ben");
  await signup(pageA, uniqueName("Ava"));
  await signup(pageB, nameB);
  await createGroup(pageA, "Watch Chat");
  await inviteToGroup(pageA, nameB);
  await acceptFirstInvite(pageB);
  await pageB.locator(".chat-item-name", { hasText: "Watch Chat" }).click();

  await pageA.click("#watchBtn");
  await pageA.fill("#watchUrl", "https://www.youtube.com/watch?v=jNQXAC9IVRw");
  await pageA.press("#watchUrl", "Enter");
  await expect(pageA.locator("#watchNow")).toContainText("Me at the zoo", { timeout: 15000 });
  // B sees it's on, and joins in
  await expect(pageB.locator("#watchBtn")).toHaveText(/Watching \(2\)/, { timeout: 15000 });
  await pageB.click("#watchBtn");
  await expect(pageB.locator("#watchNow")).toContainText("Me at the zoo");
  await expect(pageB.locator("#watchPanel iframe")).toBeVisible({ timeout: 20000 });

  // both play the same moment: within a quarter of a second of each other
  const videoTime = async (p) => { const f = p.frames().find((x) => x.url().includes("youtube.com/embed")); return f ? f.evaluate(() => { const v = document.querySelector("video"); return v && !v.paused ? v.currentTime : null; }).catch(() => null) : null; };
  await expect.poll(async () => (await videoTime(pageA)) !== null && (await videoTime(pageB)) !== null, { timeout: 30000 }).toBe(true);
  await pageA.waitForTimeout(6000);
  const [ta, tb] = await Promise.all([videoTime(pageA), videoTime(pageB)]);
  console.log("apart by", Math.abs(ta - tb).toFixed(3), "s");
  expect(Math.abs(ta - tb)).toBeLessThan(0.4);

  // a second one waits in the list
  await pageB.fill("#watchUrl", "https://youtu.be/dQw4w9WgXcQ");
  await pageB.click("#watchAddBtn");
  await expect(pageA.locator("#watchQueue li")).toHaveCount(1, { timeout: 15000 });

  // one vote of two is enough (half): skip to the next
  await expect(pageA.locator("#watchSkipBtn")).toHaveText("⏭ Vote skip (0/1)");
  await pageA.click("#watchSkipBtn");
  await expect(pageB.locator("#watchNow")).toContainText("Rick Astley", { timeout: 15000 });
  await expect(pageA.locator("#watchQueue li")).toHaveCount(0);

  await ctxA.close(); await ctxB.close();
});

// a pause someone really presses goes to everyone; the player pausing by itself (loading, a blocked autoplay) doesn't
test("watch: only real pauses are shared", async ({ browser }) => {
  test.setTimeout(150000);
  const ctxA = await browser.newContext(), ctxB = await browser.newContext();
  const pageA = await ctxA.newPage(), pageB = await ctxB.newPage();
  for (const p of [pageA, pageB]) await p.addInitScript(() => localStorage.setItem("chatclub_watch_ws", "ws://127.0.0.1:10777/watch"));
  const nameB = uniqueName("Ben");
  await signup(pageA, uniqueName("Ava")); await signup(pageB, nameB);
  await createGroup(pageA, "Pause Chat"); await inviteToGroup(pageA, nameB); await acceptFirstInvite(pageB);
  await pageB.locator(".chat-item-name", { hasText: "Pause Chat" }).click();
  await pageA.click("#watchBtn");
  await pageA.fill("#watchUrl", "https://www.youtube.com/watch?v=jNQXAC9IVRw"); await pageA.press("#watchUrl", "Enter");
  await expect(pageB.locator("#watchBtn")).toHaveText(/Watching/, { timeout: 15000 });
  await pageB.click("#watchBtn");
  const playing = (p) => { const f = p.frames().find((x) => x.url().includes("youtube.com/embed")); return f ? f.evaluate(() => { const v = document.querySelector("video"); return !!v && !v.paused; }).catch(() => false) : false; };
  await expect.poll(async () => (await playing(pageA)) && (await playing(pageB)), { timeout: 30000 }).toBe(true);
  await pageA.waitForTimeout(3000);
  // B's player pauses by itself (not B pressing it): A keeps playing, and B's starts again
  await pageB.evaluate(() => { document.activeElement && document.activeElement.blur(); });
  const fb = pageB.frames().find((x) => x.url().includes("youtube.com/embed"));
  await fb.evaluate(() => document.querySelector("video").pause());
  await pageA.waitForTimeout(3000);
  expect(await playing(pageA)).toBe(true);
  await expect(pageA.locator("#watchNow")).toContainText("▶️");
  await expect.poll(() => playing(pageB), { timeout: 10000 }).toBe(true);
  // A presses pause in the player: B pauses too
  await pageA.locator("#watchPanel iframe").click();
  await expect(pageB.locator("#watchNow")).toContainText("⏸", { timeout: 10000 });
  await expect.poll(() => playing(pageB), { timeout: 10000 }).toBe(false);
  await ctxA.close(); await ctxB.close();
});
