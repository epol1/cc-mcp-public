# Roadmap

> Generated from `status/systems.json` by `status/build.mjs`. Do not edit by hand. Dashboard: `status/index.html`.

**v0.02.007**: 97.19% weighted, 251/258 tasks, 11/11 definition-of-done items. Legend: [x] done · [~] in progress · [ ] to do.

# Core (phases 0–4) (100%)

## Research & Design (100%)
- [x] Environment discovery
- [x] TS→ES3 toolchain research
- [x] Prior-art AE MCP servers
- [x] Remotion/Lottie/ease math
- [x] AE 26.5 API verification _(w2)_
- [x] Architecture doc _(w2)_
- [x] Status dashboard + release flow
- [x] README status image (SVG/PNG)

## Bridge & Execution (100%)
- [x] CEP extension (hot reload) _(w2)_
- [x] Eval wrapping, structured errors
- [x] Backend interface (TS client)
- [x] CEP HTTP backend
- [x] AfterFX.com fallback backend
- [x] Dialog watchdog _(w2)_
- [x] Recovery: dialogs, relaunch, hung AE (force with user approval) _(w2)_
- [x] Large results (eager serialization; 500 KB verified)
- [x] aec doctor
- [x] Non-blocking watchdog (no UIA on busy AE)
- [x] Auto-cancel dialogs opened by probes

## ES3 Runtime Core (100%)
- [x] Babel/Rollup ES3 build _(w2)_
- [x] ES3 post-pass + acorn check
- [x] Runtime helpers + stringify
- [x] Loader + version guard
- [x] One-eval undo-group requests
- [x] Crash-prone API fence
- [x] Node-id error attribution
- [x] Generic group/property builder _(w2)_
- [x] Build orchestrator (passes, sticky controls) _(w2)_
- [x] Forgiving deep property resolver
- [x] Spatial/color ease collapse

## IR & Schema (100%)
- [x] zod schema v1 _(w3)_
- [x] Stable ids + source locations
- [x] Units/time/color normalization

## TSX DSL (100%)
- [x] JSX runtime (jsxDEV sources)
- [x] Scene loader (esbuild)
- [x] Composition/Sequence/Series _(w2)_
- [x] Solid/Null/Adjustment/Precomp
- [x] Footage (fit/crop/trim) _(w2)_
- [x] Text primitive
- [x] Shape primitives _(w2)_
- [x] Effect/Mask/TrackMatte
- [x] Brand tokens (brand(), live colors, examples/brand.ts)
- [x] Exits anchored to layer end (ripple-friendly)

## Animation & Easing (100%)
- [x] Bezier→KeyframeEase (1D/multi/spatial) _(w3)_
- [x] valueAtTime verification in AE _(w2)_
- [x] Easing presets (Remotion set)
- [x] Remotion-exact spring
- [x] Curve baking + key reduction _(w3)_
- [x] tween/keys/interpolate
- [x] stagger/loop/wiggle
- [x] (t)=>value escape hatch
- [x] Color ease calibration (255 units)
- [x] Motion blur: comp/layer/forced (CC Force MB, Pixel MB) _(w2)_

## Text Animation (100%)
- [x] Full TextDocument + style runs _(w2)_
- [x] Range-selector animators (keyed Offset / Amount) _(w2)_
- [x] Expression-selector per char/word/line _(w3)_
- [x] Text presets (riseIn, typewriter…) _(w2)_
- [x] 3D per-character (automatic for rotationX/Y/z)
- [x] Text on path (mask + Path Options, animatable margins)

## Shapes & Paths (100%)
- [x] Rect/Ellipse/Star/Group
- [x] Pen paths + SVG d _(w2)_
- [x] Fill/Stroke/dashes/taper
- [x] Trim/Repeater/Merge/Offset/… _(w2)_
- [x] Gradients via .ffx _(w3)_
- [x] SVG tree import + <Vector> for .ai/.eps/.pdf _(w2)_
- [x] Masks + track mattes
- [x] SVG path parser (M/L/C/S/Q/T/A/Z)

## Effects & Catalog (100%)
- [x] Effects + typed params
- [x] Discovery (vanilla filter)
- [x] Param harvest (ranges, popups) _(w2)_
- [x] Generated TS types
- [x] Fuzzy name resolution
- [x] describe_effect with popup labels

