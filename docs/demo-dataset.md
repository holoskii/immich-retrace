# Public demo dataset

Research of 2026-10-13. The goal is a dataset for the hosted demo stub, which serves the same endpoints as Immich and never touches the owner's library. Numbers come from small live samples against the Wikimedia Commons API (about 12 requests in total). Flickr and Mapillary need keys and were not sampled.

## Measured samples (per file, from EXIF `imageinfo.metadata`)

| Sample | Files | EXIF GPS | DateTimeOriginal | License |
|---|---|---|---|---|
| Commons `Kent Wang`, 4 slices of uploads | 800 | 783 (98%) | 795 (99%) | 435 CC BY 4.0, 360 CC BY-SA 4.0 |
| ... CC BY 4.0 subset only | 435 | 432 (99%) | 435 | captured 2024-05 to 2026-08 |
| Commons `Poco a poco` (Diego Delso) | 100 | 0 (1 template coord) | 100% | CC BY-SA 4.0 |
| Commons `Aniol` | 200 | 74 (37%) | 100% | CC0, only 2026 |
| Commons geosearch around Lisbon and Barcelona | ~1000 | (geotagged by definition) | n/a | 58% BY-SA; CC BY mostly Flickr/Panoramio imports, scattered across many authors |

Kent Wang has 1,750 uploads in total (1,749 JPEG and 1 WebM). They are iPhone 13/15/17 shots. In the samples, about 74 distinct capture days fall in Lisbon, Barcelona, the Basque Country, Catalonia, Switzerland, Alsace and southern France. The files keep `GPSDateStamp`/`GPSTimeStamp` but not `OffsetTimeOriginal`, so the UTC offset can be computed as DateTimeOriginal minus GPS UTC. His license changed over time: 2023 to 2024 uploads are CC BY-SA 4.0 and 2025 onward are CC BY 4.0, so filter per file.

Openverse (no key) indexes CC Flickr but exposes no geo or date fields, so it only helps find authors.

## Comparison

| Source | Realistic size | GPS coverage | Timestamps | Videos | License / attribution burden | Effort | Risks |
|---|---|---|---|---|---|---|---|
| **Commons, single author (Kent Wang)** | ~950 CC BY 4.0 (~1,700 if BY-SA is accepted) | 98–99% EXIF GPS, phone-accurate, so routes look real | DateTimeOriginal 99%; UTC from GPS stamp | 1 | CC BY 4.0: credit per file plus a link to the file page; low burden because the author and license are uniform | Low: no key, 4 list calls plus ~35 metadata calls of 50 files each, thumbs from the Commons scaler | Only ~2.3 years in BY; Europe-only; heavy same-site clusters (200 at one site); the author could delete files or relicense new ones (existing grants stay valid) |
| Commons, geotagged categories / many authors | thousands | high, but much of it is "object location" from templates, not camera position | uneven; Flickr imports often lack EXIF | rare | mixed licenses, per-file credit to many authors | Medium | Does not look like one person's library, so routes between different authors are meaningless |
| Commons, Poco a poco style pro sets | 10k+ | **0% EXIF GPS** | exact | none | BY-SA (share-alike) | High (geocode titles) | GPS would be synthetic |
| Flickr CC photostream (`photos.search license=4,9,10 has_geo=1 extras=date_taken,geo,license`) | potentially 1k–10k per prolific author | unknown; geo is often set by map pin, not EXIF | `date_taken` can fall back to upload date (check `datetakenunknown`) | yes, some | CC BY 2.0 typical; per-photo credit and a link | Medium: **API key needed** (non-commercial key via Flickr App Garden) | Not measured here; Flickr ToS on API use and caching; authors relicense often |
| Mapillary / KartaView | unlimited | 100%, dense sequences | exact | no | CC BY-SA 4.0; Mapillary **needs a token** | Medium | Not photos: dashcam frames make a poor demo of a photo library |
| Synthetic (GPX/OSM route + CC0 images) | any | whatever you assign | assigned | can be generated | CC0 images (Commons CC0, Pexels/Unsplash are **not** CC0, and their licenses bar building a similar service or redistributing as a collection); OSM routes are ODbL, which needs attribution | Medium–High | Looks fake: image content does not match the location |

## Recommendation

Use **Wikimedia Commons uploads by Kent Wang, CC BY 4.0 files only**, about 900–950 photos captured 2024 to 2026. It is the only source checked that looks like a real personal library: one phone, one person, real EXIF GPS and times, trips spread over multiple years, and dense on-site clusters for the cluster zoom. CC BY 4.0 permits hosting and redistributing resized derivatives.

If more years matter more than avoiding share-alike, also include his 2023–2024 CC BY-SA 4.0 files and mark them in the credits. SA only requires that our resized copies stay BY-SA. It does not affect the viewer code.

### Acquisition plan

1. Enumerate with `list=allimages&aiuser=Kent Wang&ailimit=500`. Then use `generator=allimages ... prop=imageinfo&iiprop=metadata|extmetadata|mediatype|url|size` in batches of 50. Run serially at 1 request/second with a descriptive User-Agent (Wikimedia API etiquette).
2. Keep files where `LicenseShortName == "CC BY 4.0"` and `DateTimeOriginal` exists. Store per file: title, page URL, Artist, license URL, lat/lon, DateTimeOriginal, and the UTC offset derived from the GPS stamp.
3. Fetch derivatives via `iiurlwidth` at standard buckets: about 250 px for thumbnails and about 1280 px for previews. Do not mirror originals. Compute thumbhash locally. That is roughly 1,000 × ~350 KB, or about 350 MB.
4. Make the stub fixtures emit `/timeline/buckets` and `/timeline/bucket` columnar data: city derived offline from coordinates, `localOffsetHours`, `isImage`, and `duration`.
5. **No-GPS gaps**: the ~1–2% natural gaps are too few. Strip GPS from one or two whole trips (for example a 2024-09 trip) and from scattered single shots, so the timeline shows grey runs and the routes break.
6. **Videos**: the dataset has one video. Generate 10–20 short clips (5–10 s, ffmpeg zoompan "Ken Burns" over selected photos, H.264 at 720p). Give them those photos' time and GPS plus a few seconds. Under CC BY 4.0 this is an adaptation, so mark "modified". As an alternative, take a handful of geotagged CC BY/CC0 Commons videos from the same cities, accepting different authors.
7. Freeze the dataset. Keep the manifest (titles plus revision timestamps) in the repo so the demo is reproducible and no rights depend on live Commons state.

### Attribution UI requirements (CC BY 4.0 §3)

- In the lightbox info panel, per asset: "Photo: Kent Wang, CC BY 4.0 (link), via Wikimedia Commons (file page link)", plus "Resized; GPS removed" or "Video derived from photo" wherever that applies.
- A global footer or credits page with the author, the license, a link to the full manifest, and the no-warranty disclaimer.
- A demo banner that says the data is public CC content and some metadata was altered for the demo.

### Open risks

The dataset covers Europe only, so the world map stays zoomed in. If wider coverage is needed, add a Flickr CC BY travel photostream later; that needs a Flickr API key (not tested). Kent Wang's subjects are mostly architecture and interiors, which is fine for a viewer demo. Re-check per-file licenses once, at freeze time.
