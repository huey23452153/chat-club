const { test, expect } = require("@playwright/test");
const {
  uniqueName, signup, createGroup, inviteToGroup, acceptFirstInvite,
} = require("./helpers");

// A screen share that comes with sound: a canvas for the picture and a steady
// 3 kHz tone for "the computer's sound" (window.__shareWithSound = false gives
// a share with no sound, as when the box isn't ticked).
function fakeScreenShare() {
  window.__shareWithSound = true;
  navigator.mediaDevices.getDisplayMedia = async (options) => {
    window.__shareOptions = options;
    const canvas = document.createElement("canvas");
    canvas.width = 640; canvas.height = 480;
    const ctx = canvas.getContext("2d");
    setInterval(() => { ctx.fillStyle = `hsl(${Date.now() / 10 % 360},60%,50%)`; ctx.fillRect(0, 0, 640, 480); }, 50);
    const stream = canvas.captureStream(15);
    if (window.__shareWithSound) {
      const audio = new AudioContext();
      const tone = audio.createOscillator();
      tone.frequency.value = 3000;
      const out = audio.createMediaStreamDestination();
      tone.connect(out);
      tone.start();
      stream.addTrack(out.stream.getAudioTracks()[0]);
    }
    return stream;
  };
}

// how loud 3 kHz is in what this page is receiving from the other person (0..255)
async function toneLevel(page) {
  return page.evaluate(async () => {
    const video = document.querySelector(".remote-video-tile video");
    const track = video && video.srcObject && video.srcObject.getAudioTracks()[0];
    if (!track) return -1;
    if (!window.__probe) {
      const audio = new AudioContext();
      const analyser = audio.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.5;
      audio.createMediaStreamSource(new MediaStream([track])).connect(analyser);
      window.__probe = { audio, analyser };
    }
    const { audio, analyser } = window.__probe;
    await audio.resume();
    await new Promise((r) => setTimeout(r, 400));
    const bins = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(bins);
    const bin = Math.round(3000 / (audio.sampleRate / analyser.fftSize));
    return Math.max(...bins.slice(bin - 2, bin + 3));
  });
}

test("sharing a screen with sound lets the other person hear it, and stopping takes it away", async ({ browser }) => {
  test.setTimeout(60000);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  await pageA.addInitScript(fakeScreenShare);

  const nameA = uniqueName("Ana");
  const nameB = uniqueName("Bo");
  await signup(pageA, nameA);
  await signup(pageB, nameB);
  await createGroup(pageA, "Sound Chat");
  await inviteToGroup(pageA, nameB);
  await acceptFirstInvite(pageB);
  await pageB.locator(".chat-item-name", { hasText: "Sound Chat" }).click();
  await pageB.waitForSelector("#chatView", { state: "visible" });

  await pageA.click("#callBtn");
  await pageB.click("#acceptCallBtn");
  await expect(pageA.locator("#callStatusText")).toHaveText("Connected", { timeout: 15000 });
  await expect(pageB.locator("#callStatusText")).toHaveText("Connected", { timeout: 15000 });

  // before sharing: no 3 kHz tone in what B hears
  await expect.poll(() => toneLevel(pageB), { timeout: 10000 }).toBeGreaterThanOrEqual(0);
  expect(await toneLevel(pageB)).toBeLessThan(60);

  await pageA.click("#toggleScreenBtn");
  await expect(pageA.locator("#tile-local")).toHaveClass(/sharing-sound/);
  await expect(pageA.locator(".toast").filter({ hasText: "hear your computer's sound" })).toBeVisible();
  // the browser was asked for the sound, unprocessed
  const asked = await pageA.evaluate(() => window.__shareOptions);
  expect(asked.audio.echoCancellation).toBe(false);
  expect(asked.systemAudio).toBe("include");
  // and B hears the tone
  await expect.poll(() => toneLevel(pageB), { timeout: 15000 }).toBeGreaterThan(120);

  await pageA.click("#toggleScreenBtn");
  await expect(pageA.locator("#tile-local")).not.toHaveClass(/sharing-sound/);
  await expect.poll(() => toneLevel(pageB), { timeout: 15000 }).toBeLessThan(60);

  // a share with no sound says so, and nothing changes for the microphone
  await pageA.evaluate(() => { window.__shareWithSound = false; });
  await pageA.click("#toggleScreenBtn");
  await expect(pageA.locator("#tile-local")).toHaveClass(/sharing-screen/);
  await expect(pageA.locator("#tile-local")).not.toHaveClass(/sharing-sound/);
  await expect(pageA.locator(".toast").filter({ hasText: "No sound is being shared" })).toBeVisible();

  await ctxA.close();
  await ctxB.close();
});
