# Phase 5 design: the creative toolkit

> Status: design, not built. Roadmap: the "P5 ·" groups in `status/systems.json`. Goal prompt: [`GOAL-PHASE5.md`](../GOAL-PHASE5.md).

Phases 0–4 built the compiler, bridge, inspector, edits, lint, renders and 14 showcases. Phase 5 adds a suite of higher-level tools so the agent can make richer, more creative work with less code, and so the results stay easy for a designer to edit in After Effects. The common thread: **express intent once, get many native, editable, live-controlled elements**.

## 1. Principles

These carry over from GOAL.md and the decisions log, and every tool below must keep them.

- **Vanilla AE, portable projects.** A project made with the toolkit opens and renders on any stock AE 2026 install. No third-party plugins and no compiled plugins of our own (see §8). Everything ships inside the project: comps, presets, expressions and footage.
- **Native and editable.** The output is real layers, keys, expressions and effects that a designer can grab. A tool that produces something opaque is wrong.
- **Live by default.** The parameters a designer would want to tweak (counts excepted) are controls in AE, not rebuild-only constants.
- **One call, one undo.** A tool runs in one build or edit, which is one undo step, and every result comes with a contact sheet and lint.
- **Agent-first.** Coarse, declarative APIs with good defaults and errors that say what to change. Every tool is documented in `docs/DSL.md` and taught in the skill with an example.
- **Craft built in.** Tools default to the direction rules in `skills/ae-compose/SKILL.md` §2: holds, staggers, transitions that come out of the scene, no slide furniture.

## 2. What we already know (verified 2026-11-04)

- **A JavaScript loop already scales.** 100 cards with seeded variation (lane, width, tilt, color, timing) built as 101 native layers in 10.7 s. The weakness is editing: each card has its own baked keys, so the design or the overall speed can't change without a rebuild.
- **Precomp instancing with per-instance overrides is scriptable.** A property added to a master comp's Essential Graphics (`addToMotionGraphicsTemplateAs`) appears on every instance under `ADBE Layer Overrides`. Scripts can set an instance's override value (color and text tested), and an override can carry an expression (`seedRandom(index, true)` tested), so N instances can vary from one expression.
- **Existing building blocks:**
  - generated `.ffx` presets (gradients, D47);
  - live controls with sticky values (D56);
  - per-unit text animators and Range Selectors (D69);
  - the layout solver with real text metrics;
  - lint with timing and occlusion (D63, D70);
  - camera rigs (D69);
  - the render tool (D65);
  - the cloner-friendly `brand()` tokens.

## 3. Foundations (build first: everything else gets shorter)

### F1. Expression library: `aec-lib.jsx`
A `.jsx` file imported into the project as a footage item. Expressions call its functions through `footage("aec-lib.jsx").sourceData`, an AE 17+ feature: **verify on 26.5 first**. Example: `var L = footage("aec-lib.jsx").sourceData; L.overshoot(t, amp, freq, decay)`.
- **Contents:**
  - **Easing and physics:** spring, overshoot, inertial bounce, damped oscillation, follow-through, lag.
  - **Seeded random:** hash, noise1d/2d, pick-from-list.
  - **Distribution maths:** grid, circle, path, scatter with Poisson spacing.
  - **Falloffs:** linear, smooth, radial, box.
  - **Timing:** stagger, cascade, `aecWn` time warp for ripple.
  - **Color:** hsl, mix, palette pick.
  - **Text helpers.**
- **Versioning:** the library carries a version; the build imports or replaces it once per project (one item, under `ae-compose/_lib`), so every expression stays one or two readable lines.
- **Migration:** move the existing rigs (unit animators, camera moves, spring and expression rigs, burst-at-marker) to library calls. Generated expressions shrink and stay readable.
- **Done when:** the library loads in AE 26.5, a test scene uses every function, ripple and lint still work, and `inspect_comp` shows the short calls.

### F2. Rig presets with their own controls
A rig shows up as **one tidy effect** ("aec Cloner", "aec Text Reveal", "aec Camera Move") holding exactly its controls, instead of loose sliders on the Controls null.
- **Mechanism:** pseudo-effect definitions inside generated `.ffx` presets (the .ffx machinery from D47). **Verify** that a project using them opens on a machine without our presets; the effect should live in the project.
- **Fallback:** grouped Slider Controls with a naming convention, if pseudo effects don't travel.
- **Done when:** the cloner, text reveal and camera move each expose one effect, the controls are live, sticky controls keep working, and the inspector reads them.

## 4. Procedural tools

