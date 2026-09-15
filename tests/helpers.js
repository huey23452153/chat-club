const { expect } = require("@playwright/test");

const PASSWORD = "testpass123";

function uniqueName(prefix) {
  return `${prefix}${Date.now()}${Math.floor(Math.random() * 10000)}`;
}

async function signup(page, name, password = PASSWORD) {
  await page.goto("/");
  await page.click("#switchModeLink");
  await page.fill("#nameInput", name);
  await page.fill("#passwordInput", password);
  await page.click("#authSubmitBtn");
  // generous timeout: the very first request against a freshly-started
  // Auth emulator can be noticeably slower than the rest
  await page.waitForSelector("#appScreen.active", { timeout: 25000 });
}

async function login(page, name, password = PASSWORD) {
  await page.goto("/");
  await page.fill("#nameInput", name);
  await page.fill("#passwordInput", password);
  await page.click("#authSubmitBtn");
  await page.waitForSelector("#appScreen.active", { timeout: 15000 });
}

async function createGroup(page, groupName) {
  await page.click("#newGroupBtn");
  await page.fill("#newGroupName", groupName);
  await page.click("#createGroupBtn");
  await page.waitForSelector("#chatView", { state: "visible" });
}

async function inviteToGroup(page, friendName) {
  await page.click("#addPersonBtn");
  await page.fill("#addPersonName", friendName);
  await page.click("#confirmAddPersonBtn");
  await page.click('#addPersonModal [data-close="addPersonModal"]');
  await expect(page.locator("#addPersonModal")).not.toHaveClass(/show/);
}

async function acceptFirstInvite(page) {
  await page.waitForSelector(".invite-item .accept", { timeout: 15000 });
  await page.click(".invite-item .accept");
}

module.exports = { PASSWORD, uniqueName, signup, login, createGroup, inviteToGroup, acceptFirstInvite };
