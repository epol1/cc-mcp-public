# Roadmap

> Generated from `status/systems.json` by `status/build.mjs`. Do not edit by hand. Dashboard: `status/index.html`.

**v0.00.004**: 19.11% weighted, 28/143 tasks, 0/11 definition-of-done items. Legend: [x] done · [~] in progress · [ ] to do.

## Research & Design (100%)
- [x] Environment discovery
- [x] TS→ES3 toolchain research
- [x] Prior-art AE MCP servers
- [x] Remotion/Lottie/ease math
- [x] AE 26.5 API verification _(w2)_
- [x] Architecture doc _(w2)_
- [x] Status dashboard + release flow
- [x] README status image (SVG/PNG)

## Bridge & Execution (67%)
- [x] CEP extension (hot reload) _(w2)_
- [x] Eval wrapping, structured errors
- [x] Backend interface (TS client)
- [x] CEP HTTP backend
- [x] AfterFX.com fallback backend
- [~] Dialog watchdog _(w2)_
- [~] Crash recovery + relaunch _(w2)_
- [ ] Large result spill to file
- [ ] aec doctor

## ES3 Runtime Core (92%)
- [x] Babel/Rollup ES3 build _(w2)_
- [x] ES3 post-pass + acorn check
- [x] Runtime helpers + stringify
- [x] Loader + version guard
- [x] One-eval undo-group requests
- [x] Crash-prone API fence
- [x] Node-id error attribution
- [x] Generic group/property builder _(w2)_
- [~] Build orchestrator (passes, sticky controls) _(w2)_

## IR & Schema (0%)
- [ ] zod schema v1 _(w3)_
- [ ] Stable ids + source locations
- [ ] Units/time/color normalization

## TSX DSL (0%)
- [ ] JSX runtime (jsxDEV sources)
- [ ] Scene loader (esbuild)
- [ ] Composition/Sequence/Series _(w2)_
- [ ] Solid/Null/Adjustment/Precomp
- [ ] Footage (fit/crop/trim) _(w2)_
- [ ] Text primitive
- [ ] Shape primitives _(w2)_
- [ ] Effect/Mask/TrackMatte
- [ ] Brand tokens/theme helpers

## Animation & Easing (77%)
- [x] Bezier→KeyframeEase (1D/multi/spatial) _(w3)_
- [x] valueAtTime verification in AE _(w2)_
- [x] Easing presets (Remotion set)
- [x] Remotion-exact spring
- [x] Curve baking + key reduction _(w3)_
- [ ] tween/keys/interpolate
- [ ] stagger/loop/wiggle
- [ ] (t)=>value escape hatch

## Text Animation (0%)
- [ ] Full TextDocument + style runs _(w2)_
- [ ] Range-selector animators _(w2)_
- [ ] Expression-selector per char/word/line _(w3)_
- [ ] Text presets (riseIn, typewriter…) _(w2)_
- [ ] 3D per-character
- [ ] Text on path

## Shapes & Paths (0%)
- [ ] Rect/Ellipse/Star/Group
- [ ] Pen paths + SVG d _(w2)_
- [ ] Fill/Stroke/dashes/taper
- [ ] Trim/Repeater/Merge/Offset/… _(w2)_
- [ ] Gradients via .ffx _(w3)_
- [ ] SVG/AI → shape layers _(w2)_
- [ ] Masks + track mattes

## Effects & Catalog (8%)
- [ ] Effects + typed params
- [~] Discovery (vanilla filter)
- [ ] Param harvest (ranges, popups) _(w2)_
- [ ] Generated TS types
- [ ] Fuzzy name resolution

## Controls & Variants (0%)
- [ ] Controls null, all control types
- [ ] Static value linking
- [ ] Retimable-keys rig _(w3)_
- [ ] Expression rigs (spring/orbit) _(w2)_
- [ ] Essential Graphics
- [ ] Sticky controls on rebuild
- [ ] Variants _(w2)_
- [ ] Compare comp

## Layout (0%)
- [ ] Shared layout solver _(w3)_
- [ ] AE-side text measurement
- [ ] Layout-relative animation
- [ ] Safe areas + aspect presets

## 3D System (0%)
- [ ] 3D layers + transforms
- [ ] Renderer control + feature table _(w2)_
- [ ] Cameras + DOF _(w2)_
- [ ] Camera rigs (orbit/dolly/lookAt…) _(w3)_
- [ ] Lights + HDRI environment _(w2)_
- [ ] Material options
- [ ] Extrusion + bevel
- [ ] 3D models + animations _(w2)_
- [ ] 3D layout helpers _(w2)_

## Particles (7%)
- [x] Catalog coverage (9 systems)
- [ ] Typed components _(w2)_
- [ ] Layer-ref source precomps _(w2)_
- [ ] Emitter linking _(w2)_
- [ ] Marker-synced bursts
- [ ] Camera integration _(w2)_
- [ ] Presets (7) _(w3)_
- [ ] Seeds + determinism

## Inspector (0%)
- [ ] Project/comp/layer walk _(w2)_
- [ ] Keys, eases, tangents _(w2)_
- [ ] Effect trees
- [ ] Text, shapes, masks _(w2)_
- [ ] 3D + particles
- [ ] .aepx gradient parse _(w2)_
- [ ] Compact agent outline _(w2)_

## Edit Operations (0%)
- [ ] Property/keys/easing ops _(w2)_
- [ ] Curve reshaping _(w2)_
- [ ] Effect add/remove/reorder/params
- [ ] Retime + replace footage
- [ ] Text/shape/path edits _(w2)_
- [ ] 3D + particle edits
- [ ] addControls/variant/precompose _(w2)_
- [ ] One-step undo verified

## Visual Feedback (21%)
- [x] Snapshot (+32bpc fix)
- [~] Contact sheets
- [ ] aerender preview MP4/GIF _(w2)_
- [ ] Lint checks _(w2)_
- [ ] Auto-attach to results

## Interfaces (0%)
- [ ] CLI (aec) _(w2)_
- [ ] MCP server (15 tools) _(w3)_
- [ ] watch mode
- [ ] Claude skill + CLAUDE.md _(w2)_
- [ ] Claude Code registration

## Testing (8%)
- [~] Unit tests _(w2)_
- [ ] Codegen snapshots + ES3 parse
- [ ] Inspector round-trip (real AE) _(w3)_
- [ ] Edit-op tests + undo _(w2)_
- [ ] Seed determinism
- [ ] Remotion quality bar _(w2)_
- [ ] Independent final review

## Showcase Scenes (0%)
- [ ] 01 Kinetic typography _(w2)_
- [ ] 02 Logo reveal _(w2)_
- [ ] 03 Lower third
- [ ] 04 Product promo (footage) _(w2)_
- [ ] 05 Data chart _(w2)_
- [ ] 06 Vertical social ad _(w2)_
- [ ] 07 Transition pack _(w2)_
- [ ] 08 Variants demo
- [ ] 09 Edit demo (hand-built) _(w2)_
- [ ] 10 3D product hero _(w3)_
- [ ] 11 3D fly-through _(w2)_
- [ ] 12 Particle logo reveal _(w2)_
- [ ] 13 Ambient 3D particles _(w2)_
- [ ] 14 Particle Playground _(w2)_

## Docs (0%)
- [ ] README + quickstart
- [ ] DSL reference _(w2)_
- [ ] AGENT_GUIDE.md
- [ ] REPORT.md

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