### P1. Cloner / instancer (the MASH-style core)
`<Cloner count={100} of={<Card />} distribute={...} effectors={[...]} data={rows} seed={7} />`
- **Structure:**
  - **Master:** `of` becomes one master precomp in `_parts`. Its exposed props (any `eg` text, color or image) become Essential Graphics properties.
  - **Instances:** N precomp layers of the master. Per-instance values are set as overrides, from `data[i]` or from seeded variation expressions.
  - **Placement and motion:** index-based expressions that call F1 and read the cloner's controls: Spacing, Speed, Stagger, Randomness, Seed, Offset, Phase.
- **Editing:** editing the master updates every instance, the controls are live, and only `count` needs a rebuild.
- **Distributions:** line, grid (rows/cols/gap), circle/arc, along a path (an SVG `d` or shape), scatter (seeded, minimum spacing), and 3D variants (z depth, sphere, helix).
- **Scale:** past ~300 instances, offer a shape Repeater or textured particle mode with a warning, because hundreds of layers with expressions get slow to render. Measure the breakpoints.
- **Done when:** the "100 cards swipe by with subtle variations" brief is one component; changing the card master, Speed or Seed in AE updates all instances with no rebuild; lint and contact sheets work; build time is recorded for 100 and 300 instances.

### P2. Effectors
Modifiers on cloner instances, in order:
- **falloff:** scale, opacity, blur or brightness by distance from a null or line; e.g. cards grow as they pass the centre;
- **noise:** seeded position and rotation wobble;
- **stagger / cascade:** time offset by index, distance or random;
- **follow:** each instance trails the previous one, like a snake or chain;
- **step:** quantized values;
- **color:** palette cycling.

Each effector is a library function plus controls on the cloner effect.

### P3. Path tools
- **Follow a path:** a layer or text on any shape path with progress and auto-orient (`pointOnPath` / `tangentOnPath`).
- **Trails and echo:** time-offset copies with an opacity ramp.
- **Shape morph:** from SVG A to SVG B with vertex-count matching and correspondence (rotate the start vertex, add points).
- **Path draw helpers:** draw-on with taper and a round cap.

### P4. Procedural backgrounds and textures
Built-in effects only: Fractal Noise, 4-Color Gradient, Gradient Ramp, CC Kaleida, Turbulent Displace, grain. Presets: soft gradient field, animated mesh-like gradient, film grain, light sweep, bokeh field (particles), dot or line grid. Each one exposes palette and speed controls tied to `brand()`.

## 5. Kits

### K1. UI kit (product and app work)
- **Components on the layout engine:** Button (hover and press states), Toggle, Slider, ProgressBar, Input (typing with a caret), Checkbox, Tabs, Card, Avatar, Badge, Toast/Notification, Modal, Tooltip.
- **Interaction:** a Cursor that moves along a path, clicks with a ripple, and drives component states through markers ("click at 2.1 s → Button pressed").
- **ScrollView:** a masked content area with eased scroll keys; lists and feeds come from P1 with `data`.
- **Frames:** phone, tablet, laptop and browser chrome (vector, built-in), plus screen-recording inserts with cursor-follow zoom and pan.
- **States:** a small state machine on markers so "open the menu, pick item 3" becomes a list of steps.

### K2. Data viz kit
Bar, line, area, donut and stacked charts from `data`, with axes and gridlines, value counters, highlights and annotations. Every series is live-tweakable (values in controls; animation style from presets). Generalize showcase 05.

### K3. Typography kit
- **Captions** from SRT or VTT, with optional word-level timing that drives a karaoke highlight. Line breaking respects the safe area, and lint checks reading time.
- **Emphasis:** a highlight bar or underline that follows a chosen word (word bounds measured in AE), a color pop, a scale punch.
- **Effects:** decode/scramble, typewriter with caret, split-flap, variable-font axis animation where the font has axes.
- **Auto-fit:** text in a box (shrink to fit, balanced line breaks).

### K4. Transitions library
The direction rules made into components, each built from elements of the outgoing scene:
- hand-off/match-cut helpers (an element spanning both beats with a planned path);
- shape-from-scene wipe (matte from any shape on screen);
- zoom-through, push-through-camera, parallax split;
- morph-cut (P3), liquid/blob wipe, slice/grid wipes from the 07 pack, light-leak cut (P4).

Each transition takes its timing from the beat boundary, so ripple edits keep it attached. Style lint (A2) warns about repeats.

## 6. Agent tools (better creative judgement, less trial and error)

