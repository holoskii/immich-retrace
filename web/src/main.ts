// Boot: starts what every shell needs at t0 and in parallel (the library index and albums, the config, the
// map's chunk and MapLibre), then mounts the shell. The shell is chosen once here; rotating never swaps it.
import {mount, type Component} from 'svelte';
import {library} from './lib/index/store.svelte.ts';
import {hasViewerState, selection, startUrlSync} from './lib/selection.svelte.ts';
import {getConfig} from './lib/config.svelte.ts';
import {loadMapView} from './lib/map/load.ts';
import './app.css';

/**
 * What every shell gets. `landing`: opened without a link (no viewer state in the query; tracking keys such as
 * utm_source don't count), so the demo picks what to show.
 */
export type ShellProps = {landing: boolean};

// Before anything writes the URL.
const landing = !hasViewerState(new URLSearchParams(location.search));
void library.load();
// Applies ?from/to/album/at/lb once the index is there, then follows back/forward.
startUrlSync();
const config = getConfig();
// A landing may open something of the deployment's choosing (the demo's trip): the overview holds its default view
// until that is settled, so it doesn't draw one period and jump to another. The demo's config names the trip's album:
// its members are fetched now, and the landing needs neither the index nor (beyond the album list) anything else.
if (landing) {
  selection.awaitingLanding = true;
  void config.then(c => {
    if (c.demo?.album) library.prefetchMembers(c.demo.album);
    if (!c.demo) selection.awaitingLanding = false;
  });
  // Never held for long (the demo chunk failing, a landing that never settles).
  setTimeout(() => (selection.awaitingLanding = false), 8000);
}
// Already failed (no WebGL 2, offline): the shell shows why when it mounts the map.
loadMapView().catch(() => {});

/** A phone-sized touch screen: the demo gets its phone shell there. Screen, not window: a split view doesn't count. */
const phone = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) <= 500;

/**
 * The shell's chunk. A desktop starts it at once; a phone first needs the config: only the demo has a phone shell
 * (lib/mobile/), an owner's phone keeps the desktop one.
 */
async function shell(): Promise<{default: Component<ShellProps>}> {
  if (phone && (await config).demo) return import('./lib/mobile/MobileShell.svelte');
  return import('./App.svelte');
}

const target = document.getElementById('app')!;
shell().then(({default: Shell}) => {
  // index.html's loading shell; mount() appends, so clear it in the same task (no empty frame).
  target.replaceChildren();
  mount(Shell, {target, props: {landing}});
}, e => {
  // Offline, or a redeploy replaced the hashed files this page refers to.
  console.warn('shell:', e);
  const p = document.createElement('div');
  p.className = 'shell';
  p.setAttribute('role', 'alert');
  p.append('Retrace couldn’t load. ');
  const b = document.createElement('button');
  b.textContent = 'Reload';
  b.onclick = () => location.reload();
  p.append(b);
  target.replaceChildren(p);
});
