# Asset sources: design

> Status: design, not built. Roadmap: the "Assets ·" group in `status/systems.json`. Decision: D90.

Scenes often need material ae-compose can't draw: icons, photos, stock video, textures, HDRIs, 3D models, fonts, sound effects. Today the agent samples the user's local folders or the user sources files by hand. This adds two tools, `find_assets` and `fetch_asset`, that search free asset APIs, download the chosen file into the project and record its credit.

## 1. Free APIs, not a hosted library

We considered hosting a tagged library ourselves (Cloudflare R2: 10 GB free, no egress fees) and chose to query free APIs instead.

- **Licenses.** "Royalty-free" usually means free to *use*, not free to *re-host*. Unsplash excludes compiling its photos into a competing service, Pexels forbids replicating its core functionality, Pixabay forbids systematic mass downloads. A hosted library would need every item cleared by hand.
- **The work is already done.** The APIs have search, tags, license data per item and size variants. Hosting would mean rebuilding that and keeping it current.
- **Hosting stays open for our own material.** Paper scans, rendered device mockups and similar assets we make ourselves can go to R2 later through the same adapter interface (§4). Not in this build.

## 2. Sources

Checked 2026-11-05 against each API's docs, and by calling the keyless ones.

| Kind | Source | Key | License | Terms that matter |
|---|---|---|---|---|
| Icons, logos, emoji | [Iconify API](https://iconify.design/docs/api/) | none | per set; `/collections` returns SPDX (Material Symbols Apache-2.0, Lucide ISC, Phosphor MIT, Simple Icons CC0) | Public API limits abuse (no numbers given); self-hosting is the answer for heavy use. Brand logos carry trademarks whatever the license. |
| Textures, HDRIs, 3D models | [Poly Haven API](https://polyhaven.com/our-api) | none | CC0 | Free for any use, commercial included. Requests need a unique User-Agent. A product using the live API must show the assets come from Poly Haven. |
| Textures, materials, decals | [ambientCG API](https://docs.ambientcg.com/api/) v2 | none | CC0 | One-person site; the docs warn it isn't enterprise-stable, so cache. |
| Photos, video | [Pexels API](https://www.pexels.com/api/documentation/) | free | Pexels license | 200 requests/hour, 20,000/month. Link to Pexels and credit the photographer where possible. |
| Photos, video | [Pixabay API](https://pixabay.com/api/docs/) | free | Pixabay content license | 100 requests/60 s. Cache responses 24 h. Download files rather than hotlink; no systematic mass downloads. |
| Photos, audio (Creative Commons) | [Openverse API](https://api.openverse.org/v1/) | optional | mixed CC, per item | Anonymous: 20/min, 200/day (from response headers); registered clients get more. Filter with `license_type=commercial`. |
| Fonts | [Fontsource API](https://fontsource.org/docs/api/introduction) | none | per family (`license: "OFL-1.1"`) | Fair-use limit. TTFs are per subset (`latin-400-normal.ttf`) on jsDelivr. |

Left out for now:
- **Unsplash**: its guidelines want hotlinked images, "non-automated" use and keys that never ship in a distributed app (a signing proxy). Pexels and Pixabay cover photos.
- **Freesound**: downloading originals needs OAuth2 per user; a plain key gets previews only.
- **Lottie sources**: vanilla AE can't import Lottie.

## 3. Tools

**`find_assets`** `{ query, kind?, orientation?, minWidth?, minDuration?, license?: 'cc0' | 'commercial', sources?, limit? }`

- Searches the configured local folders first (the user's standing rule: quick sampling of `E:\Projects` and `\\goblin\depot`, not full scans), then the APIs for that kind in parallel.
- Returns normalized hits (§4) as text, plus one numbered thumbnail grid image so the agent picks by looking, as it does with contact sheets.

**`fetch_asset`** `{ id, variant?, import?: boolean, folder? }`

- Downloads the chosen variant into the cache (`~/.ae-compose/assets/<source>/<id>/`), then copies it into the footage folder next to the saved project so Collect Files keeps it, and imports it through the existing `import_footage` path unless `import: false`.
- Icons come back as an `.svg` path for `<Svg src>`, which turns them into native shape layers. Fonts go through the install step (§6).
- Appends the credit line to `CREDITS.md` next to the project. `deliver` copies it next to the renders.

**In scenes**, `src="asset:pexels:12345"` (or `asset:iconify:lucide:rocket`) resolves at compile time, synchronously like `beatsOf`, from the cache or by downloading. Scenes then name their assets reproducibly instead of holding local paths.

## 4. Adapters and records

Each source is one adapter: `search(query) → AssetHit[]` and `download(hit, variant) → file`. Local folders and a future R2 library are adapters too.

```ts
interface AssetHit {
  id: string;                 // "pexels:12345", "iconify:lucide:rocket", "local:<hash>"
  source: string;
  kind: 'icon' | 'photo' | 'video' | 'texture' | 'hdri' | 'model' | 'font' | 'audio';
  title: string;
  tags: string[];
  preview: string;            // thumbnail URL or local path
  width?: number; height?: number; duration?: number;
  license: { id: string; url: string; commercial: boolean; attribution: boolean; shareAlike?: boolean; trademark?: boolean };
  credit: string;             // the line written to CREDITS.md
  page: string;               // the asset's own page
  variants: { label: string; url: string; format: string; width?: number; bytes?: number }[];
}
```

## 5. Rules

- **Keys** come from environment variables or `~/.ae-compose/keys.json`, never the repo or scene files. A source without a key is skipped, and `find_assets` says how to get one; `doctor` lists which sources are on.
- **License allowlist** by default: CC0, public domain, MIT, ISC, Apache-2.0, OFL, CC BY, and the Pexels and Pixabay licenses. NonCommercial and NoDerivatives are excluded; ShareAlike and trademarked logos are flagged in the hit.
- **Caching**: API responses for 24 h (Pixabay requires it), downloads indefinitely by content hash.
- **Politeness**: a `ae-compose/<version>` User-Agent on every request (Poly Haven requires a unique one), back off on 429, no bulk prefetching.
- **AE formats**: prefer what vanilla AE imports natively. JPG/PNG/TIFF/EXR/HDR stills, H.264/HEVC MP4 and ProRes MOV video, glb/gltf models, WAV/MP3/AAC audio. SVG goes through `<Svg>`.

## 6. Open questions

- **Fonts.** AE only sees installed fonts. A per-user install on Windows (`%LOCALAPPDATA%\Microsoft\Windows\Fonts` plus an HKCU registry value) needs no admin rights. Probe whether AE 26.5 picks a new font up without a restart, and ask the user before the first install. Fontsource's TTFs are subset files; full-coverage files come from the google/fonts repository.
- **Thumbnail grid size** for `find_assets` (how many hits are worth one image).
- **Openverse**: register a client for the higher limits, or stay anonymous with 200 requests/day.

## 7. Build order

1. Core: `AssetHit`, adapter interface, cache, keys, license allowlist, `CREDITS.md`. Keyless adapters first: Iconify, Poly Haven, ambientCG, local folders.
2. `find_assets` (with the thumbnail grid) and `fetch_asset` (download, copy into the project, import), plus `doctor` lines.
3. Pexels, Pixabay and Openverse adapters.
4. Fonts through Fontsource, after the AE font probe.
5. The `asset:` src scheme in the DSL, the skill section, unit tests with recorded API responses, one AE integration test (fetch, import, collect).

Later: Freesound with OAuth, and an R2 adapter for assets we make ourselves.
