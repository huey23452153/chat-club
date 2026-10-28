const { test, expect } = require("@playwright/test");
const { uniqueName, signup, createGroup } = require("./helpers");

const DB = "http://127.0.0.1:8080/v1/projects/school-chat-9e4d8/databases/(default)/documents";
const OWNER = { Authorization: "Bearer owner" }; // the emulator's "skip the rules" key

// chats load their newest 80 messages; older ones come in with "Load older messages"
test("a long chat shows the newest messages and can load older ones", async ({ page, request }) => {
  test.setTimeout(90000);
  await signup(page, uniqueName("Lia"));
  const groupName = uniqueName("Long Chat");
  await createGroup(page, groupName);

  // find the chat and fill it with 100 old messages straight in the database
  const list = await (await request.get(DB + "/groups?pageSize=500", { headers: OWNER })).json();
  const g = list.documents.find((d) => d.fields.name && d.fields.name.stringValue === groupName);
  const groupId = g.name.split("/").pop();
  const start = Date.now() - 3600 * 1000;
  for (let i = 0; i < 100; i++) {
    await request.post(`${DB}/groups/${groupId}/messages`, { headers: OWNER, data: { fields: {
      text: { stringValue: "old message " + i }, senderId: { stringValue: "someoneElse123" }, senderName: { stringValue: "Old Friend" },
      createdAt: { timestampValue: new Date(start + i * 1000).toISOString() },
    } } });
  }

  await page.reload();
  await page.waitForSelector("#appScreen.active", { timeout: 20000 });
  await page.locator(".chat-item-name", { hasText: groupName }).click();
  await expect(page.locator(".bubble", { hasText: "old message 99" })).toBeVisible({ timeout: 15000 });
  await expect(page.locator(".bubble", { hasText: /^old message 5$/ })).toHaveCount(0);
  await page.click(".load-older-btn");
  await expect(page.locator(".bubble", { hasText: /^old message 5$/ })).toBeVisible({ timeout: 15000 });
  // that was all of them, so the button goes away
  await expect(page.locator(".load-older-btn")).toHaveCount(0);
});
