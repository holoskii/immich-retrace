import {describe, expect, it} from 'vitest';
import {
  afterStep, clampView, classify, dismissRelease, doubleTapView, FIT, fit, isDoubleTap, MAX_ZOOM, nearEdge, pageRelease,
  pinchView, releaseVelocity, rubber, span, TAP_ZOOM, velocity, zoomAbout,
} from '../web/src/lib/lightbox/gesture.ts';

const stage = {w: 400, h: 800};

describe('fit', () => {
  it('fits by width or height, keeping the ratio', () => {
    expect(fit(stage, 1.5)).toEqual({w: 400, h: 267});
    expect(fit(stage, 0.25)).toEqual({w: 200, h: 800});
  });
  it('takes 3:2 for a missing ratio', () => { expect(fit(stage, NaN)).toEqual(fit(stage, 1.5)); });
});

describe('zoom and pan', () => {
  const img = fit(stage, 1.5); // 400 × 267

  it('zoomAbout keeps the image point under the focal point', () => {
    const v = zoomAbout(FIT, 2, {x: 100, y: 50});
    // The point 100 px right of the centre was image point 100; at 2× it is 200 from the image centre.
    expect(v).toEqual({s: 2, x: -100, y: -50});
    const back = zoomAbout(v, 1, {x: 100, y: 50});
    expect(back.x).toBeCloseTo(0); expect(back.y).toBeCloseTo(0);
  });

  it('clampView limits zoom to 1..MAX and keeps the stage covered along an overflowing axis', () => {
    expect(clampView({s: 0.5, x: 30, y: 30}, img, stage)).toEqual({s: 1, x: 0, y: 0});
    expect(clampView({s: 9, x: 0, y: 0}, img, stage).s).toBe(MAX_ZOOM);
    // At 2×: 800 × 534 in 400 × 800: x may go ±200, y stays centred (it doesn't fill the height).
    expect(clampView({s: 2, x: 500, y: 100}, img, stage)).toEqual({s: 2, x: 200, y: 0});
    expect(clampView({s: 2, x: -500, y: -100}, img, stage)).toEqual({s: 2, x: -200, y: 0});
  });

  it('pinchView scales by the finger distance and follows the midpoint', () => {
    const m0 = {x: 0, y: 0};
    expect(pinchView(FIT, m0, 100, m0, 200)).toEqual({s: 2, x: 0, y: 0});
    // Two-finger pan at the same distance.
    expect(pinchView({s: 2, x: 0, y: 0}, m0, 100, {x: 30, y: -10}, 100)).toEqual({s: 2, x: 30, y: -10});
    // Off-centre pinch: the point under the start midpoint stays under the fingers.
    const v = pinchView(FIT, {x: 100, y: 0}, 100, {x: 100, y: 0}, 300);
    expect(v.s).toBe(3);
    expect(v.x).toBe(100 - 100 * 3);
    // Pinching in past fitted stops at 1; past MAX at MAX.
    expect(pinchView(FIT, m0, 100, m0, 20).s).toBe(1);
    expect(pinchView(FIT, m0, 100, m0, 1000).s).toBe(MAX_ZOOM);
  });

  it('a double tap zooms to TAP_ZOOM at the tap point (clamped), and back to fitted when zoomed', () => {
    const z = doubleTapView(FIT, {x: 50, y: 20}, img, stage);
    expect(z.s).toBe(TAP_ZOOM);
    expect(z.x).toBe(50 - 50 * TAP_ZOOM);
    expect(z.y).toBe(0); // 667 px tall at 2.5× still fits the 800 px height: centred
    expect(doubleTapView(z, {x: 0, y: 0}, img, stage)).toEqual(FIT);
    // Near an edge: clamped so no empty band shows.
    expect(doubleTapView(FIT, {x: 200, y: 0}, img, stage).x).toBe(-(400 * TAP_ZOOM - 400) / 2);
  });

  it('span gives the midpoint and the distance of two pointers', () => {
    expect(span({x: 0, y: 0}, {x: 30, y: 40})).toEqual({m: {x: 15, y: 20}, d: 50});
  });
});

describe('drags', () => {
  it('classify waits for SLOP, then reads sideways as paging, down as closing, up as nothing', () => {
    expect(classify(5, 5)).toBeNull();
    expect(classify(-30, 10)).toBe('page');
    expect(classify(8, 40)).toBe('dismiss');
    expect(classify(8, -40)).toBe('none');
  });

  it('edge zones belong to the OS back swipe', () => {
    expect(nearEdge(10, 400)).toBe(true);
    expect(nearEdge(390, 400)).toBe(true);
    expect(nearEdge(200, 400)).toBe(false);
  });

  it('rubber resists only past an end', () => {
    expect(rubber(100, true, true)).toBe(100);
    expect(rubber(100, false, true)).toBe(30);
    expect(rubber(-100, true, false)).toBe(-30);
  });

  it('pageRelease turns the page after a quarter of the width or a flick, never past an end', () => {
    expect(pageRelease(-120, 0, 400, true, true)).toBe(1);
    expect(pageRelease(120, 0, 400, true, true)).toBe(-1);
    expect(pageRelease(-60, 0, 400, true, true)).toBe(0);
    expect(pageRelease(-60, -0.5, 400, true, true)).toBe(1);
    // A flick back the other way at the end of a drag: stays.
    expect(pageRelease(-60, 0.5, 400, true, true)).toBe(0);
    expect(pageRelease(-200, -1, 400, true, false)).toBe(0);
    expect(pageRelease(200, 1, 400, false, true)).toBe(0);
  });

  it('afterStep keeps the incoming page where it was on screen', () => {
    // Dragged 150 px left, then stepped to the next page (it sat one slot of 416 px right).
    expect(afterStep(-150, 1, 416)).toBe(266);
    expect(afterStep(150, -1, 416)).toBe(-266);
  });

  it('dismissRelease closes after 15% of the height or a downward flick', () => {
    expect(dismissRelease(130, 0, 800)).toBe(true);
    expect(dismissRelease(60, 0, 800)).toBe(false);
    expect(dismissRelease(60, 0.8, 800)).toBe(true);
    expect(dismissRelease(5, 0.8, 800)).toBe(false);
  });

  it('velocity uses the last 100 ms', () => {
    expect(velocity([])).toEqual({x: 0, y: 0});
    expect(velocity([{t: 0, x: 0, y: 0}, {t: 400, x: 1000, y: 0}, {t: 450, x: 1000, y: 0}, {t: 500, x: 1050, y: 25}]))
      .toEqual({x: 0.5, y: 0.25});
  });

  it('releaseVelocity: a drag held still before lifting is no flick', () => {
    const s = [{t: 0, x: 0, y: 0}, {t: 50, x: 60, y: 0}];
    expect(releaseVelocity(s, 60).x).toBeCloseTo(1.2);
    expect(releaseVelocity(s, 1050)).toEqual({x: 0, y: 0});
    expect(releaseVelocity([], 0)).toEqual({x: 0, y: 0});
  });

  it('isDoubleTap: within 300 ms and 30 px', () => {
    const t = {t: 1000, x: 100, y: 100};
    expect(isDoubleTap(null, t)).toBe(false);
    expect(isDoubleTap({t: 800, x: 110, y: 90}, t)).toBe(true);
    expect(isDoubleTap({t: 600, x: 100, y: 100}, t)).toBe(false);
    expect(isDoubleTap({t: 900, x: 160, y: 100}, t)).toBe(false);
  });
});
