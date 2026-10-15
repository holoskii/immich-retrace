// Every mouse and keyboard shortcut, for the `?` overlay (Help.svelte). Collected from the handlers:
// Overview.svelte (onKey, onWindowKey, pointer + wheel), TimeStrip.svelte (key, Space for Play), MapView.svelte (clicks,
// cardActions, Esc on the visit chooser, MapLibre's own keyboard handler), LightboxView.svelte (onKey),
// AlbumPicker.svelte. Keep this in step when one of them changes.

/**
 * `keys`: alternatives. "Shift+←/→" is a combination; lower-case entries ("drag", "click a pin") are
 * mouse gestures, shown as words rather than keys.
 */
export interface Shortcut { keys: string[]; what: string }
export interface ShortcutGroup { title: string; where?: string; items: Shortcut[] }

export const SHORTCUTS: ShortcutGroup[] = [
  {title: 'Timeline', where: 'the wave at the top', items: [
    {keys: ['drag'], what: 'select dates'},
    {keys: ['drag an edge'], what: 'resize the selection'},
    {keys: ['drag the middle'], what: 'move the selection'},
    {keys: ['click a coloured bar'], what: 'open that album'},
    {keys: ['scroll'], what: 'zoom the timeline'},
    {keys: ['←', '→'], what: 'move the selection by a day (when focused)'},
    {keys: ['Shift+←/→'], what: 'move it by a week'},
    {keys: ['Alt+←/→'], what: 'make it a day shorter / longer'},
    {keys: ['double-click', 'Esc'], what: 'clear the selection (a single click never does)'},
  ]},
  {title: 'All-years strip', where: 'the thin strip above the timeline', items: [
    {keys: ['drag the window'], what: 'choose the period the timeline shows'},
    {keys: ['click'], what: 'centre the window there'},
    {keys: ['double-click'], what: 'clear the selection'},
    {keys: ['scroll'], what: 'zoom the timeline'},
  ]},
  {title: 'Map', items: [
    {keys: ['drag', 'scroll'], what: 'pan and zoom (pauses Follow)'},
    {keys: ['click a cluster'], what: 'narrow the selection to those photos\' dates'},
    {keys: ['click a pin'], what: 'move the time cursor there (no selection: select its day)'},
    {keys: ['click the photo card'], what: 'open the photo'},
    {keys: ['←', '↑', '→', '↓', '+', '−'], what: 'pan and zoom (when the map is focused)'},
    {keys: ['Esc'], what: 'close the list of visits a cluster click offers'},
  ]},
  {title: 'Time strip', where: 'under the map', items: [
    {keys: ['drag'], what: 'scrub through the selection'},
    {keys: ['←', '→'], what: 'previous / next photo (when focused)'},
    {keys: ['Home', 'End'], what: 'first / last photo'},
    {keys: ['Enter'], what: 'open the photo nearest the cursor'},
    {keys: ['Space'], what: 'play / pause: step through the photos (anywhere but a text field or button)'},
  ]},
  {title: 'Photo viewer', items: [
    {keys: ['←', '→'], what: 'previous / next photo in the selection'},
    {keys: ['Esc'], what: 'close'},
  ]},
  {title: 'Albums list', items: [
    {keys: ['type'], what: 'search by name or year'},
    {keys: ['↑', '↓'], what: 'move through the list'},
    {keys: ['Enter'], what: 'open the highlighted album'},
    {keys: ['Esc'], what: 'close the list'},
  ]},
  {title: 'Anywhere', items: [
    {keys: ['Backspace'], what: 'back out of the last cluster or pin zoom'},
    {keys: ['?'], what: 'show or hide this list'},
  ]},
];

/** One alternative as its parts: "Shift+←/→" → ["Shift", "←/→"]; a lone "+" stays a key. `mouse`: a gesture, not keys. */
export function keyParts(k: string): {mouse: boolean; parts: string[]} {
  return {mouse: /^[a-z]/.test(k), parts: k.length > 1 && k.includes('+') ? k.split('+') : [k]};
}

/** Whether a keydown should toggle the shortcut list: `?` outside text fields, without Ctrl/Alt/Meta. */
export function isHelpKey(e: {key: string; ctrlKey: boolean; altKey: boolean; metaKey: boolean; defaultPrevented: boolean; target: EventTarget | null}) {
  if (e.key !== '?' || e.ctrlKey || e.altKey || e.metaKey || e.defaultPrevented) return false;
  const t = e.target as {closest?: (s: string) => unknown} | null;
  return !t?.closest?.('input, textarea, select, [contenteditable]');
}
