# GOAL: Build "ae-compose": a code-first motion design compiler and live bridge for Adobe After Effects

> **How to run this:** Open Claude Code in an empty folder on the machine where After Effects is installed. Save this file as `GOAL.md` in that folder and say: *"Read GOAL.md and execute it end to end."* Opus 5.5 recommended.

---

## 0. Who you're building for and why

I'm Evan, a professional marketer and hands-on After Effects user. When Claude builds motion graphics in Remotion, the animation quality is excellent. The problem is the workflow:

- Every change has to go through a prompt.
- I wait for a full re-render to preview one change.
- I can't scrub, tweak or compare options myself.

Existing After Effects MCP servers solve the workflow problem but produce visibly worse animation. Their causes:

1. **Tools are too small.** Each call creates one layer or sets one property, so nothing is designed as a whole.
2. **Easing gets lost.** Keyframes end up linear, so motion looks robotic.
3. **There's no layout system.** Everything is placed by hand-computed pixel coordinates.
4. **Claude can't see the result.** There's no visual feedback loop.

**The product:** a tool that lets Claude author motion graphics in TypeScript/TSX, a Remotion-like language it writes fluently. It compiles that code into **native, fully editable After Effects projects**:

- real comps, layers, shape groups and text animators
- keyframes with proper temporal easing
- real effects with real parameter values
- my imported footage
- expression-control rigs I can tweak live in AE

It must also let Claude **inspect and edit an existing AE project** like a person would. It is **not** a pipeline that renders video elsewhere and imports it. The output is always native AE.

This is a personal tool. Licensing doesn't matter. Use whatever library, repo or approach is technically best.

---

## 1. Operating rules for this run

- **Work autonomously through every phase.** Don't stop to ask for approval between phases. Make decisions, record them in `docs/DECISIONS.md` with a one-line rationale, and keep going.
- **Ask me only when a human must physically act.** Examples: changing an AE preference, approving a macOS permission prompt, opening a panel, telling you which AE version or project to use. Batch these into **one up-front checklist** (see Phase 0) so you aren't blocked later.
- **Keep `docs/PROGRESS.md` current.** It should always show the phase, what's done, what's next and any open issues, so the work can resume if the session is interrupted.
- **Use subagents in parallel** for independent research and for test or verification passes. Have a separate subagent that didn't write the code review the final output against the acceptance criteria.
- **Verify, don't assume.** ExtendScript/AE scripting has many undocumented behaviors and version differences. Every API you rely on must be confirmed by running it against my installed AE, not just by reading docs.
- **Look at your output.** Whenever you produce an AE comp, capture frames (see Phase 3) and actually view the images before calling it done.
- **Commit to git** at the end of each phase with a clear message.

---

## 2. Phase 0: Environment discovery and human checklist (do first)

1. Detect the OS (macOS or Windows), the installed After Effects version(s) and their install paths, Node.js version and available package managers.
2. Find a reliable way to **execute a .jsx file in the running AE instance and get a result back**. Candidates to test:
   - macOS: `osascript` with `DoScriptFile` / `DoScript`
   - Windows: `AfterFX.exe -r` / `AfterFX.com`
   - a CEP panel bridge (see Phase 2)

   Results should come back via a JSON file written by the script.
3. Detect whether `aerender` is available and where.
4. Produce **one checklist for me** of every manual step, in order. It will likely include:
   - enabling *Preferences → Scripting & Expressions → Allow Scripts to Write Files and Access Network*
   - enabling unsigned CEP extensions (PlayerDebugMode) if you choose a CEP panel
   - macOS Automation permission for the terminal
   - opening AE with a test project
   - placing a couple of sample footage files in a known folder

   Present it once, wait for my "done," then don't interrupt again unless something genuinely new requires a human.

---

## 3. Phase 1: Research and prior art (parallel subagents)

Research and summarize in `docs/RESEARCH.md`, with a recommendation for each:

