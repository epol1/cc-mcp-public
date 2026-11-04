# ae-compose architecture

ae-compose turns Remotion-flavored TSX into **native, editable After Effects comps**, and lets an agent inspect and surgically edit existing AE projects. It runs against stock AE 2026 (26.5) only, with no third-party plugins (D2).

```
  TSX scene ──► DSL runtime (Node) ──► IR (zod, JSON) ──► codegen ──► ES3 call: AEC.build(payload)
                                         ▲                                  │  CEP bridge (HTTP, token)
  inspector ◄── AE→JSON (runtime) ◄──────┘                                  ▼
  edit ops (zod) ─────────────────────────────────► AEC.edit(ops) ──► After Effects 26.5
  visual: snapshot / contact sheet / aerender preview ◄─────────────────────┘
  interfaces: CLI `aec`, MCP server (stdio), Claude skill
```

---

## 0. Principle zero: agent-first

The primary user of this tool is **an AI agent (Claude) working with a human designer**. Every interface is shaped so an agent spends its effort on design quality, not on plumbing:

1. **Coarse, declarative calls.** One `build_scene` call creates a whole scene. One `apply_edits` call applies a batch. There are no "create layer", then "set property", then "add key" chains, and no connect, open or save ceremony. The bridge is discovered automatically, and the project is saved only when the agent asks.
2. **Feedback is automatic.** Every build and edit returns:
   - a **contact sheet image**,
   - the **key frames**,
   - a **lint report**: text overflow, safe-area violations, overlaps, blank frames, too-fast reads, renderer/feature mismatches, missing fonts,
   - the ids it created, so the next edit can target them.

   The agent never has to remember to look.
3. **Forgiving, self-describing names.** Effects and properties accept display names, matchNames or paths (`"Glow Radius"`, `"ADBE Glo2-0003"`, `"effects/Glow/Glow Radius"`). Values accept units (`"400ms"`, `"12f"`, `"#4683c4"`, `"50%"`). Unknown names fail with **"did you mean…"** suggestions drawn from the effect catalog. `describe_effect` returns params with human names, ranges, defaults and popup labels.
4. **Errors point at the cause.** Runtime errors carry the IR node id, and the node carries its TSX `file:line:col`. Validation runs before AE is touched: schema, renderer feature table, ES3 parse. Messages say what to change, not just what failed.
5. **Inspection reads like a briefing.** `inspect_comp` returns a compact outline by default: layers, timing, what's animated and how (ease names, not raw arrays), effects with changed params only, controls. The agent asks for depth (`detail: "full"`, `layer`, `property`) only when needed. Responses are size-budgeted, and images are downscaled to what is useful.
6. **Stable handles.** Every generated or inspected item gets an id (`aec:` comment tag, or a path for hand-built items). Edits target ids or human paths, never fragile indices.
7. **Idempotent and safe by construction.** Rebuilding the same scene converges, replacing in place and keeping live control tweaks. All writes run in one undo group. Crash-prone AE APIs are fenced off in the runtime (D15). Modal dialogs and crashes are detected and recovered automatically (D17). The agent cannot easily break the user's AE.
8. **One language, good types.** Scenes are TSX with rich JSDoc on every prop. Effect params are typed from the catalog. The skill doc (`skills/ae-compose/SKILL.md`) teaches the DSL with examples and motion-design guidance, and Claude never needs matchNames for common work.
9. **AI-friendly codebase.** Small single-purpose modules, explicit types at every boundary, one README per module folder, tests as executable specs, and `docs/AGENT_GUIDE.md` for agents developing the tool itself.

---

## 1. Repository layout

