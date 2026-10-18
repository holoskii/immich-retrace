// The phone shell where things go wrong or come in odd (Pixel 7 and iPhone 15): long names on small and landscape
// screens, links without a cursor or with tracking keys, failing album requests, an empty range, the landing's wait,
// the map attribution, About's close button, and the lightbox opening on the thumbnail the card already showed.
import {expect, test, type Page} from '@playwright/test';

test.beforeEach(async ({page}) => {
  await page.addInitScript(() => { try { localStorage.setItem('immich-retrace.demo.tour-seen', '1'); } catch { /* */ } });
});

const q = (page: Page, k: string) => new URL(page.url()).searchParams.get(k);
const pill = (page: Page) => page.locator('.pill h1');
const tab = (page: Page, name: string) => page.getByRole('tab', {name});
const card = (page: Page) => page.locator('.dock .card[role=button]');
const nextStop = (page: Page) => page.getByRole('button', {name: 'Next stop'});
const ERROR = {status: 502, contentType: 'application/json', body: JSON.stringify({code: 'upstream', error: 'Demo temporarily unavailable'})};

/** The demo's albums with photos (the stub's list, through the viewer). */
async function albums(page: Page): Promise<{id: string; name: string; count: number}[]> {
  return (await (await page.request.get('/api/albums')).json() as {id: string; name: string; count: number; start: number | null}[])
    .filter(a => a.count > 0 && a.start != null);
}

/** Every control of the Map tab that must stay on screen, and whatever lies past the edges. */
async function offscreen(page: Page) {
  return page.evaluate(() => {
    const W = innerWidth, H = innerHeight, out: string[] = [];
    for (const s of ['.mapbox', '.dock', '.pmodes button', '.dock .card .n', '.transport .where', '.tb.play', '.tabbar']) {
      for (const el of document.querySelectorAll(s)) {
        const b = el.getBoundingClientRect();
        if (b.width && (b.left < -0.5 || b.right > W + 0.5 || b.bottom > H + 0.5)) out.push(`${s} ${Math.round(b.left)}–${Math.round(b.right)}`);
      }
    }
    const sw = document.querySelector('.phoneshell')!.scrollWidth;
    if (sw > W) out.push(`shell ${sw} > ${W}`);
    return out;
  });
}

test('every stop of every trip fits a 320 px phone and a landscape one (long names never push Follow / Fit off)', async ({page}) => {
  test.setTimeout(180_000);
  const list = await albums(page);
  expect(list.length).toBeGreaterThan(3);
  for (const size of [{width: 320, height: 568}, {width: 568, height: 320}]) {
    await page.setViewportSize(size);
    for (const a of list) {
      await page.goto(`/?album=${a.id}`);
      await expect(card(page)).toBeVisible({timeout: 20_000});
      for (let i = 0; i < 30; i++) {
        expect(await offscreen(page), `${a.name} at ${size.width}×${size.height}, ${await page.locator('.transport .where').textContent()}`).toEqual([]);
        if (await nextStop(page).isDisabled()) break;
        const at = q(page, 'at');
        await nextStop(page).click();
        await expect.poll(() => q(page, 'at')).not.toBe(at);
      }
    }
  }
});

test('a link without `at` puts the cursor on a photo mid-trip (not a placeholder), replacing the entry', async ({page}) => {
  const a = (await albums(page)).find(x => x.name.startsWith('San Sebastián'))!;
  for (const link of [`/?album=${a.id}`, '/?from=2024-09-06&to=2024-09-10', '/?near=41.39,2.16,8000&from=2024-07-01&to=2024-09-30']) {
    await page.goto(link);
    const len = await page.evaluate(() => history.length);
    await expect(card(page)).toBeVisible({timeout: 20_000});
    await expect(page.locator('.dock .skeleton')).toHaveCount(0);
    await expect.poll(() => q(page, 'at')).not.toBeNull();
    expect(await page.evaluate(() => history.length)).toBe(len);
    // Mid-selection, not its first photo.
    const [n, total] = (await card(page).locator('.n').textContent())!.split('/').map(s => Number(s.replace(/\D/g, '')));
    if (total > 10) expect(n).toBeGreaterThan(1);
  }
  // An explicit `at` stays as it was.
  await page.goto(`/?album=${a.id}&at=1725897107000`);
  await expect(card(page)).toBeVisible({timeout: 20_000});
  await page.waitForTimeout(500);
  expect(q(page, 'at')).toBe('1725897107000');
});

