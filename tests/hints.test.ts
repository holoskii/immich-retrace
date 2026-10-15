// Hints and header (plan C7/C8): the shortcut list, the header status split, the camera control, pin → day.
import {describe, expect, it} from 'vitest';
import {headerStatus} from '../web/src/lib/index/store.svelte.ts';
import {camNext, type CamState} from '../web/src/lib/map/follow.ts';
import {dayAround} from '../web/src/lib/nav.ts';
import {isHelpKey, keyParts, SHORTCUTS} from '../web/src/lib/shortcuts.ts';

const DAY = 86400e3;

describe('shortcut list', () => {
  const ev = (key: string, over: Partial<Parameters<typeof isHelpKey>[0]> = {}) =>
    ({key, ctrlKey: false, altKey: false, metaKey: false, defaultPrevented: false, target: null, ...over});
  const field = (sel: string) => ({closest: (s: string) => (s.split(', ').includes(sel) ? {} : null)}) as unknown as EventTarget;

  it('? toggles it, except in text fields, with modifiers, or when already handled', () => {
    expect(isHelpKey(ev('?'))).toBe(true);
    expect(isHelpKey(ev('?', {target: field('div')}))).toBe(true);
    expect(isHelpKey(ev('/'))).toBe(false);
    expect(isHelpKey(ev('?', {target: field('input')}))).toBe(false);
    expect(isHelpKey(ev('?', {target: field('[contenteditable]')}))).toBe(false);
    expect(isHelpKey(ev('?', {ctrlKey: true}))).toBe(false);
    expect(isHelpKey(ev('?', {defaultPrevented: true}))).toBe(false);
  });

  it('splits combinations but keeps a lone + and mouse gestures whole', () => {
    expect(keyParts('Shift+←/→')).toEqual({mouse: false, parts: ['Shift', '←/→']});
    expect(keyParts('+')).toEqual({mouse: false, parts: ['+']});
    expect(keyParts('Esc')).toEqual({mouse: false, parts: ['Esc']});
    expect(keyParts('drag an edge')).toEqual({mouse: true, parts: ['drag an edge']});
  });

  it('lists every key the handlers react to', () => {
    const all = SHORTCUTS.flatMap(g => g.items.flatMap(s => s.keys.flatMap(k => keyParts(k).parts)));
    for (const k of ['?', 'Esc', 'Enter', 'Backspace', 'Home', 'End', '←', '→', '↑', '↓', 'Shift', 'Alt']) expect(all).toContain(k);
    // Items are keyed by their text in the overlay: unique per group.
    for (const g of SHORTCUTS) expect(new Set(g.items.map(s => s.what)).size).toBe(g.items.length);
  });
});

describe('headerStatus', () => {
  const base = {phase: null, attempt: 0, progress: {done: 0, total: 0}, items: '1 688 items', error: null};

  it('keeps first-build load phases and errors in the bar', () => {
    expect(headerStatus({...base, status: 'building', phase: 'loading', progress: {done: 3, total: 40}, items: ''}).shown).toBe('Loading 3/40 months');
    expect(headerStatus({...base, status: 'building', phase: 'connecting', items: ''}).shown).toBe('Connecting to Immich…');
    const err = headerStatus({...base, status: 'error', error: 'Immich is unreachable'});
    expect(err.shown).toBe('error: Immich is unreachable');
    expect(err.busy).toBe(false);
  });

  it('moves background refresh chatter into the menu and shows the count instead', () => {
    const cached = headerStatus({...base, status: 'cached', phase: 'connecting'});
    expect(cached).toEqual({shown: '1 688 items', detail: 'Showing the cached copy · checking for changes', busy: true});
    const refreshing = headerStatus({...base, status: 'refreshing', phase: 'loading', progress: {done: 7, total: 40}});
    expect(refreshing.shown).toBe('1 688 items');
    expect(refreshing.detail).toContain('Loading 7/40 months');
    expect(refreshing.busy).toBe(true);
  });

  it('still shows waiting for Immich while a cached copy is up', () => {
    expect(headerStatus({...base, status: 'cached', phase: 'waiting', attempt: 1}).shown).toBe('Waiting for Immich to start (attempt 2)…');
    expect(headerStatus({...base, status: 'refreshing', phase: 'waiting', attempt: 0}).shown).toBe('Waiting for Immich to start (attempt 1)…');
  });

  it('ready: the count in the bar, "up to date" in the menu', () => {
    expect(headerStatus({...base, status: 'ready'})).toEqual({shown: '1 688 items', detail: 'Up to date · 1 688 items', busy: false});
  });
});

describe('camera control (Follow toggle + Fit)', () => {
  const start: CamState = {mode: 'follow', auto: 'follow'};
  const run = (s: CamState, ...evs: Parameters<typeof camNext>[1][]) => evs.reduce(camNext, s);

  it('a pan pauses Follow; the next selection follows again', () => {
    const paused = run(start, 'pan');
    expect(paused).toEqual({mode: 'manual', auto: 'follow'});
    expect(run(paused, 'pan')).toBe(paused);
    expect(run(paused, 'select')).toEqual(start);
  });

  it('Fit frames the selection, drops Follow, and new selections are framed too', () => {
    const fit = run(start, 'fit');
    expect(fit).toEqual({mode: 'whole', auto: 'whole'});
    expect(run(fit, 'pan')).toEqual({mode: 'manual', auto: 'whole'});
    expect(run(fit, 'pan', 'select')).toEqual(fit);
  });

  it('turning Follow off leaves the map where it is; on again follows', () => {
    const off = run(start, 'unfollow');
    expect(off).toEqual({mode: 'manual', auto: 'whole'});
    expect(run(off, 'select').mode).toBe('whole');
    expect(run(off, 'follow')).toEqual(start);
    expect(run(start, 'fit', 'follow')).toEqual(start);
  });
});

describe('dayAround', () => {
  it('is the local day containing the instant, end exclusive (identity conversion without an index)', () => {
    const d = Date.UTC(2025, 4, 12);
    expect(dayAround(d + 13.5 * 3600e3)).toEqual([d, d + DAY]);
    expect(dayAround(d)).toEqual([d, d + DAY]);
    expect(dayAround(d + DAY - 1)).toEqual([d, d + DAY]);
    // 23:00 UTC at UTC+2 is 01:00 the next local day; the photo itself always stays inside.
    expect(dayAround(d + 23 * 3600e3, 2)).toEqual([d + 23 * 3600e3, d + 2 * DAY]);
    // Clamped edges stay whole minutes (the URL's finest format) and still contain the photo.
    expect(dayAround(d + 23 * 3600e3 + 30e3, 2)).toEqual([d + 23 * 3600e3, d + 2 * DAY]);
  });
});