- **TypeScript → ExtendScript (ES3) toolchains.** Evaluate Hyper Brew's **Bolt CEP**, **types-for-adobe** (AE type definitions), Babel/TypeScript ES3 targets, and the polyfills needed (JSON, Array methods, etc.). Pick the toolchain that gives typed authoring and reliable ES3 output.
- **Existing AE MCP servers.** Read their source, especially the Dakkshin `after-effects-mcp` and the TheLlamainator fork, which adds keyframe/graph easing, presets and effect discovery. Note what's worth borrowing: bridge mechanics, effect discovery, easing code. Don't just adopt their narrow-tool architecture.
- **Remotion's authoring model** (composition, sequence, spring, interpolate, easing). This is the ergonomic target for the DSL. Note where it maps cleanly to AE and where it doesn't. Remotion evaluates a pure function per frame; AE wants keyframes, so explain how we bridge that.
- **Lottie/bodymovin data model**, as a reference for how others have mapped AE's layer/shape/keyframe model to JSON. It works in the opposite direction from us but is useful prior art.
- **AE scripting specifics to confirm:**
  - temporal ease (`KeyframeEase`, `setTemporalEaseAtKey`) and converting CSS-style cubic-béziers to AE speed/influence, for both 1D and multi-dimensional/spatial properties
  - spatial interpolation and auto-orient
  - text layers: `TextDocument`, fonts by PostScript name, text animators/selectors by matchName
  - shape layer matchName hierarchy
  - adding effects by matchName, and enumerating `app.effects`
  - expression controls (Slider, Color, Checkbox, Point, Angle, Dropdown)
  - Essential Graphics (`addToMotionGraphicsTemplate`)
  - precomps, track mattes in the current AE version, blending modes, motion blur, 3D layers/cameras/lights
  - `comp.saveFrameToPng` for single-frame capture, and `aerender` for frame ranges
  - undo groups
  - `app.executeCommand` IDs for things not exposed directly, such as Convert Expression to Keyframes
- **The full 3D system** in my AE version (see §4.8). Confirm by running scripts:
  - every available comp renderer (Classic 3D, Cinema 4D, Advanced 3D, or whatever this version ships) and how to set it by script
  - which features each renderer supports
  - 3D layer properties and Material Options, plus geometry options (extrude/bevel)
  - cameras and depth of field; all light types, including environment/HDRI lights
  - 3D model layers (glTF/GLB/OBJ import and their embedded animations)
  - shadows and the native 3D gizmo/views
- **Particle effects** in my AE install:
  - CC Particle World, CC Particle Systems II, Particle Playground
  - CC Star Burst, CC Rainfall/Snowfall, CC Pixel Polly, Shatter, Card Dance
  - any third-party systems found (e.g. Trapcode Particular/Form, Element 3D)

  For each, map its full parameter tree, how layer-reference params (texture or particle-source layers) are set by script, how random seeds work, and whether and how it follows the comp camera.
- **AE's newer UXP scripting** for After Effects: current status in my installed version. Decide whether it's usable now or whether ExtendScript/CEP is the safer foundation. Design the bridge so the execution backend can be swapped later.

---

## 4. Phase 2: Architecture and product design

Write `docs/ARCHITECTURE.md` before coding. It must cover the components below. These are my strong preferences; deviate only with a recorded reason.

### 4.1 Authoring layer: TSX DSL (Remotion-flavored)
- A **custom JSX runtime** (not React DOM) that evaluates in Node and produces a scene graph. Components are plain functions.
- Primitives, at minimum:
  - `Composition`, `Sequence`/`Series` (timing offsets, which become layer in/out points)
  - `Precomp`, `Footage` (references a project item by name/ID or imports a file)
  - `Solid`, `Null`, `Text`, `Shape` (rect, ellipse, path, polystar, with fill, stroke, trim paths, repeater)
  - `Adjustment`, `Camera`, `Light`
  - `Effect` (by matchName with typed params where known), `Mask`, `TrackMatte`
- **Layout helpers** that resolve at compile time: alignment, stacks/rows/columns, padding, grids, safe areas, and text measurement where feasible. This fixes the "pixel placement by hand" problem. Investigate measuring text through AE itself (`sourceRectAtTime`) via a round-trip, versus approximating in Node.
- **Animation as data, not per-frame functions:**
  - property tracks with keyframes plus easing
  - `spring()` with stiffness, damping and mass
  - `interpolate()`, named easing presets, `stagger()`, `loop()`, `wiggle`
  - per-character and per-word text animation that compiles to native text animators where possible
- An escape hatch for arbitrary `(frame) => value` functions. These get **baked** into keyframes, with sampling plus keyframe reduction, or emitted as an AE expression when that's cleaner.
- **Controls:** any value can be marked as a `control(...)`. It then compiles to an Expression Control on a "Controls" null and/or an Essential Graphics property, and the animation references it via expression. This is how I tweak timing, overshoot, delay, colors and sizes **live in AE without prompting or re-rendering**. Duration/delay controls that retime keyframes are the hardest part; design a clean way to do this, e.g. expression-driven `valueAtTime` remapping or a keyframe-free expression rig.
- **Variants:** `variants({ A: {...}, B: {...}, C: {...} })` produces sibling comps (`Promo_v003_A`, `_B`, `_C`) with different parameters, plus an optional "Compare" comp that grids them side by side.
- **Footage awareness:** the DSL can reference items already in my AE project panel, and fit, crop or trim them.

