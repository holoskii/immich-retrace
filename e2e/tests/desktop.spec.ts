// A mouse desktop keeps the G-B lightbox (photo plus side panel, mini-map), not the touch pager.
import {expect, test} from '@playwright/test';

test('the desktop lightbox on a fine pointer', async ({page}) => {
  await page.addInitScript(() => { try { localStorage.setItem('immich-retrace.demo.tour-seen', '1'); } catch { /* */ } });
  await page.goto('/');
  const card = page.locator('.card[role=button]');
  await expect(card).toBeAttached({timeout: 20_000});
  await card.click();
  const dialog = page.getByRole('dialog', {name: 'Lightbox'});
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('aside.panel')).toBeVisible();
  await expect(page.getByRole('dialog', {name: 'Photo viewer'})).toHaveCount(0);
  // Step on, then Esc: closes like Back (the entry the opening pushed is popped, no dead Back step), the cursor
  // staying on the photo shown; Forward reopens it.
  const lb = () => new URL(page.url()).searchParams.get('lb');
  const first = lb();
  await page.keyboard.press('ArrowRight');
  await expect.poll(lb).not.toBe(first);
  const shown = lb(), at = new URL(page.url()).searchParams.get('at');
  const len = await page.evaluate(() => history.length);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect(lb()).toBeNull();
  await expect.poll(() => new URL(page.url()).searchParams.get('at')).toBe(at);
  expect(await page.evaluate(() => history.length)).toBe(len);
  await page.goForward();
  await expect(dialog).toBeVisible();
  expect(lb()).toBe(shown);
});

test('a desktop gets the desktop shell, not the phone one', async ({page}) => {
  await page.addInitScript(() => { try { localStorage.setItem('immich-retrace.demo.tour-seen', '1'); } catch { /* */ } });
  await page.goto('/');
  await expect(page.locator('.card[role=button]')).toBeAttached({timeout: 20_000});
  await expect(page.locator('header canvas').first()).toBeVisible();
  await expect(page.getByRole('tablist', {name: 'Views'})).toHaveCount(0);
  await expect(page.locator('.pill')).toHaveCount(0);
});

test('the toolbar readout: an album named with its dates doesn’t repeat them; a one-day zoom shows its day once', async ({page}) => {
  await page.addInitScript(() => { try { localStorage.setItem('immich-retrace.demo.tour-seen', '1'); } catch { /* */ } });
  await page.setViewportSize({width: 1440, height: 900});
  await page.goto('/');
  const readout = page.locator('.readout');
  await expect(readout).toContainText('San Sebastián to Huesca, 6–10 Sep 2024 · 5d ·', {timeout: 20_000});
  await expect(readout).not.toContainText('→');
  // The album narrowed to hours of one day (a cluster zoom's URL): that day once, then the length.
  const album = new URL(page.url()).searchParams.get('album');
  await page.goto(`/?album=${album}&from=2024-09-09T10:00Z&to=2024-09-09T12:00Z`);
  await expect(readout).toContainText(/9 Sept 2024 · 2h/, {timeout: 20_000});
  await expect(readout).not.toContainText('→');
  // One row of controls plus at most a wrapped readout: never a third row.
  expect((await page.locator('.bar').boundingBox())!.height).toBeLessThanOrEqual(40);
});