```
ae-compose/
  src/
    dsl/          JSX runtime + primitives + animation helpers + layout + controls/variants + 3D + particles
    ir/           zod schema (versioned), ids, source locations, normalization
    compile/      DSL tree → IR: timing, layout plan, animation lowering, baking, rig planning, feature checks
    shared/       pure TS used BOTH in Node and in the ES3 runtime (ease math, layout solver, spring, units)
    runtime/      ES3 runtime library (TS → Babel → ES3): build / inspect / edit / snapshot / measure
    codegen/      IR/ops → ES3 request scripts; ES3 validation (acorn)
    bridge/       Backend interface; CEP HTTP backend; AfterFX.com fallback; dialog watchdog; recovery
    catalog/      effect discovery → cached catalog → generated TS types; name resolution (fuzzy)
    inspect/      Node side of the inspector (JSON → IR/outline), .aepx gradient parser
    edit/         patch-op schema and helpers
    visual/       snapshot, contact sheet (sharp), aerender preview (ffmpeg), 32 bpc fix, lint
    cli/          `aec` commands
    mcp/          MCP stdio server
  packages/bridge-cep/extension/   CEP extension (stable manifest, hot-reloaded server.js)
  examples/       14 showcase scenes (+ shared brand tokens)
  skills/ae-compose/SKILL.md       authoring guide for Claude
  tests/          unit, codegen snapshots, integration (real AE), visual
  docs/           ARCHITECTURE, DECISIONS, RESEARCH, DSL reference, AGENT_GUIDE, PROGRESS, REPORT
```
It's a single npm package (`ae-compose`, bin `aec`), managed with pnpm. The runtime is built by Rollup into `dist/runtime/aec-runtime.jsx`.

---

## 2. Authoring layer (TSX DSL)

### 2.1 JSX runtime
- A custom `jsx-runtime` (`jsxImportSource: "ae-compose"`) builds a plain element tree, with no React. Components are plain functions `(props) => Element | Element[]`. In dev mode `jsxDEV` records `__source` (file, line, column) on every element, and it flows into IR `src`.
- Scene files are loaded with esbuild (TSX → ESM in memory) and evaluated in Node. The default export is `scene(config, () => <Composition>…</Composition>)`.

### 2.2 Units and time
- Time is given as a number of **seconds**, or as a string: `"6s"`, `"400ms"`, `"12f"`, `"00:00:02:15"`. Frames are resolved against the comp fps and stored as frames (integers, or sub-frame floats when `exactTimes`).
- Space is in pixels. 3D scene units are AE pixels: at the default 50 mm-equivalent camera, z = 0 is "screen size" and +z is away from the camera (AE convention).
- Colors: `"#rrggbb[aa]"`, `rgb()`, `hsl()`, arrays `[r,g,b]` (0–1), or brand tokens.

### 2.3 Primitives
`Composition`, `Sequence` (from/duration → layer in/out), `Series`, `Precomp`, `Footage` (by project item name/id or file path; `fit: cover|contain|fill|none`, `crop`, `trim`), `Solid`, `Null`, `Adjustment`, `Text`, `Shape` with children:
- shapes: `Rect`, `Ellipse`, `Star`/`Polygon`, `Path` (pen: points with in/out tangents, or an SVG `d` string),
- paint: `Fill`, `Stroke` (dashes, caps, joins, taper), `GradientFill`/`GradientStroke`,
- path operators: `Trim`, `Repeater`, `Merge`, `OffsetPaths`, `RoundCorners`, `Twist`, `PuckerBloat`, `WigglePaths`, `ZigZag`,
- `Group`.

Also: `Effect` (by friendly name or matchName, typed params), `Mask`, `TrackMatte` (`matte` prop on layers), `Camera`, `Light`, `Model` (glTF/GLB/OBJ), plus particle components (§9).

### 2.4 Layout (resolved with real AE text metrics)
- `Stack` (direction, gap, align, justify), `Row`, `Column`, `Grid`, `Center`, `Align` (to comp, safe area or parent box), `Padding`, `SafeArea` (action/title safe, or custom insets), `Box` (explicit size), plus 3D helpers (§8.5).
- The **layout solver lives in `src/shared/es3/layout.ts`** and is compiled both for Node and into the ES3 runtime. The build runs in AE in this order:
  1. create the layers,
  2. measure them (`sourceRectAtTime`, `composedLineCount`),
  3. solve the layout,
  4. set positions and anchors,
  5. apply relative animation.

  All of it happens inside **one undo group in one eval**. No measurement round-trip, no stale cache.