test('tracking keys keep the demo landing, and stay in the URL', async ({page}) => {
  await page.goto('/?utm_source=telegram&fbclid=abc');
  await expect(pill(page)).toHaveText('San Sebastián to Huesca', {timeout: 20_000});
  await expect(tab(page, 'Map')).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => q(page, 'at')).not.toBeNull();
  expect(q(page, 'album')).toBeTruthy();
  expect(q(page, 'utm_source')).toBe('telegram');
  expect(q(page, 'fbclid')).toBe('abc');
  await expect(page.locator('.tb.play')).toHaveAttribute('data-pulsed', 'true');
});

test('while the landing opens its trip the pill says so, not "Pick a trip"', async ({page}) => {
  // Slow album list: the landing waits for it.
  await page.route('**/api/albums', async r => { await new Promise(f => setTimeout(f, 2500)); await r.continue(); });
  await page.goto('/');
  await expect(page.locator('.pill .l2')).toContainText('Loading the trip…', {timeout: 15_000});
  await expect(page.locator('.pill .l2')).not.toContainText('Pick a trip');
  await expect(pill(page)).toHaveText('San Sebastián to Huesca', {timeout: 20_000});
});

test('the landing opens the trip from its members before the library index is in', async ({page}) => {
  let release!: () => void;
  const held = new Promise<void>(r => (release = r));
  await page.route(/\/api\/index\/\d{4}-\d\d$/, async r => { await held; await r.continue(); });
  await page.goto('/');
  await expect(pill(page)).toHaveText('San Sebastián to Huesca', {timeout: 15_000});
  await expect.poll(() => new URL(page.url()).searchParams.has('at'), {timeout: 15_000}).toBe(true);
  await expect(page.locator('.dock')).toContainText(/Sat,? 7 Sept/);
  release();
});

test('the album list failing: Trips says so with Try again (not "No trips here"), and the retry fills it', async ({page}) => {
  let fail = true;
  await page.route('**/api/albums', r => (fail ? r.fulfill(ERROR) : r.continue()));
  await page.goto('/');
  await expect(tab(page, 'Trips')).toHaveAttribute('aria-selected', 'true', {timeout: 20_000});
  const trips = page.locator('#tab-trips');
  await expect(trips.getByRole('alert')).toContainText('Trips unavailable', {timeout: 15_000});
  await expect(trips).not.toContainText('No trips here');
  fail = false;
  await trips.getByRole('button', {name: 'Try again'}).click();
  await expect(trips.getByRole('button', {name: /San Sebastián to Huesca/})).toBeVisible({timeout: 15_000});
  await expect(trips.getByRole('alert')).toHaveCount(0);
});

test('an album link whose album list failed opens that album once a retry brings the list', async ({page}) => {
  const a = (await albums(page)).find(x => x.name.startsWith('Pamplona'))!;
  let fail = true;
  await page.route('**/api/albums', r => (fail ? r.fulfill(ERROR) : r.continue()));
  await page.goto(`/?album=${a.id}`);
  const trips = page.locator('#tab-trips');
  await expect(trips.getByRole('alert')).toContainText('Trips unavailable', {timeout: 20_000});
  fail = false;
  await trips.getByRole('button', {name: 'Try again'}).click();
  await expect(pill(page)).toHaveText('Pamplona & Basque Country', {timeout: 15_000});
  await expect(tab(page, 'Map')).toHaveAttribute('aria-selected', 'true');
  await expect(card(page)).toBeVisible({timeout: 15_000});
  expect(q(page, 'album')).toBe(a.id);
});

test('the trip’s photos failing: the dock says so with Try again, and the retry shows the trip', async ({page}) => {
  let fail = true;
  await page.route('**/api/albums/*/assets', r => (fail ? r.fulfill(ERROR) : r.continue()));
  await page.goto('/');
  await expect(pill(page)).toHaveText('San Sebastián to Huesca', {timeout: 20_000});
  const dock = page.locator('.dock');
  await expect(dock.getByRole('alert')).toContainText('unavailable', {timeout: 15_000});
  fail = false;
  await dock.getByRole('button', {name: 'Try again'}).click();
  await expect(card(page)).toBeVisible({timeout: 15_000});
  await expect.poll(() => q(page, 'at')).not.toBeNull();
});

