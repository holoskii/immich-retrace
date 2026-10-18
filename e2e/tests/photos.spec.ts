// The Photos tab (Pixel 7 and iPhone 15): the virtual grid under day headers, the cursor ring and the scroll to it on
// entry, taps into the lightbox and back, and that scrolling never moves the cursor or grows the DOM.
import {expect, test, type Page} from '@playwright/test';
import {swipe} from './touch.ts';

test.beforeEach(async ({page}) => {
  await page.addInitScript(() => { try { localStorage.setItem('immich-retrace.demo.tour-seen', '1'); } catch { /* */ } });
});

const q = (page: Page, k: string) => new URL(page.url()).searchParams.get(k);
const histLen = (page: Page) => page.evaluate(() => history.length);
const tab = (page: Page, name: string) => page.getByRole('tab', {name});
const scroller = (page: Page) => page.locator('#tab-photos .scroller');
const cells = (page: Page) => page.locator('#tab-photos .cell');
const ringed = (page: Page) => page.locator('#tab-photos .cell[aria-current="true"]');
const dialog = (page: Page) => page.getByRole('dialog', {name: 'Photo viewer'});
const scrollTop = (page: Page) => scroller(page).evaluate(el => el.scrollTop);
const setScroll = (page: Page, y: number) => scroller(page).evaluate((el, y) => { el.scrollTop = y; }, y);

/** Lands on the demo trip (the largest, ~190 photos) and opens Photos. */
async function photos(page: Page) {
  await page.goto('/');
  await expect(page.locator('.pill h1')).toHaveText('San Sebastián to Huesca', {timeout: 20_000});
  await expect.poll(() => q(page, 'at')).not.toBeNull();
  await tab(page, 'Photos').tap();
  await expect(tab(page, 'Photos')).toHaveAttribute('aria-selected', 'true');
  await expect(cells(page).first()).toBeVisible({timeout: 15_000});
}

/** The cell's box lies inside the scroller's, below the sticky day header (36 px). */
async function inView(page: Page, cell: ReturnType<Page['locator']>) {
  const s = (await scroller(page).boundingBox())!, c = (await cell.boundingBox())!;
  return c.y >= s.y + 36 - 1 && c.y + c.height <= s.y + s.height + 1;
}

test('shows the trip as a grid under day headers, the cursor’s photo ringed and scrolled into view', async ({page}) => {
  await photos(page);
  const heads = page.locator('#tab-photos h2');
  await expect(heads.first()).toHaveText(/^\w{3},? \d{1,2} \w+/);
  await expect(page.locator('#tab-photos header')).toContainText(/San Sebastián to Huesca.*photos/);
  // The one ringed cell is the photo on the map's card, in view.
  await expect(ringed(page)).toHaveCount(1);
  const when = (await page.locator('.dock .card strong').textContent())!;
  expect(await ringed(page).getAttribute('aria-label')).toContain(when);
  expect(await inView(page, ringed(page))).toBe(true);
  // The cursor is mid-trip, so getting there scrolled the grid.
  expect(await scrollTop(page)).toBeGreaterThan(0);
  // Square cells, three to a row; thumbnails arrive as object URLs over the thumbhash.
  const box = (await cells(page).first().boundingBox())!;
  expect(Math.abs(box.width - box.height)).toBeLessThan(1);
  expect(box.width * 3).toBeLessThanOrEqual(page.viewportSize()!.width);
  await expect(ringed(page).locator('img')).toHaveAttribute('src', /^blob:/, {timeout: 15_000});
  // Video cells are marked.
  await expect(page.locator('#tab-photos .cell[aria-label$=", video"] .vid').first()).toBeAttached();
});

test('scrolling never moves the cursor; entering the tab again scrolls back to it', async ({page}) => {
  await photos(page);
  const at = q(page, 'at'), len = await histLen(page), ring = await ringed(page).getAttribute('data-id');
  if (test.info().project.name === 'Pixel 7') {
    // A real finger drag (Chromium): the grid scrolls inside its own box, the page doesn't.
    const s = (await scroller(page).boundingBox())!, t0 = await scrollTop(page);
    await swipe(page, {x: s.x + s.width / 2, y: s.y + s.height * 0.8}, {x: s.x + s.width / 2, y: s.y + s.height * 0.2}, {steps: 10, ms: 16});
    await expect.poll(() => scrollTop(page)).not.toBe(t0);
    expect(await page.evaluate(() => document.scrollingElement!.scrollTop)).toBe(0);
  }
  await setScroll(page, 0);
  await page.waitForTimeout(300);
  expect(q(page, 'at')).toBe(at);
  expect(await histLen(page)).toBe(len);
  await tab(page, 'Map').tap();
  await tab(page, 'Photos').tap();
  await expect(ringed(page)).toHaveAttribute('data-id', ring!);
  expect(await inView(page, ringed(page))).toBe(true);
  expect(q(page, 'at')).toBe(at);
});