- Node runs the same solver with estimated metrics (from a measurement cache) for `--dry-run`, lint and tests.
- Animations on laid-out layers are **relative to the solved position** by default (`y: spring({ from: 80 })` means "start 80 px below its layout slot").

### 2.5 Animation as data
Each animatable prop accepts a static value, a **track descriptor** or a function:
- `tween(from, to, { duration, delay, easing })` and `keys([...])` give exact bezier keys (2 per segment).
- `spring({ from, to, stiffness, damping, mass, delay, duration, rig })` gives Remotion-exact numerics (golden-tested against `remotion@4.0.540`).
  - `rig: "keys"` (default): extrema-seeded fitted keys, typically 5–9.
  - `rig: "expression"`: a closed-form spring expression driven by sliders.
- `interpolate(input, inRange, outRange, { easing, extrapolate })`, which maps another track or time. The default extrapolation is `clamp` in ae-compose (documented difference from Remotion).
- Easing: the full Remotion `Easing` set plus named presets (`easeOutCubic`, `easeInOutQuart`, `expoOut`, `backOut`, `anticipate`, `snappy`, `smooth`…). Cubic forms map exactly. Others are baked (§4.4).
- `stagger(children, { each, from: "start|center|end|random", seed })`, `loop(track, { mode: "cycle|pingpong" })` (→ `loopOut`), and `wiggle(freq, amp, { seed })` (→ `wiggle()` expression with `seedRandom`).
- Escape hatch: `(t) => value` (seconds). It is sampled and reduced to keys within tolerance, or emitted as an expression when `as: "expression"` and the body is expression-safe.

### 2.6 Text animation (first-class)
- `<Text>` takes every `TextDocument` attribute: font by PostScript name, size, tracking, leading, fill/stroke, caps, justification, box text, auto-fit.
- Per-range styling uses `runs={[{ start, end, fill, font, size }]}` (→ `characterRange`).
- `animate` on `<Text>` can target **units**: `perChar`, `perWord`, `perLine`. These compile to **native text animators**:
  - **Expression Selector mode** (default for eased/spring staggers): animator properties hold the "from" offsets (Position, Scale, Rotation, Opacity, Blur, Fill, Tracking…). The selector's Amount expression evaluates the exact easing or spring per unit at `time − inPoint − delay − textIndex·each`, with `each`, `duration`, `delay` and overshoot linked to controls. This gives the same per-unit curves as Remotion and is fully live-tweakable.
  - **Range Selector mode** (`mode: "range"`): classic Start/End/Offset keys with shape and ease high/low, for designers who prefer native keys.
- Presets: `riseIn`, `fadeUp`, `blurIn`, `scaleIn`, `typewriter`, `trackingIn`, `slideMask`, `popIn`, `wave`, `scramble` (Character Offset), and a 3D `flipIn` (per-character 3D).

### 2.7 Controls
`control(name, default, opts)` marks any value as live. It compiles to an expression control on a **"Controls" null** (or on the layer, `scope: "layer"`). Optionally it's also exposed as an Essential Graphics property (`eg: true`, default for showcase scenes). Types are inferred: number → Slider (range/step), color → Color, boolean → Checkbox, point → Point/3D Point, angle → Angle, enum → Dropdown, layer → Layer control.

How controls drive animation without rebuilding:
- **Static values**: the property expression reads the control.
- **Keyed tracks ("retimable keys")**: real keyframes stay on the property, so the graph editor still shows them, and a rig expression remaps time and value:
  ```js
  var d = delayCtrl, s = durCtrl / authoredDur;      // controls
  var k0 = key(1).time;                              // authored start
  var tt = k0 + (time - k0 - d) / s;                 // retimed sample time
  var v = valueAtTime(tt);
  base + (v - base) * (ampCtrl / authoredAmp)        // optional amplitude (distance/overshoot) scaling
  ```
  Delay, duration (speed), distance and intensity become live, and the curve shape is preserved exactly. Keys are authored at the default control values.
- **Expression rigs** (`rig: "expression"`): fully expression-driven springs, wiggles and orbits with every parameter on controls (stiffness, damping, overshoot, orbit speed…).
- **Sticky controls**: on rebuild (`watch`), the current control values in AE are read first and re-applied after the rebuild, so a designer's tweaks survive code changes.

