const { test, expect } = require("@playwright/test");
const { uniqueName, signup, createGroup } = require("./helpers");

// No waiting between messages, but the same thing over and over or keyboard mashing doesn't send
test("no cooldown, but repeats and keyboard mashing are stopped", async ({ page }) => {
  await signup(page, uniqueName("Sam"));
  await createGroup(page, "Spam Chat");
  const send = async (t) => { await page.fill("#messageInput", t); await page.click("#sendBtn"); };
  // straight after each other is fine
  await send("one"); await send("two"); await send("three");
  for (const t of ["one", "two", "three"]) await expect(page.locator(".bubble", { hasText: new RegExp("^" + t + "$") })).toHaveCount(1, { timeout: 10000 });
  // the same thing a third time isn't sent
  await send("same again"); await send("same again"); await send("same again");
  await expect(page.locator("#composerHint")).toContainText("already sent that");
  await expect(page.locator(".bubble", { hasText: "same again" })).toHaveCount(2);
  // mashing isn't sent; stretched words and laughing are
  await send("asdfghjklzxcvb qwrtpsdfgh");
  await expect(page.locator("#composerHint")).toContainText("keyboard mashing");
  await send("yessssssss hehehe");
  await expect(page.locator(".bubble", { hasText: "yessssssss hehehe" })).toHaveCount(1, { timeout: 10000 });
});