- **A1. Motion previews the agent can judge.** After a build or edit, optionally return a short low-res GIF strip of the key segments, plus a speed graph per animated layer (sampled position, scale and opacity derivatives). Feel becomes reviewable: easing quality, holds, "everything moves at once".
- **A2. Style lint.** Extends lint with the craft rules:
  - the same transition used twice in a row;
  - more than N elements entering at once;
  - holds shorter than the reading time (already covered) or than a minimum for non-text elements;
  - every move on the same easing;
  - linear moves;
  - slide furniture (persistent corner labels or numbers across beats);
  - an end state shorter than 2 s.

  Warnings name the layer and time, like lint.
- **A3. Storyboard first.** A `plan_scene` tool takes a beat sheet (message, beats, durations, transitions, holds) and scaffolds a scene file with named Sequences, transitions from K4 and placeholder elements. Lint and style lint check the plan before any detail is written.
- **A4. Responsive reframe and delivery packs.** Turn a 16:9 scene into 9:16 and 1:1:
  - re-solve layouts with new safe areas (platform UI zones for vertical);
  - scale type within limits;
  - re-target camera framing.

  Then render all formats with the render tool in one call ("delivery pack": mp4 16:9 / 9:16 / 1:1 + ProRes master).
- **A5. Beat sync.** Music → beat and onset markers (AE "Convert Audio to Keyframes" plus peak detection in Node, or analysis with ffmpeg). Then:
  - `snap` cuts, accents and burst markers to beats;
  - ripple edits snap to beats;
  - lint warns about cuts that land just off a beat.
- **A6. Recipe library.** Save a finished scene as a recipe (scene file, params, brand, thumbnails) and instantiate it with new params ("another one like the Ember Roast title, for brand X"). Recipes are searchable by intent; the skill lists them.

## 7. Optional: designer panel

A CEP panel in AE (UXP when AE ships it) for the human:
- the current comp's ae-compose controls grouped by rig;
- variant switching and compare;
- a lint and style-lint list with jump-to-time;
- recipe browsing;
- an "ask Claude" box that sends a message to the session through the bridge.

It's optional because everything it does is also reachable from the agent; it makes the human side faster.

## 8. Plugin policy

- **No compiled AE plugins** (C++ SDK) unless a capability can't be had any other way. Compiled plugins need building and installing per machine, and a project that uses one breaks wherever it's missing. That breaks the "opens anywhere" principle and the vanilla-AE rule.
- **Preferred, in order:** expression library (F1) → generated presets with pseudo effects (F2) → scripts and runtime functions → CEP/UXP panel for UI.
- **If a compiled plugin ever looks necessary,** write it up as a decision with the capability gap, the alternatives tried, and how projects degrade without it.

## 9. Milestones

1. **Foundations:** F1 and F2, with existing rigs migrated. Verify library loading and pseudo-effect portability first.
2. **Procedural:** P1 cloner with distributions and data, then P2 effectors. Showcase 15: "100 cards".
3. **Agent quality:** A1 motion previews and A2 style lint (they make every later tool better), then A3 storyboard.
4. **Delivery:** A4 reframe and delivery packs.
5. **Kits:** K1 UI (showcase 16: product demo), K2 data viz (showcase 17), K3 typography with captions, K4 transitions.
6. **Sync and reuse:** A5 beat sync (showcase 18: music-synced promo), A6 recipes.
7. **Optional:** P3 path tools and P4 backgrounds if not already pulled in by the showcases, then the designer panel.

## 10. Definition of done (Phase 5)

1. F1–F2 built and verified in AE 26.5, existing rigs migrated, and all earlier integration suites still green.
2. The cloner, with every distribution and effector, live-controlled. Showcase 15 ("100 cards with subtle variations swipe by") built from one component, with build and render times recorded at 100 and 300 instances.
3. The UI kit, data viz kit, typography kit with captions, and transitions library. Showcases 16–18 built, reviewed from contact sheets and motion previews, and lint and style-lint clean.
4. Motion previews and style lint on every build and edit (opt-out), reframe and delivery packs, beat sync, and the recipe library.
5. Every tool documented in `docs/DSL.md` and taught in the skill with an example. Each has unit tests and an AE integration test that also checks one-step undo.
6. A fresh session using only the skill and MCP builds an original piece with the cloner, a UI sequence and a beat-synced cut, and reviews it with previews and lint, unaided.
7. REPORT.md updated with what was built, what's limited, and the next improvements ranked.

## 11. Risks to check early

- `footage(...).sourceData` for function libraries on 26.5 (F1), and how expressions using it survive Collect Files and opening on another machine.
- Pseudo effects in presets opening without our presets installed (F2).
- Render cost of hundreds of expression-driven instances. Measure, then pick the Repeater or particle fallback threshold.
- Word-level bounds for emphasis (K3): measure per-word `sourceRectAtTime` through range selectors or temporary text, without slowing builds.
- Beat detection accuracy across genres (A5): validate against a few hand-marked tracks.
