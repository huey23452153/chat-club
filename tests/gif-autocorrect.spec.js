const { test, expect } = require("@playwright/test");
const { uniqueName, signup, createGroup } = require("./helpers");

// A tiny real animated GIF (2 frames, 1x1), as bytes.
const GIF_B64 = "R0lGODlhAQABAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQAAAAAACwAAAAAAQABAAACAkQBACH5BAAAAAAALAAAAAABAAEAgAAA/wAAAAICRAEAOw==";

test("autocorrect (when switched on) fixes typos as you type", async ({ page }) => {
  await signup(page, uniqueName("Ava"));
  await createGroup(page, "Typo Chat");
  const box = page.locator("#messageInput");
  // off by default: nothing changes
  await box.click(); await page.keyboard.type("teh ");
  await expect(box).toHaveValue("teh ");
  await box.fill("");
  await page.click("#customizeBtn");
  await page.click("#autocorrectToggleBtn");
  await expect(page.locator("#autocorrectToggleBtn")).toHaveText("Turn off autocorrect");
  await page.click('[data-close="customizeModal"]');
  await box.click(); await page.keyboard.type("Teh dog dont care, i think ");
  await expect(box).toHaveValue("The dog don't care, I think ");
  // the big list and the common-words fixer (loaded from the internet), leaving slang and game names alone
  await box.fill("");
  await expect.poll(async () => { await box.fill(""); await box.click(); await page.keyboard.type("goverment "); return box.inputValue(); }, { timeout: 30000 }).toBe("government ");
  await box.fill(""); await box.click();
  await page.keyboard.type("plaeyr tahnks roblox lol bruh jeep ");
  await expect(box).toHaveValue("player thanks roblox lol bruh jeep ");
  // laughing is left alone, however long
  await box.fill(""); await box.click();
  await page.keyboard.type("hehe hehehe hahaha lolol ");
  await expect(box).toHaveValue("hehe hehehe hahaha lolol ");
});

test("pasting a GIF file attaches it still animated (not turned into a photo)", async ({ page }) => {
  await signup(page, uniqueName("Ben"));
  await createGroup(page, "Gif Chat");
  await page.locator("#messageInput").click();
  await page.evaluate((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer(); dt.items.add(new File([bytes], "dance.gif", { type: "image/gif" }));
    document.getElementById("messageInput").dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, GIF_B64);
  await expect(page.locator("#imagePreviewStrip")).toHaveClass(/show/);
  await expect(page.locator("#imagePreviewThumb")).toHaveAttribute("src", /^data:image\/gif;base64,/);
});

test("the GIF button opens GIF search (and says so when it isn't set up yet)", async ({ page }) => {
  await signup(page, uniqueName("Cal"));
  await createGroup(page, "Gif Search Chat");
  await page.click("#gifBtn");
  await expect(page.locator("#gifPanel")).toHaveClass(/show/);
  // the test server has no GIPHY key, so it should explain instead of breaking
  await expect(page.locator("#gifGrid")).toContainText(/not switched on|GIF/i, { timeout: 10000 });
  await page.click("#gifClose");
  await expect(page.locator("#gifPanel")).not.toHaveClass(/show/);
});
