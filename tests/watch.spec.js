const { test, expect } = require("@playwright/test");
const { spawn } = require("child_process");
const path = require("path");
const { uniqueName, signup, createGroup, inviteToGroup, acceptFirstInvite } = require("./helpers");

// 📺 Watch: two people in a chat play the same YouTube video at the same time, can queue more,
// and the song is skipped once half of them vote to skip it. Uses a relay run right here,
// and YouTube itself (so it needs the internet).
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