Illustrative only. Design the real API yourself:
```tsx
export default scene({ name: "Promo", width: 1920, height: 1080, fps: 30, duration: "6s" }, () => (
  <Composition>
    <Footage item="Hero_Clip.mov" trim={["2s", "8s"]} fit="cover" />
    <Stack align="center" gap={24}>
      <Text font="Inter-Bold" size={140}
        animate={{ y: spring({ from: 80, delay: control("Title Delay", 0.2) }), opacity: fade.in("0.4s") }}>
        SAY IT LOUD
      </Text>
      <Text font="Inter-Regular" size={48} animate={stagger.words({ preset: "riseIn", each: "60ms" })}>
        New collection out now
      </Text>
    </Stack>
    <Effect name="ADBE Glo2" params={{ "Glow Radius": control("Glow", 40) }} />
  </Composition>
));
```

### 4.2 Intermediate representation (IR)
- A versioned, JSON-serializable scene graph, validated with a schema (zod or equivalent). The compiler, the inspector and the MCP all speak IR.
- Every generated item carries a **stable ID**, stored in the AE layer/comp comment or another durable spot, so rebuilds and edits can target it precisely.

### 4.3 Code generator: IR → ExtendScript
- Emits ES3-valid ExtendScript backed by a **runtime helper library** (written in TS, transpiled to ES3, bundled once). The library handles:
  - easing conversion and keyframe/ease application
  - text/shape/effect builders
  - controls rigging, precomp management, layout measurement
- Every build runs inside **one undo group**, so I can undo a whole generation in one step.
- **Non-destructive by default:**
  - generated comps go in a `ae-compose/` project folder with version suffixes
  - the generator never modifies items it didn't create, unless an explicit edit operation targets them
- Validate generated code by **parsing it as ES3** (e.g. acorn with `ecmaVersion: 3`) before sending it to AE.

### 4.4 Inspector: AE → IR
- Reads an existing comp, including ones I built by hand, into IR or a detailed JSON description: layers, transforms, keyframes and eases, effects with full property trees, text, masks, expressions and controls. This lets Claude understand and modify my work, not just generate new work.
- **Effect discovery:** dumps `app.effects` plus each effect's full property tree (names, matchNames, types, ranges, defaults) for my installed AE and third-party plugins into a cached catalog. Claude uses this to set effect parameters correctly. Generate TS types from the catalog for autocomplete and validation.

### 4.5 Edit operations (surgical changes to existing projects)
- A typed set of patch operations run in undo groups:
  - set property / keyframes / easing
  - add/remove/reorder effects and set effect params
  - retime layers
  - replace footage
  - add controls to existing animation
  - duplicate as variant
  - precompose
- This is the "use After Effects like a person" mode for projects I already have open.

### 4.6 Bridge and execution
- A reliable, low-latency channel between Node and the running AE. Preferred is a CEP panel (Bolt CEP) with Node enabled, running a local WebSocket/HTTP server and calling `evalScript`. Fall back to the OS-level script execution found in Phase 0.
- Structured results and errors: script errors come back with line numbers mapped to the source TSX where possible.
- Behind an interface, so a UXP backend can replace it later.

### 4.7 Visual feedback
- `snapshot(comp, times[])` uses `saveFrameToPng` for single frames.
- `contactSheet(comp, n)` produces an N-frame grid image of the whole timeline.
- `renderPreview(comp, range, { scale, fps })` uses aerender for a short low-res MP4 or GIF when motion needs checking.
- Claude must use these to self-review: spacing, overlap, text overflow, safe areas, easing feel by comparing adjacent frames, and blank frames.

### 4.8 3D and particles (first-class, not an add-on)
3D and particle work are **core requirements**. The DSL, IR, code generator, inspector, edit ops, controls and visual feedback must all fully support them.

**3D system**
- **Renderer control:**
  - set and switch the comp renderer and its options (quality, shadows, environment, etc.)
  - the compiler knows which features each renderer supports
  - it fails with a clear message, or suggests the right renderer, when a scene uses something the chosen renderer can't do
- **3D layers:**
  - every transform: position (combined or separated), orientation vs. X/Y/Z rotation, scale, anchor point, auto-orient
  - all Material Options: casts/accepts shadows, accepts lights, ambient/diffuse/specular, shininess, metal, light transmission
  - geometry options: extrusion depth, bevel style/depth, hole bevel, on text and shape layers where the renderer supports them
