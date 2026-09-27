const { test, expect } = require("@playwright/test");
const {
  uniqueName, signup, createGroup, inviteToGroup, acceptFirstInvite,
} = require("./helpers");

// Reads the whiteboard canvas back: how many painted pixels a vertical
// line through board-x crosses, and the color of the pixel at (x, y).
// Positions are fractions of the board, same as the app sends them.
function inspectBoard(page, x, y) {
  return page.evaluate(([x, y]) => {
    const c = document.getElementById("wbCanvas");
    const ctx = c.getContext("2d");
    const px = Math.round(x * (c.width - 1));
    const column = ctx.getImageData(px, 0, 1, c.height).data;
    let painted = 0;
    for (let i = 3; i < column.length; i += 4) if (column[i] > 0) painted++;
    const at = ctx.getImageData(px, Math.round(y * (c.height - 1)), 1, 1).data;
    return { painted, rgba: Array.from(at), height: c.height };
  }, [x, y]);
}

// Drags the mouse across the board from (x1,y1) to (x2,y2), in fractions.
async function drawLine(page, x1, y1, x2, y2) {
  const box = await page.locator("#wbCanvas").boundingBox();
  await page.mouse.move(box.x + x1 * box.width, box.y + y1 * box.height);
  await page.mouse.down();
  await page.mouse.move(box.x + x2 * box.width, box.y + y2 * box.height, { steps: 12 });
  await page.mouse.up();
}

test("whiteboard: drawings show up live for everyone, with late-join sync, undo, and clear", async ({ browser }) => {
  test.setTimeout(60000);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  const nameA = uniqueName("Ava");
  const nameB = uniqueName("Ben");
  await signup(pageA, nameA);
  await signup(pageB, nameB);
  await createGroup(pageA, "Board Chat");
  await inviteToGroup(pageA, nameB);
  await acceptFirstInvite(pageB);
  await pageB.locator(".chat-item-name", { hasText: "Board Chat" }).click();
  await pageB.waitForSelector("#chatView", { state: "visible" });

  // A starts a call alone and draws a thin red line before B is there.
  await pageA.click("#callBtn");
  await expect(pageA.locator("#callOverlay")).toHaveClass(/show/);
  await expect(pageA.locator("#whiteboard")).toBeHidden();
  await pageA.click("#whiteboardBtn");
  await expect(pageA.locator("#whiteboard")).toBeVisible();
  await pageA.click('#wbColors [data-color="#E4572E"]');
  await drawLine(pageA, 0.2, 0.3, 0.8, 0.3);
  await expect(pageA.locator("#wbUndoBtn")).toBeEnabled();

  // B joins afterwards and still gets A's earlier line.
  await pageB.click("#acceptCallBtn");
  await expect(pageA.locator("#callStatusText")).toHaveText("Connected", { timeout: 15000 });
  await expect(pageB.locator("#callStatusText")).toHaveText("Connected", { timeout: 15000 });
  await expect(pageB.locator("#whiteboardBtn")).toHaveClass(/has-news/, { timeout: 10000 });
  await pageB.click("#whiteboardBtn");
  await expect(pageB.locator("#whiteboardBtn")).not.toHaveClass(/has-news/);
  await expect.poll(async () => (await inspectBoard(pageB, 0.5, 0.3)).rgba, { timeout: 10000 })
    .toEqual([0xE4, 0x57, 0x2E, 255]);
  const thin = await inspectBoard(pageB, 0.5, 0.3);

  // B draws a thick blue line live; it shows up on A's board, thicker.
  await pageB.click('#wbColors [data-color="#2F80ED"]');
  await pageB.click('#whiteboard [data-size="thick"]');
  await drawLine(pageB, 0.2, 0.7, 0.8, 0.7);
  await expect.poll(async () => (await inspectBoard(pageA, 0.5, 0.7)).rgba, { timeout: 10000 })
    .toEqual([0x2F, 0x80, 0xED, 255]);
  const both = await inspectBoard(pageA, 0.5, 0.7);
  const thickPainted = both.painted - thin.painted * (both.height / thin.height);
  expect(thickPainted).toBeGreaterThan(thin.painted * (both.height / thin.height) * 2);

  // A undoes: only A's own red line goes away, on both screens.
  await pageA.click("#wbUndoBtn");
  await expect(pageA.locator("#wbUndoBtn")).toBeDisabled();
  expect((await inspectBoard(pageA, 0.5, 0.3)).rgba[3]).toBe(0);
  await expect.poll(async () => (await inspectBoard(pageB, 0.5, 0.3)).rgba[3], { timeout: 10000 }).toBe(0);
  expect((await inspectBoard(pageB, 0.5, 0.7)).rgba[3]).toBe(255);

  // B clears (after confirming): the board is empty for everyone.
  pageB.once("dialog", (d) => d.accept());
  await pageB.click("#wbClearBtn");
  expect((await inspectBoard(pageB, 0.5, 0.7)).painted).toBe(0);
  await expect.poll(async () => (await inspectBoard(pageA, 0.5, 0.7)).painted, { timeout: 10000 }).toBe(0);
  await expect(pageB.locator("#wbUndoBtn")).toBeDisabled();

  // Closing the board hides it; leaving the call throws the drawing away.
  await drawLine(pageA, 0.4, 0.5, 0.6, 0.5);
  await pageA.click("#whiteboardBtn");
  await expect(pageA.locator("#whiteboard")).toBeHidden();
  await pageA.click("#endCallBtn");
  await pageA.click("#acceptCallBtn", { timeout: 15000 });
  await expect(pageA.locator("#callStatusText")).toHaveText("Connected", { timeout: 15000 });
  await expect(pageA.locator("#whiteboardBtn")).not.toHaveClass(/active/);
  await pageA.click("#whiteboardBtn");
  // A rejoins with an empty board of their own, then B (still in the call)
  // catches them back up on B's copy.
  await expect.poll(async () => (await inspectBoard(pageA, 0.5, 0.5)).rgba[3], { timeout: 15000 }).toBe(255);

  await ctxA.close();
  await ctxB.close();
});