### 2.8 Variants and compare
`variants({ A: {...}, B: {...}, C: {...} })` turns params into sibling comps `Name_v003_A/B/C`. Seed is always a variant param. An optional `Compare` comp grids the variant precomps, labeled and scaled to fit, with a shared timeline.

### 2.9 Footage awareness
`<Footage item="Hero_Clip.mov" />` resolves against the project panel by name, path or id, and imports it if given a path that isn't in the project yet. `fit` and `crop` are computed in the runtime from the real source size. `trim` maps to `startTime`/`inPoint`/`outPoint` (or time remap when `speed` is set).

---

## 3. Intermediate representation (IR)

- `src/ir/schema.ts` (zod), version `irVersion: 1`, JSON-serializable. The compiler, runtime, inspector and MCP all speak IR.
- The top level is `Project { scenes: Scene[] }`. A `Scene` has comp settings (size, fps, duration, bg, renderer, motion blur), `layers: Layer[]`, `controls: Control[]`, `variants?` and `assets`.
- A `Layer` is a discriminated union: `text | shape | solid | null | adjustment | footage | precomp | camera | light | model`. Each has `id`, `name`, `src`, timing (`in`, `out`, `start`, `stretch`), `parent`, `transform`, `threeD`, `material`, `geometry`, `effects`, `masks`, `matte`, `blend`, `motionBlur`, `expressions`, plus a type-specific payload (text doc/runs/animators, shape contents tree, …).
- **Property values** are either static values or a `Track`:
  ```ts
  Track = { keys: Key[]; dims: 'one'|'multi'|'spatial'; separated?: boolean; relativeTo?: 'layout';
            rig?: Rig; expression?: string }
  Key   = { t: frames, v, inType, outType, inEase: Ease[], outEase: Ease[], continuous?, spatial?: {ti,to,auto}, roving?: false, label? }
  Ease  = { speed: number, influence: number }   // exact AE units
  ```
  This is a lossless superset of what AE stores, so inspector output round-trips.
- **Ids**: every IR node has `id` (deterministic: scene + path + explicit `id` prop). They're written into AE as the comment tag `aec:<id>` on comps and layers, and into effect and control names where needed. Hand-built items get path ids (`comp:"Title"/layer:"Logo"`).

---

## 4. Code generator and runtime

### 4.1 Request scripts are data
- Codegen emits a tiny ES3 script:
  ```js
  AEC.ensure("<runtimeVersion>");                 // loads dist runtime via $.evalFile if missing/stale
  AEC.build({ ...IR as an ES3 object literal... }, { replace: true, snapshot: [..], contactSheet: 12 })
  ```
  - The payload is an object literal: quoted keys, no trailing commas, `\u` escapes outside ASCII. It is not `JSON.parse`d (which is slow and absent in AE).
  - Every script is parsed with acorn `ecmaVersion: 3` before sending.
- **Why data, not generated statements:** the runtime is written and tested once. Generated code is tiny and always valid. The same runtime powers inspect, edit, measure and snapshot, and errors are attributed to IR node ids (`AEC.cur = nodeId`) rather than generated line numbers.
- Codegen snapshot tests store the emitted request script, normalized.

### 4.2 Runtime library (ES3)
- `src/runtime/*.ts` is TypeScript restricted to ES3-safe constructs. It's type-checked with TS 6 (`noLib` + `types-for-adobe/AfterEffects/26.0` + `ae-augment.d.ts`), compiled by Babel 8 (`preset-env`, `targets: "ie 8"`) and bundled by Rollup (IIFE). An acorn/magic-string post-pass adds ponyfills and parens for ExtendScript parser bugs and re-validates as ES3 (D21, see `docs/research/toolchain.md`).
- It never installs global polyfills: everything lives under `$.global.AEC` with its own `stringify`, `each`, `map` and `keys`.
- Modules:
  - `build`: comps, layers, transforms, keys and eases, text, shapes, effects, masks, mattes, 3D, particles, controls, EG, precomps, variants.
  - `measure`: text and layer bounds.
  - `layout`: the shared solver.
  - `inspect`: AE → JSON.
  - `edit`: patch ops.
  - `snapshot`: `saveFrameToPng().wait()`.
  - `safety`: crash-prone matchName fence, `CUSTOM_VALUE` guard, dialog suppression.
  - `json`: stringify.