- **Cameras:**
  - one- and two-node cameras, zoom/focal length, depth of field (focus distance, aperture, blur level, iris shape)
  - camera rigs built from parented nulls: orbit, dolly, truck, crane, follow-target, look-at
  - DSL helpers such as `orbit()`, `dolly()`, `pushIn()`, `lookAt(layer)`, `focusOn(layer)`
- **Lights:** parallel, spot, point and ambient, plus environment/image-based lighting with HDRI where supported. Intensity, color, falloff, cone angle/feather, shadow darkness/diffusion, and lighting/shadow-casting rigs.
- **3D models:** import glTF/GLB/OBJ (or whatever this AE version supports), place and transform them, light them, play embedded animations if available, and treat them as normal layers in the DSL.
- **3D layout and space:**
  - helpers for arranging layers in depth: z-stacks, grids in 3D, arrange-on-circle/arc, spacing, parallax depth
  - one scene-unit convention, documented clearly
- **Controls:** camera moves, focus distance, light intensity/color, extrusion depth, orbit speed and similar values are exposable as live controls, like everything else.
- **Inspector and edit ops** fully read and modify all of the above, including 3D comps I built by hand.

**Particle systems**
- **First-class DSL components** for built-in systems:
  - `ParticleWorld` (CC Particle World), `ParticleSystemsII`, `ParticlePlayground`
  - `StarBurst`, `Rainfall`, `Snowfall`, `PixelPolly`, `Shatter`, `CardDance`
  - typed params generated from the effect catalog
  - a generic `<Effect>` path for any other installed particle plugin (e.g. Trapcode Particular, if present)
- **Layer-reference params:** using another layer (text, logo, footage, precomp) as particle texture, source or map, handled automatically, including creating hidden source precomps.
- **Emitter linking:** attach an emitter to an animated layer or 3D null (via expressions) so particles follow motion. Sync particle bursts to timeline events, keyframes or markers.
- **Camera integration:** where a particle system can follow the comp camera, wire it automatically so particles sit correctly in 3D scenes with other layers. Where it can't, document the limitation and pick the best workaround.
- **Presets:** curated, good-looking starting points for marketing work: dust/bokeh ambience, sparks, confetti burst, snow, logo disintegrate, energy trail, magic sparkle. Each has its key parameters exposed as controls (birth rate, velocity, gravity, size, life, colors, seed).
- **Determinism:** always set random seeds explicitly so rebuilds and variants are reproducible. Make seed a variant parameter.
- **Visual feedback for simulations:** particle state builds up over time, so single-frame snapshots can mislead. Use contact sheets across the whole duration and short low-res previews to judge particle motion. Watch for render-time cost and keep preview settings fast.

### 4.9 Interfaces
1. **CLI:**
   - `aec build scene.tsx [--variants]`
   - `aec watch scene.tsx` (rebuild on save, replacing the previous version of that comp)
   - `aec inspect "<comp>"`
   - `aec snapshot`
   - `aec effects --refresh`
   - `aec doctor` (checks the whole environment)
2. **MCP server** (stdio), so Claude in Claude Code or the Claude desktop app can drive AE in conversation. Tools should be **coarse and expressive**, not one-property-at-a-time:
   - `build_scene` (TSX source or IR in, comp IDs out)
   - `inspect_project` / `inspect_comp`
   - `apply_edits` (batched patch ops)
   - `create_variants`
   - `snapshot` / `contact_sheet` / `render_preview` (return images)
   - `list_effects` / `describe_effect`
   - `list_project_items` / `import_footage`
   - `run_extendscript` (raw escape hatch, logged)
3. **A Claude skill / authoring guide** (`skills/ae-compose/SKILL.md` plus `CLAUDE.md`) that teaches future Claude sessions how to author great motion with this tool. It should cover:
   - DSL reference with examples
   - motion design principles: easing choices, anticipation/overshoot, staggering, hierarchy, timing for marketing content, readable text durations
   - always expose key timings as controls
   - always self-review with contact sheets
   - always offer 2–3 variants for subjective choices

---

## 5. Phase 3: Build

Build in this order, getting each layer working end to end against real AE before widening scope:

1. Bridge, plus `aec doctor`, plus a "hello world": create a comp with a solid, read a result back.
2. ES3 toolchain, runtime helper library and code-gen skeleton.
3. Core layers and transforms, then keyframes with **correct easing**. Prove that bézier → AE ease conversion matches by sampling values in AE (`valueAtTime`) and comparing against the expected curve numerically.
4. Text (including animators/per-word/per-character), shapes and footage.
5. Effects plus the discovery catalog and generated types.
6. Controls rig, then variants and the compare comp.
7. Layout helpers, including text measurement.
8. **3D system:**
   - 3D layers and transforms, then renderer control, then cameras and camera rigs
   - then lights (including environment/HDRI), then materials, extrusion/bevel, shadows and DOF
   - then 3D model import, then 3D layout helpers
