const { test, expect } = require("@playwright/test");
const { spawn } = require("child_process");
const path = require("path");
const { uniqueName, signup, createGroup, inviteToGroup, acceptFirstInvite } = require("./helpers");

// When Firebase has run out (?backup turns that on), video calls connect through the relay
// instead (a relay run right here).
let relay;
test.beforeAll(async () => {
  relay = spawn(process.execPath, [path.join(__dirname, "..", "relay", "server.js")], { env: { ...process.env, PORT: "10778" } });
  await new Promise((ok) => relay.stdout.on("data", (d) => String(d).includes("listening") && ok()));
});
test.afterAll(() => relay && relay.kill());

test("backup calls: ringing, connecting, leaving and rejoining all work without Firebase", async ({ browser }) => {
  test.setTimeout(120000);
  const ctxA = await browser.newContext(), ctxB = await browser.newContext();
  const a = await ctxA.newPage(), b = await ctxB.newPage();
  for (const p of [a, b]) await p.addInitScript(() => localStorage.setItem("chatclub_call_ws", "ws://127.0.0.1:10778/call"));
  const nameA = uniqueName("Ava"), nameB = uniqueName("Ben"), group = uniqueName("Call Backup");
  await signup(a, nameA); await signup(b, nameB);
  await createGroup(a, group); await inviteToGroup(a, nameB); await acceptFirstInvite(b);
  await expect(b.locator(".chat-item-name", { hasText: group })).toBeVisible({ timeout: 15000 });
  for (const p of [a, b]) {
    await p.goto("/?backup");
    await p.waitForSelector("#appScreen.active", { timeout: 20000 });
    await expect(p.locator("#backupBanner")).toHaveClass(/show/, { timeout: 15000 });
    await p.locator(".chat-item-name", { hasText: group }).click();
    await p.waitForSelector("#chatView", { state: "visible" });
  }
  await a.click("#callBtn");
  await expect(a.locator("#callOverlay")).toHaveClass(/show/);
  await expect(b.locator("#incomingCallBanner")).toHaveClass(/show/, { timeout: 15000 });
  await expect(b.locator("#incomingCallText")).toContainText(nameA);
  await b.click("#acceptCallBtn");
  for (const p of [a, b]) await expect(p.locator("#callStatusText")).toHaveText("Connected", { timeout: 20000 });
  await expect(a.locator(".video-tile-name", { hasText: nameB })).toBeVisible();

  // A leaves and comes back
  await a.click("#endCallBtn");
  await expect(b.locator("#callStatusText")).toHaveText("Waiting for others to join...", { timeout: 15000 });
  await expect(a.locator("#callBtn")).toHaveText("📹 Join Call", { timeout: 10000 });
  // (B is still in it, so A gets the incoming-call banner over the button: accept it)
  await expect(a.locator("#incomingCallBanner")).toHaveClass(/show/, { timeout: 10000 });
  await a.click("#acceptCallBtn");
  for (const p of [a, b]) await expect(p.locator("#callStatusText")).toHaveText("Connected", { timeout: 20000 });
  await ctxA.close(); await ctxB.close();
});
