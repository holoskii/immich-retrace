// Curation for the demo dataset: which Commons uploads, which GPS to remove, which photos become
// clips, which trips become albums, and the offline place table. Everything fetch.ts does to the
// data is decided here, so a rebuild is deterministic. Ranges are UTC ISO, `from` inclusive, `to` exclusive.

export const COMMONS_USER = 'Kent Wang';
/** Uploads from this date on (his 2023+ uploads are CC BY-SA 4.0, 2025+ CC BY 4.0). */
export const UPLOADS_FROM = '2023-01-01T00:00:00Z';
/** Captures before this are dropped (a handful of 2019–2022 shots would stretch the timeline). */
export const CAPTURED_FROM = '2023-01-01T00:00:00Z';
export const LICENSES = {
  'CC BY 4.0': 'https://creativecommons.org/licenses/by/4.0/',
  'CC BY-SA 4.0': 'https://creativecommons.org/licenses/by-sa/4.0/',
} as const;

/** Standard Commons scaler widths: thumbnail and preview copies. Originals are never downloaded. */
export const THUMB_WIDTH = 250;
export const PREVIEW_WIDTH = 1280;

export interface Range {from: string; to: string; why: string}

/** GPS removed from every photo in these ranges (whole trips, plus one leg of an album trip). */
export const STRIP_GPS: Range[] = [
  {from: '2025-02-28T00:00:00Z', to: '2025-03-03T00:00:00Z', why: 'whole trip: Madrid, 1–2 Mar 2025'},
  {from: '2025-06-15T00:00:00Z', to: '2025-06-21T00:00:00Z', why: 'whole trip: Esslingen & Ulm, 16–20 Jun 2025'},
  {from: '2025-05-06T00:00:00Z', to: '2025-05-09T00:00:00Z', why: 'Lyon leg of the May 2025 trip (album with missing GPS)'},
];
/** Plus single shots: a photo loses GPS when hashUnit(title + salt) < rate. */
export const STRIP_SINGLE = {rate: 0.03, salt: '#strip-gps'};

/** Pan/zoom clips: `count` photos with GPS, evenly spaced in time within the range. */
export const CLIPS: (Range & {count: number})[] = [
  {from: '2024-09-06T00:00:00Z', to: '2024-09-11T00:00:00Z', count: 8, why: 'San Sebastián to Huesca trip (album with video)'},
  {from: '2024-08-02T00:00:00Z', to: '2024-08-13T00:00:00Z', count: 2, why: 'Pamplona & Basque Country'},
  {from: '2025-05-14T00:00:00Z', to: '2025-05-26T00:00:00Z', count: 2, why: 'Alsace & Freiburg'},
  {from: '2026-01-04T00:00:00Z', to: '2026-02-01T00:00:00Z', count: 2, why: 'Lisbon & Queluz'},
];
export const CLIP = {seconds: 6, fps: 30, long: 1280, short: 720, offsetSeconds: 5};

/**
 * Shared-album demo: the photos in this range belong to a second user ("friend") in the stub. They
 * are not in the key user's timeline and are reachable only through the shared album below.
 */
export const FRIEND_OWNS: Range = {from: '2024-07-25T00:00:00Z', to: '2024-07-28T00:00:00Z', why: 'Núria & Queralbs, 26–27 Jul 2024'};
export const USERS = {
  me: {id: '00000000-0000-4000-8000-00000000d3e0', name: 'Demo', email: 'demo@example.invalid'},
  friend: {id: '00000000-0000-4000-8000-00000000f1e0', name: 'Alex (demo friend)', email: 'alex@example.invalid'},
} as const;

