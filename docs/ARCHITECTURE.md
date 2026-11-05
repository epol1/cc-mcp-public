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
   - a **lint report**: text too briefly on screen to read, text cut off or outside the safe area, overlapping texts, box overflow, missing fonts, near-empty frames, linear-only moves (§10),
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
    ir/           zod schema of the IR plus cross-reference checks (`validateIr`, run before anything reaches AE)
    compile/      DSL tree → IR: timing, layout plan, animation lowering, baking, rig planning, feature checks
    shared/       pure TS used BOTH in Node and in the ES3 runtime (ease math, layout solver, spring, units)
    runtime/      ES3 runtime library (TS → Babel → ES3): build / inspect / edit / snapshot / measure
    codegen/      values → ES3 object literals for request scripts
    bridge/       Backend interface; CEP HTTP backend; AfterFX.com fallback; ES3 check (acorn); dialog watchdog
    catalog/      effect harvest (`harvest.ts`) → `params.json` → generated TS types; name resolution (fuzzy)
    inspect/      Node side of the inspector (JSON → compact outline)
    edit/         agent edit ops → runtime ops (key-color sampling, frame-string times)
    lint/         lint rules over the AE samples, blank-frame check on rendered frames
    scene/        TSX scene loader (esbuild)
    api/          the operations the CLI and MCP share: build, inspect, edit, snapshot, doctor, disk-cache guard
    visual/       snapshot, contact sheet (sharp), preview (frame capture + ffmpeg; aerender optional), 32 bpc fix, key-color sampling
    cli/          `aec` commands
    mcp/          MCP stdio server
  packages/bridge-cep/extension/   CEP extension (stable manifest, hot-reloaded server.js)
  examples/       14 showcase scenes (+ shared brand tokens)
  skills/ae-compose/SKILL.md       authoring guide for Claude
  tests/          unit, codegen snapshots, integration (real AE), quality (Remotion side by side)
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
- Node runs the same solver in the unit tests (estimated metrics); builds always solve inside AE with real metrics.
- Animations on laid-out layers are **relative to the solved position** by default (`y: spring({ from: 80 })` means "start 80 px below its layout slot").

### 2.5 Animation as data
Each animatable prop accepts a static value, a **track descriptor** or a function:
- `tween(from, to, { duration, delay, easing })` and `keys([...])` give exact bezier keys (2 per segment).
- `spring({ from, to, stiffness, damping, mass, delay, duration, rig })` gives Remotion-exact numerics (golden-tested against `remotion@4.0.540`).
  - `rig: "keys"` (default): extrema-seeded fitted keys, typically 5–9.
  - `rig: "expression"`: a closed-form spring expression driven by sliders.
- *(planned, not built)* `interpolate(input, inRange, outRange, …)`. Today: `sample(fn, { duration })` bakes any JS function of time into keys, and `expr(code)` writes an expression.
- Easing: the full Remotion `Easing` set plus named presets (`easeOutCubic`, `easeInOutQuart`, `expoOut`, `backOut`, `anticipate`, `snappy`, `smooth`…). Cubic forms map exactly. Others are baked (§4.4).
- `loop(anim, 'cycle' | 'pingpong' | 'offset' | 'continue')` (→ `loopOut`), `wiggle(freq, amp, { seed })` (→ `wiggle()` with `seedRandom`). Staggers: per-unit text animators have `each` + `order`; for layers, compute delays in JS or use `plus(control, i * step)` so one slider shifts the whole stagger. A `stagger()` helper is planned.
- Escape hatch: `(t) => value` (seconds). It is sampled and reduced to keys within tolerance, or emitted as an expression when `as: "expression"` and the body is expression-safe.