test('a tap opens the lightbox on that photo; Back returns to the grid where it was, the cursor on the photo', async ({page}) => {
  await photos(page);
  // A cell that isn't the cursor's, well inside the view.
  const id = await scroller(page).evaluate(el => {
    const s = el.getBoundingClientRect();
    const inside = [...el.querySelectorAll<HTMLElement>('.cell:not([aria-current])')].filter(c => {
      const r = c.getBoundingClientRect();
      return r.top > s.top + 60 && r.bottom < s.bottom - 20;
    });
    return inside[Math.floor(inside.length / 2)].dataset.id!;
  });
  const cell = page.locator(`#tab-photos .cell[data-id="${id}"]`);
  await expect(cell.locator('img')).toHaveAttribute('src', /^blob:/, {timeout: 15_000});
  const top = await scrollTop(page), len = await histLen(page);
  await cell.tap();
  await expect(dialog(page)).toBeVisible();
  expect(q(page, 'lb')).toBe(id);
  expect(await histLen(page)).toBe(len + 1);
  await page.goBack();
  await expect(dialog(page)).toBeHidden();
  expect(q(page, 'lb')).toBeNull();
  await expect(tab(page, 'Photos')).toHaveAttribute('aria-selected', 'true');
  expect(await scrollTop(page)).toBe(top);
  await expect(ringed(page)).toHaveAttribute('data-id', id);
  await expect.poll(() => q(page, 'at')).not.toBeNull();
});

test('tapping a cell half under the day header opens it without moving the grid', async ({page}) => {
  await photos(page);
  // Scroll so a row sits 60% under the sticky header, then tap its visible lower part.
  const id = await scroller(page).evaluate(el => {
    const s = el.getBoundingClientRect();
    const c = [...el.querySelectorAll<HTMLElement>('.cell')].find(c => c.getBoundingClientRect().top > s.top + 150)!;
    const r = c.getBoundingClientRect();
    el.scrollTop += r.top - (s.top + 36) + r.height * 0.6;
    return c.dataset.id!;
  });
  await page.waitForTimeout(200);
  const cell = page.locator(`#tab-photos .cell[data-id="${id}"]`), box = (await cell.boundingBox())!, top = await scrollTop(page);
  await cell.tap({position: {x: box.width / 2, y: box.height * 0.85}});
  await expect(dialog(page)).toBeVisible();
  expect(q(page, 'lb')).toBe(id);
  await page.goBack();
  await expect(dialog(page)).toBeHidden();
  expect(await scrollTop(page)).toBe(top);
  await expect(ringed(page)).toHaveAttribute('data-id', id);
});

test('paging in the lightbox moves the ring along and keeps that photo in view', async ({page}) => {
  await photos(page);
  // From the cursor's photo (centred), a dozen photos on is out of view.
  const ring0 = (await ringed(page).getAttribute('data-id'))!;
  await ringed(page).tap();
  await expect(dialog(page)).toBeVisible();
  await expect(page.locator('.page.current img.shown')).toBeVisible({timeout: 15_000});
  const {width: w, height: h} = page.viewportSize()!;
  for (let i = 0; i < 12; i++) {
    const before = q(page, 'lb');
    await swipe(page, {x: w * 0.8, y: h / 2}, {x: w * 0.2, y: h / 2});
    await expect.poll(() => q(page, 'lb')).not.toBe(before);
  }
  const last = q(page, 'lb')!;
  expect(last).not.toBe(ring0);
  await page.goBack();
  await expect(dialog(page)).toBeHidden();
  await expect(ringed(page)).toHaveAttribute('data-id', last);
  expect(await inView(page, ringed(page))).toBe(true);
});

test('the DOM stays bounded while scrolling the largest trip end to end, and the whole library', async ({page}) => {
  test.setTimeout(60_000);
  await photos(page);
  const at = q(page, 'at');
  /** Scrolls top to bottom `step` screens at a time, counting the cells in the DOM after each. */
  async function sweep(step: number) {
    const {h, total} = await scroller(page).evaluate(el => ({h: el.clientHeight, total: el.scrollHeight}));
    let max = 0;
    for (let y = 0; y <= total; y += h * step) {
      await setScroll(page, y);
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      const n = await cells(page).count();
      expect(n).toBeGreaterThan(0);
      max = Math.max(max, n);
    }
    return {max, total};
  }
  const trip = await sweep(0.5);
  expect(trip.max).toBeLessThanOrEqual(60);
  expect(await page.locator('#tab-photos .day').count()).toBeLessThanOrEqual(8);
  // The last photo is reachable.
  const n = Number((await page.locator('#tab-photos header .n').textContent())!.replace(/\D/g, ''));
  expect(n).toBeGreaterThan(150);
  expect(await page.locator('#tab-photos h2 .cnt').last().textContent()).toBeTruthy();
  expect(q(page, 'at')).toBe(at);

  // Every demo photo at once (~1700, hundreds of days): the same bound.
  await page.goto('/?from=2024-07-01&to=2026-02-28');
  await tab(page, 'Photos').tap();
  await expect(cells(page).first()).toBeVisible({timeout: 15_000});
  const all = await sweep(3); // ~30 samples
  expect(all.total).toBeGreaterThan(trip.total * 5);
  expect(all.max).toBeLessThanOrEqual(60);
});