- Each request runs in **one `evalScript`** inside **one undo group** (`"ae-compose: build Promo_v003"`), because undo groups don't survive across evals.
- During builds the runtime avoids expression re-evaluation storms: it shows a trivial comp in the viewer while building and restores the user's comp afterwards (borrowed from AEUX).
- AE quirks handled centrally:
  - re-fetch shape group references after every `addProperty` (they go stale),
  - set **all** TextDocument fields explicitly (`addText` inherits the Character panel),
  - contents index 1 is frontmost,
  - set interpolation to BEZIER before setting eases,
  - always pass both in and out eases,
  - the ease array length comes from the property value type (spatial → 1, TwoD → 2, ThreeD → 3, …).

### 4.3 Non-destructive by default
- Generated comps live in a project folder `ae-compose/<Scene>/` named `Scene_v###`, with variants as `_A`/`_B`/`_C` and helper precomps in a `_parts` subfolder.
- The runtime only modifies items carrying its `aec:` tag, unless an explicit edit op targets something else.
- `replace: true` (watch / rebuild) rebuilds **in place**: same comp item, generated layers removed and recreated, control values carried over. `--new-version` bumps `v###`.

### 4.4 Ease math and baking
- The CSS bezier ↔ `KeyframeEase` conversion uses influence = x·100 and speed = (y/x)·Δv/Δt per dimension. Spatial properties use one ease over arc length, and influence is clamped to [0.1, 100].
- Baking: seed keys at extrema with analytic derivatives, fit the influences per segment, and split until within tolerance. Tolerances are per property kind (0.1 px, 0.05°, 0.1 opacity, …).
- Position overshoot uses separated dimensions automatically.
- Verified in AE by `valueAtTime` sampling against the reference curve (an integration test in CI).

---

## 5. Inspector (AE → IR / outline)
- `AEC.inspect(target, opts)` walks the project, a comp, a layer or a property and returns JSON. It covers:
  - layers and timing; transforms with keys, all eases and spatial tangents;
  - expressions;
  - effects, with full trees but changed values only by default;
  - text docs, including style runs via `characterRange` sampling at style boundaries;
  - shape contents and pen paths; masks; mattes;
  - 3D: renderer, material, geometry, camera/light options, environment source;
  - model layers, markers, controls and EG properties.
- It skips `CUSTOM_VALUE` and fenced matchNames (D15). Gradient stops are recovered by saving a temporary `.aepx` copy and parsing its XML (`src/inspect/aepx.ts`).
- The Node side turns the JSON into:
  - (a) lossless IR, for round-trip tests and "edit then rebuild",
  - (b) a **compact outline** for agents, with ease names inferred (e.g. `easeOutCubic≈`), keyframe summaries (`0→1s, 3 keys, overshoot`) and only non-default effect params.
- **Effect discovery** (`aec effects --refresh`): enumerates `app.effects`, filters to vanilla (D19), and applies each effect to a temp layer in a temp comp, one per eval, with a blocklist for dialog/analysis effects (Apply Color LUT, 3D Camera Tracker, Warp Stabilizer, Roto Brush…). It dumps names, matchNames, value types, ranges, defaults and popup labels (by stepping `setValue`, reading the display text where available), then caches to `~/.ae-compose/catalog/26.5.json`. `src/catalog/gen-types.ts` writes `src/dsl/effects.generated.ts` (typed params per effect).

## 6. Edit operations
`apply_edits({ target, ops })` runs zod-validated ops in **one undo group**. Ops:
- **Properties and keys:** `setProperty`, `setKeys`, `addKeys`, `removeKeys`, `setEasing`.
- **Curve editing:**
  - apply a named or bezier easing to existing keys, preserving their times and values;
  - set per-key speed/influence; scale timing; change interpolation (linear/bezier/hold); set spatial tangents;
  - `reshapeCurve`, with presets like "more overshoot" or "snappier out".
