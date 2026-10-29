const { test, expect } = require("@playwright/test");
const { spawn } = require("child_process");
const path = require("path");
const { uniqueName, signup, createGroup, inviteToGroup, acceptFirstInvite } = require("./helpers");

// On the backup chat (Firebase ran out): reactions and editing your own message still work. (A relay run right here.)
let relay;
test.beforeAll(async () => {
  relay = spawn(process.execPath, [path.join(__dirname, "..", "relay", "server.js")], { env: { ...process.env, PORT: "10776" } });
  await new Promise((ok) => relay.stdout.on("data", (d) => String(d).includes("listening") && ok()));
});
test.afterAll(() => relay && relay.kill());

test("backup chat: reactions and edits reach the other person", async ({ browser }) => {
  test.setTimeout(120000);
  const ctxA = await browser.newContext(), ctxB = await browser.newContext();
  const a = await ctxA.newPage(), b = await ctxB.newPage();
  for (const p of [a, b]) await p.addInitScript(() => localStorage.setItem("chatclub_backup_ws", "ws://127.0.0.1:10776/chat"));
  const nameB = uniqueName("Ben"), group = uniqueName("Extras");
  await signup(a, uniqueName("Ava")); await signup(b, nameB);
  await createGroup(a, group); await inviteToGroup(a, nameB); await acceptFirstInvite(b);
  await expect(b.locator(".chat-item-name", { hasText: group })).toBeVisible({ timeout: 15000 });
  for (const p of [a, b]) {
    await p.goto("/?backup");
    await expect(p.locator("#backupBanner")).toHaveClass(/show/, { timeout: 20000 });
    await p.locator(".chat-item-name", { hasText: group }).click();
  }
  await a.fill("#messageInput", "first words"); await a.click("#sendBtn");
  await expect(b.locator(".bubble", { hasText: "first words" })).toBeVisible({ timeout: 15000 });

  // B reacts
  await b.locator('[data-action="react-toggle-picker"]').first().click();
  await b.locator('[data-action="react-pick"]').first().click();
  await expect(a.locator(".reaction-pill")).toHaveCount(1, { timeout: 10000 });

  // A edits it
  const mine = a.locator(".bubble", { hasText: "first words" });
  const box = await mine.boundingBox();
  await a.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await a.mouse.down(); await a.waitForTimeout(900); await a.mouse.up();
  await a.locator("textarea[id^=editTextarea-]").fill("better words");
  await a.locator('[data-action="save"]').click();
  await expect(b.locator(".bubble", { hasText: "better words" })).toBeVisible({ timeout: 10000 });
  await expect(b.locator(".msg-time", { hasText: "edited" })).toHaveCount(1);
  await ctxA.close(); await ctxB.close();
});
