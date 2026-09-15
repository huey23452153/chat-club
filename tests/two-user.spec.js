const { test, expect } = require("@playwright/test");
const {
  uniqueName, signup, createGroup, inviteToGroup, acceptFirstInvite,
} = require("./helpers");

// These tests use two separate browser contexts (like two separate devices/
// browsers) since Firebase Auth persists one session per origin per context.

test("inviting a friend and them accepting adds them to the group", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  const nameA = uniqueName("Jill");
  const nameB = uniqueName("Kevin");

  await signup(pageA, nameA);
  await signup(pageB, nameB);

  await createGroup(pageA, "Friends Chat");
  await inviteToGroup(pageA, nameB);

  await acceptFirstInvite(pageB);

  await expect(pageB.locator(".chat-item-name").filter({ hasText: "Friends Chat" })).toBeVisible();

  // The inviter's live listener should reflect the new member count too.
  await expect(pageA.locator("#chatMemberCount")).toHaveText("2 people");

  await ctxA.close();
  await ctxB.close();
});

test("a message sent by one person shows up live for the other", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  const nameA = uniqueName("Leo");
  const nameB = uniqueName("Mia");

  await signup(pageA, nameA);
  await signup(pageB, nameB);

  await createGroup(pageA, "Live Chat");
  await inviteToGroup(pageA, nameB);
  await acceptFirstInvite(pageB);

  await pageB.locator(".chat-item-name", { hasText: "Live Chat" }).click();
  await pageB.waitForSelector("#chatView", { state: "visible" });

  await pageA.fill("#messageInput", "hi from A");
  await pageA.click("#sendBtn");

  await expect(pageB.locator(".bubble").filter({ hasText: "hi from A" })).toBeVisible({ timeout: 10000 });

  await ctxA.close();
  await ctxB.close();
});

test("the call button only appears once a chat has exactly two people", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  const nameA = uniqueName("Nora");
  const nameB = uniqueName("Omar");

  await signup(pageA, nameA);
  await signup(pageB, nameB);

  await createGroup(pageA, "Call Test Chat");
  await expect(pageA.locator("#callBtn")).toBeHidden();

  await inviteToGroup(pageA, nameB);
  await acceptFirstInvite(pageB);

  await expect(pageA.locator("#callBtn")).toBeVisible();

  await ctxA.close();
  await ctxB.close();
});

test("starting a video call rings the other person, and accepting connects both sides", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  const nameA = uniqueName("Priya");
  const nameB = uniqueName("Quinn");

  await signup(pageA, nameA);
  await signup(pageB, nameB);

  await createGroup(pageA, "Video Chat");
  await inviteToGroup(pageA, nameB);
  await acceptFirstInvite(pageB);

  // B needs the chat open to receive the incoming-call listener,
  // matching the same "must have the chat open" behavior as typing indicators.
  await pageB.locator(".chat-item-name", { hasText: "Video Chat" }).click();
  await pageB.waitForSelector("#chatView", { state: "visible" });

  await pageA.click("#callBtn");
  await expect(pageA.locator("#callOverlay")).toHaveClass(/show/);

  await expect(pageB.locator("#incomingCallBanner")).toHaveClass(/show/, { timeout: 10000 });
  await expect(pageB.locator("#incomingCallText")).toContainText(nameA);

  await pageB.click("#acceptCallBtn");

  await expect(pageB.locator("#callOverlay")).toHaveClass(/show/);
  await expect(pageA.locator("#callStatusText")).toHaveText("Connected", { timeout: 15000 });

  // Ending the call from one side should close it on both.
  await pageA.click("#endCallBtn");
  await expect(pageA.locator("#callOverlay")).not.toHaveClass(/show/);
  await expect(pageB.locator("#callOverlay")).not.toHaveClass(/show/, { timeout: 10000 });

  await ctxA.close();
  await ctxB.close();
});

test("declining a call clears the caller's overlay", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  const nameA = uniqueName("Ravi");
  const nameB = uniqueName("Sara");

  await signup(pageA, nameA);
  await signup(pageB, nameB);

  await createGroup(pageA, "Decline Chat");
  await inviteToGroup(pageA, nameB);
  await acceptFirstInvite(pageB);

  await pageB.locator(".chat-item-name", { hasText: "Decline Chat" }).click();
  await pageB.waitForSelector("#chatView", { state: "visible" });

  await pageA.click("#callBtn");
  await expect(pageB.locator("#incomingCallBanner")).toHaveClass(/show/, { timeout: 10000 });

  await pageB.click("#declineCallBtn");

  await expect(pageA.locator("#callStatusText")).toHaveText("Call declined", { timeout: 10000 });
  await expect(pageA.locator("#callOverlay")).not.toHaveClass(/show/, { timeout: 10000 });

  await ctxA.close();
  await ctxB.close();
});

test("an owner can remove a member from the group", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  const nameA = uniqueName("Aria");
  const nameB = uniqueName("Beau");

  await signup(pageA, nameA);
  await signup(pageB, nameB);

  await createGroup(pageA, "Remove Test Chat");
  await inviteToGroup(pageA, nameB);
  await acceptFirstInvite(pageB);

  await expect(pageA.locator("#chatMemberCount")).toHaveText("2 people");

  pageA.on("dialog", (dialog) => dialog.accept());
  await pageA.click("#addPersonBtn");
  await pageA.click(`.member-chip-remove[title="Remove ${nameB}"]`);

  // Check the toast first — it auto-dismisses after a few seconds, so it
  // has to be checked before the other, slower-to-settle assertions below.
  await expect(pageB.locator(".toast-name", { hasText: "Removed from chat" })).toBeVisible({ timeout: 10000 });
  await expect(pageA.locator("#chatMemberCount")).toHaveText("1 people", { timeout: 10000 });
  await expect(pageB.locator(".chat-item-name", { hasText: "Remove Test Chat" })).toHaveCount(0, { timeout: 10000 });

  await ctxA.close();
  await ctxB.close();
});

test("the sender sees a 'Seen by' note once the other person reads the message", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  const nameA = uniqueName("Cora");
  const nameB = uniqueName("Drew");

  await signup(pageA, nameA);
  await signup(pageB, nameB);

  await createGroup(pageA, "Receipts Chat");
  await inviteToGroup(pageA, nameB);
  await acceptFirstInvite(pageB);

  await pageA.fill("#messageInput", "did you see this");
  await pageA.click("#sendBtn");
  await expect(pageA.locator(".bubble", { hasText: "did you see this" })).toBeVisible();

  // B hasn't opened the chat yet, so there's nothing to show as seen.
  await expect(pageA.locator("#seenIndicator")).toHaveText("");

  await pageB.locator(".chat-item-name", { hasText: "Receipts Chat" }).click();
  await pageB.waitForSelector("#chatView", { state: "visible" });

  await expect(pageA.locator("#seenIndicator")).toHaveText(`Seen by ${nameB}`, { timeout: 10000 });

  await ctxA.close();
  await ctxB.close();
});
