const { test, expect } = require("@playwright/test");
const { uniqueName, signup, createGroup } = require("./helpers");

// taking back lots of messages in a row on the backup chat
test("backup chat: deleting many messages in a row", async ({ page: a }) => {
  test.setTimeout(150000);
  const group = uniqueName("Many Del");
  await signup(a, uniqueName("Ava")); await createGroup(a, group);
  await a.goto("/?backup");
  await a.waitForSelector("#appScreen.active", { timeout: 20000 });
  await expect(a.locator("#backupBanner")).toHaveClass(/show/, { timeout: 15000 });
  await a.locator(".chat-item-name", { hasText: group }).click();
  const tag = "m" + Date.now();
  await expect.poll(async () => {
    await a.fill("#messageInput", tag + "-0"); await a.click("#sendBtn"); await a.waitForTimeout(3000);
    return a.locator(".bubble", { hasText: tag + "-0" }).count();
  }, { timeout: 90000, intervals: [1000] }).toBeGreaterThan(0);
  for (let i = 1; i < 8; i++) { await a.fill("#messageInput", tag + "-" + i); await a.click("#sendBtn"); }
  await expect(a.locator(".bubble", { hasText: tag })).toHaveCount(await a.locator(".bubble", { hasText: tag }).count() >= 8 ? await a.locator(".bubble", { hasText: tag }).count() : 8, { timeout: 15000 });
  const n = await a.locator(".bubble", { hasText: tag }).count();
  for (let i = 0; i < n; i++) {
    const mine = a.locator(".bubble", { hasText: tag }).last();
    const box = await mine.boundingBox();
    await a.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await a.mouse.down(); await a.waitForTimeout(900); await a.mouse.up();
    await a.click(".edit-btn.delete");
    await expect(a.locator(".bubble", { hasText: tag })).toHaveCount(n - i - 1, { timeout: 10000 });
  }
});