## Controls & Variants (100%)
- [x] Controls null, all control types
- [x] Static value linking
- [x] Retimable-keys rig _(w3)_
- [x] Expression rigs (spring/orbit) _(w2)_
- [x] Essential Graphics
- [x] Sticky controls on rebuild
- [x] Variants _(w2)_
- [x] Compare comp

## Layout (100%)
- [x] Shared layout solver _(w3)_
- [x] AE-side text measurement
- [x] Layout-relative animation
- [x] Safe areas + aspect presets
- [x] Solver in runtime + DSL containers _(w3)_

## 3D System (100%)
- [x] 3D layers + transforms
- [x] Renderer control + feature table _(w2)_
- [x] Cameras + DOF _(w2)_
- [x] Camera rigs (orbit, push-in/out, truck, pedestal, crane, shake) + three-point lights _(w3)_
- [x] Lights + HDRI environment _(w2)_
- [x] Material options
- [x] Extrusion + bevel
- [x] 3D models (import, transforms, materials; clip selection not scriptable in AE 26.5) _(w2)_
- [x] 3D layout helpers _(w2)_
- [x] Correct renderer IDs from AE strings

## Particles (100%)
- [x] Catalog coverage (9 systems)
- [x] Typed components _(w2)_
- [x] Layer-ref source precomps _(w2)_
- [x] Emitter linking _(w2)_
- [x] Marker-synced bursts
- [x] Camera integration _(w2)_
- [x] Presets (7) _(w3)_
- [x] Seeds + determinism
- [x] Producer unit + camera calibration
- [x] Multi-color confetti (one system per color, shared controls)

## Inspector (100%)
- [x] Project/comp/layer walk _(w2)_
- [x] Keys, eases, tangents _(w2)_
- [x] Effect trees
- [x] Text, shapes, masks _(w2)_
- [x] 3D + particles
- [x] Gradient read-back from the saved .aep (all gradients, opacity, midpoints) _(w2)_
- [x] Compact agent outline _(w2)_
- [x] Project media search + preview_item
- [x] Scenes (named Sequences → comp marker ranges)
- [x] Fast full inspect (pre-expression reads)

## Edit Operations (100%)
- [x] Property/keys/easing ops _(w2)_
- [x] Curve reshaping _(w2)_
- [x] Effect add/remove/reorder/params
- [x] Retime + replace footage
- [x] Text/shape/path edits _(w2)_
- [x] Typed 3D, particle and gradient edit ops
- [x] addControls/variant/precompose _(w2)_
- [x] One-step undo verified
- [x] Ripple edits (insert/remove/stretch time, scenes, quiet-point holds) _(w3)_
- [x] Place project media / files as layers
- [x] Chroma key op (Keylight + Spill, auto screen color) _(w2)_
- [x] Atomic edit batches (rollback on failure)

## Visual Feedback (100%)
- [x] Snapshot (+32bpc fix)
- [x] Contact sheets
- [x] aerender preview MP4/GIF _(w2)_
- [x] Lint report on builds/edits + lint_comp (reading time, safe areas, overlaps, fonts, blank frames) _(w2)_
- [x] Auto-attach to results
- [x] Lint reads per-unit animator timing (live controls, range selectors)
- [x] Final render tool (MP4, ProRes, PNG/TIFF; honest undo after render) _(w2)_
- [x] Lint: occlusion by layers above text (bounds)
- [x] Undo knows when AE cleared its history (render, purge)

## Interfaces (100%)
- [x] CLI (aec) _(w2)_
- [x] MCP server (18 tools) _(w3)_
- [x] watch mode
- [x] Claude skill + CLAUDE.md _(w2)_
- [x] Claude Code registration
- [x] Skill: motion-design direction (story, intention, transitions, holds)

## Testing (100%)
- [x] Unit tests _(w2)_
- [x] Codegen snapshots + ES3 parse
- [x] Inspector round-trip (real AE) _(w3)_
- [x] Edit-op tests + undo _(w2)_
- [x] Seed determinism
- [x] Renderer switching test
- [x] Remotion quality bar _(w2)_
- [x] Independent final review
- [x] AE disk-cache guard (auto-purge + doctor check)

## Showcase Scenes (100%)
- [x] 01 Kinetic typography _(w2)_
- [x] 02 Logo reveal _(w2)_
- [x] 03 Lower third
- [x] 04 Product promo (footage) _(w2)_
- [x] 05 Data chart _(w2)_
- [x] 06 Vertical social ad _(w2)_
- [x] 07 Transition pack _(w2)_
- [x] 08 Variants demo
- [x] 09 Edit demo (hand-built) _(w2)_
- [x] 10 3D product hero _(w3)_
- [x] 11 3D fly-through _(w2)_
- [x] 12 Particle logo reveal _(w2)_
- [x] 13 Ambient 3D particles _(w2)_
- [x] 14 Particle Playground _(w2)_

