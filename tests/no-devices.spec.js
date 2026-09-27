const { test, expect } = require("@playwright/test");
const {
  uniqueName, signup, createGroup, inviteToGroup, acceptFirstInvite,
} = require("./helpers");

// Pretends this computer is missing a camera and/or mic: asking for a
// missing kind fails the way a real browser does (NotFoundError), and
// device listings leave it out. Also fakes the screen picker, which a
// headless browser doesn't have.
function fakeDevices({ audio, video }) {
  const md = navigator.mediaDevices;
  const realGUM = md.getUserMedia.bind(md);
  const realEnum = md.enumerateDevices.bind(md);
  md.getUserMedia = async (c = {}) => {
    if ((c.audio && !audio) || (c.video && !video)) {
      throw new DOMException("Requested device not found", "NotFoundError");
    }
    return realGUM(c);
  };
  md.enumerateDevices = async () => (await realEnum()).filter(d =>
    (d.kind !== "audioinput" || audio) && (d.kind !== "videoinput" || video));
  md.getDisplayMedia = async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 640; canvas.height = 480;
    const ctx = canvas.getContext("2d");
    setInterval(() => { ctx.fillStyle = `hsl(${Date.now() / 10 % 360},60%,50%)`; ctx.fillRect(0, 0, 640, 480); }, 50);
    return canvas.captureStream(15);
  };
}

// The tile showing `name`, as seen on `page`.
function tileOf(page, name) {
  return page.locator(".remote-video-tile").filter({
    has: page.locator(".video-tile-name", { hasText: new RegExp(name, "i") }),
  });
}
function hasFrames(tile) {
  return tile.locator("video").evaluate(v => v.videoWidth > 0);
}
// Whether sound is actually arriving from them (a track with no sender
// behind it stays muted).
function audioLive(tile) {
  return tile.locator("video").evaluate(v => {
    const t = v.srcObject?.getAudioTracks()[0];
    return !!t && !t.muted;
  });
}

test("people with no camera and/or mic can join, watch, listen, and share their screen", async ({ browser }) => {
  test.setTimeout(90000);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ctxC = await browser.newContext();
  const pageA = await ctxA.newPage(); // camera + mic (a normal caller)
  const pageB = await ctxB.newPage(); // neither
  const pageC = await ctxC.newPage(); // camera, no mic
  await pageA.addInitScript(fakeDevices, { audio: true, video: true });
  await pageB.addInitScript(fakeDevices, { audio: false, video: false });
  await pageC.addInitScript(fakeDevices, { audio: false, video: true });

  const nameA = uniqueName("Ann");
  const nameB = uniqueName("Bo");
  const nameC = uniqueName("Cy");
  await signup(pageA, nameA);
  await signup(pageB, nameB);
  await signup(pageC, nameC);
  await createGroup(pageA, "Device Chat");
  await inviteToGroup(pageA, nameB);
  await inviteToGroup(pageA, nameC);
  for (const page of [pageB, pageC]) {
    await acceptFirstInvite(page);
    await page.locator(".chat-item-name", { hasText: "Device Chat" }).click();
    await page.waitForSelector("#chatView", { state: "visible" });
  }

  // B (no devices at all) starts the call; the others join.
  await pageB.click("#callBtn");
  await expect(pageB.locator("#callOverlay")).toHaveClass(/show/);
  await pageA.click("#acceptCallBtn", { timeout: 15000 });
  await pageC.click("#acceptCallBtn", { timeout: 15000 });

  // Everyone sees both of the others.
  for (const page of [pageA, pageB, pageC]) {
    await expect(page.locator(".remote-video-tile")).toHaveCount(2, { timeout: 20000 });
  }

  // Buttons for missing devices are greyed out and can't be clicked.
  await expect(pageA.locator("#toggleMicBtn")).toBeEnabled();
  await expect(pageA.locator("#toggleCamBtn")).toBeEnabled();
  await expect(pageA.locator("#toggleCamBtn")).not.toHaveClass(/unavailable/);
  await expect(pageB.locator("#toggleMicBtn")).toBeDisabled();
  await expect(pageB.locator("#toggleMicBtn")).toHaveClass(/unavailable/);
  await expect(pageB.locator("#toggleCamBtn")).toBeDisabled();
  await expect(pageB.locator("#toggleCamBtn")).toHaveClass(/unavailable/);
  await expect(pageB.locator("#switchCameraBtn")).toBeHidden();
  await expect(pageC.locator("#toggleMicBtn")).toBeDisabled();
  await expect(pageC.locator("#toggleCamBtn")).toBeEnabled();
  await expect(pageB.locator("#tile-local")).toHaveClass(/no-video/);
  await expect(pageC.locator("#tile-local")).not.toHaveClass(/no-video/);

  // B can watch and listen: A's and C's video reach B, and A's sound does.
  await expect.poll(() => hasFrames(tileOf(pageB, nameA)), { timeout: 20000 }).toBe(true);
  await expect.poll(() => hasFrames(tileOf(pageB, nameC)), { timeout: 20000 }).toBe(true);
  await expect.poll(() => audioLive(tileOf(pageB, nameA)), { timeout: 20000 }).toBe(true);
  // A normal pair is unaffected: A and C see each other, C hears A.
  await expect.poll(() => hasFrames(tileOf(pageA, nameC)), { timeout: 20000 }).toBe(true);
  await expect.poll(() => hasFrames(tileOf(pageC, nameA)), { timeout: 20000 }).toBe(true);
  await expect.poll(() => audioLive(tileOf(pageC, nameA)), { timeout: 20000 }).toBe(true);

  // Others see a "No camera" placeholder for B instead of a black box.
  await expect(tileOf(pageA, nameB)).toHaveClass(/no-video/, { timeout: 10000 });
  await expect(tileOf(pageC, nameB)).toHaveClass(/no-video/, { timeout: 10000 });
  await expect(tileOf(pageA, nameB).locator(".video-tile-placeholder")).toBeVisible();
  await expect(tileOf(pageA, nameC)).not.toHaveClass(/no-video/);

  // B shares their screen: it shows up for both A and C.
  await pageB.click("#toggleScreenBtn");
  await expect(pageB.locator("#tile-local")).not.toHaveClass(/no-video/);
  for (const page of [pageA, pageC]) {
    await expect(tileOf(page, nameB)).not.toHaveClass(/no-video/, { timeout: 10000 });
    await expect.poll(() => hasFrames(tileOf(page, nameB)), { timeout: 20000 }).toBe(true);
  }

  // Stopping the share puts the placeholder back.
  await pageB.click("#toggleScreenBtn");
  await expect(pageB.locator("#tile-local")).toHaveClass(/no-video/);
  await expect(tileOf(pageA, nameB)).toHaveClass(/no-video/, { timeout: 10000 });
  await expect(tileOf(pageC, nameB)).toHaveClass(/no-video/, { timeout: 10000 });

  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
});
