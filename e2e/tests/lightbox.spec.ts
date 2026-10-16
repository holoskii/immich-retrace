// The touch lightbox on phones (Pixel 7: Chromium, real CDP touches; iPhone 15: WebKit, synthetic pointer events).
import {expect, test, type Page} from '@playwright/test';
import {doubleTap, pinch, swipe, tap} from './touch.ts';

test.beforeEach(async ({page}) => {
  // The demo's coach mark would sit over the page.
  await page.addInitScript(() => { try { localStorage.setItem('immich-retrace.demo.tour-seen', '1'); } catch { /* */ } });
});

const dialog = (page: Page) => page.getByRole('dialog', {name: 'Photo viewer'});
const counter = (page: Page) => dialog(page).getByLabel('Position in range');
const lb = (page: Page) => new URL(page.url()).searchParams.get('lb');
const histLen = (page: Page) => page.evaluate(() => history.length);
/** The open photo's zoom (the current page's box transform). */
const zoom = (page: Page) => page.locator('.page.current .box').evaluate(el => new DOMMatrix(getComputedStyle(el).transform).a);
async function size(page: Page) {
  const v = page.viewportSize()!;
  return {w: v.width, h: v.height, c: {x: v.width / 2, y: v.height / 2}};
}
/** Position "112 / 194" → 112. */
const pos = async (page: Page) => Number((await counter(page).textContent())!.split('/')[0].replace(/\D/g, ''));

/** Lands on the demo trip and opens the lightbox from the map's photo card, like a visitor. */
async function open(page: Page) {
  await page.goto('/');
  const card = page.locator('.card[role=button]');
  await expect(card).toBeAttached({timeout: 20_000});
  await expect.poll(() => new URL(page.url()).searchParams.get('at')).not.toBeNull();
  const before = await histLen(page);
  await card.dispatchEvent('click');
  await expect(dialog(page)).toBeVisible();
  await expect(counter(page)).toHaveText(/^\d[\d\u202f]* \/ \d[\d\u202f]*$/);
  // The photo on show has loaded (through the media queue, as an object URL).
  await expect(page.locator('.page.current img.shown')).toBeVisible({timeout: 15_000});
  return before;
}

test('opens from the photo card with one history entry, full screen, with time, place and credits', async ({page}) => {
  const before = await open(page);
  expect(lb(page)).toBeTruthy();
  expect(await histLen(page)).toBe(before + 1);
  const box = await dialog(page).boundingBox(), {w, h} = await size(page);
  expect(box).toEqual({x: 0, y: 0, width: w, height: h});
  await expect(dialog(page).locator('.when')).toHaveText(/^\d\d:\d\d · \d+ \w+ \d{4}/);
  // Demo mode: the per-photo credit (licence requirement).
  await expect(dialog(page).getByRole('region', {name: 'Credits'})).toContainText('Wikimedia Commons');
  // Preview over the thumbhash, never the original.
  expect(await page.locator('.page.current img').getAttribute('src')).toMatch(/^blob:/);
  // At most three pages (and previews) alive.
  expect(await page.locator('.page').count()).toBeLessThanOrEqual(3);
});

test('swipe left and right step through the selection without new history entries', async ({page}) => {
  await open(page);
  const n = await pos(page), id = lb(page), len = await histLen(page), {w, h} = await size(page);
  await swipe(page, {x: w * 0.8, y: h / 2}, {x: w * 0.2, y: h / 2});
  await expect.poll(() => pos(page)).toBe(n + 1);
  await expect.poll(() => lb(page)).not.toBe(id);
  await swipe(page, {x: w * 0.2, y: h / 2}, {x: w * 0.8, y: h / 2});
  await expect.poll(() => pos(page)).toBe(n);
  await expect.poll(() => lb(page)).toBe(id);
  expect(await histLen(page)).toBe(len);
  // A short drag snaps back.
  await swipe(page, {x: w * 0.5, y: h / 2}, {x: w * 0.4, y: h / 2}, {steps: 6, ms: 40});
  await page.waitForTimeout(400);
  expect(await pos(page)).toBe(n);
});

test('a swipe starting at the screen edge does not page (left to the OS back gesture)', async ({page}) => {
  await open(page);
  const n = await pos(page), {w, h} = await size(page);
  await swipe(page, {x: 4, y: h / 2}, {x: w * 0.7, y: h / 2});
  await page.waitForTimeout(400);
  expect(await pos(page)).toBe(n);
});

test('swipe down closes, keeps the cursor on the photo shown, and leaves no dead Back step', async ({page}) => {
  await open(page);
  const {w, h} = await size(page), first = lb(page), at = () => new URL(page.url()).searchParams.get('at');
  const at0 = at();
  await swipe(page, {x: w * 0.8, y: h / 2}, {x: w * 0.2, y: h / 2});
  // The step's URL write is debounced.
  await expect.poll(() => lb(page)).not.toBe(first);
  const shown = lb(page), atShown = at();
  expect(atShown).not.toBe(at0);
  await swipe(page, {x: w / 2, y: h * 0.3}, {x: w / 2, y: h * 0.75});
  await expect(dialog(page)).toBeHidden();
  expect(lb(page)).toBeNull();
  expect(new URL(page.url()).searchParams.get('album')).toBeTruthy();
  // The cursor stays on the photo last shown (not where it was when the lightbox opened).
  await expect.poll(at).toBe(atShown);
  // Forward reopens the photo last shown: the entry was popped, not replaced.
  await page.goForward();
  await expect(dialog(page)).toBeVisible();
  expect(lb(page)).toBe(shown);
});

