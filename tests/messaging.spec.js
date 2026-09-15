const { test, expect } = require("@playwright/test");
const { uniqueName, signup, createGroup } = require("./helpers");

test("sending a message shows it in the chat", async ({ page }) => {
  await signup(page, uniqueName("Ellen"));
  await createGroup(page, "Solo Chat");

  await page.fill("#messageInput", "hello world");
  await page.click("#sendBtn");

  await expect(page.locator(".bubble").filter({ hasText: "hello world" })).toBeVisible();
});

test("editing your own message updates the bubble text", async ({ page }) => {
  await signup(page, uniqueName("Frank"));
  await createGroup(page, "Edit Chat");

  await page.fill("#messageInput", "first draft");
  await page.click("#sendBtn");
  await expect(page.locator(".bubble").filter({ hasText: "first draft" })).toBeVisible();

  // press-and-hold to edit — use a real mouse down/up (not a synthetic
  // dispatchEvent) so the app's pointerdown/pointerup listeners fire exactly
  // like they would for an actual user
  const bubble = page.locator(".bubble[data-editable]").first();
  const box = await bubble.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(600);
  await page.mouse.up();

  const textarea = page.locator("textarea.edit-textarea");
  await expect(textarea).toBeVisible();
  await textarea.fill("edited text");
  await page.click('[data-action="save"]');

  await expect(page.locator(".bubble").filter({ hasText: "edited text" })).toBeVisible();
  await expect(page.locator(".msg-time").filter({ hasText: "edited" })).toBeVisible();
});

test("reacting to a message shows a reaction pill", async ({ page }) => {
  await signup(page, uniqueName("Gina"));
  await createGroup(page, "React Chat");

  await page.fill("#messageInput", "react to this");
  await page.click("#sendBtn");
  await expect(page.locator(".bubble").filter({ hasText: "react to this" })).toBeVisible();

  await page.click('[data-action="react-toggle-picker"]');
  await page.click('[data-action="react-pick"][data-emoji="👍"]');

  await expect(page.locator(".reaction-pill").filter({ hasText: "👍" })).toBeVisible();
});

test("renaming a group updates the chat header", async ({ page }) => {
  await signup(page, uniqueName("Hank"));
  await createGroup(page, "Old Name");

  await page.click("#renameBtn");
  await page.fill("#renameInput", "New Name");
  await page.click("#saveRenameBtn");

  await expect(page.locator("#chatTitle")).toHaveText("New Name");
});

test("the video call button is hidden in a solo (one-person) chat", async ({ page }) => {
  await signup(page, uniqueName("Ivy"));
  await createGroup(page, "Just Me");

  await expect(page.locator("#callBtn")).toBeHidden();
});