- **Effects:** `addEffect`, `removeEffect`, `reorderEffect`, `setEffectParams`.
- **Timing and footage:** `retime` (in/out/start/stretch, shift or scale keys, sequence layers), `replaceFootage`.
- **Text:** `setText` (doc and runs), `addTextAnimator`.
- **Shapes and masks:** `setPath` (pen ops: move, insert or delete vertices, tangents), `addShapeContent`, `setGradient` (via `.ffx`), `setMask`.
- **3D:** `set3D` (renderer, material, geometry), `setCamera`, `setLight`.
- **Particles:** `setParticle` (typed particle params).
- **Structure:** `addControls` (converts existing animation into a control rig), `duplicateAsVariant`, `precompose`, `parent`, `setMatte`, `setBlend`.

Targets are ids, names or paths. Ambiguous targets fail with candidates listed. Every op result reports what changed (before → after), so the agent can confirm.

## 7. Bridge and execution
- `Backend` interface: `eval(script, { timeoutMs }) → { ok, result | error{name,line,message,nodeId,src} }`, plus `health()`. There are two implementations:
  - `CepBackend`: HTTP to `127.0.0.1:47811` with a token, a serialized queue, and eval-wrapping so syntax errors don't raise modals.
  - `AfterFxBackend`: `AfterFX.com -r` with a JSON result file.

  A future `UxpBackend` (AE 27 beta) slots in here.
- **Dialog watchdog** (`src/bridge/dialogs.ts` + `aewin.ps1`):
  - when an eval exceeds ~5 s, or on demand, list AE `#32770` windows and capture each one (DPI-aware) as an image,
  - answer with a named button, the default key or cancel,
  - auto-answer known safe dialogs (Crash Repair → Continue; "missing fonts/footage" → OK),
  - report the rest to the agent with the image.
- **Recovery**: crash dialog → save prompt → Save Copy (cancel or save to `scratch/`) → relaunch → Crash Repair "Continue" → wait for the bridge.
- Results larger than ~100 KB are spilled by the runtime to a temp file and read by Node.

## 8. 3D system (first-class)
1. **Renderer control:** `renderer: "advanced3d" | "cinema4d" | "classic3d"` (`ADBE Calder` / `ADBE Ernst` / `ADBE Advanced 3d`, see D36). `src/compile/renderers.ts` holds the **feature table**: extrusion/bevel, environment light, HDRI, reflections, shadows, 3D models, DOF, motion blur, per renderer. Compile fails with a clear message and the suggested renderer when a scene uses an unsupported feature. Renderer quality options are not scriptable in 26.5, so the docs say so.
2. **3D layers:**
   - all transforms: position combined or separated, orientation vs. X/Y/Z rotation, scale, anchor, auto-orient (`CAMERA_OR_POINT_OF_INTEREST`, `CHARACTERS_TOWARD_CAMERA`),
   - `material={...}` (all Material Options),
   - `geometry={{ extrude, bevel: { style, depth, direction }, holeBevelDepth }}`.
3. **Cameras:**
   - one-node or two-node; `lens` (mm) or zoom; DOF (`focusDistance`, `aperture`/`fStop`, `blurLevel`, iris settings);
   - rigs built from parented nulls: `orbit()`, `dolly()`, `truck()`, `crane()`, `pushIn()`, `lookAt(id)`, `focusOn(id)` (focus distance follows the target via expression), `follow(id)`;
   - speeds, angles and focus are exposed as controls.
4. **Lights:** parallel/spot/point/ambient/environment with intensity, color, falloff, cone, shadows. `environment={{ hdri: "studio.hdr", visible, blur }}`. Rigs: three-point, rim and key/fill.
5. **3D layout:** `ZStack` (depth spacing), `Grid3D`, `Circle3D`/`Arc3D`, `Parallax` (depth from a factor), `Orbit` placement. Unit convention: 1 unit = 1 px at z = 0.
6. **Models:** `<Model src="dog.gltf" animation="Walk" />` → `ThreeDModelLayer`, with transform, material assignment and animation option.

