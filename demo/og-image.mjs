// Makes web/public/og.jpg, the demo's link preview (server/demo.ts OG_IMAGE): the real demo landing's map (the
// trip's route, the position marker, the photo card), cropped and captioned at 1200×630, under 200 kB.
// Needs a demo viewer running (BASE, default http://localhost:8092) and the e2e browsers (e2e/setup.sh):
//   node demo/og-image.mjs
// The card's photo must stay OG_ASSET_TITLE (credited in the preview's description and in the image).
import {fileURLToPath} from 'node:url';

// Read when Playwright loads: set before importing it.
process.env.PLAYWRIGHT_BROWSERS_PATH ??= fileURLToPath(new URL('../e2e/.browsers', import.meta.url));
const {chromium} = await import('../e2e/node_modules/playwright/index.mjs');
const BASE = process.env.BASE ?? 'http://localhost:8092';
const OUT = fileURLToPath(new URL('../web/public/og.jpg', import.meta.url));

const browser = await chromium.launch();
const page = await browser.newPage({viewport: {width: 960, height: 1000}, deviceScaleFactor: 1.25});
await page.addInitScript(() => localStorage.setItem('immich-retrace.demo.tour-seen', '1'));
await page.goto(BASE + '/');
await page.locator('.marker .card img').first().waitFor({timeout: 20000});
await page.waitForTimeout(7000); // tiles
await page.addStyleTag({content: '.maplibregl-ctrl-top-right, .modes, .maplibregl-ctrl-bottom-right { display: none !important }'});
await page.waitForTimeout(300);
const map = await page.screenshot({clip: await page.locator('.mapwrap').boundingBox()});
const c = await browser.newPage({viewport: {width: 1200, height: 630}});
await c.setContent(`<body style="margin:0;background:#101215">
<div style="position:relative;width:1200px;height:630px;overflow:hidden;background:url(data:image/png;base64,${map.toString('base64')}) center top / 1200px auto no-repeat">
 <div style="position:absolute;right:0;top:0;width:640px;height:300px;background:radial-gradient(ellipse at 85% 25%,rgba(16,18,21,.95) 30%,transparent 70%)"></div>
 <div style="position:absolute;right:44px;top:44px;text-align:right;font-family:system-ui,sans-serif;color:#E9E6DF">
  <div style="font:600 50px system-ui,sans-serif;letter-spacing:-.01em">Retrace <span style="color:#E8A64E">for Immich</span></div>
  <div style="font:400 23px/1.35 system-ui,sans-serif;color:#B5B9C0;margin-top:8px">Your trips, retraced from<br>where your photos were taken.<br><span style="color:#E9E6DF">No tracker, nothing but Immich.</span></div>
 </div>
 <div style="position:absolute;right:10px;bottom:6px;font:400 12px system-ui,sans-serif;color:#8A9099">© OpenStreetMap contributors · OpenMapTiles · OpenFreeMap · Photo: Kent Wang via Wikimedia Commons, CC BY-SA 4.0</div>
</div></body>`);
await c.screenshot({path: OUT, type: 'jpeg', quality: 82});
await browser.close();
console.log('wrote', OUT);