9. **Particles:**
   - effect catalog coverage for all particle systems
   - typed components, layer-reference handling, emitter linking, camera integration, presets
10. Inspector, then edit operations, covering everything above including 3D and particles.
11. Visual feedback tools.
12. CLI, then MCP server, then the skill/authoring guide. The guide includes 3D cinematography basics (lens choice, camera moves, DOF, lighting setups) and particle design tips.
13. `watch` mode.

---

## 6. Phase 4: Testing

- **Unit tests:** DSL → IR, IR schema validation, easing math, layout math and spring baking/keyframe reduction (vitest or similar).
- **Code-gen tests:** snapshot tests of generated ExtendScript, and ES3 parse validation of every output.
- **Integration tests against real AE:** build each primitive. Then use the inspector to read it back and assert the IR round-trips: same layers, values, keyframe times, eases and effect params within tolerance. This is the core correctness test.
- **Edit-op tests:** apply each patch op to a fixture project, inspect and assert. Verify one undo reverts the whole operation.
- **Visual tests:** contact sheets for each showcase scene, reviewed by you (and by a separate reviewer subagent) for layout errors, overflow, blank frames and timing problems.
- **Showcase scenes** in `examples/`. Each must build cleanly and look professional:
  1. Kinetic typography title (per-word stagger, spring overshoot)
  2. Logo reveal with shape layers, trim paths and glow
  3. Lower third with exposed controls (name, title, color, timing)
  4. Product promo using **my imported footage**, with text and transitions
  5. Animated bar/line chart from a data array
  6. Social ad in 1080×1920 vertical with a layout stack
  7. Transition pack (wipes, masks, zooms) as precomps
  8. A variants demo (A/B/C plus compare comp)
  9. An edit demo: inspect a hand-built comp, then restyle its easing and effects via `apply_edits`
  10. 3D product/logo hero: extruded, beveled logo in the best renderer for it; environment/HDRI lighting; shadows; orbiting camera with rack focus. Camera speed, focus and light intensity exposed as controls.
  11. 3D fly-through: text and footage cards arranged in depth, camera dolly with DOF, parallax, motion blur
  12. Particle logo reveal: logo assembles from or bursts into particles (layer-reference texture), synced to a marker
  13. Ambient particles in 3D: dust/bokeh around a 3D scene that correctly follows the comp camera
  14. Particle Playground demo: text or grid of layers driven by Particle Playground physics
- **3D and particle tests:**
  - inspector round-trips for every 3D property: cameras, lights, materials, geometry, renderer settings
  - renderer switching behaves correctly
  - particle param round-trips
  - layer-reference wiring
  - seeds produce identical frames across rebuilds
- **Quality bar check:** build the kinetic type scene in Remotion too (same spec), render matching frames from both, and compare them side by side. The AE version should be at least as good. If not, find out why and fix the compiler, not the example.

---

## 7. Definition of done

- [ ] `aec doctor` passes on my machine.
- [ ] The 3D system is fully controllable: renderer, 3D layers, materials, extrusion, cameras/rigs/DOF, all light types, shadows and 3D models. I can ask Claude to adjust any 3D aspect of an existing comp and it does it correctly.
- [ ] Particle systems (CC Particle World, Particle Playground, and the others found) are fully controllable, with presets, emitter linking, camera integration where possible, and exposed controls.
- [ ] All fourteen showcase scenes build into native, editable AE comps with no errors, and their contact sheets look professional.
- [ ] Every showcase exposes meaningful controls; changing a control in AE changes the animation live with no rebuild.
- [ ] Variants and compare comp work.
- [ ] Inspector round-trip integration tests pass for all primitives, eases and effects in the test matrix.
- [ ] Edit ops work on a project I made by hand, each undoable in one step.
- [ ] The MCP server is registered and usable from Claude Code (and documented for the Claude desktop app). A fresh Claude session using only the skill doc can produce a good-looking new scene on first try.
- [ ] `README.md` has install, setup checklist, CLI usage, MCP setup and a 5-minute quickstart. `docs/` has architecture, decisions, research and a DSL reference.
- [ ] Final report in `docs/REPORT.md`: what was built, known limitations, what I should try first, and the next 5 improvements ranked by impact.

Begin with Phase 0 now.
