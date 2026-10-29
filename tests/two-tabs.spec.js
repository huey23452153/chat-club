const { test, expect } = require("@playwright/test");
const { uniqueName, signup, createGroup } = require("./helpers");

// Chat Club open in two tabs of the same browser: both still send
test("two tabs open at once: messages still send from both", async ({ page }) => {
  test.setTimeout(90000);
  const group = uniqueName("Tabs Chat");
  await signup(page, uniqueName("Tia")); await createGroup(page, group);
  const page2 = await page.context().newPage();
  page2.on("pageerror", (e) => console.log("tab2 error:", e.message));
  await page2.goto("/");
  await page2.waitForSelector("#appScreen.active", { timeout: 20000 });
  for (const [p, text] of [[page2, "from tab two"], [page, "from tab one"]]) {
    await p.locator(".chat-item-name", { hasText: group }).click();
    await p.fill("#messageInput", text); await p.click("#sendBtn");
  }
  for (const p of [page, page2]) for (const text of ["from tab two", "from tab one"])
    await expect(p.locator(".bubble", { hasText: text })).toBeVisible({ timeout: 15000 });
});