### 2.6 Text animation (first-class)
- `<Text>` takes every `TextDocument` attribute: font by PostScript name, size, tracking, leading, fill/stroke, caps, justification, box text, auto-fit.
- Per-range styling uses `runs={[{ start, end, fill, font, size }]}` (→ `characterRange`).
- `animate` on `<Text>` can target **units**: `perChar`, `perWord`, `perLine`. These compile to **native text animators**:
  - **Expression Selector mode** (default for eased/spring staggers): animator properties hold the "from" offsets (Position, Scale, Rotation, Opacity, Blur, Fill, Tracking…). The selector's Amount expression evaluates the exact easing or spring per unit at `time − inPoint − delay − textIndex·each`, with `each`, `duration`, `delay` and overshoot linked to controls. This gives the same per-unit curves as Remotion and is fully live-tweakable.
  - **Range Selector mode** (`selector: 'range'`): a Ramp window swept by keyed Offset (or keyed Amount when there's no stagger), for designers who prefer native keys (D69). Fixed times only.
  - **Text on a path** (`path`, `pathOptions`) and per-character 3D (automatic for rotationX/Y and z unit animators).
- Presets (`textPresets`): `riseIn`, `fadeUp`, `blurIn`, `popIn`, `trackingIn`, `typewriter`, `flipIn` (per-character 3D), `slideMask`, `scramble` (Character Offset). Exits use `direction: 'out'`, optionally `anchor: 'end'` (D51).

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
- **Sticky controls**: each control layer is stamped with the defaults it was built with. On rebuild (`build`, `watch`), the runtime re-applies only the values a designer changed from that stamp, so tweaks survive code changes while new defaults in code still take effect (D56, D60). `--reset-controls` / `resetControls` drops the tweaks.

### 2.8 Variants and compare
`variants({ A: {...}, B: {...}, C: {...} })` turns params into sibling comps `Name_v003_A/B/C`. Seed is always a variant param. An optional `Compare` comp grids the variant precomps, labeled and scaled to fit, with a shared timeline.

### 2.9 Footage awareness
`<Footage item="Hero_Clip.mov" />` resolves against the project panel by name, path or id, and imports it if given a path that isn't in the project yet. `fit` and `crop` are computed in the runtime from the real source size. `trim` maps to `startTime`/`inPoint`/`outPoint` (or time remap when `speed` is set).

---

## 3. Intermediate representation (IR)

- `src/ir/schema.ts` (zod), version `irVersion: 1`, JSON-serializable. The compiler emits it, `validateIr` checks it (shapes, key order, duplicate ids, parent/matte/asset/precomp references) before it is sent, and the runtime builds from it.
- The top level is `Project { irVersion, main, assets, comps }`. A comp has its settings (size, fps, duration, bg, renderer, motion blur, markers) and `layers`. Controls are ordinary layers (the "Controls" null) with effects, and variants are separate comps.
- A `Layer` is a discriminated union: `text | shape | solid | null | adjustment | footage | precomp | camera | light | model`. Each has `id`, `name`, `src`, timing (`in`, `out`, `start`, `stretch`), `parent`, `transform`, `threeD`, `material`, `geometry`, `effects`, `masks`, `matte`, `blend`, `motionBlur`, `expressions`, plus a type-specific payload (text doc/runs/animators, shape contents tree, …).
- **Property values** are either static values or a `Track`:
  ```ts
  Track = { keys: Key[]; dims: 'one'|'multi'|'spatial'; separated?: boolean; relativeTo?: 'layout';
            rig?: Rig; expression?: string }
  Key   = { t: frames, v, inType, outType, inEase: Ease[], outEase: Ease[], continuous?, spatial?: {ti,to,auto}, roving?: false, label? }
  Ease  = { speed: number, influence: number }   // exact AE units
  ```
  This was the design target. As built, layer properties are `{ p, v | keys, expr }` entries whose keys (`t, v, i, o, ie, oe, ti, to, …`) are in AE units (seconds, `KeyframeEase` speed/influence), so the inspector output and the IR compare directly (the round-trip test).
- **Ids**: every IR node has `id` (deterministic: scene + path + explicit `id` prop). They're written into AE as the comment tag `aec:<id>` on comps and layers, and into effect and control names where needed. Hand-built items get path ids (`comp:"Title"/layer:"Logo"`).

---

## 4. Code generator and runtime

### 4.1 Request scripts are data
- Every request is a tiny ES3 script: a preamble that loads the runtime with `$.evalFile` when it is missing or stale (version check), then one call:
  ```js
  if (!$.global.AEC || $.global.AEC.version !== "<runtimeVersion>") { $.evalFile(new File(".../dist/runtime/aec-runtime.jsx")); }
  AEC.build({ ...IR as an ES3 object literal... }, { keepControls: true })
  ```
  - The payload is an object literal: quoted keys, no trailing commas, `\u` escapes outside ASCII. It is not `JSON.parse`d (which is slow and absent in AE).
  - Every call is parsed with acorn `ecmaVersion: 3` before sending (`assertEs3`).
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
- It skips `CUSTOM_VALUE` and fenced matchNames (D15): shape gradient colors are reported as opaque. Gradients are written through generated `.ffx` presets (`src/compile/gradients.ts`, and the `gradient` edit op for any existing gradient), which record their stops in the group name for read-back. Stops of every gradient, hand-built included, are read from the saved .aep (`src/inspect/aep.ts`, D72): RIFX chunks, gradients as `GCst`/`GCky` XML, matched to the live property tree by "k-th group with this matchName" paths (AE saves only non-default properties). AE has no save-a-copy and `serializeToXML` needs an enum it doesn't publish, so the saved file is the source; unsaved changes are flagged.
- Properties with expressions are read pre-expression (`valueAtTime(t, true)`) unless `evalExpressions` is asked for, so a full inspect of a heavy project takes seconds, not minutes (D55).
- The Node side turns the JSON into:
  - (a) lossless IR, for round-trip tests and "edit then rebuild",
  - (b) a **compact outline** for agents, with ease names inferred (e.g. `easeOutCubic≈`), keyframe summaries (`0→1s, 3 keys, overshoot`) and only non-default effect params.
- **Effect discovery** (`aec effects --refresh`, `src/catalog/harvest.ts`): starts from the vanilla effect list (`effects.json`, D19) and applies each effect to a temp layer in a temp comp, one per eval, with a blocklist for dialog/analysis effects (Apply Color LUT, 3D Camera Tracker, Warp Stabilizer, Roto Brush, Numbers…). Any dialog that opens anyway is cancelled automatically. It records names, matchNames, value types, ranges, defaults and popup labels in `src/catalog/params.json` (391 of 397 effects) and regenerates `src/dsl/effects.generated.ts` (typed params per effect).

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

*As built:* the agent-facing op names are `set`, `ease`, `easeKey`, `interpolation`, `retime`, `layerTiming`, `addEffect`, `setEffect`, `removeEffect`, `moveEffect`, `text`, `path`, `layer`, `removeLayer`, `duplicateLayer`, `addLayer`, `comp`, `precompose`, `duplicateComp`, `addControls`, `ripple`, `place`, `key` and `raw` (`src/edit/ops.ts`; reference in `docs/DSL.md` §16). Built since: typed `camera`, `light`, `material`, `geometry`, `particles` and `gradient` ops (D68), and `place` with `shapes` for vector art (D66). Planned but not built: `reshapeCurve` presets and `addTextAnimator`.

### 6.1 Atomic batches
Every batch is all or nothing (D53): a net-zero sentinel change makes the undo group non-empty, and a failure part-way undoes it, so the project is exactly as before (`rolledBack: true`). One `undo` call undoes the last batch or build. Read-only tools that need temporary comps record counted no-op groups, which `undo` skips.

### 6.2 Ripple edits
`ripple` turns "make the scene at 1:02 slower" into one op (D50):
- **The edit is a time map:** old span [a, b] becomes [a, a + len] (insert: a = b; remove: len = 0; otherwise stretch).
- **Layers after the edit** move whole via `startTime`.
- **Layers spanning it:**
  - keys are remapped, with eases rescaled by segment length;
  - a key on an insert point is doubled so the value holds;
  - linear segments are split so they hold;
  - markers and in/out points are mapped.
- **ae-compose expressions:** they are time-warped, or rig pivots are moved.
- **Precomps** spanning the edit are rippled inside unless they are shared.
- **Scenes:** comp markers with a duration (named `<Sequence>`s create them). `scene + by` holds at the scene's quietest moment.

The TSX-side equivalent is `<Series>` plus exits with `anchor: 'end'` (D51).

### 6.3 Project media
- **Finding media:** `list_project_items` searches the project, and `preview_item` shows any item without placing it.
- **Placing it:** `place` adds an item or file as a layer (`below`/`above`/`start`/`fit`).
- **Keying:** `key` chroma-keys with Keylight + Advanced Spill Suppressor and an auto-sampled screen color (D52).

## 7. Bridge and execution
- `Backend` interface: `eval(script, { timeoutMs }) → { ok, result | error{name,line,message,nodeId,src} }`, plus `health()`. There are two implementations:
  - `CepBackend`: HTTP to `127.0.0.1:47811` with a token, a serialized queue, and eval-wrapping so syntax errors don't raise modals.
  - `AfterFxBackend`: `AfterFX.com -r` with a JSON result file.

  A future `UxpBackend` (AE 27 beta) slots in here.
- **Dialog watchdog** (`src/bridge/dialogs.ts` + `aewin.ps1`):
  - when an eval times out or the bridge fails, or on demand (`list_dialogs`), list AE `#32770` windows and capture each one (DPI-aware) as an image,
  - answer with a named button (`answer_dialog`),
  - auto-answer known safe dialogs (Crash Repair → Continue),
  - report the rest to the agent with the image, or say that AE is busy or not running.
- **Probe dialogs**: read-only probes (effect description, catalog harvest) run with `cancelDialogs`, which presses Cancel on any titled dialog that opens while they run (D54).
- **Recovery** (`recover_ae`, `aec recover`, D67): answers known dialogs and reports others with captures; launches AE when it isn't running and waits for the bridge (answering Crash Repair on the way); reports a hung AE and only kills and relaunches it with `force` (unsaved work is lost, so only after the user agrees). The launch and force paths are unit-tested with mocks; they have not been exercised on a live crash.

## 8. 3D system (first-class)
1. **Renderer control:** `renderer: "advanced3d" | "cinema4d" | "classic3d"` (`ADBE Calder` / `ADBE Ernst` / `ADBE Advanced 3d`, see D36). `src/compile/renderers.ts` holds the **feature table**: extrusion/bevel, environment light, HDRI, reflections, shadows, 3D models, DOF, motion blur, per renderer. Compile fails with a clear message and the suggested renderer when a scene uses an unsupported feature. Renderer quality options are not scriptable in 26.5, so the docs say so.
2. **3D layers:**
   - all transforms: position combined or separated, orientation vs. X/Y/Z rotation, scale, anchor, auto-orient (`CAMERA_OR_POINT_OF_INTEREST`, `CHARACTERS_TOWARD_CAMERA`),
   - `material={...}` (all Material Options),
   - `geometry={{ extrude, bevel: { style, depth, direction }, holeBevelDepth }}`.
3. **Cameras:**
   - one-node or two-node; `lens` (mm) or zoom; DOF (`focusDistance`, `aperture`/`fStop`, `blurLevel`, iris settings);
   - rigs: `<OrbitCamera>` (parented null + expression, live speed), `CameraMove` and its presets `PushIn`, `PullOut`, `Truck`, `Pedestal`, `Crane` (target null → move null → camera at the 1:1 framing distance; aim fixed or follow; keys with `duration`, else an eased expression over the layer; optional handheld `shake`), camera `lookAt` and `focusOn` (expressions);
   - speeds, angles and focus are exposed as controls.
4. **Lights:** parallel/spot/point/ambient/environment with intensity, color, falloff, cone, shadows. `environment={{ hdri: "studio.hdr", visible, blur }}`. Rig: `ThreePointLights` (key, fill, rim aimed at a target).
5. **3D layout:** `ZStack` (depth spacing), `Grid3D`, `Circle3D`/`Arc3D`, `Parallax` (depth from a factor), `Orbit` placement. Unit convention: 1 unit = 1 px at z = 0.
6. **Models:** `<Model src="dog.gltf" animation="Walk" />` → `ThreeDModelLayer`, with transform, material assignment and animation option.

## 9. Particles (first-class)
- Components: `ParticleWorld`, `ParticleSystemsII`, `ParticlePlayground`, `StarBurst`, `Rainfall`, `Snowfall`, `PixelPolly`, `Shatter`, `CardDance`. Params are typed from the catalog, and `Effect` handles any other vanilla effect.
- **Layer references:** `texture={<Text>…</Text>}` or a layer id. Element-valued refs automatically become a hidden source precomp (in `_parts`) added to the comp, hidden, with the `LAYER_INDEX` param set.
- **Emitter linking:** `emitter={{ follow: 'logoNull' }}` → producer position expressions from `layer.toWorld(anchorPoint)` converted to the effect's coordinate space. Bursts: `burst={{ at: 1.2 }}` → hold keys on Birth Rate; `burst={{ at: { marker: 'hit' } }}` → an expression gated on that comp marker (moving the marker retimes the burst).
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
- `renderPreview(comp, range, { scale, fps })`: captures frames of the live (unsaved) state inside AE, then ffmpeg makes an MP4 or GIF; `aerender: true` renders the saved project file instead. Used for particle and motion checks.
- **Final renders** (`src/runtime/render.ts`, `src/api/render.ts`, D65): AE's Render Queue renders the live project state with an output module template (H.264, QuickTime ProRes 422/4444, TIFF sequence, lossless AVI); ProRes 422 HQ and PNG sequences are made from a lossless intermediate with ffmpeg/sharp. The user's queued items are parked and re-queued, and the added item is removed. `render()` must not run inside an undo group (AE warns "Undo group mismatch"), and a scripted render clears AE's undo history: the runtime records that floor and `undo` reports it. Results are checked with ffprobe and come with a poster frame.
- **Disk-cache guard** (`src/api/cache.ts`): renders fill AE's disk cache, so after each snapshot, contact sheet and build the cache is purged when it passes 30 GB or the drive drops below 15 GB free (D62). Purging also clears AE's undo history (D65), so the threshold is high and the runtime records the floor.
- **Lint** (`src/runtime/lint.ts` samples, `src/lint/` rules, D63): inside the build's or edit's own undo group, one temporary text layer (at the bottom of the stack, so layer indices never shift) carries an expression that measures every visible text layer, including those in nested precomps, with `sourceRectAtTime` + `toComp` every 0.1 s. That is exact for parenting, 3D layers and cameras; 3D text behind the camera counts as off screen. Per-unit animators are read too: ae-compose reveals/exits with the current values of their live controls (parsed from the selector expression), hand-built Range Selectors from their keys. Node judges the samples (reading time vs. word count, frame edges, action/title safe, text-on-text overlap, box overflow, substituted fonts, linear-only moves) and checks the contact-sheet frames for near-empty ones. Builds, edits and `lint_comp` return the report. Not covered: occlusion by non-text layers, composition and taste (the contact sheet and the skill's review).

## 11. Interfaces
- **CLI** (`aec`): `doctor`, `build <scene.tsx> [--no-variants] [--variant A] [--version n] [--frames n] [--param k=v] [--reset-controls]`, `watch`, `inspect [comp] [--full] [--project]`, `edit <ops.json>`, `lint [comp]`, `undo [steps]`, `snapshot`, `sheet`, `preview`, `render`, `effects [query] [--describe] [--refresh]`, `import`, `dialogs`, `eval`. *(planned, not built)* `--dry-run`, `recover`.
- **MCP server** (stdio, `@modelcontextprotocol/sdk`):
  - `build_scene`, `inspect_project`, `inspect_comp`, `apply_edits`, `create_variants`, `lint_comp`, `undo`
  - `snapshot`, `contact_sheet`, `render_preview` (images), `render` (final files)
  - `list_effects`, `describe_effect`, `list_project_items`, `preview_item`, `import_footage`
  - `list_dialogs`, `answer_dialog`, `doctor`, `run_extendscript` (logged escape hatch)

  Tool descriptions are written for agents: when to use each one, what comes back, and an example.
- **Skill**: `skills/ae-compose/SKILL.md` plus `CLAUDE.md`, covering the DSL reference, motion-design principles, timing for marketing, always exposing key timings as controls, always reviewing contact sheets, and offering 2–3 variants for subjective choices.

## 12. Testing
- **Unit** (vitest, `pnpm test:unit`): DSL → IR, IR schema, ease math (vs. Remotion), spring fitting, layout solver, units, SVG paths, edit-op lowering, outline.
- **Codegen**: snapshot tests plus an ES3 parse of every output.
- **Integration (real AE, `tests/integration/`):**
  - `roundtrip.ts`: builds the primitive matrix and four showcases, inspects them, and compares every property the IR sets (values, key times, key values, eases), including inside groups, effects, masks, 3D and particles (588 properties);
  - `edit-ops.ts`: every agent op on a hand-built project, asserted through the inspector, then one undo must restore the comp exactly;
  - `renderer-seeds.ts`: renderer switching (each switch one undo step) and seed determinism (pixel-identical frames across rebuilds);
  - `ripple.ts`, `livecontrols.ts`, `ease-verify.ts`, plus the vitest suites `ease.test.ts` and `controls.test.ts`.
- **Visual**: contact sheets for all 14 showcases, reviewed by me and by an independent reviewer subagent.
- **Quality bar** (`tests/quality/compare.ts`): the kinetic type scene is rendered in Remotion from the same spec and compared frame by frame with the AE build (`docs/quality/kinetic-compare.png`).