## 9. Particles (first-class)
- Components: `ParticleWorld`, `ParticleSystemsII`, `ParticlePlayground`, `StarBurst`, `Rainfall`, `Snowfall`, `PixelPolly`, `Shatter`, `CardDance`. Params are typed from the catalog, and `Effect` handles any other vanilla effect.
- **Layer references:** `texture={<Text>…</Text>}` or a layer id. Element-valued refs automatically become a hidden source precomp (in `_parts`) added to the comp, hidden, with the `LAYER_INDEX` param set.
- **Emitter linking:** `emitter={follow("logoNull")}` → producer position expressions from `layer.toWorld(anchorPoint)` converted to the effect's coordinate space. `burstAt: marker("Burst")` → birth-rate keys or expression gated on markers.
- **Camera integration:**
  - CC Particle World uses the comp camera (Effect Camera → comp camera) when the scene has a camera.
  - Shatter and Card Dance set `Camera System` to Comp Camera.
  - Systems without camera support are documented, with the workaround: place them on a 2D layer in a 3D precomp, or fake parallax with depth-cue nulls.
- **Presets** (controls exposed: birth rate, velocity, gravity, size, life, colors, seed): `dustBokeh`, `sparks`, `confettiBurst`, `snow`, `logoDisintegrate`, `energyTrail`, `magicSparkle`.
- **Determinism:** the seed is always set explicitly, derived from the scene seed + node id unless given, and is a variant param.
- **Feedback:** particle scenes default to contact sheets across the full duration plus a short low-res aerender preview.

## 10. Visual feedback
- `snapshot(comp, times[])`: a temp wrapper comp (premultiplied-alpha safe) with `saveFrameToPng().wait()` and the 32 bpc ×10 fix (D13). Returns PNG paths and downscaled base64.
- `contactSheet(comp, n)`: N frames → one grid image (sharp) with timecode labels. It's attached automatically to build and edit results.
- `renderPreview(comp, range, { scale, fps })`: saves a temp copy of the project and runs aerender (PNG sequence, draft settings) then ffmpeg (MP4 or GIF). Used for particle and motion checks.
- **Lint**: text overflow (box/rect vs. comp), safe-area violations, layer overlaps at peaks, blank or near-black frames, text on screen shorter than its reading time (~0.3 s + 0.06 s/char), keys with linear-only easing, renderer mismatch.

## 11. Interfaces
- **CLI** (`aec`): `build <scene.tsx> [--variants] [--new-version] [--dry-run]`, `watch`, `inspect "<comp>"`, `edit <ops.json>`, `snapshot`, `contact-sheet`, `preview`, `effects --refresh`, `dialogs`, `recover`, `doctor`.
- **MCP server** (stdio, `@modelcontextprotocol/sdk`):
  - `build_scene`, `inspect_project`, `inspect_comp`, `apply_edits`, `create_variants`
  - `snapshot`, `contact_sheet`, `render_preview` (images)
  - `list_effects`, `describe_effect`, `list_project_items`, `import_footage`
  - `list_dialogs`, `answer_dialog`, `run_extendscript` (logged escape hatch)

  Tool descriptions are written for agents: when to use each one, what comes back, and an example.
- **Skill**: `skills/ae-compose/SKILL.md` plus `CLAUDE.md`, covering the DSL reference, motion-design principles, timing for marketing, always exposing key timings as controls, always reviewing contact sheets, and offering 2–3 variants for subjective choices.

## 12. Testing
- **Unit** (vitest): DSL → IR, schema, ease math (vs. Remotion), spring fitting, layout solver, units, name resolution.
- **Codegen**: snapshot tests plus an ES3 parse of every output.
- **Integration (real AE)**: build each primitive → inspect → assert round-trip within tolerance (values, key times, eases, effect params, 3D, particles). Plus edit ops with a one-step undo check, and seed determinism (pixel-identical frames across rebuilds).
- **Visual**: contact sheets for all 14 showcases, reviewed by me and by an independent reviewer subagent.
- **Quality bar**: the kinetic type scene is built in Remotion with the same spec, and matching frames are compared side by side.
