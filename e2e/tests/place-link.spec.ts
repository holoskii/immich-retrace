// A place link from the desktop (`near=`, a cluster's "Only photos here") opened on a phone: the shell has no UI to
// make one, but it shows it like any selection (pill, dock, Photos).
import {expect, test} from '@playwright/test';

test('a near= link opens on a phone', async ({page}) => {
  await page.addInitScript(() => { try { localStorage.setItem('immich-retrace.demo.tour-seen', '1'); } catch { /* */ } });
  // Barcelona, across two summer trips (Tossa de Mar and the Pyrenees in between stay out).
  await page.goto('/?near=41.39,2.16,8000&from=2024-07-01&to=2024-09-30');
  await expect(page.locator('.pill h1')).toHaveText('Barcelona', {timeout: 20_000});
  await expect(page.locator('.pill .l2')).toContainText(/\d+ photos/);
  await expect(page.getByRole('tab', {name: 'Map'})).toHaveAttribute('aria-selected', 'true');
  expect(new URL(page.url()).searchParams.get('near')).toBe('41.39,2.16,8000');
  await page.getByRole('tab', {name: 'Photos'}).click();
  await expect(page.locator('#tab-photos header')).toContainText(/Barcelona.*\d+ photos/);
});
