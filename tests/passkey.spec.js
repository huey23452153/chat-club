const { test, expect } = require("@playwright/test");
const { uniqueName, signup } = require("./helpers");

// A pretend fingerprint reader / Windows Hello, built into the test browser: it always "recognises" the person.
async function addFakeAuthenticator(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
}

test("set up a passkey, log out, log back in with it and no password", async ({ page }) => {
  await addFakeAuthenticator(page);
  const name = uniqueName("Pk").slice(0, 24);
  await signup(page, name);

  await page.click("#customizeBtn");
  await page.click("#addPasskeyBtn");
  await expect(page.locator("#passkeyMsg")).toContainText("Done!", { timeout: 30000 });

  // the same device again: already set up
  await page.click("#addPasskeyBtn");
  await expect(page.locator("#passkeyMsg")).toContainText("already has a passkey", { timeout: 15000 });

  await page.reload();
  await page.waitForSelector("#appScreen.active", { timeout: 15000 });
  await page.click("#logoutBtn");
  await page.waitForSelector("#authSubmitBtn", { state: "visible" });

  await expect(page.locator("#nameInput")).toHaveValue("");
  await page.click("#passkeyLoginBtn");
  await page.waitForSelector("#appScreen.active", { timeout: 15000 });
});
