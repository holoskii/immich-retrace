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
