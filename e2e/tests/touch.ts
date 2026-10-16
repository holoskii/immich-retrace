// Touch input for the e2e tests. Chromium: real touches through CDP (Input.dispatchTouchEvent), which the browser
// turns into pointer events itself, multi-touch included. WebKit has no such channel in Playwright, so there the
// same gestures are dispatched as synthetic touch PointerEvents on the element under each point: it exercises the
// app's handlers, not WebKit's input pipeline (and setPointerCapture is a no-op for them).
import type {CDPSession, Page} from '@playwright/test';

export interface Pt { x: number; y: number }

const sessions = new WeakMap<Page, CDPSession>();
async function cdp(page: Page) {
  let s = sessions.get(page);
  if (!s) { s = await page.context().newCDPSession(page); sessions.set(page, s); }
  return s;
}
const isChromium = (page: Page) => page.context().browser()?.browserType().name() === 'chromium';

/** One frame of fingers: down/move/up of all `pts` (ids 0..n-1). */
async function frame(page: Page, type: 'start' | 'move' | 'end', pts: Pt[]) {
  if (isChromium(page)) {
    const s = await cdp(page);
    await s.send('Input.dispatchTouchEvent', {
      type: type === 'start' ? 'touchStart' : type === 'move' ? 'touchMove' : 'touchEnd',
      touchPoints: type === 'end' ? [] : pts.map((p, id) => ({x: p.x, y: p.y, id, radiusX: 1, radiusY: 1, force: 1})),
    });
    return;
  }
  await page.evaluate(({type, pts}) => {
    const w = window as unknown as {__touchTargets?: (Element | null)[]};
    if (type === 'start') w.__touchTargets = pts.map(p => document.elementFromPoint(p.x, p.y));
    const names = {start: 'pointerdown', move: 'pointermove', end: 'pointerup'} as const;
    pts.forEach((p, i) => {
      const el = w.__touchTargets?.[i] ?? document.elementFromPoint(p.x, p.y);
      el?.dispatchEvent(new PointerEvent(names[type], {
        pointerId: 100 + i, pointerType: 'touch', isPrimary: i === 0, clientX: p.x, clientY: p.y,
        bubbles: true, cancelable: true, composed: true, buttons: type === 'end' ? 0 : 1, width: 2, height: 2,
      }));
    });
  }, {type, pts});
}

const lerp = (a: Pt, b: Pt, k: number): Pt => ({x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k});

/** One finger from `a` to `b` in `steps` moves, `ms` apart, resting `hold` ms before lifting. */
export async function swipe(page: Page, a: Pt, b: Pt, {steps = 8, ms = 16, hold = 0} = {}) {
  await frame(page, 'start', [a]);
  for (let i = 1; i <= steps; i++) { await page.waitForTimeout(ms); await frame(page, 'move', [lerp(a, b, i / steps)]); }
  if (hold) await page.waitForTimeout(hold);
  await frame(page, 'end', [b]);
}

/** A tap at `p` (touch down and up in place). */
export async function tap(page: Page, p: Pt) {
  await frame(page, 'start', [p]);
  await frame(page, 'end', [p]);
}

/** Two taps well inside the app's 300 ms double-tap window (no wait: a loaded test machine is slow enough). */
export async function doubleTap(page: Page, p: Pt) {
  await tap(page, p);
  await tap(page, p);
}

/** Two fingers on a horizontal line through `c`, from `d0` apart to `d1` apart. */
export async function pinch(page: Page, c: Pt, d0: number, d1: number, steps = 8) {
  const at = (d: number): Pt[] => [{x: c.x - d / 2, y: c.y}, {x: c.x + d / 2, y: c.y}];
  await frame(page, 'start', at(d0));
  for (let i = 1; i <= steps; i++) { await page.waitForTimeout(16); await frame(page, 'move', at(d0 + (d1 - d0) * i / steps)); }
  await frame(page, 'end', at(d1));
}
