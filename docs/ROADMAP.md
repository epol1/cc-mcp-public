# Roadmap

> Generated from `status/systems.json` by `status/build.mjs`. Do not edit by hand. Dashboard: `status/index.html`.

**v0.00.012**: 91.04% weighted, 147/163 tasks, 0/11 definition-of-done items. Legend: [x] done · [~] in progress · [ ] to do.

## Research & Design (100%)
- [x] Environment discovery
- [x] TS→ES3 toolchain research
- [x] Prior-art AE MCP servers
- [x] Remotion/Lottie/ease math
- [x] AE 26.5 API verification _(w2)_
- [x] Architecture doc _(w2)_
- [x] Status dashboard + release flow
- [x] README status image (SVG/PNG)

## Bridge & Execution (93%)
- [x] CEP extension (hot reload) _(w2)_
- [x] Eval wrapping, structured errors
- [x] Backend interface (TS client)
- [x] CEP HTTP backend
- [x] AfterFX.com fallback backend
- [x] Dialog watchdog _(w2)_
- [~] Crash recovery + relaunch _(w2)_
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

## IR & Schema (40%)
- [ ] zod schema v1 _(w3)_
- [x] Stable ids + source locations
- [x] Units/time/color normalization

## TSX DSL (92%)
- [x] JSX runtime (jsxDEV sources)
- [x] Scene loader (esbuild)
- [x] Composition/Sequence/Series _(w2)_
- [x] Solid/Null/Adjustment/Precomp
- [x] Footage (fit/crop/trim) _(w2)_
- [x] Text primitive
- [x] Shape primitives _(w2)_
- [x] Effect/Mask/TrackMatte
- [ ] Brand tokens/theme helpers
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

## Text Animation (64%)
- [x] Full TextDocument + style runs _(w2)_
- [ ] Range-selector animators _(w2)_
- [x] Expression-selector per char/word/line _(w3)_
- [x] Text presets (riseIn, typewriter…) _(w2)_
- [ ] 3D per-character
- [ ] Text on path

## Shapes & Paths (85%)
- [x] Rect/Ellipse/Star/Group
- [x] Pen paths + SVG d _(w2)_
- [x] Fill/Stroke/dashes/taper
- [x] Trim/Repeater/Merge/Offset/… _(w2)_
- [x] Gradients via .ffx _(w3)_
- [ ] SVG/AI → shape layers _(w2)_
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

## 3D System (85%)
- [x] 3D layers + transforms
- [x] Renderer control + feature table _(w2)_
- [x] Cameras + DOF _(w2)_
- [~] Camera rigs (orbit/dolly/lookAt…) _(w3)_
- [x] Lights + HDRI environment _(w2)_
- [x] Material options
- [x] Extrusion + bevel
- [~] 3D models + animations _(w2)_
- [x] 3D layout helpers _(w2)_
- [x] Correct renderer IDs from AE strings

## Particles (94%)
- [x] Catalog coverage (9 systems)
- [x] Typed components _(w2)_
- [x] Layer-ref source precomps _(w2)_
- [x] Emitter linking _(w2)_
- [x] Marker-synced bursts
- [x] Camera integration _(w2)_
- [x] Presets (7) _(w3)_
- [x] Seeds + determinism
- [x] Producer unit + camera calibration
- [ ] Multi-color confetti (layered)

## Inspector (87%)
- [x] Project/comp/layer walk _(w2)_
- [x] Keys, eases, tangents _(w2)_
- [x] Effect trees
- [x] Text, shapes, masks _(w2)_
- [x] 3D + particles
- [ ] .aepx gradient parse _(w2)_
- [x] Compact agent outline _(w2)_
- [x] Project media search + preview_item
- [x] Scenes (named Sequences → comp marker ranges)
- [x] Fast full inspect (pre-expression reads)

## Edit Operations (97%)
- [x] Property/keys/easing ops _(w2)_
- [x] Curve reshaping _(w2)_
- [x] Effect add/remove/reorder/params
- [x] Retime + replace footage
- [x] Text/shape/path edits _(w2)_
- [~] 3D + particle edits
- [x] addControls/variant/precompose _(w2)_
- [x] One-step undo verified
- [x] Ripple edits (insert/remove/stretch time, scenes, quiet-point holds) _(w3)_
- [x] Place project media / files as layers
- [x] Chroma key op (Keylight + Spill, auto screen color) _(w2)_
- [x] Atomic edit batches (rollback on failure)

## Visual Feedback (71%)
- [x] Snapshot (+32bpc fix)
- [x] Contact sheets
- [x] aerender preview MP4/GIF _(w2)_
- [ ] Lint checks _(w2)_
- [x] Auto-attach to results

## Interfaces (100%)
- [x] CLI (aec) _(w2)_
- [x] MCP server (18 tools) _(w3)_
- [x] watch mode
- [x] Claude skill + CLAUDE.md _(w2)_
- [x] Claude Code registration

## Testing (71%)
- [x] Unit tests _(w2)_
- [x] Codegen snapshots + ES3 parse
- [x] Inspector round-trip (real AE) _(w3)_
- [x] Edit-op tests + undo _(w2)_
- [ ] Seed determinism
- [ ] Remotion quality bar _(w2)_
- [~] Independent final review

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

## Definition of done
- [ ] aec doctor passes
- [ ] 3D fully controllable
- [ ] Particles fully controllable
- [ ] 14 showcases build + look professional
- [ ] Live controls in every showcase
- [ ] Variants + compare comp
- [ ] Inspector round-trip tests pass
- [ ] Edit ops on hand-built project, 1-step undo
- [ ] MCP usable from Claude Code
- [ ] README + docs complete
- [ ] REPORT.md written
