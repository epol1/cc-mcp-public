# Progress

> On resume: read `GOAL.md`, then this file, then `docs/DECISIONS.md` and `docs/AGENT_GUIDE.md`. Continue from **Next**. Never start over.
> Roadmap and dashboard: `status/systems.json` → `status/index.html` (`node status/build.mjs`). Release: `node scripts/release.mjs "msg"`.

> Repo: **cc-mcp** (`epol1/cc-mcp`, D131); `pnpm run setup` installs ae-compose and pr-cut together.

## Current phase
**Phase 7, pr-cut (editing in Premiere Pro): in progress.** Design and reference: `docs/PRCUT.md`; verified Premiere behaviour: `docs/research/premiere/spike.md`; skill: `skills/pr-cut/SKILL.md`; decisions D105–D121; roadmap: the "Pr ·" groups (phase 7) in `status/systems.json`. The run prompt was the user's `/goal` (a short brief; `GOAL-PREMIERE.md` is the longer spec it grew from).

### Phase 7 so far
- **Shared core** (`packages/core`, workspace package `@cc-mcp/core`): bridge contract + token HTTP client + window/dialog watchdog for both apps (`appwin.ps1 -App ae|pr`), contact sheets, captions, beats, motion/pacing analysis, lint report, reframe targets, template params, units, **assets** (moved from `src/assets` after Phase 6), plus new: timecode/ticks, transcription, media library, ffprobe facts. ae-compose stays in `src/`. Unit suite green after the move; **AE integration suites pass** (`pnpm test:ae`: 4 files, 12 tests, 13.5 min, 2026-11-05).
- **Spike** (Premiere 26.5.2, one feature per probe, throwaway projects): CEP + ExtendScript works (background extension, no setup); FCP7 XML import is frame exact and **one Ctrl+Z**; QE gives undo stack, frame export, Lumetri, transitions, razor; `clone`, `autoReframeSequence`, `createCaptionTrack`, `importMGT`, `exportAsMediaDirect` all scriptable; property writes aren't undoable; no transcript access from ExtendScript. Premiere also ships its own agent skills (getSequenceStructure, createTranscript…) used by its built-in Assistant, not reachable from scripts.
- **pr-cut** (`packages/pr-cut`): JSON edit plan → compiler (words/sentences/quotes/time; tightening of fillers, repeats and pauses at word gaps; punch-ins over jump cuts; J/L; B-roll; music ducked on words and backtimed; montages on bars/beats; titles; captions; grades) → FCP7 writer in Premiere's dialect → import; contact sheets and cut strips from Premiere frames; edit lint; `apply_cut_edits` on any sequence by adopting Premiere's own XML (filters and graphics carried) into a new version; `tighten` dry run; undo journal; `audio_finish` (−14 LUFS / −1 dBTP measured via Amplify + Hard Limiter); `deliver` (master + Auto Reframe 9:16 / 1:1 / 4:5); `match_shots`; media library (SQLite FTS5, worker, shots, agent-written descriptions, served Whisper); 26 MCP tools; `prc` CLI; UXP plugin written (long-polls the CEP hub).
- **Verified in Premiere** (`pnpm test:pr`, throwaway project): XML round trip at 23.976/24/25/29.97/30/59.94 with 0-frame error; build (quotes, tightening, B-roll, dissolve, markers, captions; undo in 3 steps); edits on a hand cut (delete/trim/move/grade; grade and title carried; original untouched; one undo); finishing (loudness within ±1 LU and ≤ −1 dBTP; deliveries at 1920×1080, 1080×1920, 1080×1080 with matching lengths).
- **Fresh-session test passed** (10 min, unaided): a 45 s testimonial from a 3-minute scripted interview with B-roll it described itself, music and captions; it recovered from a bad edit with `undo`. Its findings were fixed (D120).
- **Independent review**: 16 findings; all fixed with regression specs (D120).
- **`match_shots` in Premiere**: a deliberately mis-graded copy of a shot matched back to the reference (frame difference 85 → 17), as a new version; reference and original untouched (`tests/premiere/match.ts`).
- **ae-compose `export_mogrt` → Premiere titles** (D122, D123): AE check `tests/integration/mogrt/mogrt.ts` 14/14 (refuses unsaved or modified projects without AE's modal prompt, `save: true` saves in place, fields reported, AE's font warning answered, undo reports the history the export cleared); Premiere check `tests/premiere/mogrt.ts` 13/13 (fields filled by name, title on V3 over an untouched V1, the frame shows both; a title edit op lands on V4 of a new version). Found and fixed on the way: `importMGT` on a missing track lands on V1 over the picture, so title tracks are now created by the XML import.
- **Karaoke captions** (D125): `<Captions template>` in ae-compose → `export_mogrt` → pr-cut `captions: { mogrt }` places one per caption with its text and word times; checked in AE (6 checks) and Premiere (6 checks, incl. rebuilt after an edit).
- **Undo journaling with several projects open** (D130): QE kept following a closed same-named test project, so builds weren't journaled; fixed by a Premiere restart (user OK'd), `tests/premiere/build.ts` passes again, and imports now warn when the undo index doesn't move.
- **Real footage, the user's own sequences** (on copies; originals byte-identical):
  - *Hand cut* (`QiaoBio.prproj`, copied to `scratch/pr/qiao/`): a slides + keyed-presenter-cutout + separate-audio layout (D126). `apply_cut_edits` `tighten` → "Bio Research Assignment - Edit v002": 24 trims (fillers incl. a 2.4 s "uh", pauses, a repeat), 565.4 → 548.2 s, cutout keeps its alpha and corner position (D127), slides re-timed; the original sequence unchanged; `undo` removed the version in one call.
  - *Long-form → 2 min*: the first 30 min of a 64-min Keith and the Girl live show ((raw footage, not included), read-only) → "KATG Live - Roommates (2-min cut)", 2:08, 9 segments / 14 pieces (pizza-murder theme → One-Eyed Davis and the force → Tracy's co-op board → the mice that jumped), laughs kept (comedy pacing), an ae-compose lower third and karaoke caption templates (lifted clear of the title, D128). In `scratch/pr/katg/KATG highlight (pr-cut).prproj`. Reviewed from the contact sheet, all 13 cut strips and full frames. **Waiting for the user's verdict** ("a cut I'd keep").
  - Found and fixed on the way: D126–D129.
- **The user's notes on the KATG cut** ("cuts that stay on the same camera look jarring"): camera-aware cutting for switched programs (D132); KATG v002 (2:13) has no cut that stays on one camera (5 cutaways from other cameras, 3 pauses kept). Undo after a cleared history (D133); frame exports in batches, AE needed for AE templates in frame exports (D134).
- **Fresh-session test re-run on the final skill doc: passed** (22 turns, 3.5 min, unaided; "Loop testimonial – Dana v002", 42.4 s, checked in Premiere).
- **AE titles through edits** (D124): an edit used to reset AE-made titles to their defaults (Premiere's XML drops their fields); they are now re-placed from their project item with their values (checked: the carried title keeps "Ana Ruiz").

**Next:** (1) the user's verdict on the KATG cut and the Qiao v002 (revise from their notes); deliver the KATG cut in 16:9 / 9:16 / 1:1 once approved (caption templates in 9:16 need a vertical template); (2) UXP plugin + Premiere's own transcripts once Developer Mode is on; (3) diarization, sync groups, library as ae-compose's local asset source; (4) REPORT Phase 7; carry an AE title's own Motion/Opacity changes through edits.

## Phase 6 (complete)
**Phase 6, asset sources: complete** (spec `docs/ASSETS.md`, goal `GOAL-PHASE6.md`, roadmap: the "Assets ·" group in `status/systems.json` at 100 %, decisions D91–D104, REPORT "Phase 6"). Releases v0.01.002 (core, adapters, tools), v0.01.003 (showcase 19, AE check, review fixes) and the phase release.

### Phase 6 so far
- **Verified first** (D91–D93, D102): every keyless API's response shape (recorded in `tests/fixtures/assets/`); AE 26.5 imports JPG, PNG, H.264 MP4, HDR, EXR, a Poly Haven glTF and MP3 (an SVG only as a 1×1 still, so icons go through `<Svg>`); a per-user font is seen by the running AE once loaded into the session (`AddFontResource`, D102; the first probe missed that); Fontsource statics of variable families are misnamed, so fonts come from google/fonts.
- **Core** (`src/assets/`): `AssetHit` + adapter interface, polite HTTP (UA, 24 h response cache, per-source budgets, one 429 back-off, keys redacted), keys from env or `~/.ae-compose/keys.json`, license allowlist with ShareAlike/trademark flags, `CREDITS.md`, 5 GB LRU download cache, content sniffing, conversions, ZIP reader, glTF → GLB packer, `asset:` resolver.
- **Adapters** (three subagents): Iconify, Poly Haven, ambientCG, Fontsource, local folders (sampled index, D96), Pixabay (live key), Unsplash (live key, added at the user's request, D95), Pexels (no key available: Pexels isn't issuing keys; built on documented responses), Openverse (anonymous).
- **Tools**: `find_assets` (text + numbered 4×4 thumbnail grid, D97), `fetch_asset` (download → footage folder next to the project → one-undo import → credit; fonts with `install: true`), `doctor` lines per source and for the cache, `aec assets find|fetch|index`, `deliver` copies `CREDITS.md` next to the renders, `pnpm test:live`.
- **`asset:` sources** in `<Footage>`, `<Audio>`, `<Model>`, `<Light hdri>`, `<Svg>` (D101); `<Svg>` handles `currentColor` and outline icons (D92).
- **Tests**: 95 unit tests on fixtures (core, keyless, keyed, local, zip/glb, fetch pipeline, review fixes); `pnpm test:live` 7/7 live (Pexels skipped: no key). AE check `tests/integration/p6/assets.ts` **37/37**: every kind fetched, imported and credited; a fetch import is one undo step; the `asset:` scene builds clean and one undo restores it exactly; AE's own Collect Files keeps every fetched file and the collected project relinks inside the collection. Getting there: the first Collect run crashed AE (D99, user restarted it), the second exposed slow UI Automation on file dialogs (D103), a later run hung AE while reopening the dev project (user OK'd a forced restart).
- **Showcase 19** (`examples/19-launch-teaser`, "Morrow 35"): built in its own project `scratch/p6-showcase/MorrowTeaser.aep`; lint and style lint clean; `CREDITS.md` complete (10 assets incl. the font via `asset()`).
- **Independent review**: 15 findings, all fixed with tests (D104).
- **Coordination**: the user's pr-cut (Premiere) session was restructuring this checkout at the same time; the user chose to pause it: its work is on branch `pr-cut` in `E:\Projects\ae-mcp-prcut` and it rebases after the Phase 6 release (message it the version). `GOAL-PHASE6.md` went missing from the tree meanwhile and was restored byte for byte.
- **Font**: Space Grotesk (variable) installed per-user with the user's OK (D100, D102).

- **Fresh-session test passed** (12.7 min, unaided): EmberTeaser_v001 from a Pixabay clip, Tabler icons and an ambientCG texture, all credited (REPORT).
- **Regression**: round-trip (652 properties), edit ops 26/26, p5 foundations 24/24, showcase 02 unchanged.

**Phase 6 is complete.** **Next:** the ranked list in REPORT.md (Phase 6 "Next improvements": `recover_ae` recognising Crash Repair, a Pexels live check when keys open, local thumbnails, an R2 adapter, Freesound OAuth). The pr-cut session rebases its core extraction onto this release and moves `src/assets` into `packages/core`.

## Phase 5 (complete)
**Phase 5, the creative toolkit: complete** (spec `docs/TOOLKIT.md`, goal `GOAL-PHASE5.md`, roadmap: the "P5 ·" groups in `status/systems.json`).

### Phase 5 so far
- **§11 verifications (D73, D74):** `footage().sourceData` libraries work on 26.5 but aren't cached (a missing file disables every expression using it) and cost ~3× per call, so the library is inlined by default. Pseudo effects generated as .ffx work, the .aep stores their definition, and a fresh `aerender` rendered a copy with our presets moved away.
- **F1 expression library** (`src/aeclib/aec-lib.js`, 49 functions: easing/physics, seeded random/noise, distributions, falloffs, timing, color, text, markers). Expressions call `L.fn(...)`; the compiler adds the functions used (inline) or binds the shared `aec-lib.jsx` item (`lib: 'footage'`). Every function checked in AE in both modes (`tests/integration/p5/aeclib.ts`).
- **F2 rig effects** (`src/compile/ffx/pseudo.ts`, `rigfx.ts`, `<RigEffect>`): grouped `control(..., { group })`, live text reveals (`live: true`), live camera moves (default). Sticky values cover every rig param.
- **Migrated** text-unit reveals, spring rigs, camera moves and marker bursts (bursts now fire on every marker with the comment). Ripple (frames identical) and live controls still pass.
- **Bug fixed (D75):** checkbox controls always read as on in expressions.
- **P1/P2 cloner** (`src/dsl/cloner.ts`, D77): master precomp + fields (`field()`), a controller null with one "Cloner" rig effect, instance 1 with index-based library expressions duplicated in AE. Distributions line/grid/circle/path/scatter/sphere/helix; motion (speed, direction, wrap, variation); effectors noise, falloff (radial/linear, scale/opacity/blur), stagger (index/distance/random via time remap), follow, step, colorize; data rows/CSV to fields and transform channels; `mode: 'repeater'` for big shape counts. Build/render measured at 100/300/1000 (D77). AE checks: `tests/integration/p5/cloner.ts` (16), `distributions.ts` (all distributions vs aec-lib).
- Node-side modules from subagents, to be wired in: captions (`src/text/captions.ts`, 50 tests), motion analysis + speed graphs + style lint (`src/motion/`, 42 tests), beat detection (`src/audio/`, 25 tests; Diafano 105 BPM).

- **A1/A2 motion previews + style lint** (D78): `src/runtime/motion.ts` sampler, `src/api/motion.ts` (reports, text-reveal folding, `motionPreview`), on every build/edit and in `lint_comp`; MCP `motion_preview`. AE check `tests/integration/p5/motion.ts` (15).
- AE was restarted once (user OK'd) after it degraded during heavy cloner tests (D79).
- **A4 reframe + delivery** (D80): `reframe` on builds (9:16 platform zone, 1:1, 4:5), `deliver` tool (mp4 per target + ProRes master). AE check `tests/integration/p5/reframe.ts`.
- **A5 beat sync** (D81): `beatsOf`, `<Audio>`, `<BeatMarkers>`, `<CompMarkers>`, ripple `snap: 'beats'`, `off-beat` rule, `analyze_beats`. AE check `tests/integration/p5/beats.ts`.
- **Showcase 15** (`examples/15-cloner-cards`): 100 cards stream, one stops and grows into the message panel; lint and style lint clean.
- **Designer panel** (D83): `packages/bridge-cep/extension/designer.js` + `panel.html`; `designer_inbox` tool.
- **Docs**: DSL.md §21 (toolkit), style rules in §17, new MCP tools; SKILL.md §11.
- **Kits integrated** (built by subagents, exported from `ae-compose`, documented in DSL.md §21.9–21.16 and SKILL.md §11.6–11.7): typography + captions (K3), backgrounds (P4), data viz (K2), UI kit (K1), transitions (K4), path tools + morph (P3); `plan_scene` (A3) and the recipe library (A6, 6 shipped recipes) as MCP tools.
- **Verified in AE** (`tests/integration/p5/kits.ts`): typography, backgrounds and data viz build with no expression errors, lint, and one undo restores the comp exactly. Fixed on the way: word bounds under centred text (D85), pseudo-effect matchNames over 31 bytes (D84), the bridge's 300 s fetch limit (D86).
- **Regression**: every earlier integration suite passes (roundtrip, edit-ops 26/26, edit-3d, renderer-seeds, gradient-edit, ease 11/11 after fixing the test's spring reference, quality compare, render).

- **UI kit, transitions, path tools verified in AE** (`p5/kits.ts`), and `plan_scene` + recipes end to end (`p5/agenttools.ts`: a planned scaffold and a recipe instance build and undo in one step).
- **Showcases 16–18** (product UI demo, data story, beat-synced promo): lint and style-lint clean, reviewed from contact sheets and frame strips of every transition.
- **Independent review** (a subagent that read the code and docs without AE): every finding fixed with a regression test (D87–D89 and REPORT "Found and fixed").
- **AE restarted once more** (user OK'd) when expression evaluation had slowed 4× after hours of heavy builds (D79).
- **REPORT.md** has the Phase 5 section (definition of done with evidence, limits, fixes, next improvements).

- **Fresh-session test passed** (TOOLKIT §10 item 6): a headless session with only the skill and MCP built and reviewed LoopPromo_v001 (cloner, phone UI with a beat-timed tap, bar-aligned cuts, held end card) unaided in 22 min; details in REPORT.md.

**Phase 5 is complete:** TOOLKIT §10 met, every P5 roadmap group at 100 %.

**Next:** the ranked list in REPORT.md (Phase 5 "Next improvements"): faster builds of large scenes, `plan_scene` scaffolds with the real transitions, matte-aware lint, recipe thumbnails, a live crash test of `recover_ae`.

**Planned: asset sources** (design in `docs/ASSETS.md`, D90; roadmap group "Assets ·", phase 6, not started): `find_assets` / `fetch_asset` over free APIs (Iconify, Poly Haven, ambientCG, Pexels, Pixabay, Openverse, Fontsource) instead of a hosted library.

## Done
- **Phase 0**: environment discovered (`docs/ENVIRONMENT.md`). CEP bridge installed and verified (~50 ms eval). `AfterFX.com -r` fallback verified (~1.1 s). Assets gathered from the user's own projects (`assets/SOURCES.md`). Hand-built fixture: `assets/handmade/languages_proj/`.
- **Phase 1**: research reports in `docs/research/` (toolchain, prior art, Remotion/Lottie/easing) and the AE 26.5 API verification summary in `docs/RESEARCH.md` §1 (raw dumps in `docs/research/ae-verify/`).
- **Phase 2**: `docs/ARCHITECTURE.md`, with agent-first as principle zero; decisions D21–D28.
- Dialog watchdog prototype (`scratch/p1/aewin.ps1`) verified on the full crash → relaunch → Crash Repair flow.
- Status dashboard and release flow (`status/`, `scripts/release.mjs`). Private GitHub repo `epol1/ae-compose`.

## Built so far (Phase 3)
- **Core:** ES3 runtime (build/inspect/edit/snapshot/describe/layout/ripple/preview), TS→ES3 toolchain, bridge client, dialog watchdog, auto-cancel of probe dialogs (D54), zod IR validation before AE (`src/ir/schema.ts`), AE disk-cache guard (D62), `aec` CLI (doctor passes), MCP server (18 tools).
- **DSL + compiler:**
  - layers, transforms, text documents and runs, per-unit text animators (with `anchor: 'end'` exits), shapes/pen/SVG, effects (fuzzy names, popup labels), masks (rounded rects), mattes;
  - controls (with `plus()` staggers) and EG;
  - layout containers (solved in AE);
  - 3D (renderer table, cameras, DOF, orbit rig, lights + HDRI, materials, extrusion, models, 3D layout helpers);
  - particles (9 systems + presets), motion blur modes;
  - gradients via .ffx (D47), variants + Compare (D48);
  - named Sequences → scene markers.
- **Effect catalog:** 391/397 vanilla effects harvested → `src/catalog/params.json` + `src/dsl/effects.generated.ts`.
- **Gradient read-back (D72):** stops of every shape gradient from the saved .aep (fixture tests/fixtures/gradient-test.aep).
- **Roadmap gaps closed (D66–D70):** Range Selector text mode, text on a path, automatic per-character 3D; camera move rigs (PushIn, PullOut, Truck, Pedestal, Crane, CameraMove with shake) and ThreePointLights; multi-color Confetti; brand tokens (`brand()`, `examples/brand.ts`); SVG tree import (transforms, strokes, gradients, `<use>`) and `<Vector>` for .ai/.eps/.pdf; typed camera/light/material/geometry/particles/gradient edit ops; `recover_ae`; occlusion lint.
- **Final renders (D65):** `render` / `aec render` → `renders/` next to the project (or `~/.ae-compose/renders/`); MP4, ProRes 422/HQ/4444, PNG/TIFF sequences, AVI. A scripted render (and a full cache purge) clears AE's undo history; `undo` now knows and says so.
- **Lint (D63):** every build and edit returns a lint report (reading time, frame edges, action/title safe, text overlap, box overflow, missing fonts, near-empty frames, linear-only moves); `lint_comp` / `aec lint` for any comp. All 13 scene showcases lint clean after re-staging 01, 10, 11, 12 and 14 (D64).
- **Skill:** SKILL.md §2 "Direct it like a motion designer" (story beats, intention, transitions from scene elements, arrive → hold → leave).
- **Edits:**
  - property/curve/effect/text/path/layer/comp ops;
  - ripple (D50), place + key + preview_item (D52);
  - atomic batches with rollback (D53); one-step undo.
- **Verified in AE:**
  - round-trip: 588 properties (matrix + showcases 01/05/10/12) match the IR;
  - edit ops: 26/26 on the hand-built project, each undone exactly in one step;
  - renderer switching and seed determinism: pass;
  - easing 11/11; live controls 0.000 px, sticky 3/3;
  - ripple: frames pixel-identical after the shift;
  - greenscreen place → key → background → animate → undo;
  - Remotion side by side (kinetic type): timing matches, AE at least as good (`docs/quality/kinetic-compare.png`).
- **Docs:** `docs/DSL.md` (copied to `skills/ae-compose/reference/DSL.md` on release), `skills/ae-compose/SKILL.md` + `recipes.md`, README, ARCHITECTURE (unbuilt parts marked planned), REPORT (what to try first, next 5 improvements).
- **Tests:** unit/codegen tests pass (`pnpm test:unit`, including 21 IR-schema tests). Bugs found by the test agent and the independent reviewer are fixed and kept as regression tests. AE integration checks in `tests/integration/` pass: round-trip, edit ops, renderer + seeds, ripple, live controls, ease. Watch mode works.
- **Showcases:** all 14 built, reviewed from contact sheets and iterated.
- **MCP:** a fresh headless Claude Code session using only the skill and the MCP tools built, reviewed, fixed and ripple-edited a title card unaided (REPORT.md).

## Next
The ranked list is in `docs/REPORT.md` ("Next 5 improvements"):
1. Motion previews the agent can judge (GIF strips or velocity graphs after builds).
2. A live crash test of `recover_ae` (the launch and force paths are only mock-tested).
3. Pixel-level lint (occlusion and overlap are judged by bounds today).
4. Bezier-aware ripple splits; `stagger()` / `interpolate()` helpers.
5. Keyframed gradient stops and `addTextAnimator` (the last planned edit ops).

Also: `undo` should detect an AE session whose undo history is not recording (D61) and say so instead of reporting success; dolly/push-in rig helpers, Range Selector text mode, text on path, multi-color confetti.

## Open issues
- AE crashes `(0 :: 42)` from shape-gradient internals: fenced (D15). One crash with no script running happened while the `Blue Dwarf V0` dev plugins were installed; they have since been removed (D18). No crashes since.
- Renderer quality settings are not scriptable (documented limitation). Model embedded-animation selection is not scriptable (open).
- Rebuilding a scene keeps layers that edits added to its comps (they're untagged; documented in DSL.md).
- The one unexplained undo miss after lint (2026-11-04) is most likely a disk-cache purge right after that build: AE clears undo history on purge (D65). The guard now purges far less often and `undo` reports a cleared history.
- AE's disk cache fills fast during snapshot-heavy sessions; the guard purges it (D62), and the user should cap Maximum Disk Cache Size in AE preferences.
- Edit `set` keys default to `easeInOutCubic`; DSL `keys()` default to `easeOutCubic` (documented; consider aligning).