## Docs (100%)
- [x] README + quickstart
- [x] DSL reference _(w2)_
- [x] AGENT_GUIDE.md
- [x] REPORT.md

# Phase 5: creative toolkit (docs/TOOLKIT.md) (100%)

## P5 · Foundations (100%)
- [x] Verify footage().sourceData libraries + pseudo-effect portability on 26.5
- [x] Expression library aec-lib.jsx (physics, random, distribution, falloff, timing, color) _(w3)_
- [x] Rig presets: one effect per rig with its controls (.ffx pseudo effects) _(w3)_
- [x] Existing rigs migrated to the library (text units, camera, springs, bursts) _(w2)_

## P5 · Procedural (100%)
- [x] Cloner: master precomp + instances + Essential Properties overrides _(w5)_
- [x] Distributions: line, grid, circle/arc, path, scatter, 3D _(w2)_
- [x] Effectors: falloff, noise, stagger/cascade, follow, step, color _(w3)_
- [x] Data-driven instances (arrays, CSV) _(w2)_
- [x] Large counts: Repeater / particle fallback with measured thresholds _(w2)_
- [x] Path tools: follow path, trails/echo, draw helpers _(w2)_
- [x] Shape morph with vertex matching _(w3)_
- [x] Procedural backgrounds and textures (vanilla effects, brand palettes) _(w2)_

## P5 · Kits (100%)
- [x] UI kit components on the layout engine (button, toggle, input, toast…) _(w5)_
- [x] Cursor with clicks + component states on markers _(w2)_
- [x] ScrollView and feeds (cloner + data) _(w2)_
- [x] Device/browser frames + screen inserts with cursor-follow zoom _(w2)_
- [x] Data viz kit: bar, line, area, donut, stacked + counters _(w4)_
- [x] Captions from SRT/VTT with word timing (karaoke) _(w3)_
- [x] Type FX: word emphasis, decode, split-flap, variable fonts, auto-fit _(w3)_
- [x] Transitions library built from scene elements _(w4)_

## P5 · Agent tools (100%)
- [x] Motion previews: GIF strips + speed graphs after builds/edits _(w3)_
- [x] Style lint (repeats, everything-at-once, short holds, easing monotony, slide furniture) _(w3)_
- [x] Storyboard first: beat sheet → scene scaffold (plan_scene) _(w3)_
- [x] Responsive reframe 16:9 → 9:16 / 1:1 (safe areas, type, camera) _(w4)_
- [x] Delivery packs: every format rendered in one call
- [x] Beat sync: music → beat markers, snap cuts/accents, lint off-beat cuts _(w3)_
- [x] Recipe library: save and re-instantiate scenes with params _(w2)_

## P5 · Designer panel (optional) (100%)
- [x] CEP panel: controls by rig, variants, lint list, recipes, ask Claude _(w4)_

## P5 · Showcases, tests, docs (100%)
- [x] Showcase 15: 100 cards with subtle variations (cloner) _(w2)_
- [x] Showcase 16: product UI demo (UI kit, cursor, scroll) _(w2)_
- [x] Showcase 17: data story (data viz kit) _(w2)_
- [x] Showcase 18: music-synced promo (beat sync, transitions) _(w2)_
- [x] Unit + AE integration tests (one-step undo) for every tool _(w3)_
- [x] DSL reference + skill sections for every tool _(w2)_
- [x] Fresh-session test with only the skill + MCP
- [x] REPORT.md: Phase 5 results, limits, next improvements

# Phase 6: asset sources (docs/ASSETS.md) (100%)