test('the ✕ button closes like Back', async ({page}) => {
  const before = await open(page);
  await dialog(page).getByRole('button', {name: 'Close'}).click();
  await expect(dialog(page)).toBeHidden();
  expect(lb(page)).toBeNull();
  // history.length counts the popped entry too; the current one is the one the lightbox opened from.
  expect(await histLen(page)).toBe(before + 1);
  await page.goForward();
  await expect(dialog(page)).toBeVisible();
});

test('Back closes it and stays in the app', async ({page}) => {
  await open(page);
  await page.goBack();
  await expect(dialog(page)).toBeHidden();
  expect(lb(page)).toBeNull();
  expect(new URL(page.url()).searchParams.get('album')).toBeTruthy();
});

test('a cold link with lb: Back closes the photo instead of leaving the app', async ({page}) => {
  await open(page);
  const url = page.url();
  await page.goto('about:blank');
  await page.goto(url);
  await expect(dialog(page)).toBeVisible({timeout: 20_000});
  await page.goBack();
  await expect(dialog(page)).toBeHidden();
  expect(new URL(page.url()).origin).toBe(new URL(url).origin);
  expect(lb(page)).toBeNull();
});

test('double tap zooms, paging is off while zoomed, a second double tap restores it', async ({page}) => {
  await open(page);
  const n = await pos(page), {w, h, c} = await size(page);
  await doubleTap(page, c);
  await expect.poll(() => zoom(page)).toBeCloseTo(2.5, 1);
  // A sideways drag now pans the photo instead of paging.
  await swipe(page, {x: w * 0.7, y: h / 2}, {x: w * 0.3, y: h / 2});
  await page.waitForTimeout(400);
  expect(await pos(page)).toBe(n);
  expect(await zoom(page)).toBeCloseTo(2.5, 1);
  await doubleTap(page, c);
  await expect.poll(() => zoom(page)).toBeCloseTo(1, 2);
  await swipe(page, {x: w * 0.8, y: h / 2}, {x: w * 0.2, y: h / 2});
  await expect.poll(() => pos(page)).toBe(n + 1);
});

test('pinch zooms the preview, within 1–3×', async ({page}) => {
  await open(page);
  const {c} = await size(page);
  await pinch(page, c, 60, 200);
  await expect.poll(() => zoom(page)).toBeGreaterThan(2);
  await pinch(page, c, 100, 1000);
  expect(await zoom(page)).toBeLessThanOrEqual(3);
  await pinch(page, c, 300, 40);
  await expect.poll(() => zoom(page)).toBeCloseTo(1, 2);
});

test('a pinch never counts as a tap: the bars stay', async ({page}) => {
  await open(page);
  const {c} = await size(page);
  await pinch(page, c, 60, 200);
  await page.waitForTimeout(500);
  await expect(page.locator('.bar.top')).not.toHaveClass(/hidden/);
});

test('a drag held still before lifting snaps back instead of paging', async ({page}) => {
  await open(page);
  const n = await pos(page), {w, h} = await size(page);
  // 15% of the width, fast, then held: no flick.
  await swipe(page, {x: w * 0.6, y: h / 2}, {x: w * 0.45, y: h / 2}, {steps: 3, ms: 10, hold: 400});
  await page.waitForTimeout(400);
  expect(await pos(page)).toBe(n);
});

test('a single tap hides and shows the bars', async ({page}) => {
  await open(page);
  const {c} = await size(page);
  const bar = page.locator('.bar.top');
  await tap(page, c);
  await expect(bar).toHaveClass(/hidden/);
  await tap(page, c);
  await expect(bar).not.toHaveClass(/hidden/);
});

test('a video plays in place, and the pager swipes on past it', async ({page, browserName}) => {
  // A clip in the demo trip (Yesa, 9 Sept 2024), opened by a cold link.
  await page.goto('/?album=4251a624-627f-58bc-b557-d0fe8058f34f&lb=56d5468d-a8f5-5403-b002-8292d5483051');
  await expect(dialog(page)).toBeVisible({timeout: 20_000});
  await expect(dialog(page).locator('.when')).toContainText('video');
  if (browserName === 'chromium') {
    const video = page.locator('.page.current video');
    await expect(video).toHaveAttribute('controls', '');
    await expect.poll(() => video.evaluate(v => (v as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(1);
  } else {
    // Playwright's Linux WebKit has no H.264 decoder: the poster stays up with the format message.
    // (Waited for: the synthetic events would go to the <video> it replaces.)
    await expect(dialog(page).locator('.msg')).toContainText('can’t be played');
  }
  const n = await pos(page), {w, h} = await size(page);
  await swipe(page, {x: w * 0.8, y: h * 0.4}, {x: w * 0.2, y: h * 0.4});
  await expect.poll(() => pos(page)).toBe(n + 1);
});

test('a preview that arrives but will not decode shows the failure, not an endless placeholder', async ({page}) => {
  await open(page);
  const url = new URL(page.url()), bad = lb(page)!;
  // The photo on show answers 200 with bytes that aren't an image (also for the relay's probe).
  await page.route(`**/api/assets/${bad}/thumbnail?*size=preview*`, r => r.fulfill({status: 200, contentType: 'image/jpeg', body: 'not a jpeg'}));
  await page.goto('about:blank');
  await page.goto(url.href);
  await expect(dialog(page).locator('.msg')).toContainText('couldn’t be decoded', {timeout: 20_000});
});
