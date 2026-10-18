// A map cluster visited more than once (desktop): its menu offers "Only photos here" (a place selection, `near=`)
// and "Everything in this period" (first visit → last) above the per-visit rows.
import {expect, test, type Page} from '@playwright/test';

/** Three months of the demo: Barcelona and the Pyrenees each visited on two or more trips. */
const RANGE = '/?from=2024-07-01&to=2024-09-30';

/** Frames the whole selection, then finds a cluster whose click opens the menu with both options; its tip count. */
async function openMenu(page: Page) {
  await page.getByRole('button', {name: 'Fit', exact: true}).click();
  await page.waitForTimeout(1500);
  const box = (await page.locator('.map canvas').boundingBox())!;
  // MapLibre answers synthetic mouse moves synchronously (cursor = pointer over a cluster or pin): scan in the page.
  const spots = await page.evaluate(({x0, y0, w, h}) => {
    const c = document.querySelector<HTMLCanvasElement>('.map canvas')!, out: [number, number][] = [];
    for (let y = y0 + 30; y < y0 + h - 30; y += 8) for (let x = x0 + 20; x < x0 + w - 20; x += 8) {
      c.dispatchEvent(new MouseEvent('mousemove', {clientX: x, clientY: y, bubbles: true}));
      if (c.style.cursor === 'pointer' && !out.some(([a, b]) => Math.hypot(a - x, b - y) < 30)) out.push([x, y]);
    }
    c.dispatchEvent(new MouseEvent('mouseout', {bubbles: true}));
    return out;
  }, {x0: box.x, y0: box.y, w: box.width, h: box.height});
  const fit = page.getByRole('button', {name: 'Fit', exact: true}), menu = page.getByRole('menu', {name: 'Visits to this place'});
  for (const [x, y] of spots) {
    await page.mouse.move(x, y);
    const tip = page.locator('.tip strong');
    const text = await tip.textContent({timeout: 1500}).catch(() => '');
    if (!text?.includes('items')) continue;
    const n = Number(text.match(/(\d+) items/)![1]), url = page.url();
    await page.mouse.click(x, y);
    // A menu, or a zoom straight to the one visit (a new URL), or the map zooming in.
    await expect.poll(async () => (await menu.isVisible()) || page.url() !== url, {timeout: 3000}).toBe(true).catch(() => {});
    if (await menu.isVisible()) {
      if (await menu.getByRole('menuitem', {name: /Only photos here/}).count()) return {menu, n};
      await page.keyboard.press('Escape');
    } else if (page.url() !== url) {
      await page.goBack();
      await expect.poll(() => page.url()).toBe(url);
    }
    await fit.click();
    await page.waitForTimeout(1200);
  }
  throw new Error('no multi-visit cluster found');
}

const count = async (page: Page) => {
  const t = (await page.locator('.readout').textContent())!.replace(/\u202f/g, '');
  const m = t.match(/(\d+) with location · (\d+) without/)!;
  return [Number(m[1]), Number(m[2])];
};

test('a multi-visit cluster: only the photos here, or everything in the period', async ({page}) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => { try { localStorage.setItem('immich-retrace.demo.tour-seen', '1'); } catch { /* */ } });
  await page.goto(RANGE);
  await expect(page.locator('.readout .sw').first()).toBeVisible({timeout: 20_000});
  const start = page.url();

  const {menu, n} = await openMenu(page);
  const items = menu.getByRole('menuitem');
  await expect(items.nth(0)).toContainText('Only photos here');
  await expect(items.nth(1)).toContainText('Everything in this period');
  await expect(menu).toContainText(/\d visits here/);
  await expect(items.last()).toHaveText('Just zoom the map in');
  // The circle's count: the cluster's own photos, nothing from the clusters around it.
  await expect(items.nth(0)).toContainText(String(n));

  await items.nth(0).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('near')).toMatch(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?,\d+$/);
  await expect(page.locator('.readout')).toContainText(`${n} photos`);
  expect(await count(page)).toEqual([n, 0]);
  await expect(page.locator('.notice.zoomed')).toContainText('only the photos within');
  const place = page.url();

  // Back returns to the range; Forward and a reload come back to the same place.
  await page.goBack();
  await expect.poll(() => page.url()).toBe(start);
  await page.goForward();
  await expect.poll(() => page.url()).toBe(place);
  expect(await count(page)).toEqual([n, 0]);
  await page.reload();
  await expect(page.locator('.readout .sw').first()).toBeVisible({timeout: 20_000});
  expect(await count(page)).toEqual([n, 0]);
  await expect(page.locator('.readout')).toContainText(`${n} photos`);

  // From the range again: everything from the first visit to the last, other places included.
  await page.goto(RANGE);
  await expect(page.locator('.readout .sw').first()).toBeVisible({timeout: 20_000});
  const again = await openMenu(page);
  const all = again.menu.getByRole('menuitem', {name: /Everything in this period/});
  const total = Number((await all.textContent())!.replace(/\u202f/g, '').match(/· (\d+)$/)![1]);
  await all.click();
  await expect.poll(() => new URL(page.url()).searchParams.get('from')).toMatch(/T\d\d:\d\dZ$/);
  expect(new URL(page.url()).searchParams.has('near')).toBe(false);
  const [g, ng] = await count(page);
  expect(g + ng).toBe(total);
  expect(g).toBeGreaterThan(again.n);
});
