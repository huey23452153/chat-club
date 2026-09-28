const { test, expect } = require("@playwright/test");
const {
  uniqueName, signup, createGroup, inviteToGroup, acceptFirstInvite,
} = require("./helpers");

// Stand-ins for the two things a headless browser can't do for real:
// - getDisplayMedia (no screen picker): returns a 640x480 canvas stream.
// - the local control helper program: a fake WebSocket that records every
//   message the page sends it, and can be switched "off" to test the
//   helper-not-running path.
function installFakes() {
  window.CONTROL_HELPER_URL = "ws://fake-control-helper";
  window.__helperRunning = true;
  window.__helperMessages = [];
  window.__helperClosed = false;

  navigator.mediaDevices.getDisplayMedia = async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 640; canvas.height = 480;
    const ctx = canvas.getContext("2d");
    setInterval(() => { ctx.fillStyle = `hsl(${Date.now() / 10 % 360},60%,50%)`; ctx.fillRect(0, 0, 640, 480); }, 50);
    return canvas.captureStream(15);
  };

  const RealWebSocket = window.WebSocket;
  window.WebSocket = function (url, protocols) {
    if (url !== window.CONTROL_HELPER_URL) return new RealWebSocket(url, protocols);
    const fake = {
      readyState: 0,
      send(data) { window.__helperMessages.push(JSON.parse(data)); },
      close() { if (fake.readyState === 3) return; fake.readyState = 3; window.__helperClosed = true; setTimeout(() => fake.onclose?.({})); },
    };
    setTimeout(() => {
      if (!window.__helperRunning) { fake.readyState = 3; fake.onerror?.({}); fake.onclose?.({}); return; }
      fake.readyState = 1;
      fake.onmessage?.({ data: JSON.stringify({ type: "helper-ready" }) });
    }, 20);
    return fake;
  };
  window.WebSocket.OPEN = 1;
}

test("a call partner can request, get, use, and lose control of a shared screen", async ({ browser }) => {
  test.setTimeout(60000);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage(); // shares their screen
  const pageB = await ctxB.newPage(); // controls it
  await pageA.addInitScript(installFakes);

  const nameA = uniqueName("Rosa");
  const nameB = uniqueName("Sam");
  await signup(pageA, nameA);
  await signup(pageB, nameB);
  await createGroup(pageA, "Control Chat");
  await inviteToGroup(pageA, nameB);
  await acceptFirstInvite(pageB);
  await pageB.locator(".chat-item-name", { hasText: "Control Chat" }).click();
  await pageB.waitForSelector("#chatView", { state: "visible" });

  await pageA.click("#callBtn");
  await pageB.click("#acceptCallBtn");
  await expect(pageA.locator("#callStatusText")).toHaveText("Connected", { timeout: 15000 });
  await expect(pageB.locator("#callStatusText")).toHaveText("Connected", { timeout: 15000 });

  // No request button until A actually shares their screen.
  const requestBtn = pageB.locator(".remote-video-tile .control-request-btn");
  await expect(requestBtn).toBeHidden();
  await pageA.click("#toggleScreenBtn");
  await expect(requestBtn).toBeVisible({ timeout: 10000 });
  await expect(requestBtn).toHaveText("🖱️ Request control");

  // 1) A says no.
  await requestBtn.click();
  await expect(requestBtn).toHaveText("Waiting for them to allow…");
  await expect(pageA.locator("#controlBanner")).toHaveClass(/show/, { timeout: 10000 });
  await expect(pageA.locator("#controlBannerText")).toContainText(`${nameB} wants to control`);
  await pageA.click("#controlDenyBtn");
  await expect(pageB.locator(".video-tile-control-note")).toHaveText("They said no", { timeout: 10000 });
  await expect(requestBtn).toHaveText("🖱️ Request control");

  // 2) A allows, but the helper app isn't running on A's computer.
  await pageA.evaluate(() => { window.__helperRunning = false; });
  await requestBtn.click();
  await pageA.click("#controlAllowBtn");
  await expect(pageA.locator("#controlBannerText")).toHaveText("Remote control needs a one-time setup on this computer");
  await expect(pageB.locator(".video-tile-control-note")).toHaveText("They need to run the control helper app first", { timeout: 10000 });
  await pageA.click("#controlCloseBtn");
  await expect(pageA.locator("#controlBanner")).not.toHaveClass(/show/);

  // 3) Helper running: A allows, and B's clicks/keys reach A's helper.
  await pageA.evaluate(() => { window.__helperRunning = true; });
  await requestBtn.click();
  await pageA.click("#controlAllowBtn");
  await expect(pageA.locator("#controlBanner")).toHaveClass(/active/, { timeout: 10000 });
  await expect(pageA.locator("#controlBannerText")).toContainText(`${nameB} is controlling your computer`);
  const tileB = pageB.locator(".remote-video-tile");
  await expect(tileB).toHaveClass(/controlling/, { timeout: 10000 });
  await expect(requestBtn).toHaveText("■ Stop controlling");

  // Wait for real video frames so there's a picture to click on.
  await pageB.waitForFunction(() => document.querySelector(".remote-video-tile video")?.videoWidth > 0);
  const box = await tileB.locator("video").boundingBox();
  await pageB.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await pageB.keyboard.press("a");

  await expect.poll(() => pageA.evaluate(() => window.__helperMessages.map(m => m.kind)), { timeout: 10000 })
    .toEqual(expect.arrayContaining(["down", "up", "keydown", "keyup"]));
  const msgs = await pageA.evaluate(() => window.__helperMessages);
  const down = msgs.find(m => m.kind === "down");
  expect(down.button).toBe(0);
  expect(down.x).toBeCloseTo(0.5, 1); // the middle of the shared screen
  expect(down.y).toBeCloseTo(0.5, 1);
  expect(msgs.find(m => m.kind === "keydown").code).toBe("KeyA");

  // While controlling, clicking the screen must not toggle fullscreen.
  expect(await pageB.evaluate(() => !!document.fullscreenElement)).toBe(false);

  // 4) A hits Stop: control ends on both sides and the helper is let go.
  await pageA.click("#controlStopBtn");
  await expect(pageA.locator("#controlBanner")).not.toHaveClass(/show/);
  expect(await pageA.evaluate(() => window.__helperClosed)).toBe(true);
  await expect(tileB).not.toHaveClass(/controlling/, { timeout: 10000 });
  await expect(pageB.locator(".video-tile-control-note")).toHaveText("They stopped your control");

  // 5) Stopping the share hides the request button again.
  await pageA.click("#toggleScreenBtn");
  await expect(requestBtn).toBeHidden({ timeout: 10000 });

  await ctxA.close();
  await ctxB.close();
});
