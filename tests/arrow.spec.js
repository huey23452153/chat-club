const { test, expect } = require("@playwright/test");

// Two phones ~100 m apart (B is due north of A). Fake GPS per browser context.
const A = { latitude: -37.8136, longitude: 144.9631, accuracy: 5 };
const B = { latitude: -37.8127, longitude: 144.9631, accuracy: 5 };

async function phone(browser, geo) {
  const ctx = await browser.newContext({ geolocation: geo, permissions: ["geolocation"] });
  const page = await ctx.newPage();
  await page.goto("/arrow.html");
  return page;
}

async function compass(page, deg) {
  // the page smooths the compass, so feed it a steady reading for a moment
  await page.evaluate(d => {
    for (let i = 0; i < 40; i++) {
      const e = new Event("deviceorientation");
      e.webkitCompassHeading = d;
      window.dispatchEvent(e);
    }
  }, deg);
}

test("two phones see the distance and an arrow pointing at each other", async ({ browser }) => {
  const a = await phone(browser, A);
  const b = await phone(browser, B);
  const code = "TEST" + Math.floor(Math.random() * 90 + 10);

  for (const p of [a, b]) {
    await p.fill("#codeInput", code);
    await p.click("#startBtn");
    await expect(p.locator("#findView")).toBeVisible();
  }

  // ~100 m apart, shown on both phones
  for (const p of [a, b]) {
    await expect(p.locator("#dist")).toHaveAttribute("data-meters", /^(9\d|10\d)$/, { timeout: 15000 });
  }

  // A faces north: B is straight ahead (arrow ~0 deg)
  await compass(a, 0);
  await expect(a.locator("#arrow")).toHaveAttribute("data-rotation", /^(0|1|359|358)$/);
  // A turns to face east: B is now on the left (arrow ~270 deg)
  await compass(a, 90);
  await expect(a.locator("#arrow")).toHaveAttribute("data-rotation", /^(26[89]|27[0-2])$/);
  // B is south of... A is due south of B: B's arrow points back (180) when B faces north
  await compass(b, 0);
  await expect(b.locator("#arrow")).toHaveAttribute("data-rotation", /^(179|180|181)$/);
});

test("it says waiting until the other phone joins", async ({ browser }) => {
  const a = await phone(browser, A);
  await a.fill("#codeInput", "ALONE" + Math.floor(Math.random() * 90 + 10));
  await a.click("#startBtn");
  await expect(a.locator("#status")).toContainText("Waiting for the other phone");
});

test("when the phones are within a few metres the arrow fades and it says you're here", async ({ browser }) => {
  const near = { latitude: -37.81359, longitude: 144.96311, accuracy: 3 }; // ~1.5 m from A
  const a = await phone(browser, A);
  const b = await phone(browser, near);
  const code = "NEAR" + Math.floor(Math.random() * 90 + 10);
  for (const p of [a, b]) {
    await p.fill("#codeInput", code);
    await p.click("#startBtn");
  }
  await expect(a.locator("#arrow")).toHaveAttribute("data-close", "1", { timeout: 15000 });
  await expect(a.locator("#status")).toContainText("You're here");
});

test("it still works when the other phone's clock is 5 minutes wrong", async ({ browser }) => {
  const a = await phone(browser, A);
  const ctxB = await browser.newContext({ geolocation: B, permissions: ["geolocation"] });
  await ctxB.addInitScript(() => { const n = Date.now.bind(Date); Date.now = () => n() - 5 * 60 * 1000; });
  const b = await ctxB.newPage();
  await b.goto("/arrow.html");
  const code = "SKEW" + Math.floor(Math.random() * 90 + 10);
  for (const p of [a, b]) {
    await p.fill("#codeInput", code);
    await p.click("#startBtn");
  }
  await expect(a.locator("#dist")).toHaveAttribute("data-meters", /^(9\d|10\d)$/, { timeout: 15000 });
});

test("it says how many phones are in the room while waiting", async ({ browser }) => {
  const a = await phone(browser, A);
  await a.fill("#codeInput", "ROOM" + Math.floor(Math.random() * 90 + 10));
  await a.click("#startBtn");
  await expect(a.locator("#status")).toContainText("only you are in room");
});
