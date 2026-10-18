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

test('lands on the demo trip framed whole: Map tab, the pill, the pitch, the cursor before the first flight, Play pulsing', async ({page}) => {
  await land(page);
  await expect(tab(page, 'Map')).toHaveAttribute('aria-selected', 'true');
  await expect(tab(page, 'Trips')).toHaveAttribute('aria-selected', 'false');
  await expect(page.locator('.pill .l2')).toContainText(/Demo.*2024 · 194 photos/);
  await expect(page.getByRole('note')).toContainText('retraced from where your photos were taken');
  // On the first stop's last photo: the first ▶ flies on to the next stop at once.
  const [n, total] = await counter(page);
  expect(n).toBeGreaterThan(total * 0.05);
  expect(n).toBeLessThan(total * 0.95);
  await expect(where(page)).toHaveText(/stop 1 \//);
  await expect(page.getByRole('button', {name: /^Fit/})).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', {name: 'Follow the time cursor'})).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.tb.play')).toHaveAttribute('data-pulsed', 'true');
  // The landing replaced the entry: no extra Back step. The card image is the high-priority LCP candidate.
  expect(await histLen(page)).toBe(await page.evaluate(() => (window as unknown as {len0: number}).len0));
  await expect(page.locator('.card img')).toHaveAttribute('fetchpriority', 'high');
  // The fixed root: the page itself never scrolls.
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).toBe('hidden');
});

test('the first ▶ turns Follow on, reaches the next stop within a few seconds and dismisses the pitch for good', async ({page}) => {
  await land(page);
  await page.locator('.tb.play').tap();
  await expect(page.getByRole('button', {name: 'Following the time cursor'})).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('note')).toHaveCount(0);
  await expect(where(page)).toHaveText(/stop 2 \//, {timeout: 4000});
  await page.locator('.tb.play').tap(); // pause
  await page.reload();
  await expect(pill(page)).toHaveText('San Sebastián to Huesca', {timeout: 20_000});
  await expect(page.locator('.card[role=button] img')).toBeVisible({timeout: 15_000});
  await expect(page.getByRole('note')).toHaveCount(0);
});

test('the pitch: About opens the panel (call to action first, the data changes folded), ✕ dismisses it', async ({page}) => {
  await land(page);
  const note = page.getByRole('note');
  await note.getByRole('button', {name: 'About'}).tap();
  const about = page.getByRole('dialog', {name: 'About this demo'});
  await expect(about).toBeVisible();
  await expect(about.locator('.cta')).toHaveText(/Get it for your Immich/);
  await expect(about.getByText('the video clips were generated from photos')).toBeHidden();
  await about.locator('summary').tap();
  await expect(about.getByText('the video clips were generated from photos')).toBeVisible();
  await about.getByRole('button', {name: 'Close'}).tap();
  await expect(about).toBeHidden();
  await note.getByRole('button', {name: 'Dismiss'}).tap();
  await expect(note).toHaveCount(0);
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
  // The same trip applied again by Back is not a new selection: the landing's whole-trip frame stays.
  await expect(page.getByRole('button', {name: /^Fit/})).toHaveAttribute('aria-pressed', 'true');
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

test('a slow strip drag keeps the card on the photo at the cursor: its thumbhash at once, never another photo', async ({page}) => {
  // Which thumbnail URL each object URL holds, so the card's <img src="blob:…"> can be checked against the cursor.
  await page.addInitScript(() => {
    const tags = new Map<string, string>();
    (window as unknown as {__objUrls: Map<string, string>}).__objUrls = tags;
    const blob = Response.prototype.blob;
    Response.prototype.blob = async function (this: Response) {
      const b = await blob.call(this);
      (b as Blob & {__u?: string}).__u = new URL(this.url).pathname + new URL(this.url).search;
      return b;
    };
    const create = URL.createObjectURL;
    URL.createObjectURL = (o: Blob | MediaSource) => {
      const u = create(o), tag = (o as Blob & {__u?: string}).__u;
      if (tag) tags.set(u, tag);
      return u;
    };
  });
  await land(page);
  // Every change in the card's picture: the photo wanted (data-want) and the thumbnail its visible <img> shows.
  await page.evaluate(() => {
    const w = window as unknown as {__objUrls: Map<string, string>; __card: [string, string | null][]};
    w.__card = [];
    const ph = () => document.querySelector<HTMLElement>('.card .ph');
    const shown = () => {
      const img = ph()?.querySelector('img');
      if (!img || img.style.visibility === 'hidden') return null;
      if (img.src.startsWith('blob:')) return w.__objUrls.get(img.src) ?? img.src;
      const u = new URL(img.src);
      return u.pathname + u.search;
    };
    new MutationObserver(() => {
      const want = ph()?.dataset.want ?? '', last = w.__card.at(-1), s = shown();
      if (!last || last[0] !== want || last[1] !== s) w.__card.push([want, s]);
    }).observe(document.querySelector('.dock')!, {subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'style', 'data-want']});
  });
  const box = (await page.getByRole('slider').boundingBox())!;
  const y = box.y + box.height / 2;
  // Slow: ~2.5 s across half the trip, the finger down until the end.
  await swipe(page, {x: box.x + box.width * 0.1, y}, {x: box.x + box.width * 0.6, y}, {steps: 40, ms: 60});
  const states = await page.evaluate(() => (window as unknown as {__card: [string, string | null][]}).__card);
  const wants = new Set(states.map(s => s[0]));
  // The card followed the finger: many photos, each shown (thumbhash or thumbnail) as the cursor reached it…
  expect(wants.size).toBeGreaterThanOrEqual(5);
  expect(states.length).toBeGreaterThanOrEqual(5);
  // …some as their real thumbnail before the finger lifted, and never a photo for another moment.
  expect(states.filter(([want, shown]) => shown === want).length).toBeGreaterThanOrEqual(1);
  expect(states.filter(([want, shown]) => shown != null && shown !== want)).toEqual([]);
  // At rest, the photo at the cursor's own thumbnail.
  await expect.poll(() => page.evaluate(() => {
    const ph = document.querySelector<HTMLElement>('.card .ph')!, img = ph.querySelector('img');
    if (!img) return false;
    const u = new URL(img.src);
    // An object URL from the queue, or the first card image's own (the page's LCP, kept).
    const shown = img.src.startsWith('blob:') ? (window as unknown as {__objUrls: Map<string, string>}).__objUrls.get(img.src) : u.pathname + u.search;
    return shown === ph.dataset.want;
  })).toBe(true);
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