/** Albums: curated trips, named by place and dates. Owned by the key's user unless `owner` says otherwise. */
export const ALBUMS: {name: string; from: string; to: string; description: string; owner?: 'friend'; shared?: true}[] = [
  {name: 'Pamplona & Basque Country, 2–12 Aug 2024', from: '2024-08-02T00:00:00Z', to: '2024-08-13T00:00:00Z',
    description: 'Pamplona, San Sebastián, Arantzazu and the Aizkorri hike.'},
  {name: 'San Sebastián to Huesca, 6–10 Sep 2024', from: '2024-09-06T00:00:00Z', to: '2024-09-11T00:00:00Z',
    description: 'Road trip from the coast over Leyre and San Juan de la Peña to Huesca. Includes video clips.'},
  {name: 'Sète, Lyon & Dole, 3–9 May 2025', from: '2025-05-02T22:00:00Z', to: '2025-05-10T00:00:00Z',
    description: 'Sète, Le Grau-du-Roi, Lyon and Dole. GPS was removed from the Lyon days for the demo.'},
  {name: 'Alsace & Freiburg, 14–25 May 2025', from: '2025-05-13T22:00:00Z', to: '2025-05-26T00:00:00Z',
    description: 'Ebersmunster, Strasbourg and Freiburg im Breisgau.'},
  {name: 'Lisbon & Queluz, 4–31 Jan 2026', from: '2026-01-04T00:00:00Z', to: '2026-02-01T00:00:00Z',
    description: 'Belém, Santa Engrácia, Fronteira and the Queluz palace.'},
  {name: 'Pyrenees, 14–27 Jul 2024', from: '2024-07-13T22:00:00Z', to: '2024-07-28T00:00:00Z', owner: 'friend', shared: true,
    description: 'Shared by Alex: their Núria & Queralbs photos plus the demo user\'s Sallent de Gállego and Panticosa days.'},
];

/**
 * Offline reverse geocoding: nearest place within `CITY_KM` names the city; the nearest place's
 * country is used within `COUNTRY_KM`. Centroids are approximate; enough for labels.
 */
export const CITY_KM = 20;
export const COUNTRY_KM = 150;
export const PLACES: [city: string, country: string, lat: number, lon: number][] = [
  ['Barcelona', 'Spain', 41.39, 2.165],
  ['Badalona', 'Spain', 41.45, 2.245],
  ['Sant Adrià de Besòs', 'Spain', 41.43, 2.22],
  ['Santa Coloma de Cervelló', 'Spain', 41.365, 2.025],
  ['Sitges', 'Spain', 41.235, 1.81],
  ['Vilanova i la Geltrú', 'Spain', 41.224, 1.725],
  ['Tossa de Mar', 'Spain', 41.72, 2.93],
  ['Queralbs', 'Spain', 42.37, 2.16],
  ['Madrid', 'Spain', 40.417, -3.704],
  ['Pamplona', 'Spain', 42.817, -1.644],
  ['San Sebastián', 'Spain', 43.318, -1.981],
  ['Zumaia', 'Spain', 43.297, -2.257],
  ['Oñati', 'Spain', 42.99, -2.41],
  ['Yesa', 'Spain', 42.66, -1.18],
  ['Santa Cruz de la Serós', 'Spain', 42.52, -0.67],
  ['Huesca', 'Spain', 42.14, -0.408],
  ['Sallent de Gállego', 'Spain', 42.77, -0.33],
  ['Lisbon', 'Portugal', 38.722, -9.139],
  ['Queluz', 'Portugal', 38.756, -9.255],
  ['Sintra', 'Portugal', 38.80, -9.38],
  ['Rome', 'Italy', 41.9, 12.49],
  ['Bergamo', 'Italy', 45.70, 9.66],
  ['Sète', 'France', 43.40, 3.69],
  ['Le Grau-du-Roi', 'France', 43.535, 4.14],
  ['Lyon', 'France', 45.76, 4.835],
  ['Dole', 'France', 47.092, 5.49],
  ['Ebersmunster', 'France', 48.31, 7.53],
  ['Strasbourg', 'France', 48.583, 7.75],
  ['Freiburg im Breisgau', 'Germany', 47.995, 7.85],
  ['Esslingen am Neckar', 'Germany', 48.74, 9.31],
  ['Ulm', 'Germany', 48.40, 9.99],
  ['Zürich', 'Switzerland', 47.37, 8.54],
  ['Teufen', 'Switzerland', 47.39, 9.39],
  ['Engelberg', 'Switzerland', 46.82, 8.41],
  ['Kandersteg', 'Switzerland', 46.49, 7.67],
  ['Val-de-Travers', 'Switzerland', 46.95, 6.72],
  ['Neuchâtel', 'Switzerland', 46.99, 6.93],
  ['Fribourg', 'Switzerland', 46.806, 7.16],
  ['Schwyz', 'Switzerland', 47.02, 8.65],
];
