# GOAL (Phase 6): asset sources

> **How to run this:** open Claude Code in `E:\Projects\ae-mcp` with After Effects 2026 running, and say: *"Read GOAL-PHASE6.md and execute it end to end."*

## 0. Why

Phases 0–5 are done (v0.01.001): the compiler, bridge, edits, lint, renders, the creative toolkit and 18 showcases. What scenes still lack is material ae-compose can't draw. Icons, stock photos and video, textures, HDRIs, 3D models, fonts and sound get sourced by hand every time a prompt needs them.

This phase adds `find_assets` and `fetch_asset`. They search free asset APIs (plus my local folders), download the chosen file into the project and credit it, so the agent can source material itself.

The design is in **`docs/ASSETS.md`**. Read it first: it is the spec for this phase. Decision D90 explains why we use free APIs instead of hosting a library. The roadmap is the "Assets ·" group in `status/systems.json` (7 tasks, phase 6).

## 1. Read first (resume rules)

1. `docs/AGENT_GUIDE.md` (session start, AE safety rules, release flow), then `docs/PROGRESS.md`, `docs/DECISIONS.md` (D1–D90) and `docs/ASSETS.md`.
2. `skills/ae-compose/SKILL.md`. Fetched assets must serve the direction rules in §2. An icon or a stock clip earns its place like any other element.
3. Resume from `docs/PROGRESS.md`. Never start over. Keep it current as you go.

## 2. Operating rules (carry over, non-negotiable)

- **Vanilla AE only**, verified in the installed AE, with contact sheets for every build. Work autonomously. Record decisions in `docs/DECISIONS.md` (continue from D91) and add newly discovered tasks to the roadmap. Use parallel subagents for independent work and an independent reviewer before calling the phase done. Release often with `node scripts/release.mjs "short description"`.
- **AE safety** as in the guide: one eval and one undo group per mutating call, probe unknown APIs one feature per eval, never force-kill or restart AE without asking me, never modify my original projects.
- **Licenses:**
  - Fetch only what the ASSETS §5 allowlist permits. Never fetch NonCommercial or NoDerivatives items. Flag ShareAlike items and trademarked logos in every result.
  - Every fetched file gets a credit line in the project's `CREDITS.md`.
- **API terms:**
  - Follow each API's terms (ASSETS §2): an `ae-compose/<version>` User-Agent, rate limits with back-off on 429, a 24 h response cache (Pixabay requires it), credits where a source asks for them.
  - No bulk downloads or catalog prefetching.
  - Unsplash and Freesound originals are out of scope.
- **Keys:**
  - I create the Pexels and Pixabay accounts (and an optional Openverse client) and put their keys in `~/.ae-compose/keys.json`. Don't create accounts yourself.
  - Keys never go in the repo, scene files, logs or tool output.
  - Until I add the keys, build and test those adapters against recorded responses, and tell me when you need the keys.
- **Downloads are untrusted data:**
  - Check file types by their contents, not their extension.
  - Cap file sizes.
  - Never execute anything downloaded. SVGs are parsed for geometry only, and external references in them are ignored.
  - Formats vanilla AE can't import (OGG, FLAC, WebP, AVIF) are converted with ffmpeg or sharp first.
- **Disk:**
  - The download cache lives in `~/.ae-compose/assets/` with a size cap (default 5 GB, `AEC_ASSET_CACHE_GB`). The cap evicts least-recently-used files inside that folder only.
  - `doctor` reports the cache's size.
  - Tell me before deleting anything else.
- **Collected projects:**
  - Fetched files are copied into the footage folder next to the saved `.aep`, so Collect Files keeps them.
  - If the project isn't saved yet, import from the cache and say so in the tool result.
- **My machine:** installing a font changes my system. Ask me before the first install, and report each install afterwards.
- **Tests never hit the network.** Unit tests use recorded responses in `tests/fixtures/assets/`. A separate opt-in live check (`pnpm test:live`) calls each API once.

## 3. Scope and order (ASSETS §7)

1. **Verifications first.** Log each result as a decision.
   - Call each keyless API once and confirm the response shape the adapters will parse: Iconify search, collections and SVG; Poly Haven assets and files; ambientCG v2; Fontsource.
   - Import one file of every kind into a throwaway AE project and confirm it works: an icon through `<Svg>`, a JPG and a PNG, an H.264 MP4, an HDR or EXR HDRI, a Poly Haven glTF model (a `.gltf` with its `.bin` and textures, downloaded together), an MP3.
   - With my OK, install one Fontsource font per-user and check whether AE 26.5 sees it without a restart.
2. **Core:** the `AssetHit` record, the adapter interface, the cache, keys, the license allowlist and `CREDITS.md`. Then the keyless adapters:
   - Iconify
   - Poly Haven
   - ambientCG
   - My local folders (`E:\Projects`, `\\goblin\depot\{3D,Evan,Work}`): a small cached index of names, types and sizes, sampled quickly, never a full scan per query.
3. **Tools:**
   - `find_assets`: text results plus one numbered thumbnail grid, built with the contact-sheet code.
   - `fetch_asset`: download, convert if needed, copy into the project, import through the `import_footage` path, write the credit.
   - `doctor` lines for each source (on or off, and why) and for the cache.
4. **Key-based adapters:** Pexels and Pixabay (photos and video), Openverse (Creative Commons photos and audio).
5. **Fonts** through Fontsource, following what the font probe in step 1 found.
6. **`asset:` sources in scenes:** `src="asset:pexels:12345"` and `src="asset:iconify:lucide:rocket"` resolve at compile time, synchronously like `beatsOf`, from the cache or by downloading. `deliver` copies `CREDITS.md` next to the renders.

## 4. Showcase (new, original, professional)

**19:** a 20–30 s launch teaser for a fictional product, built mainly from fetched assets:
- Icons as native shapes with draw-on reveals.
- A stock video backdrop.
- A Poly Haven HDRI lighting a 3D model.
- An ambientCG paper texture on a torn-paper transition, built from vanilla effects.
- A Fontsource font.

Review it from contact sheets and motion previews, keep it lint and style-lint clean, and make sure `CREDITS.md` lists every asset with its license.

## 5. Testing (every tool)

- **Unit tests:**
  - every adapter's parsing on recorded responses;
  - license filtering;
  - credit lines;
  - cache eviction;
  - `asset:` resolution;
  - type checks on downloads.
- **AE integration test** (`tests/integration/p6/assets.ts`):
  - fetch one asset of each kind;
  - import it;
  - build a scene that uses it;
  - one undo restores the comp exactly;
  - Collect Files keeps every fetched file.
- **Earlier suites stay green.**
- **A fresh session** using only the skill and MCP gets a brief that needs material the repo doesn't have. It finds, fetches and credits that material, then builds and reviews the piece unaided.

## 6. Definition of done

1. Every source in ASSETS §2 works through `find_assets` and `fetch_asset`. The key-based ones are verified with my keys, or listed as waiting on them.
2. The license allowlist, credits, cache cap and `doctor` lines are in place, and the `asset:` scheme works in scenes.
3. Fonts install and are used, or the font probe's outcome is documented with the fallback that was built.
4. Showcase 19 done.
5. The tools are documented in `docs/DSL.md`, the skill (a new section on finding and crediting assets) and the README.
6. Tests are green and the fresh-session test passed. REPORT.md has a Phase 6 section covering what was built, its limits and the next improvements, ranked.

The "Assets ·" roadmap group is at 100 % on the dashboard.