## Assets · Free asset sources (100%)
- [x] Verify first: API response shapes, AE import of each kind, font install probe
- [x] Core: hit record, source adapters, cache, API keys, license allowlist, CREDITS.md _(w3)_
- [x] Keyless adapters: Iconify, Poly Haven, ambientCG, local folders _(w3)_
- [x] find_assets (thumbnail grid) + fetch_asset (download, copy into project, import) + doctor _(w3)_
- [x] Key-based adapters: Pixabay, Unsplash, Openverse (Pexels built, waiting on a key: Pexels isn't issuing keys) _(w2)_
- [x] Fonts via Fontsource, after probing font installs in AE _(w2)_
- [x] asset: src scheme in the DSL (fetched at compile time, cached) _(w2)_
- [x] Skill + DSL docs, unit tests on recorded responses, AE fetch-import-collect test _(w2)_
- [x] Showcase 19: launch teaser built mainly from fetched assets, CREDITS.md complete _(w2)_
- [x] Fresh-session test (brief needs assets the repo lacks) + REPORT Phase 6

# Phase 7: pr-cut, editing in Premiere (docs/PRCUT.md) (87.5%)

## Pr · Shared core (100%)
- [x] Shared modules moved to packages/core (bridge, watchdog, visual, captions, beats, motion, lint report, reframe targets, templates, units, assets) _(w4)_
- [x] AE integration suites pass after the refactor _(w3)_
- [x] Watchdog for both apps (-App ae|pr), Premiere dialog detection _(w2)_

## Pr · Bridge and spike (82%)
- [x] Spike: Premiere 26.5.2 feature table (docs/research/premiere/spike.md) _(w3)_
- [x] CEP + ExtendScript bridge (:47812) with UXP hub _(w3)_
- [ ] UXP plugin (long-poll) loaded and verified _(w2)_
- [x] prc doctor
- [x] Undo journal (index at the change, focus-safe) _(w2)_

## Pr · Cutting (100%)
- [x] Ticks, rates, drop-frame timecode (exhaustive tests) _(w2)_
- [x] Transcription: faster-whisper, fillers kept, energy-refined boundaries, corrections _(w3)_
- [x] Edit plan IR + compiler (words/sentences/quotes/time, tightening, J/L, punch-ins) _(w5)_
- [x] FCP7 writer in Premiere dialect; round trip at 6 rates _(w4)_
- [x] build_cut with contact sheets and cut strips _(w3)_
- [x] Edit lint _(w2)_
- [x] Edits on any sequence as versions (adopt Premiere XML) _(w5)_
- [x] tighten (dry-run diff, apply) _(w2)_

## Pr · Dress and finish (100%)
- [x] B-roll over segments/jump cuts, snap to beats _(w2)_
- [x] Music: ducking on words, backtimed endings, montage on bars/beats _(w3)_
- [x] Captions from transcripts (caption track) _(w2)_
- [x] Place .mogrt titles and fill fields (Premiere-authored verified) _(w2)_
- [x] export_mogrt in ae-compose → place_mogrt round trip _(w3)_
- [x] Karaoke captions via an ae-compose mogrt _(w2)_
- [x] AE-made titles keep their fields through edits _(w2)_
- [x] Lumetri grades in plans and edits _(w2)_
- [x] match_shots verified in Premiere (difference 85 → 17) _(w2)_
- [x] audio_finish: -14 LUFS / -1 dBTP measured _(w2)_
- [x] deliver: master + Auto Reframe 9:16/1:1/4:5 _(w2)_

## Pr · Media library (47%)
- [x] SQLite FTS5 index, worker, statuses _(w3)_
- [x] Shots, thumbnails, agent-written descriptions _(w2)_
- [x] library_search (said + seen, filters, grid) _(w2)_
- [ ] Premiere Speech to Text as an engine (UXP) _(w2)_
- [ ] Speaker diarization _(w2)_
- [ ] Sync groups (multicam by audio) _(w2)_
- [ ] find_assets local source uses the library (AE crossover) _(w2)_

## Pr · Tests, docs, showcases (85%)
- [x] Unit specs (timecode, transcripts, compiler, writer/adopt, lint, library, montage, review regressions) _(w3)_
- [x] Premiere suites: round trip x6, build, edits on a hand cut, finishing _(w3)_
- [x] Fresh-session test (skill + MCP only) _(w3)_
- [x] Independent review: findings fixed with regression specs _(w3)_
- [x] skills/pr-cut/SKILL.md _(w2)_
- [~] 30-min interview → 2-min cut the user keeps (needs footage) _(w5)_
- [x] Edit demo on the user's own hand cut _(w3)_
- [ ] REPORT.md Phase 7

## Definition of done
- [x] aec doctor passes
- [x] 3D fully controllable
- [x] Particles fully controllable
- [x] 14 showcases build + look professional
- [x] Live controls in every showcase
- [x] Variants + compare comp
- [x] Inspector round-trip tests pass
- [x] Edit ops on hand-built project, 1-step undo
- [x] MCP usable from Claude Code
- [x] README + docs complete
- [x] REPORT.md written
