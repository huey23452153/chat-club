const { test, expect } = require("@playwright/test");
const { uniqueName, signup, createGroup } = require("./helpers");

test("sending a message shows it in the chat", async ({ page }) => {
  await signup(page, uniqueName("Ellen"));
  await createGroup(page, "Solo Chat");

  await page.fill("#messageInput", "hello world");
  await page.click("#sendBtn");

  await expect(page.locator(".bubble").filter({ hasText: "hello world" })).toBeVisible();
});

test("swear words are swapped for milder ones before sending", async ({ page }) => {
  await signup(page, uniqueName("Wendy"));
  await createGroup(page, "Clean Chat");

  await page.fill("#messageInput", "What an ass move, hell no");
  await page.click("#sendBtn");

  await expect(page.locator(".bubble").filter({ hasText: "What an butt move, heck no" })).toBeVisible();
  await expect(page.locator(".bubble").filter({ hasText: /\bass\b|\bhell\b/i })).toHaveCount(0);
});

test("damn, dammit, crap, and crappy are left alone (not censored)", async ({ page }) => {
  await signup(page, uniqueName("Xander"));
  await createGroup(page, "Uncensored Words Chat");

  await page.fill("#messageInput", "Damn, dammit, this crap is crappy");
  await page.click("#sendBtn");

  await expect(page.locator(".bubble").filter({ hasText: "Damn, dammit, this crap is crappy" })).toBeVisible();
});

test("leetspeak, stretched letters, and punctuation-split swears still get swapped", async ({ page }) => {
  await signup(page, uniqueName("Yara"));
  await createGroup(page, "Fuzzy Filter Chat");

  await page.fill("#messageInput", "sh1t that was fuuuuck1ng a$$");
  await page.click("#sendBtn");

  await expect(page.locator(".bubble").filter({ hasText: "shoot that was freaking butt" })).toBeVisible();
});

test("the fuzzy filter doesn't mangle ordinary words or short real sentences", async ({ page }) => {
  await signup(page, uniqueName("Zane"));
  await createGroup(page, "False Positive Chat");

  await page.fill("#messageInput", "I have class, and a s soon as possible is fine");
  await page.click("#sendBtn");

  await expect(page.locator(".bubble").filter({
    hasText: "I have class, and a s soon as possible is fine"
  })).toBeVisible();
});

test("editing your own message updates the bubble text", async ({ page }) => {
  await signup(page, uniqueName("Frank"));
  await createGroup(page, "Edit Chat");

  await page.fill("#messageInput", "first draft");
  await page.click("#sendBtn");
  await expect(page.locator(".bubble").filter({ hasText: "first draft" })).toBeVisible();
  // Firestore fires the optimistic local write and then the server-confirmed
  // one in quick succession, and the app fully re-renders the message list
  // each time — wait for that churn to settle before grabbing a bounding box.
  await page.waitForTimeout(400);

  // press-and-hold to edit — use a real mouse down/up (not a synthetic
  // dispatchEvent) so the app's pointerdown/pointerup listeners fire exactly
  // like they would for an actual user
  const bubble = page.locator(".bubble[data-editable]").first();
  await expect(bubble).toBeVisible();
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
