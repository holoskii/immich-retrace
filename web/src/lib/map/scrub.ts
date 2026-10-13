// When the time strip last moved the cursor itself (drag, arrow keys). The follow camera flies
// along with a scrub; any other cursor jump (pin click, URL, overview hover) is a seek and snaps.
export const scrub = {at: -Infinity};
export const markScrub = () => { scrub.at = performance.now(); };
export const isScrub = () => performance.now() - scrub.at < 150;
