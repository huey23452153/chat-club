const { test, expect } = require("@playwright/test");
const { uniqueName, signup, createGroup } = require("./helpers");

async function send(page, text) {
  await page.fill("#messageInput", text);
  await expect(page.locator("#sendBtn")).toBeEnabled({ timeout: 10000 });
  await page.click("#sendBtn");
}

test("a link in a message is clickable and gets a preview card", async ({ page, baseURL }) => {
  await signup(page, uniqueName("Lin"));
  await createGroup(page, "Links");
  const url = `${baseURL}/tests/fixtures/preview-page.html`;
  await send(page, `look at this ${url}.`);

  const link = page.locator(".bubble .msg-link");
  await expect(link).toHaveAttribute("href", url, { timeout: 10000 });
  await expect(link).toHaveAttribute("target", "_blank");

  const card = page.locator(".bubble .link-card");
  await expect(card).toBeVisible({ timeout: 10000 });
  await expect(card.locator(".link-card-title")).toHaveText("Huey's Test Page");
  await expect(card.locator(".link-card-site")).toHaveText("Fixture Site");
  await expect(card.locator(".link-card-img")).toHaveAttribute("src", `${baseURL}/icons/icon-192.png`);
});

test("a link straight to a picture or GIF shows the picture", async ({ page, baseURL }) => {
  await signup(page, uniqueName("Gif"));
  await createGroup(page, "Gifs");
  const url = `${baseURL}/icons/icon-192.png`;
  await send(page, url);
  await expect(page.locator(".bubble img.msg-linked-image")).toHaveAttribute("src", url, { timeout: 10000 });
});

test("message text can't smuggle in HTML through a link", async ({ page }) => {
  await signup(page, uniqueName("Xss"));
  await createGroup(page, "Safe");
  await send(page, `https://example.com/"onmouseover="window.hacked=1 <img src=x onerror="window.hacked=1">`);
  await expect(page.locator(".bubble .msg-link")).toBeVisible({ timeout: 10000 });
  await expect(page.locator(".bubble .msg-text img")).toHaveCount(0);
  await expect(page.locator(".bubble .msg-link")).not.toHaveAttribute("onmouseover", /.*/);
  expect(await page.evaluate(() => window.hacked)).toBeUndefined();
});

test("pinning a chat keeps it at the top of the list, and unpinning lets it go back", async ({ page }) => {
  await signup(page, uniqueName("Pin"));
  await createGroup(page, "Older Chat");
  await createGroup(page, "Newer Chat");
  const names = page.locator(".chat-item .chat-item-name");
  await expect(names).toHaveText(["Newer Chat", "Older Chat"], { timeout: 10000 });

  const older = page.locator(".chat-item", { hasText: "Older Chat" });
  await older.hover();
  await older.locator(".chat-pin-btn").click();
  await expect(names).toHaveText(["Older Chat", "Newer Chat"], { timeout: 10000 });
  await expect(older.locator(".chat-pin-btn")).toHaveClass(/pinned/);
  // pinning doesn't open the chat
  await expect(page.locator("#chatTitle")).toHaveText("Newer Chat");

  // a message in the other chat doesn't push the pinned one down
  await send(page, "hello");
  await expect(page.locator(".bubble").filter({ hasText: "hello" })).toBeVisible({ timeout: 10000 });
  await expect(names).toHaveText(["Older Chat", "Newer Chat"]);

  await older.locator(".chat-pin-btn").click();
  await expect(names).toHaveText(["Newer Chat", "Older Chat"], { timeout: 10000 });
});
