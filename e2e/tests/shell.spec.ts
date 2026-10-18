// The phone shell (demo mode, Pixel 7 and iPhone 15): landing, tabs, the dock (⏭, strip, Play, card → lightbox), and
// that an owner's phone (no demo) keeps the desktop shell.
import {expect, test, type Page} from '@playwright/test';
import {swipe} from './touch.ts';

test.beforeEach(async ({page}) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('immich-retrace.demo.tour-seen', '1'); } catch { /* */ }
    (window as unknown as {len0: number}).len0 = history.length;
  });
});

const q = (page: Page, k: string) => new URL(page.url()).searchParams.get(k);
const at = (page: Page) => Number(q(page, 'at'));
const histLen = (page: Page) => page.evaluate(() => history.length);
const pill = (page: Page) => page.locator('.pill h1');
const tab = (page: Page, name: string) => page.getByRole('tab', {name});
const where = (page: Page) => page.locator('.transport .where');
/** "15 / 194" on the card → [15, 194]. */
const counter = async (page: Page) => (await page.locator('.card .n').textContent())!.split('/').map(s => Number(s.replace(/\D/g, '')));

async function land(page: Page) {
  await page.goto('/');
  await expect(pill(page)).toHaveText('San Sebastián to Huesca', {timeout: 20_000});
  await expect.poll(() => q(page, 'at')).not.toBeNull();
  await expect(page.locator('.card[role=button] img')).toBeVisible({timeout: 15_000});
}

test('lands on the demo trip: Map tab, the pill, the cursor mid-trip, Follow on, Play pulsing', async ({page}) => {
  await land(page);
  await expect(tab(page, 'Map')).toHaveAttribute('aria-selected', 'true');
  await expect(tab(page, 'Trips')).toHaveAttribute('aria-selected', 'false');
  await expect(page.locator('.pill .l2')).toContainText(/Demo.*2024 · 194 photos/);
  const [n, total] = await counter(page);
  expect(n).toBeGreaterThan(total * 0.05);
  expect(n).toBeLessThan(total * 0.95);
  await expect(page.getByRole('button', {name: 'Following the time cursor'})).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.tb.play')).toHaveAttribute('data-pulsed', 'true');
  // The landing replaced the entry: no extra Back step. The card image is the high-priority LCP candidate.
  expect(await histLen(page)).toBe(await page.evaluate(() => (window as unknown as {len0: number}).len0));
  await expect(page.locator('.card img')).toHaveAttribute('fetchpriority', 'high');
  // The fixed root: the page itself never scrolls.
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).toBe('hidden');
});

test('a trip card in Trips selects it and shows it on the map, one history entry', async ({page}) => {
  await land(page);
  const album = q(page, 'album'), len = await histLen(page);
  await tab(page, 'Trips').tap();
  await expect(tab(page, 'Trips')).toHaveAttribute('aria-selected', 'true');
  const card = page.getByRole('button', {name: /Pamplona & Basque Country/});
  await expect(card).toBeVisible();
  // The map pane is hidden under the list, not removed.
  await expect(page.locator('#tab-map')).toBeHidden();
  expect(await page.locator('.maplibregl-canvas').count()).toBe(1);
  await card.tap();
  await expect(tab(page, 'Map')).toHaveAttribute('aria-selected', 'true');
  await expect(pill(page)).toHaveText('Pamplona & Basque Country');
  expect(q(page, 'album')).not.toBe(album);
  expect(await histLen(page)).toBe(len + 1);
  await expect.poll(() => q(page, 'at')).not.toBeNull();
  expect(await page.locator('.maplibregl-canvas').count()).toBe(1);
  // Back returns to the landing trip, still on Map.
  await page.goBack();
  await expect(pill(page)).toHaveText('San Sebastián to Huesca');
  await expect(tab(page, 'Map')).toHaveAttribute('aria-selected', 'true');
});

test('⏭ moves the cursor to the next stop, ⏮ back, replacing the entry', async ({page}) => {
  await land(page);
  const len = await histLen(page), a0 = at(page);
  const label0 = await where(page).textContent();
  const next = page.getByRole('button', {name: 'Next stop'});
  await expect(next).toBeEnabled();
  await next.tap();
  await expect.poll(() => at(page)).toBeGreaterThan(a0);
  await expect(where(page)).not.toHaveText(label0!);
  await expect(where(page)).toHaveText(/stop \d+ \/ \d+$/);
  const a1 = at(page);
  await page.getByRole('button', {name: 'Previous stop'}).tap();
  await expect.poll(() => at(page)).toBeLessThan(a1);
  expect(await histLen(page)).toBe(len);
});

test('the photo card opens the lightbox; Back closes it and stays on Map', async ({page}) => {
  await land(page);
  const len = await histLen(page);
  await page.locator('.card[role=button]').tap();
  const dialog = page.getByRole('dialog', {name: 'Photo viewer'});
  await expect(dialog).toBeVisible();
  expect(q(page, 'lb')).toBeTruthy();
  expect(await histLen(page)).toBe(len + 1);
  await page.goBack();
  await expect(dialog).toBeHidden();
  expect(q(page, 'lb')).toBeNull();
  expect(q(page, 'album')).toBeTruthy();
  await expect(tab(page, 'Map')).toHaveAttribute('aria-selected', 'true');
});

test('dragging the strip scrubs the cursor without history entries', async ({page}) => {
  await land(page);
  const len = await histLen(page);
  const box = (await page.getByRole('slider').boundingBox())!;
  const y = box.y + box.height / 2;
  await swipe(page, {x: box.x + box.width * 0.1, y}, {x: box.x + box.width * 0.3, y}, {steps: 6, ms: 30});
  await expect.poll(() => at(page)).toBeGreaterThan(0);
  const a1 = at(page);
  await swipe(page, {x: box.x + box.width * 0.3, y}, {x: box.x + box.width * 0.85, y}, {steps: 10, ms: 30});
  await expect.poll(() => at(page)).toBeGreaterThan(a1);
  const [n] = await counter(page);
  expect(n).toBeGreaterThan(1);
  expect(await histLen(page)).toBe(len);
});

test('Play steps through the photos and stops when another tab covers the map or the cursor is moved', async ({page}) => {
  await land(page);
  const a0 = at(page);
  const play = page.locator('.tb.play');
  await play.tap();
  await expect(play).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => at(page), {timeout: 8000}).not.toBe(a0);
  await tab(page, 'Trips').tap();
  await expect(play).toHaveAttribute('aria-pressed', 'false');
  // A seek of its own (⏭) takes the cursor over too.
  await tab(page, 'Map').tap();
  await play.tap();
  await expect(play).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', {name: 'Next stop'}).tap();
  await expect(play).toHaveAttribute('aria-pressed', 'false');
});

test('an owner’s phone (no demo) keeps the desktop shell', async ({page}) => {
  await page.route('**/api/config', async r => {
    const res = await r.fetch();
    await r.fulfill({response: res, json: {...(await res.json()), demo: null}});
  });
  await page.goto('/');
  await expect(page.locator('main .mapview, main .placeholder').first()).toBeAttached({timeout: 20_000});
  await expect(page.getByRole('tablist', {name: 'Views'})).toHaveCount(0);
  await expect(page.locator('.app > header')).toBeAttached();
});
