# ae-compose — Report

What was built, how it was verified against the installed After Effects 2026 (26.5), and what is limited or
left. Decisions with rationale are in [DECISIONS.md](DECISIONS.md) (D1–D104); the roadmap with live status is
[`status/systems.json`](../status/systems.json) / [ROADMAP.md](ROADMAP.md).

## Phase 6: asset sources

Spec: [ASSETS.md](ASSETS.md); goal: [GOAL-PHASE6.md](../GOAL-PHASE6.md); decisions D90–D104. `find_assets` and `fetch_asset` search the user's local folders and free asset APIs, download the chosen file into the project and credit it; scenes name assets as `src="asset:<id>"`.

### Definition of done (GOAL-PHASE6 §6)

| Item | Status | Evidence |
|---|---|---|
| 1. Every ASSETS §2 source works through `find_assets` and `fetch_asset` (key-based: verified, or listed as waiting) | ✅ | Keyless, live: Iconify, Poly Haven, ambientCG, Fontsource (+ google/fonts), Openverse (anonymous), local folders. Key-based, live with the user's keys: Pixabay, Unsplash (added at the user's request, D95). **Pexels: waiting** (not issuing keys); its adapter is built and unit-tested on fixtures written from its docs. The AE check fetched and imported one asset of each kind from these sources. |
| 2. License allowlist, credits, cache cap, `doctor` lines, `asset:` scheme | ✅ | Allowlist with ShareAlike/trademark flags, NC/ND never returned or fetched (unit tests, plus re-checks at fetch time). Every fetch credited in `CREDITS.md` next to the project (and the scene for `asset:` refs); `deliver` copies it next to the renders. 5 GB LRU cache that only deletes indexed folders inside its root (tests with a forged entry). `doctor` prints one line per source and one for the cache. `asset:` refs in `<Footage>`, `<Audio>`, `<Model>`, `<Light hdri>`, `<Svg>`, plus `asset()` for indirect use (fonts). |
| 3. Fonts install and are used, or the probe's outcome is documented with the fallback | ✅ | A per-user install loaded into the Windows session (`AddFontResource` + `WM_FONTCHANGE`) is seen by the running AE at once (D102; D93's first probe had missed the session load). Space Grotesk (google/fonts variable file) was installed once with the user's OK and is the type of showcase 19. |
| 4. Showcase 19 | ✅ | `examples/19-launch-teaser` "Morrow 35" (25 s): Pixabay crowd clip, 16 Lucide icons drawn on as native shapes, an ambientCG paper sheet that tears in (jagged matte, Roughen Edges, fibre fringe, drop shadow), a Poly Haven camera model lit by a Poly Haven HDRI (Advanced 3D precomp), feature icons drawn on, a paper-rip sound (Openverse CC0), Space Grotesk. Lint and style lint clean; reviewed from contact sheets, full-res frames and a motion strip of the tear. `CREDITS.md` lists all 10 assets. The model's lens carries a real maker's engraving: it is staged at angles where it isn't legible. |
| 5. Documented in DSL.md, the skill and the README | ✅ | DSL.md §22 (+ §18 tool and CLI rows), SKILL.md §12 (+ tool table row), README "Asset sources" + showcase row, ASSETS.md marked built. |
| 6. Tests green, fresh-session test passed, REPORT Phase 6 | ✅ | 95 asset unit tests on recorded responses (adapters, license filter, credits, eviction, `asset:`, content checks, ZIP/GLB, fetch pipeline, review fixes), the whole unit/codegen suite green on every release; `pnpm test:live` 7/7 (Pexels skipped, no key); 37/37 checks in `tests/integration/p6/assets.ts`. Earlier AE suites re-run for what this phase touched (`<Svg>`, `src` resolution, the build, the runtime, dialogs): round-trip (652 properties incl. showcase 12's recoloured SVG logo), edit ops 26/26, p5 foundations 24/24, showcase 02 rebuilt unchanged. Fresh session: below. |

### Fresh-session test (2026-11-05)

A headless Claude Code session (`claude -p`, empty folder, only the ae-compose MCP server, `dontAsk` mode allowing only the MCP tools and reads of the skill folder) got a brief that needs material the repo doesn't have: a 15–20 s teaser for a fictional coffee roaster, "Ember", with a stock video backdrop, at least two icons drawn on as shapes, a texture that earns its place, an end card, and no font installs. Script and brief: `tests/fresh-session/run-p6.sh`, `p6-brief.md` (transcript in `scratch/p6/fresh/`).

**Result: ✅ succeeded unaided** (39 turns, 12.7 min). It ran `doctor`, read the skill and DSL §22, searched 8 times (`find_assets`, choosing from the grids), previewed two clips (`preview_item`), checked its beat sheet with `plan_scene`, fetched 5 assets and built **EmberTeaser_v001** (18 s) in 4 builds with 4 `motion_preview` reviews:
- **Roast:** a Pixabay clip of beans over flame; a Tabler flame icon draws on; "ROASTED THIS WEEK."
- **Pack:** an ambientCG kraft texture pulls up over the beans as the coffee bag (the texture is the story beat); a package icon draws on; "PACKED BY HAND."
- **Ship:** the package hands off to a truck that drives along a Mon→Fri week line; "AT YOUR DOOR BY FRIDAY."
- **End:** the Friday dot grows into an ember-orange end card with the flame as the logo mark; holds 3.3 s.

It fixed what its review found (a repeated transition flagged by style lint, a dead moment before the bag rose, elements vanishing a frame before the wipe covered them, 0.4 s of empty kraft, small label sizes) and reported one kept blank-frame note (0.1 s of plain orange as the wipe lands) and a contrast decision (no orange text on kraft, 2:1). All five assets are in the project's `CREDITS.md` with their licenses (checked here, not just taken from its report); it installed no fonts.

### Verified in After Effects

- **Imports (D92):** JPG, PNG, H.264 MP4 + AAC, HDR, EXR, a Poly Haven glTF (and the packed `.glb`), MP3; SVG only as a 1×1 still, so icons go through `<Svg>`.
- **`tests/integration/p6/assets.ts` (37 checks):** in a throwaway saved project, nine fetches (icon, HDRI, model, texture, two photos, video, audio, font) land in `footage/<source>/<id>/` next to the .aep, are imported (not icons and fonts) and credited; a fetch import is one undo step; a scene using every kind through `asset:` builds with no expression errors, lints, and one undo restores the comp exactly; AE's own **File > Dependencies > Collect Files** (driven through its dialogs) keeps every fetched file, and the collected project opens with every footage item found and relinked inside the collection.

### Limits

- **Pexels** is unverified live (no key can be had right now).
- **Collect Files** has no scripting API: the check drives AE's dialogs (Win32 by control id, D103). A native file dialog doesn't stop bridge evals, so nothing may touch the project while one is open (D99: the first attempt crashed AE).
- **AE keeps file handles** on footage after its project closes: renaming or deleting a fetched file's folder can fail until AE restarts (the test uses a fresh folder per run).
- **Opening the large dev project hung AE once** right after the Collect check (0 % CPU for 15 min; the user OK'd a forced restart). Not reproduced; showcase 19 was built in its own small project.
- **`recover_ae` can't recognise AE's Crash Repair dialog by itself:** AE draws it with no UI Automation text, so the automatic "Continue" never matched (it was mock-tested only). It was answered by hand from its capture.
- Grid thumbnails can't show PSD/HDR/EXR or video frames for local files (a labelled card instead).
- Openverse audio from Freesound is the 128 kbps preview (originals need a Freesound login).
- Fonts install on Windows only.

### Found and fixed in Phase 6 (beyond the plan)

- `<Svg>` filled outline icons into blobs and didn't know `currentColor` (D92).
- `license_type=commercial` at Openverse still returns NoDerivatives (D91).
- Fontsource's static TTFs of variable families carry the default instance's name (`SpaceGroteskLight-Bold`), so installs use the google/fonts files (D93).
- A font installed by file + registry alone is invisible to every running app until the next logon (D102).
- The independent review's 15 findings (D104), among them file: URLs from APIs, a font family losing its italic file, and unstreamed downloads.
- A unit test (`edit-ops`) silently depended on AE answering for a comp's fps; it now passes fps.
- The user's untracked `GOAL-PHASE6.md` disappeared from the working tree while the pr-cut session parked its work; it was restored byte for byte from this session's first read.

### Next improvements, ranked by impact

1. **`recover_ae` recognises Crash Repair** from its capture (image match), so a forced restart finishes unattended.
2. **Pexels live check** once keys open again (one `pnpm test:live` run).
3. **A local-asset thumbnail pass** (ffmpeg frame for video, tonemapped HDR/EXR) so local hits show in the grid.
4. **An R2 adapter for our own material** (paper scans, device mockups), behind the same interface (ASSETS §1).
5. **Freesound originals with OAuth**, for full-quality sound effects.

## Phase 5: the creative toolkit

Spec: [TOOLKIT.md](TOOLKIT.md); goal: [GOAL-PHASE5.md](../GOAL-PHASE5.md); decisions D73–D86. Everything is vanilla AE:
expressions, generated pseudo-effect presets, scripts and the existing CEP panel. No compiled plugins and no
third-party effects.

### Definition of done (TOOLKIT §10)

| Item | Status | Evidence |
|---|---|---|
| 1. F1–F2 built and verified in AE 26.5, rigs migrated, earlier suites green | ✅ | Expression library: 49 functions, each checked in AE in inline and footage mode (`p5/aeclib.ts`). Rig effects are generated pseudo effects (D74, D84); the .aep stores their definition and a fresh `aerender` rendered a copy with our presets moved away. Text reveals, spring rigs, camera moves and marker bursts are migrated. Earlier suites re-run after the migration: round-trip, edit ops 26/26, edit-3d, renderer + seeds, gradient edit, ease 11/11, quality compare, render, ripple, live controls. |
| 2. Cloner with every distribution and effector, live; showcase 15; times at 100 and 300 | ✅ | `p5/cloner.ts` (16 checks), `p5/distributions.ts` (every distribution against the library). Showcase 15 "100 cards" from one `<Cloner>`. Build: 100 instances 3.3 s fresh, 5–10 s rebuild; 300 instances 12.7–19.9 s. Render per frame: identical copies 1.2 s, a 4-color palette 1.8 s, unique labels 5–22 s; repeater mode 1000 copies 0.6 s (D77). |
| 3. UI, data viz, typography + captions, transitions; showcases 16–18 reviewed, lint and style-lint clean | ✅ | `p5/kits.ts`: every kit's test scene builds with no expression errors, lints, and one undo restores it exactly. Showcases 16 (product UI: phones, a data-driven feed that scrolls, taps and typing from one script), 17 (data story: counter, area, donut, bars; hand-off, liquid wipe, push-through) and 18 (beat-synced promo on a 105 BPM track: words and colorways on beats, a light-leak cut, a beat-pulsing disc that becomes the end card) build lint- and style-lint clean, reviewed from contact sheets and dense frame strips of every transition. |
| 4. Previews and style lint on every build/edit, reframe and delivery, beat sync, recipes | ✅ | Motion sampling + speed graph + style lint in every build and edit, within a time budget (`p5/motion.ts`); reframe and deliver (`p5/reframe.ts`); beat sync (`p5/beats.ts`); `plan_scene` and recipes: a planned scaffold and a recipe instance with new params both build and undo in one step (`p5/agenttools.ts`). |
| 5. Every tool documented and taught with an example; unit + AE tests with one-step undo | ✅ | DSL.md §21.1–21.16, SKILL.md §11.1–11.7; unit tests for every module (651 unit/codegen tests); AE checks in `tests/integration/p5/` with one-undo-restores-exactly. |
| 6. Fresh session builds cloner + UI + beat-synced piece and reviews it unaided | ✅ | See "Fresh-session test" below: LoopPromo_v001, built and reviewed unaided in 22 min. |
| 7. REPORT.md updated | ✅ | this section |

### Fresh-session test (2026-11-05)

A headless Claude Code session (`claude -p`, empty folder, `--strict-mcp-config` with only ae-compose, `dontAsk` mode allowing only the MCP tools and reads of the skill folder; reads of the repo's source were denied) got one brief: an original 12–16 s promo for a fictional habit app, "Loop", with the cloner, a UI sequence and a beat-synced cut to a 105 BPM track, then review it like a director. Script and brief: `tests/fresh-session/run-p5.sh`, `p5-brief.md` (the transcript goes to `scratch/p5/fresh/`).

**Result: ✅ succeeded unaided** (46 turns, 22 min, 6 builds). It ran `analyze_beats`, checked its beat sheet with `plan_scene` (fixed 4 warnings and re-planned), and built **LoopPromo_v001** (14.9 s):
- **Hook:** a ring draws on and is checked ("One check-in.").
- **Tap:** the ring hands off into the phone's week strip; a beat-timed tap on "Read 10 pages" fills today's dot, the streak goes from 11 to 12, and a toast drops in ("One tap a day.").
- **Add up:** the phone pulls back and a cloner fills 140 day-dots in four close shades, with a day counter ("Small check-ins add up.").
- **End:** the last dot swells into the end card (shape wipe), which holds about 2.2 s.

Cuts are on bars from `beatsOf`. After reviewing its contact sheets, lint, style lint and `motion_preview` strips, it fixed seven real problems: a cloner grid collapsed by a misread `gap`, a toast covering the header and too short to read, a counter left under the end card, hook text over the arriving phone, a phone exit that contradicted the idea (zoom in, replaced by a pull-back), a dead 3.6 s hold (a slow push-in added), and an empty first frame. It reported what it couldn't fix:
- a short hook headline;
- the weakest transition (phone to grid);
- small in-app text;
- the analyzer's low downbeat confidence;
- a hard music ending;
- the accent color not being live inside nested comps;
- a coarse speed graph on the cloner scene.

I reviewed its contact sheet: the piece reads as described.

### What exists

- **Foundations:** the expression library `aec-lib` (easing, springs, seeded noise, distributions, falloffs, timing, color, text, markers), inlined into each expression by default (D73), and rig effects: one generated pseudo effect per rig holding its live values (D74). Grouped controls, live text reveals and camera moves use them.
- **Procedural:** `<Cloner>` (master precomp + live instances, 7 distributions, motion, 7 effectors, data/CSV, repeater mode), path tools (`FollowPath`, `Trail`, `Echo`, `DrawOn`, `Morph` with vertex matching), procedural backgrounds (gradient, mesh, bokeh, grids, light sweep, grain).
- **Kits:** UI (controls, display components, device frames, screen inserts, cursor + `uiSteps` interaction scripts with states on markers), data viz (bar, stacked, line, area, donut, pie, counter; every value live on the chart's effect), typography (captions with karaoke, emphasis measured in AE, decode, typewriter, split-flap, variable weight, auto-fit), transitions (9 kinds from scene elements, `<Beats>` timing).
- **Agent tools:** motion previews (speed graph, dense frame strips, GIF, motion summary) and 10 style-lint rules on every build and edit; `plan_scene`; responsive reframe (9:16 platform zone, 1:1, 4:5) and `deliver`; beat sync (`analyze_beats`, `beatsOf`, beat markers, ripple snap, `off-beat` rule); the recipe library (6 shipped); the designer panel in AE (controls by rig, lint with jump-to-time, variants, recipes, Ask Claude → `designer_inbox`).

### Limits

- Big scenes are slow to build in a long AE session: layer creation and text documents cost ~0.3 s per call after a few hours of heavy builds (a 172-layer chart scene: 2–5 min). The bridge now waits as long as the build needs (D86); restarting AE restores the speed (D79).
- Cloner instances with unique text render the master once per value (5–22 s a frame for 100 labels); use a palette or repeater mode for big counts.
- Changing a chart's category count, a cloner's count or a caption file needs a rebuild; values, colors and timing are live.
- Emphasis works on point text with one style per line; marks follow ink bounds (a few px of bearing).
- Transitions that take over scene elements need them positioned explicitly and at rest when the transition starts.
- Reframe maps absolute positions approximately: wide side-by-side layouts may need a `Stack` to read well in 9:16.

### Found and fixed in Phase 5 (beyond the plan)

- Pseudo-effect matchNames longer than 31 bytes are silently ignored by AE (D84).
- Word bounds under centred text: AE carries the paragraph justification into measuring copies (D85).
- Node's fetch gives up after 300 s regardless of timeouts (D86).
- A layout around a precomp leaked into the precomp, misplacing everything inside it (fixed in the compiler; regression test).
- Checkbox controls always read as on in expressions (D75); ExtendScript's left-associative `?:` (D82).
- The ease-verification test compared springs against a reference that ignored the settle extension added in Phase 3.
- From the independent review (all fixed, with regression tests): explicit part-comp ids collided across reframes, variants and scenes, so a 9:16 build emptied the 16:9 cloner (D89); reframed wipes didn't cover a vertical frame; a 3D cloner with noise got NaN depth; `build_scene` didn't return the speed graph; style-lint tags were lost outside `build_scene` (D88); a project on Legacy ExtendScript expressions would compute wrong values silently (now a build warning and a `doctor` check); UI states drifted on components with `from`; `Counter`/`VariableFont` overloaded `from`; ZoomThrough scaled footage backgrounds; the panel couldn't see saved recipes and could edit the wrong comp.
- Found while building the showcases: PushThrough pushed layers parented inside the incoming beat twice as deep (the chart's bars vanished behind its background); the Input placeholder's hide-on-typing expression was replaced by an entrance fade; the chart highlight "punch" started and stopped at full speed (now sin², eased); lint and motion sampling of chart scenes took minutes (D87).

### Next improvements, ranked by impact

1. **Faster builds of large scenes.** Creating a layer costs 0.1–0.3 s in AE, so a 170-layer chart scene takes 1–3 minutes before lint. Building each chart in its own precomp, merging per-category labels into fewer text layers, or batching layer creation would make chart- and UI-heavy pieces iterate faster.
2. **`plan_scene` scaffolds with the real transitions** (the `<Beats>` components instead of placeholders) and beats snapped to the music grid when `music` is given.
3. **Mask- and matte-aware lint.** Overlap and occlusion are judged by bounds, so text covered by a wipe's matte still counts as visible; reading the rendered alpha would remove those false positives (they were the only lint noise in the showcases).
4. **Recipe thumbnails and variants**, and instantiating a recipe from the designer panel.
5. **A live crash test of `recover_ae`** (carried over from Phase 4: launch and force paths are mock-tested only).

## Phases 0–4: the compiler, editing and the showcases

### Definition of Done (GOAL §7)

| Item | Status | Evidence |
|---|---|---|
| `aec doctor` passes | ✅ | 14 checks green on this machine (AE 26.5, CEP 12 bridge, runtime, ffmpeg, sharp, bpc, Inter) |
| 3D fully controllable | ✅ | Showcase 10: Advanced 3D, glTF model, HDRI environment, shadows, extrusion + bevel, orbit camera, DOF. Showcase 11: Classic 3D dolly, DOF, motion blur. Showcase 13: 3D carousel. Renderer table read from AE's own strings (D36/D37). |
| Particles fully controllable | ✅ | CC Particle World presets with live controls; emitter following a layer; bursts by time or by comp marker; textured particles; Particle Playground; Star Burst; Pixel Polly (showcases 12–14; D41/D42) |
| All 14 showcases build and look professional | ✅ | `examples/01…14`, each built, its contact sheet reviewed by me and by an independent reviewer, and iterated (layout, contrast, framing, timing). The fixes that needed tool changes are D51 and D57 |
| Live controls in every showcase | ✅ | Every scene exposes controls on a Controls null and in Essential Graphics. 08: per-variant Accent Color / Headline Delay. 09: `addControls` adds Map Delay / Map Speed to a hand-built move. Verified numerically: 0.000 px between the expected curve and AE after changing controls in AE (D49) |
| Variants and compare | ✅ | Showcase 08: A/B/C sibling comps + `EndCard_v001_Compare` grid labelled with the params that differ (D48) |
| Inspector round-trip tests pass | ✅ | `tests/integration/roundtrip.ts`: a primitive matrix (every shape, paint and path operator, text animators, masks, mattes, effects, eases, camera and lights) plus showcases 01, 05, 10 and 12. 588 properties compared: 436 static values, 59 keyed properties with 440 eases, layer names, order and timing, renderer. All match |
| Edit ops on a hand-built project, each undoable in one step | ✅ | `tests/integration/edit-ops.ts`: all 26 agent ops on `assets/handmade/languages_proj` (a real client project, not made by ae-compose), each asserted through the inspector, then one undo restores the full-detail inspector JSON exactly. 26/26 pass. Showcase 09 runs a realistic batch on the same project. Batches are atomic (D53) |
| MCP usable from Claude Code; fresh session with only the skill succeeds | see §MCP | `.mcp.json` registration; headless `claude -p` run from an empty folder with only the skill + MCP tools |
| README and docs complete | ✅ | README (install, setup checklist, CLI, MCP for Claude Code/Desktop, quickstart, showcase table), DSL reference (every primitive, helper and edit op, with examples), skill + recipes, architecture (unbuilt parts marked planned), decisions, research, progress |
| REPORT.md | ✅ | this file |

### What exists

- **DSL + compiler** (`src/dsl`, `src/compile`): Remotion-style TSX → IR. It covers:
  - layers, Sequence/Series timing, transforms with exact eases;
  - springs: Remotion-exact, fitted to keys, or a closed-form expression with live physics;
  - per-unit text animators (Expression Selector), text documents and style runs, Essential Graphics text;
  - shapes, pen paths and SVG import, .ffx gradients, masks (rounded rects), mattes;
  - effects by name, with popup labels and typed params for 391 harvested vanilla effects;
  - controls (slider/angle/checkbox/color/point/dropdown/layer, with `plus()` staggers);
  - layout containers solved in AE with real text metrics;
  - 3D (cameras, rigs, lights, HDRI, materials, extrusion, models, 3D layout helpers);
  - particles, motion blur (switch / CC Force Motion Blur / Pixel Motion Blur), variants.
- **ES3 runtime** (`src/runtime`, built to `dist/runtime/aec-runtime.jsx`, ~139 KB): it does the following in AE:
  - build: one eval, one undo group, staged passes;
  - inspect (outline/full);
  - edit (atomic batches);
  - ripple, preview/sample, snapshot, effect description.
- **Edits** (`src/edit/ops.ts`):
  - set/ease/easeKey/interpolation/retime/layerTiming;
  - effects add/set/remove/move, text, path, layer, add/remove/duplicate layer;
  - comp, precompose, duplicateComp;
  - addControls (live timing rig on hand-built keys);
  - **ripple** (insert/remove/stretch time, scenes, hold at the quietest moment; precomp-aware);
  - **place** (project media or files as layers);
  - **key** (Keylight + Advanced Spill Suppressor with an auto-sampled screen color);
  - raw.
- **Bridge** (`packages/bridge-cep`, `src/bridge`):
  - background CEP extension, HTTP on 127.0.0.1 with a token, hot-reloading server;
  - `AfterFX.com -r` fallback;
  - dialog watchdog, which lists, captures and answers AE modals, auto-answers Crash Repair, and auto-cancels dialogs opened by read-only probes.
- **Interfaces:**
  - `aec` CLI (doctor/build/watch/inspect/edit/undo/snapshot/sheet/preview/effects/import/dialogs/eval);
  - MCP server (18 tools; images come back automatically after builds and edits);
  - Claude skill (`skills/ae-compose`).
- **Gradient read-back** (D72): `inspect_comp` reports the stops of every shape gradient, hand-built included, read from the saved .aep, and flags unsaved changes.
- **Final renders** (D65): the `render` tool writes MP4, ProRes 422 / 422 HQ / 4444 with alpha, PNG or TIFF sequences or lossless AVI through AE's Render Queue, checks the file and returns a poster frame (`tests/integration/render.ts`: every format, the user's queue untouched, no overwrite, honest undo afterwards).
- **Lint** (D63): every build and edit returns a lint report, and `lint_comp` checks any comp. It flags text on screen too briefly to read, text cut off or outside action-safe, overlapping texts, box overflow, missing fonts, near-empty frames and linear-only moves, each with the layer and the time range.
- **Visual feedback:**
  - automatic contact sheets after every build and edit, snapshots, previews (frame capture → ffmpeg);
  - 16 bpc captures; 32 bpc is compensated but not a target.

### Verified in After Effects (not just in Node)

- **Easing:** 11/11 eased curves match `valueAtTime` within tolerance. Color speed is calibrated in 0–255 units (D31). Springs follow Remotion's curve to the last key (a former end drift is fixed).
- **Live controls and sticky controls:**
  - changing controls in AE moves the animation with 0.000 px error, with no rebuild;
  - a rebuild keeps AE-side tweaks, while untouched controls take new code defaults (D56).
- **Ripple:**
  - frames after an insert or stretch are pixel-identical to the originals shifted by Δ;
  - removal works, precomps ripple inside, and each ripple undoes in one step;
  - on the hand-built project it moved 32 keys and 4 markers and held time-remapped precomps.
- **Greenscreen workflow:** import → `list_project_items` → `preview_item` → place → key → background below → animate, all in one undoable batch. Key Cleaner is opt-in because it degrades solid mattes (D52).
- **Round-trip:** the inspector reads back what the compiler wrote: 588 properties, all matching (§DoD).
- **Edit ops:** 26/26 ops applied to a hand-built project and undone in one step each (§DoD).
- **3D renderers and seeds** (`tests/integration/renderer-seeds.ts`): switching Classic 3D → Advanced 3D → Cinema 4D → Classic keeps 3D transforms, and each switch is one undo step. Rebuilding a particle scene with the same seed gives pixel-identical frames (mean diff 0.0000); another seed gives different frames.
- **IR validation:** every compiled IR passes the zod schema and its cross-reference checks before it reaches AE, and every request is parsed as ES3 first.
- **Remotion quality bar** (`tests/quality/compare.ts`): the kinetic type spec of showcase 01 was rewritten for Remotion 4.0.540 with the same beats, springs, staggers, exits, fonts and colors, and rendered at the same times as the AE build ([docs/quality/kinetic-compare.png](quality/kinetic-compare.png)). Timing matches beat for beat. The AE frames are at least as good: same layout and type, with native motion blur and text animators that stay editable.
- **Lint on the 14 showcases:** the first run flagged 9 issues in 6 showcases. Six were real: both taglines in 01 left before they could be read, the wordmark in 10 drifted out of action-safe, the words in the opening of 11 stacked on each other, the opening of 12 was nearly empty, and the title in 14 exploded before it could be read. Three were false positives, now fixed in lint: 3D text behind the camera (two in 11), and an arrow counted as a word (04). Fixing 11 then showed its words flew past too fast to read, so it was re-staged as a stop-and-go dolly (D64). All 13 scene showcases lint clean now (09 edits a hand-built project). With lint sampling inside the undo group, the 26 edit ops still undo exactly in one step, and a linted build is one undo step.
- **Effect catalog:** 391/397 vanilla effects harvested from the installed AE. The 6 skipped open dialogs when applied.
- **Performance:**
  - a scene build takes 1–10 s (Advanced 3D: about 3.5 s per snapshot frame, D40);
  - a full inspect of a 35-layer comp takes 4.4 s (it took over 5 minutes before D55).

### MCP from Claude Code

`.mcp.json` registers the stdio server for Claude Code in this repo; README shows `claude mcp add` and the
Claude Desktop config. A fresh headless session (`claude -p`, empty working folder, `--strict-mcp-config`, only
`mcp__ae-compose__*` tools allowed, the skill appended as the only guidance) was given a brief to build a
title card with live controls, review its own contact sheet, and ripple-edit it:

**Result: ✅ succeeded unaided (2026-11-04).** The session built `EmberRoast_Title_v001` (1920×1080, 30 fps):
- a per-word spring reveal of the brand name;
- a line draw-on;
- a tagline fade;
- live **Accent Color** and **Reveal Delay** controls on the Controls layer and in Essential Graphics.

After reading its own contact sheet it fixed two real problems:
- a visible glow edge (an ellipse smaller than the frame);
- tight spacing (gaps 36 → 52 px, line 600 → 680 px).

It then ripple-inserted 1 s at 1.37 s, the quiet moment between the line finishing and the tagline starting:
- the comp went 4 → 5 s;
- the tagline moved from 1.4–1.9 s to 2.4–2.9 s;
- one expression was warped, there were no expression errors, and the controls stayed wired.

It reported the comp, its fixes, the ripple result and the final contact sheet, which looks clean on review.

### Limitations and things AE does not allow

- **Scripting limits in AE 26.5:**
  - shape gradient colors can't be read or written by scripts safely: touching `ADBE Vector Grad Colors` crashes AE 26.5. Gradients go through generated .ffx presets, and the inspector reports stops only for gradients ae-compose made (D15/D47);
  - renderer quality settings and a glTF model's embedded-animation selection are not scriptable;
  - the Numbers effect, OCIO/LUT pickers and some analysis effects open modal dialogs when applied from a script. The compiler rejects Numbers and points to sourceText counters (D54);
  - protected-region markers on time-stretched layers are repositioned by AE. Ripple lands their start exactly, but their length can drift and is reported (D58).
- **Behavior trade-offs:**
  - ripple leaves non-ae-compose expressions that use `time` unchanged and warns about them;
  - a bezier segment that spans an insert point is stretched rather than split (linear segments are split exactly);
  - rebuilding a scene keeps layers that edits added to its comps (they are untagged; documented).
- **Planned, not built** (marked in ARCHITECTURE.md):
  - an `interpolate`/`stagger` helper;
  - dolly/push-in rig helpers (keyed moves work);
  - Range Selector text mode, text on path, multi-color confetti preset;
  - `.aepx` gradient reads;
  - automatic crash recovery (a hung AE is reported; the user restarts it);
  - `--dry-run`, typed `setParticle`/`set3D` ops (use `set` on AE paths meanwhile).
- **Platform:** Windows only so far (CEP bridge install, dialog watchdog). The runtime and DSL are platform-neutral.
- **Bit depth:** 8 and 16 bpc are the target (D29). 32 bpc captures are compensated but untested beyond that.

### Incidents during the build (for the record)

- **Shape-gradient crashes:** early probes of shape-gradient internals crashed AE three times. That led to the D15 fence and the .ffx approach, with no gradient crashes since.
- **Blue Dwarf plugin:** a third-party dev plugin (Blue Dwarf V0) caused a crash with no script running. It was moved out of AE's plug-ins folder.
- **Effect harvest dialogs:** the harvest opened "Select a LUT" and "Numbers" dialogs on screen. Probes now auto-cancel any dialog they open, and LUT menus are never probed (D54).
- **AE unresponsive:** a full inspect of a large comp made AE stop responding. AE was restarted (force-quit, at the user's request), and the cause was fixed (D55). That restart lost the unsaved dev project; everything in it is rebuildable from code.
- **Bridge stuck "Starting…":** after the restart the bridge stayed on "Starting…" because of the repo's ES-module setting. It was fixed with a CommonJS pin in the extension folder (D59).
- **Undo stopped recording:** once, an AE session stuck at "Can't Undo" and ignored quit requests. With the user's go-ahead the project was closed without saving and AE restarted; undo worked again. The trigger is unknown (D61).
- **C: drive full, twice:** snapshots and contact sheets filled AE's disk cache (67–69 GB in about 40 minutes) with a high Maximum Disk Cache Size. ae-compose now purges the cache when it passes 10 GB or the drive gets low, and `doctor` reports it (D62). A 30000 px floor solid in showcase 10 also caused memory-error modals; it is now 4000 px scaled, and the compiler rejects such solids.

## What to try first

1. **Check the setup:** `node bin/aec.mjs doctor` with AE open (all checks should be green). Then lower **Edit > Preferences > Media & Disk Cache > Maximum Disk Cache Size** to about 20 GB; ae-compose purges the cache on its own too.
2. **Build a showcase and play with its controls:** `node bin/aec.mjs build examples/01-kinetic-type/scene.tsx`, open `KineticType_v001`, select the Controls layer (or the Essential Graphics panel) and drag Word Stagger, Title Delay or Accent Color. The animation updates without a rebuild.
3. **Ask Claude Code for a scene in words:** with the MCP server registered (`claude mcp add`, README), ask for something like "a 6-second lower third for 'Maya Chen, Head of Product', with a delay control". Claude reads the skill, builds, checks its own contact sheet and iterates.
4. **Edit an existing project:** open one of your own comps and ask "make the title ease in with more overshoot" or "make the scene at 0:04 a second slower so the text reads". The ripple op shifts everything after it, and one Ctrl+Z undoes the whole edit.
5. **Try the greenscreen flow:** "add `<your clip>` to this comp, key it, put `<background>` behind it and push in slowly". Claude finds the media, previews it, places it, keys it with an auto-sampled screen color and animates it, in one undo step.
6. **Try the toolkit:** build `examples/15-cloner-cards` and drag the Cloner effect's Speed, Seed and Falloff on the "Cards" null; or ask Claude for "a 15-second promo for <product> cut to <music file>, with a phone UI showing <one task>, a stream of <things>, and a held end card". It plans the beats, builds with the cloner, the UI kit and the beat grid, and checks the speed graph and style lint before showing you. `build_scene { reframe: ['9:16'] }` then gives the vertical cut.

## Next improvements, ranked by impact

1–5 are the Phase 5 list above (faster large builds, plan_scene with real transitions, matte-aware lint, recipe thumbnails, a live crash test of `recover_ae`). Still open from Phase 4 (its motion-preview and pixel-lint items are built or folded into the Phase 5 list):

6. **Bezier-aware ripple and a stagger helper.** Ripple stretches bezier segments that span an insert point instead of splitting them, and `stagger()` / `interpolate()` would remove hand-written timing arithmetic from scenes.
7. **Typed animation of gradients and text animator presets** (`addTextAnimator`, gradient stop keys): the last edit ops still planned. Gradient stops can be set and read back (D72) but not keyframed by ae-compose.