test('an empty range offers Choose a trip instead of a placeholder', async ({page}) => {
  await page.goto('/?from=2010-01-01&to=2010-01-02');
  const dock = page.locator('.dock');
  await expect(dock).toContainText('No photos in this selection', {timeout: 20_000});
  await expect(page.locator('.dock .skeleton')).toHaveCount(0);
  await dock.getByRole('button', {name: 'Choose a trip'}).click();
  await expect(tab(page, 'Trips')).toHaveAttribute('aria-selected', 'true');
});

test('the map attribution folds to its ⓘ once the map is in, clear of Fit, and opens on a tap', async ({page}) => {
  await page.goto('/');
  await expect(card(page)).toBeVisible({timeout: 20_000});
  const attrib = page.locator('.maplibregl-ctrl-attrib');
  await expect(attrib).toBeAttached();
  await expect(attrib).not.toHaveClass(/maplibregl-compact-show/, {timeout: 20_000});
  const fit = (await page.getByRole('button', {name: /^Fit/}).boundingBox())!;
  const closed = (await attrib.boundingBox())!;
  expect(closed.x + closed.width).toBeLessThan(fit.x);
  await page.locator('.maplibregl-ctrl-attrib-button').click();
  await expect(attrib).toHaveClass(/maplibregl-compact-show/);
  const open = (await attrib.boundingBox())!;
  expect(open.x + open.width).toBeLessThanOrEqual(fit.x);
});

test('About has a 44 px ✕ that stays on screen while its text scrolls', async ({page}) => {
  await page.setViewportSize({width: 320, height: 568});
  await page.goto('/');
  await expect(pill(page)).toHaveText('San Sebastián to Huesca', {timeout: 20_000});
  await page.getByRole('button', {name: /^More/}).click();
  await page.getByRole('menuitem', {name: /About/}).click();
  const dlg = page.getByRole('dialog', {name: 'About this demo'});
  await expect(dlg).toBeVisible();
  const x = dlg.getByRole('button', {name: 'Close'});
  await dlg.evaluate(d => d.scrollTo(0, d.scrollHeight));
  const b = (await x.boundingBox())!;
  expect(b.width).toBeGreaterThanOrEqual(44);
  expect(b.height).toBeGreaterThanOrEqual(44);
  expect(b.y).toBeGreaterThanOrEqual(0);
  expect(b.y + b.height).toBeLessThanOrEqual(568);
  await x.click();
  await expect(dlg).toBeHidden();
});

test('the lightbox opens on the card’s sharp thumbnail (from cache, no request) while the preview loads', async ({page}) => {
  const thumbs: string[] = [];
  page.on('request', r => { if (r.url().includes('size=thumbnail')) thumbs.push(r.url()); });
  // Hold the previews back, so what shows meanwhile can be checked.
  await page.route('**/thumbnail?size=preview*', async r => { await new Promise(f => setTimeout(f, 4000)); await r.continue().catch(() => {}); });
  await page.goto('/');
  await expect(card(page).locator('img')).toBeVisible({timeout: 20_000});
  const want = await card(page).locator('.ph').getAttribute('data-want');
  await expect.poll(() => card(page).locator('img').evaluate(i => (i as HTMLImageElement).complete)).toBe(true);
  const before = thumbs.length;
  await card(page).dispatchEvent('click');
  const box = page.locator('.page.current .box');
  await expect(box).toBeVisible();
  // The thumbnail's URL layered over the thumbhash; the preview not in yet.
  const bg = await box.evaluate(el => getComputedStyle(el).backgroundImage);
  expect(bg.split('url(').length - 1).toBe(2);
  expect(bg).toContain(want!.replace(/^\//, ''));
  await expect(page.locator('.page.current img.shown')).toHaveCount(0);
  // No thumbnail request since: it came from the cache.
  expect(thumbs.slice(before)).toEqual([]);
});
