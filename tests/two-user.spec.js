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

test("the call button appears once a solo chat gets a second person", async ({ browser }) => {
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

  await expect(pageA.locator("#callBtn")).toHaveText("📹 Call");
  await pageA.click("#callBtn");
  await expect(pageA.locator("#callOverlay")).toHaveClass(/show/);

  await expect(pageB.locator("#incomingCallBanner")).toHaveClass(/show/, { timeout: 10000 });
  await expect(pageB.locator("#incomingCallText")).toContainText(nameA);
  await expect(pageB.locator("#callBtn")).toHaveText("📹 Join Call");

  await pageB.click("#acceptCallBtn");

  await expect(pageB.locator("#callOverlay")).toHaveClass(/show/);
  await expect(pageA.locator("#callStatusText")).toHaveText("Connected", { timeout: 15000 });
  // Each side should see the other's name labeled on their video tile.
  await expect(pageA.locator(".video-tile-name", { hasText: nameB })).toBeVisible();
  await expect(pageB.locator(".video-tile-name", { hasText: nameA })).toBeVisible();

  // It's a joinable room, not a 1:1 phone call — one person leaving
  // shouldn't kick everyone else out.
  await pageA.click("#endCallBtn");
  await expect(pageA.locator("#callOverlay")).not.toHaveClass(/show/);
  // B is still in the call, so A's button should offer to rejoin, not
  // read as if there's no call at all.
  await expect(pageA.locator("#callBtn")).toHaveText("📹 Join Call");
  await expect(pageB.locator("#callOverlay")).toHaveClass(/show/);
  await expect(pageB.locator("#callStatusText")).toHaveText("Waiting for others to join...", { timeout: 10000 });

  await ctxA.close();
  await ctxB.close();
});

test("declining an incoming call only dismisses your own banner", async ({ browser }) => {
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

  await expect(pageB.locator("#incomingCallBanner")).not.toHaveClass(/show/);
  // Declining is purely local — it shouldn't write anything back, so the
  // caller's call keeps running untouched.
  await expect(pageA.locator("#callOverlay")).toHaveClass(/show/);
  await expect(pageA.locator("#callStatusText")).toHaveText("Waiting for others to join...");

  await ctxA.close();
  await ctxB.close();
});

test("a three-person group call connects everyone to everyone", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ctxC = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  const pageC = await ctxC.newPage();

  const nameA = uniqueName("Tia");
  const nameB = uniqueName("Umar");
  const nameC = uniqueName("Vik");

  await signup(pageA, nameA);
  await signup(pageB, nameB);
  await signup(pageC, nameC);

  await createGroup(pageA, "Trio Call Chat");
  await inviteToGroup(pageA, nameB);
  await acceptFirstInvite(pageB);
  await inviteToGroup(pageA, nameC);
  await acceptFirstInvite(pageC);

  await expect(pageA.locator("#chatMemberCount")).toHaveText("3 people");
  await expect(pageA.locator("#callBtn")).toBeVisible();

  for (const p of [pageB, pageC]) {
    await p.locator(".chat-item-name", { hasText: "Trio Call Chat" }).click();
    await p.waitForSelector("#chatView", { state: "visible" });
  }

  await pageA.click("#callBtn");
  await pageB.click("#acceptCallBtn");
  await pageC.click("#acceptCallBtn");

  // Everyone should end up "Connected", each seeing their own tile plus one
  // remote tile per other participant (2 others each, in a 3-person call).
  for (const p of [pageA, pageB, pageC]) {
    await expect(p.locator("#callStatusText")).toHaveText("Connected", { timeout: 15000 });
    await expect(p.locator(".remote-video-tile")).toHaveCount(2, { timeout: 15000 });
  }

  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
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

test("starting a fresh call after a previous one ended still connects properly", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  const nameA = uniqueName("Elle");
  const nameB = uniqueName("Finn");

  await signup(pageA, nameA);
  await signup(pageB, nameB);

  await createGroup(pageA, "Repeat Call Chat");
  await inviteToGroup(pageA, nameB);
  await acceptFirstInvite(pageB);

  await pageB.locator(".chat-item-name", { hasText: "Repeat Call Chat" }).click();
  await pageB.waitForSelector("#chatView", { state: "visible" });

  // First call: connect, then both leave cleanly.
  await pageA.click("#callBtn");
  await pageB.click("#acceptCallBtn");
  await expect(pageA.locator("#callStatusText")).toHaveText("Connected", { timeout: 15000 });
  await pageB.click("#endCallBtn");
  await pageA.click("#endCallBtn");
  await expect(pageA.locator("#callOverlay")).not.toHaveClass(/show/);
  await expect(pageB.locator("#callOverlay")).not.toHaveClass(/show/);

  // Second call between the exact same two people: this is what leftover
  // `peers` signaling data from the first call could poison — it should
  // connect cleanly, not silently fail to exchange video.
  await pageA.click("#callBtn");
  await pageB.click("#acceptCallBtn");
  await expect(pageA.locator("#callStatusText")).toHaveText("Connected", { timeout: 15000 });
  await expect(pageB.locator("#callStatusText")).toHaveText("Connected", { timeout: 15000 });
  await expect(pageA.locator(".remote-video-tile")).toHaveCount(1, { timeout: 15000 });
  await expect(pageB.locator(".remote-video-tile")).toHaveCount(1, { timeout: 15000 });

  await ctxA.close();
  await ctxB.close();
});

test("the call keeps receiving updates even if you switch to a different chat", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  const nameA = uniqueName("Gwen");
  const nameB = uniqueName("Hugo");

  await signup(pageA, nameA);
  await signup(pageB, nameB);

  await createGroup(pageA, "Call Chat");
  await inviteToGroup(pageA, nameB);
  await acceptFirstInvite(pageB);
  // A second group for A alone, to switch to mid-call.
  await createGroup(pageA, "Other Chat");
  await pageA.locator(".chat-item-name", { hasText: "Call Chat" }).click();

  await pageB.locator(".chat-item-name", { hasText: "Call Chat" }).click();
  await pageB.waitForSelector("#chatView", { state: "visible" });

  await pageA.click("#callBtn");
  await pageB.click("#acceptCallBtn");
  await expect(pageA.locator("#callStatusText")).toHaveText("Connected", { timeout: 15000 });

  // Force-click "Other Chat" in the sidebar via a raw DOM click, which
  // (unlike Playwright's pointer-based click) bypasses the fact that it's
  // visually covered by the full-screen call overlay — simulating whatever
  // real navigation path might land a user on a different chat mid-call,
  // to prove the call's own listener doesn't die when that happens.
  await pageA.evaluate(() => {
    const items = Array.from(document.querySelectorAll(".chat-item-name"));
    const other = items.find(el => el.textContent.includes("Other Chat"));
    other.closest(".chat-item").click();
  });

  // B leaves; if A's call listener died from the chat switch, A would be
  // stuck showing "Connected" forever despite being alone in the call.
  await pageB.click("#endCallBtn");
  await expect(pageA.locator("#callStatusText")).toHaveText("Waiting for others to join...", { timeout: 10000 });

  await ctxA.close();
  await ctxB.close();
});
