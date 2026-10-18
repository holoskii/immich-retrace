// The desktop demo landing: opened from the trip's members before the library index is in, a map that keeps about
// half of a short window, the coach mark after the map has shown the trip (Play first), every demo trip listed.
import {expect, test, type Page} from '@playwright/test';

const seen = (page: Page) => page.addInitScript(() => { try { localStorage.setItem('immich-retrace.demo.tour-seen', '1'); } catch { /* */ } });

test('lands on the trip from its members alone, before the library index is in', async ({page}) => {
  await seen(page);
  let release!: () => void;
  const held = new Promise<void>(r => (release = r));
  // Every month of the index waits until the landing is checked.
  await page.route(/\/api\/index\/\d{4}-\d\d$/, async r => { await held; await r.continue(); });
  await page.goto('/');
  await expect.poll(() => new URL(page.url()).searchParams.has('at'), {timeout: 15_000}).toBe(true);
  await expect(page.locator('.readout')).toContainText('San Sebastián to Huesca');
  await expect(page.locator('.card[role=button]')).toBeAttached({timeout: 15_000});
  await expect(page.getByText('Loading the demo library…')).toHaveCount(0);
  // The legend's days are the trip's local ones (the members' offsets stand in for the index's).
  await expect(page.locator('.legend .ends')).toHaveText(/6 Sept 2024\s*10 Sept 2024/);
  const at = new URL(page.url()).searchParams.get('at');
  release();
  await expect(page.locator('.status')).toContainText('items', {timeout: 15_000});
  expect(new URL(page.url()).searchParams.get('at')).toBe(at);
});

for (const [w, h] of [[1280, 720], [1024, 768]]) {
  test(`a ${w}×${h} window keeps about half its height for the map, on one line of banner, nothing wider than the window`, async ({page}) => {
    await seen(page);
    await page.setViewportSize({width: w, height: h});
    await page.goto('/');
    await expect(page.locator('.card[role=button]')).toBeAttached({timeout: 20_000});
    const map = (await page.locator('.mapwrap').boundingBox())!;
    expect(map.height).toBeGreaterThanOrEqual(h * 0.5);
    expect((await page.locator('.banner').boundingBox())!.height).toBeLessThanOrEqual(40);
    expect((await page.locator('.overview .bar').boundingBox())!.height).toBeLessThanOrEqual(30);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(w);
    // The whole-trip inset waits for a taller map (it would cover the route); the colour key is in the readout.
    await expect(page.locator('.overview .hint')).toHaveCount(0);
  });
}

test('a tall window keeps the full overview (wave, hint line)', async ({page}) => {
  await seen(page);
  await page.setViewportSize({width: 1440, height: 900});
  await page.goto('/');
  await expect(page.locator('.card[role=button]')).toBeAttached({timeout: 20_000});
  await expect(page.locator('.overview .hint')).toBeVisible();
  expect((await page.locator('canvas.main').boundingBox())!.height).toBe(176);
});

test('the coach mark starts once the map has shown the trip, with Play first', async ({page}) => {
  await page.goto('/');
  const bubble = page.locator('.bubble');
  await expect(bubble).toBeVisible({timeout: 30_000});
  await expect(bubble.locator('h3')).toHaveText('Replay the trip');
  // Its ring is on the Play button.
  const ring = (await page.locator('.ring').boundingBox())!, play = (await page.locator('.strip .play').boundingBox())!;
  expect(Math.abs(ring.x + 4 - play.x)).toBeLessThan(2);
  await bubble.getByRole('button', {name: 'Next →'}).click();
  await expect(bubble.locator('h3')).toHaveText('The photo at that moment');
  await page.keyboard.press('Escape');
  await expect(bubble).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('immich-retrace.demo.tour-seen'))).toBe('1');
});

test('"Try another trip" lists every demo trip, as the phone does', async ({page}) => {
  await seen(page);
  await page.goto('/');
  await expect(page.locator('.card[role=button]')).toBeAttached({timeout: 20_000});
  await expect(page.locator('.status')).toContainText('items', {timeout: 15_000}); // scored with the index in
  await page.getByRole('button', {name: /Try another trip/}).click();
  const list = page.getByRole('listbox', {name: 'Albums'});
  await expect(list.getByRole('option')).toHaveCount(6);
  await expect(list).toContainText('Lisbon & Queluz');
});
