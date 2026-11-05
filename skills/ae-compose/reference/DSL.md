# ae-compose DSL reference

The complete authoring reference for ae-compose: TSX scenes that compile into native, editable After Effects 2026 comps, plus the `apply_edits` vocabulary for changing existing comps. It's written for Claude working in a fresh session; the workflow and motion-design guidance live in [`skills/ae-compose/SKILL.md`](../skills/ae-compose/SKILL.md).

Source of truth is the code: `src/dsl/*.ts` (public API), `src/compile/*.ts` (how props lower to AE), `src/edit/ops.ts` (edit ops), `src/mcp/server.ts` (tools). When this page and the code disagree, the code wins. Please fix the page.

**Contents**
1. [Scene files](#1-scene-files)
2. [Units and coordinates](#2-units-and-coordinates)
3. [Order, ids and names](#3-order-ids-and-names)
4. [Time: Sequence, Series, layer timing](#4-time-sequence-series-layer-timing)
5. [LayerProps (every layer)](#5-layerprops-every-layer)
6. [Layer primitives](#6-layer-primitives)
7. [Animation](#7-animation)
8. [Text](#8-text)
9. [Shapes, paths, gradients, SVG](#9-shapes-paths-gradients-svg)
10. [Effects and masks](#10-effects-and-masks)
11. [Live controls](#11-live-controls)
12. [Layout](#12-layout)
13. [3D](#13-3d)
14. [Particles](#14-particles)
15. [Motion blur](#15-motion-blur)
16. [Edit ops (`apply_edits`)](#16-edit-ops-apply_edits)
17. [MCP tools and CLI](#17-mcp-tools-and-cli)
18. [AE gotchas handled for you](#18-ae-gotchas-handled-for-you)
19. [Known limitations](#19-known-limitations)
21. [Creative toolkit (Phase 5)](#21-creative-toolkit-phase-5): expression library, rig effects, fields, cloner, beat sync, reframe and delivery, motion previews and style lint, designer panel, typography, backgrounds, data viz, storyboard, recipes, UI kit, transitions, path tools
22. [Asset sources (Phase 6)](#22-asset-sources-phase-6): find_assets, fetch_asset, `asset:` sources, credits, fonts

> **Components that make several layers** (`OrbitCamera`, `ParticleWorld`, `ZStack`, `Grid3D`, `Circle3D`, `Parallax`) return a fragment, so both the JSX form `<ParticleWorld preset="sparks" />` and the function form `{ParticleWorld({ preset: 'sparks' })}` type-check and compile to the same thing.

---

## 1. Scene files

A scene file's default export is `scene(config, render)`. `render` receives the scene params (plus `seed`) and returns one `<Composition>`.

```tsx
import { scene, Composition, Solid, Text, spring, fade } from 'ae-compose';

export default scene({ name: 'Hello', width: 1920, height: 1080, fps: 30, duration: '4s', bg: '#0e1117' }, () => (
  <Composition>
    <Solid name="BG" color="#0e1117" />
    <Text id="title" font="Inter-Black" size={140} animate={{ y: spring({ from: 80, delay: 0.2 }), opacity: fade.in('0.4s', { delay: 0.2 }) }}>
      HELLO
    </Text>
  </Composition>
));
```

### Brand tokens: `brand()`

One place for a brand's colors, fonts and type sizes, shared by scenes. Colors listed in `live` become live controls named "<Name> Color" wherever they're used, so the whole piece re-colors from one slider in AE.

```tsx
// brand.ts
export const BRAND = brand({
  colors: { ink: '#0b0d12', white: '#eef1f6', accent: '#4683c4' },
  fonts: { display: 'Inter-Black', body: 'Inter-Medium' },
  sizes: { hero: 190, body: 44 },
  live: ['accent'],                       // → "Accent Color" control
});
// scene.tsx
<Text font={BRAND.fonts.display} size={BRAND.sizes.hero} color={BRAND.colors.accent}>LAUNCH</Text>
```

`BRAND.value('ink')` gives a plain hex for places that need a fixed color (gradient stops). The showcases share `examples/brand.ts`.

### `SceneConfig`

| Prop | Type | Default | Meaning |
|---|---|---|---|
| `name` | `string` | required | Comp name prefix. Comps are named `<name>_v###`, and variants add `_A`, `_B`… The comp's identity (what a rebuild replaces) is the *name* (+ variant key). |
| `duration` | `Time` | required | Comp duration (`6`, `"6s"`, `"180f"`, `"00:00:06:00"`). |
| `width` / `height` | `number` | `1920` / `1080` | Comp size in px. |
| `fps` | `number` | `30` | Frame rate. |
| `bg` | `ColorSpec` | AE default | Comp background color. It isn't rendered when the comp is nested or rendered with alpha, so add a full-frame `<Solid>` for a real background. |
| `renderer` | `'advanced3d' \| 'cinema4d' \| 'classic3d'` | auto (§13.8) | 3D renderer. |
| `motionBlur` | `boolean \| { enabled?, shutterAngle?, shutterPhase?, samples?, adaptiveLimit? }` | off | Comp motion-blur switch and settings (§15). |
| `params` | `P & { seed?: number }` | `{}` | Default params passed to `render`. `seed` defaults to `1`. |
| `variants` | `Record<string, Partial<P>>` | none | Each key builds a sibling comp `<name>_v###_<key>` with those params merged over `params`. When variants exist, only the variants are built (pass `variants: false` to `build_scene` to build just the defaults). |
| `compare` | `boolean` | `false` | Also build `<name>_v###_Compare`: the variants side by side in a grid, labeled with the params that differ, with its own contact sheet. |
| `version` | `number` | `1` | The `v###` in the comp name. It only renames: a rebuild replaces the comps by scene id. To keep an older build, `duplicateComp` it first. |
| `lint` | `{ safe?, readingRate?, minRead?, ignore? } \| false` | on | Lint settings for this scene's builds (§18); `false` turns lint off. |

Rebuilding a scene with the same `name` replaces its comp **in place**: the same project item, generated layers recreated, and live control values kept (§11.5). To keep the previous result, `duplicateComp` it first (§16) or change `name`.

### Params, variants, compare

```tsx
import { scene, Composition, Solid, Text, Shape, Rect, Fill, Stack, spring, perWord } from 'ae-compose';

export default scene({
  name: 'Headline', duration: '3s',
  params: { accent: '#4683c4', damping: 12, headline: 'SAY IT LOUD' },
  variants: { A: { damping: 8 }, B: { accent: '#ee4266', damping: 14 }, C: { accent: '#2ec4b6', damping: 22, headline: 'SAY IT CLEAR' } },
  compare: true,
}, (p) => (
  <Composition>
    <Solid color="#0e1117" />
    <Stack gap={30}>
      <Text font="Inter-Black" size={150} animate={{ text: perWord({ from: { y: 120, opacity: 0 }, spring: { damping: p.damping, stiffness: 170 } }) }}>{p.headline}</Text>
      <Shape animate={{ scale: spring({ from: [0, 100], delay: 0.6, damping: p.damping }) }}>
        <Rect size={[600, 12]} roundness={6} />
        <Fill color={p.accent} />
      </Shape>
    </Stack>
  </Composition>
));
```

`seed` is always a param, so `variants: { A: { seed: 1 }, B: { seed: 2 } }` gives reproducible random alternates. It drives `wiggle`, random text order and Wiggle Paths. Particle components take an explicit `seed` prop (§14.5), so pass `seed={p.seed}`.

### `<Composition>`

The root element. Its props override the scene config.

| Prop | Type | Meaning |
|---|---|---|
| `bg` | `ColorSpec` | Comp background color. |
| `renderer` | `'advanced3d' \| 'cinema4d' \| 'classic3d'` | 3D renderer. |
| `motionBlur` | `boolean \| { enabled?, shutterAngle?, shutterPhase?, samples?, adaptiveLimit? }` | Comp motion blur. |
| `shutterAngle` | `number` | Shorthand for the comp shutter angle. |
| `markers` | `{ t, comment, duration? }[]` | Comp markers. Expressions can read them (`thisComp.marker.key("hit")`, and `ParticleWorld burst={{ at: { marker: 'hit' } }}` fires on one), and ripple edits move them. With a `duration` they are scenes. |

---

## 2. Units and coordinates

**Time** (`Time = number | string`): a number is seconds. Strings: `"1.5s"`, `"400ms"`, `"12f"` (frames at the comp fps), `"00:00:02:15"` (hh:mm:ss:ff), `"1:30"` (mm:ss). Animation times (delays, key times) are **relative to the layer's start**, which is its Sequence start plus its own `from`.

**Color** (`ColorSpec`): `"#4683c4"`, `"#4683c4cc"`, `"#fff"`, `"rgb(70,131,196)"`, `"rgba(…)"`, `"hsl(210,52%,52%)"`, names (`white`, `black`, `red`, `green`, `blue`, `gray`, `yellow`, `cyan`, `magenta`, `orange`, `transparent`), or arrays `[r, g, b(, a)]` in 0–1 (or 0–255 when any channel is > 1).

**Space**: comp pixels, origin top-left, +x right, **+y down**. Layers default to the **comp centre** (`x = width/2`, `y = height/2`). In 3D, `z = 0` is the plane that a default 50 mm camera sees pixel-for-pixel, and **+z is away from the camera**. Rotation is in degrees, opacity is 0–100, and scale is a percent (`scale={50}` means 50 %).

---

## 3. Order, ids and names

- **Layer order follows JSX (Remotion):** a *later* sibling renders **on top**. The first child of `<Composition>` is the bottom layer (put the background first).
- **Shape contents follow AE's Contents order instead:** inside `<Shape>` and `<Group>`, the *first* child is frontmost. `Fill`/`Stroke` paint the paths listed **above** them in the same group, and path operators (`Trim`, `Merge`, `Repeater`…) act on the paths above them. A safe order is paths, then operators, then paints (put the `Stroke` before the `Fill` to draw the stroke on top).
- **`id`**: a stable handle, written into AE as the layer comment `aec:<id>`. Edits, parenting, mattes, `lookAt`/`focusOn`, particle emitters and layer refs all use it. Without one, a path-derived id is generated (`hello.text0`). Ids must be unique across the whole scene. **Give an `id` to every layer you'll edit or reference.**
- **`name`**: the layer name in AE. Text layers default to their text (truncated to 28 chars), and others to `Solid 0`, `Shape 1`… Names don't have to be unique, *unless* an expression references the layer (`lookAt`, `focusOn`, `emitter.follow`, `__AEC_LAYER(id)__`), because AE expressions address layers by name.

---

## 4. Time: Sequence, Series, layer timing

### `<Sequence>`

Offsets its children in time (Remotion semantics): children's in/out points *and* their animation times shift by `from`.

| Prop | Type | Default | Meaning |
|---|---|---|---|
| `from` | `Time` | `0` | Start, relative to the parent sequence. |
| `duration` | `Time` | to the parent's end | Children end here. |
| `name` | `string` |  | Adds a segment to generated ids (keeps ids stable when you reorder), **and** emits a comp marker spanning the sequence (a "scene"). |

**Scenes.** A named `<Sequence>` (or named `<Series.Sequence>`) becomes a comp marker with a duration. It's visible in AE's timeline, listed by `inspect_comp` as `Scenes (ripple targets)`, and it's the handle for ripple edits: `{ "op": "ripple", "scene": "Beat 2", "by": 1 }` (§16.3). Name your beats.

```tsx
<Sequence from="2.3s" duration="2.4s" name="Beat 2">
  <Text font="Inter-Black" size={190} animate={{ opacity: fade.in() }}>NATIVE.</Text>
</Sequence>
```

### `<Series>` / `<Series.Sequence>`

Children play back to back. Each step needs a `duration`; `offset` overlaps (negative) or adds a gap (positive).

```tsx
<Series>
  <Series.Sequence duration="2s"><Text size={120}>ONE</Text></Series.Sequence>
  <Series.Sequence duration="2s" offset="-0.3s"><Text size={120}>TWO</Text></Series.Sequence>
  <Series.Sequence duration="2s"><Text size={120}>THREE</Text></Series.Sequence>
</Series>
```

### Layer timing

Every layer also takes `from` and `duration`, relative to its Sequence. The layer's animations start at its own `from`.

```tsx
<Text from={1.5} duration="2s" size={80} animate={{ opacity: fade.in('0.3s') }}>Appears at 1.5 s for 2 s</Text>
```

---

## 5. LayerProps (every layer)

Values marked *V* accept a static value, an animation (§7) or a `control()` (§11).

| Prop | Type | Default | Meaning |
|---|---|---|---|
| `id` | `string` | path-derived | Stable handle (§3). |
| `name` | `string` | derived | Layer name in AE. |
| `x`, `y`, `z` | *V* `number` | comp centre, z 0 | Position components. Setting any of them animated separates dimensions automatically. |
| `position` | *V* `Vec` | comp centre | `[x, y]` or `[x, y, z]`. |
| `anchor` | `Vec \| 'center' \| 'top' \| 'bottom' \| 'left' \| 'right' \| 'topLeft' \| 'topRight' \| 'bottomLeft' \| 'bottomRight'` | text: `'center'`; shape: AE default `[0,0]` | Anchor point in layer px, or (Text/Shape only) a point of the *content box*, measured in AE. That point sits at `x`/`y`, and scale and rotation pivot around it. |
| `scale` | *V* `Vec` | `100` | Percent. A number is uniform. |
| `rotation` | *V* `number` | `0` | Degrees (Z). |
| `rotationX`, `rotationY` | *V* `number` | `0` | 3D only. |
| `orientation` | *V* `Vec` | `[0,0,0]` | 3D only. |
| `opacity` | *V* `number` | `100` | 0–100. |
| `animate` | `Record<string, Anim \| TextUnitsAnim \| TextUnitsAnim[]>` |  | Animations by prop name: `{ y: spring({ from: 80 }), opacity: fade.in() }`. Keys are transform props (`x y z position scale rotation rotationX rotationY orientation opacity`). On `<Text>`, `text:` takes per-unit animators (§8.3). |
| `from`, `duration` | `Time` | Sequence span | Layer in point and length inside its Sequence. |
| `threeD` | `boolean` | `false` | 3D layer (§13). |
| `parent` | `string` | | Parent layer **id**, in the same comp. |
| `blend` | `'NORMAL' \| 'ADD' \| 'SCREEN' \| 'MULTIPLY' \| 'OVERLAY' \| 'SOFT_LIGHT' \| …` | `NORMAL` | AE `BlendingMode` names (also `HARD_LIGHT COLOR_DODGE COLOR_BURN LIGHTEN DARKEN DIFFERENCE HUE SATURATION COLOR LUMINOSITY LINEAR_DODGE LINEAR_LIGHT VIVID_LIGHT PIN_LIGHT ALPHA_ADD SILHOUETE_ALPHA STENCIL_ALPHA`). |
| `motionBlur` | `boolean \| 'native' \| 'force' \| 'pixel' \| { mode?, samples?, shutterAngle?, shutterPhase? }` | off | §15. |
| `matte` | `{ layer: string; type?: 'alpha' \| 'alphaInverted' \| 'luma' \| 'lumaInverted' }` | | Track matte from another layer (id). Set `hidden` on the matte source; a hidden layer still works as a matte. |
| `hidden` | `boolean` | `false` | Video switch off. |
| `shy`, `guide` | `boolean` | | Shy / guide layer. |
| `label` | `number` | | AE label color index (0–16). |
| `markers` | `{ t: Time; comment?: string; duration?: Time }[]` | | Layer markers. `t` is relative to the layer's start (`markerBase: 'sequence'`: to the enclosing Sequence's start; the UI kit uses it so `uiSteps` times hold when a component starts later). |
| `props` | `Record<string, V<any>>` | | Raw property values by AE path (matchName or display-name segments, `#n` index): `{ 'ADBE Transform Group/ADBE Opacity': 50 }`. Values can be animated, `expr(...)` or controls. |
| `expressions` | `Record<string, string>` | | Raw expressions by AE path. `__AEC_LAYER(id)__` in the code becomes `thisComp.layer("<name>")`. |
| `effects` | `Element[]` | | Effects as a list, the same as `<Effect>` children. Required on `<Precomp>`, whose children are its contents. |
| `layout` | `{ grow?, align?, width?, height?, offset? }` | | Inside layout containers (§12.2). |
| `material`, `geometry`, `autoOrient` | | | 3D (§13). |
| `children` | | | `<Effect>`/`<Mask>` on any layer. Text content on `<Text>`. Shape contents on `<Shape>`. |

### Rest values and "from alone"

- `x`, `y`, `z`, `position`: a static value is the *rest* position, and an animation in `animate` moves relative to it. **`from` alone (no `to`) is an offset from rest**: `animate={{ y: spring({ from: 80 }) }}` rises 80 px into place.
- `scale`, `rotation`, `opacity` etc.: `from` alone animates *from that absolute value to the default rest* (`100`, `0`, `100`). The rest is the default even if you also set a static `scale`/`opacity`, so give `to` explicitly when the end value isn't the default: `animate={{ opacity: tween({ from: 0, to: 60 }) }}`.
- Inside layout containers, the rest position is the solved slot, and `x`/`y` values and keys are offsets from it (§12).

```tsx
<Text id="sub" x={960} y={760} size={46} animate={{ x: tween({ from: -60, duration: '0.6s', easing: 'easeOutExpo' }), opacity: tween({ from: 0, to: 80, duration: '0.4s' }) }}>
  Slides in from 60 px left, fades to 80 %
</Text>
```

---

## 6. Layer primitives

### `<Solid>`

| Prop | Type | Default | Meaning |
|---|---|---|---|
| `color` | `ColorSpec` | `#000000` | Solid color. |
| `width`, `height` | `number` | comp size | Solid size. |

```tsx
<Solid name="BG" color="#0b0d12" />
```

### `<Null>`

A null object (LayerProps only), for parenting, rigs and particle emitters.

```tsx
<Null id="rig" name="Rig" animate={{ rotation: tween({ from: -10, to: 10, duration: '4s', easing: 'easeInOutSine' }) }} />
```

### `<Adjustment>`

An adjustment layer: its `<Effect>` children apply to every layer **below** it. Props: `width`, `height` (default comp size).

```tsx
<Adjustment name="Grade">
  <Effect name="Exposure" params={{ 'Exposure': 0.3 }} />
</Adjustment>
```

### `<Text>`

See §8.

### `<Shape>`

A shape layer whose children are its Contents (§9). Default position is the comp centre and the contents origin sits there.

### `<Footage>`

| Prop | Type | Default | Meaning |
|---|---|---|---|
| `src` | `string` | | File to import (absolute, or relative to the scene file). Reused if already imported. |
| `item` | `string` | | Use an existing project item by name instead. |
| `fit` | `'cover' \| 'contain' \| 'fill' \| 'none' \| 'width' \| 'height'` | `'cover'` | Scale to the comp from the real source size. Skipped when you set `scale`. |
| `trim` | `[Time, Time]` | | Source in/out to use. |
| `speed` | `number` | `1` | Playback speed (time stretch). |
| `loop` | `boolean` | | Loop via time remapping (`loopOut("cycle")`). |
| `muted` | `boolean` | | Disable audio. |

```tsx
<Footage id="clip" src="footage/hero.mp4" fit="cover" trim={['2s', '8s']} muted animate={{ scale: tween({ from: 108, to: 100, duration: '6s', easing: 'easeOutSine' }) }} />
```

### `<Precomp>`

Its children become a nested comp (in the scene's `_parts` folder), used as one layer. Effects go in the `effects` prop.

| Prop | Type | Default | Meaning |
|---|---|---|---|
| `width`, `height` | `number` | parent comp size | Precomp size. |
| `compDuration` | `Time` | Sequence span | Precomp duration. |
| `bg` | `ColorSpec` | | Precomp background color. |
| `collapse` | `boolean` | | Collapse transformations. |

```tsx
<Precomp id="card" name="Card" width={800} height={450} effects={[<Effect name="Drop Shadow" params={{ 'Distance': 20, 'Softness': 40, 'Opacity': 50 }} />]}>
  <Solid color="#1b2436" />
  <Text size={64}>Inside a precomp</Text>
</Precomp>
```

Inside a precomp, layer ids still need to be scene-unique, and `parent`, `matte` and expression layer refs resolve within that precomp. `control()` values used inside a precomp read the main comp's Controls layer, so one slider drives layers inside and outside precomps.

### `<Svg>`

An SVG file becomes one Shape layer with a group per drawn element: `<path>`, `<rect>` (with `rx`/`ry`), `<circle>`, `<ellipse>`, `<line>`, `<polygon>`, `<polyline>`, and `<use>` of any of them. The SVG is walked as a tree: `<g>` and element `transform`s are baked into the points, and paint is inherited the SVG way (`fill`, `stroke`, `stroke-width`, `opacity`, `fill-opacity`, `stroke-opacity`, `fill-rule`, linecap/linejoin; default fill black), from attributes, `<style>` classes or inline styles. The SVG's own strokes are kept (widths scaled with the drawing). Linear and radial gradients become native Gradient Fills. `<defs>`, `<clipPath>`, `<mask>` and `<symbol>` contents aren't drawn (a `<use>` of a symbol is). It's centred on the layer and scaled, and every path stays pen-editable. All Shape/LayerProps apply.

| Prop | Type | Default | Meaning |
|---|---|---|---|
| `src` | `string` | required | `.svg` path (absolute or relative to the scene file). |
| `width` | `number` | SVG size | Target width (keeps aspect). |
| `color` | `ColorSpec \| ControlRef` | SVG fills | Override every fill. |
| `stroke` | `{ color; width? }` | | Add a stroke (width 3), useful for draw-ons. |
| `draw` | `Anim` | | Draw-on: animates a Trim Paths `end` per group, e.g. `tween({ from: 0, to: 100, duration: '1.2s' })`. |
| `fillOpacity` | *V* `number` | | Fill opacity, e.g. fade the fill in after the draw. |
| `select` | `RegExp` | | Only elements whose id/class matches. |
| children | `<Effect>`, `<Mask>` | | Extra layer children, added after the SVG's groups. The `effects` prop works too. |

```tsx
<Svg id="logo" src="brand/logo.svg" width={900} stroke={{ color: '#4683c4', width: 3 }}
  draw={tween({ from: 0, to: 100, duration: '1.4s', easing: 'easeInOutCubic' })}
  fillOpacity={tween({ from: 0, to: 100, duration: '0.5s', delay: 1.2 })}
  effects={[<Effect name="Glow" params={{ 'Glow Radius': 30, 'Glow Threshold': 40 }} />]} />
```

**Illustrator / EPS / PDF art**: `<Vector src="logo.ai" width={800} />` imports the file and runs Layer > Create Shapes from Vector Layer during the build, then removes the source layer: the result is an editable shape layer with every path (animate Trim, color, morph by edits). All LayerProps apply. Very detailed artwork makes `inspect_comp` with `detail: "full"` slow (every vertex is listed). In edits: `place` with `shapes: true` (and `width`).

Effects can also be children: `<Svg src="brand/logo.svg"><Effect name="Glow" /></Svg>`. Group names come from the SVG element ids/classes (`<id> 1`, `<id> 2`…, or `Path n`), so edits can target `Contents/<id> 1/...`.

### `<Camera>`, `<Light>`, `<Model>`

See §13.

### `<MotionBlur>`

An adjustment layer that forces motion blur on everything below it (§15).

---

## 7. Animation

Any animatable prop accepts:
1. a **static value**: `opacity={60}`;
2. an **animation descriptor** (plain data the compiler lowers to exact native keys, text animators or expressions): `opacity={tween({ from: 0 })}` or `animate={{ opacity: tween({ from: 0 }) }}`;
3. a **`control(...)`**: a live expression control (§11).

### 7.1 `tween`

Two-key tween with exact easing. Cubic-bezier easings become exactly 2 native keys, and other curves are baked into fitted keys.

```ts
tween(from, to?, duration?, easing?)
tween({ from?, to?, duration?, delay?, easing? })
```

| Field | Type | Default | Meaning |
|---|---|---|---|
| `from` | `Vec \| ControlRef` | rest | Start value (offset from rest on x/y/z/position when `to` is omitted). A control here (on x/y/z/position) becomes a live **distance**. |
| `to` | `Vec` | rest | End value. |
| `duration` | `Time \| ControlRef` | `0.6s` | Length. A control makes it live (retimable keys). |
| `delay` | `Time \| ControlRef` | `0` | From the layer start. A control makes it live. |
| `easing` | `EasingSpec` | `'easeOutCubic'` | §7.5. |

```tsx
<Shape id="bar" anchor="left" x={300} animate={{ scale: tween({ from: [0, 100], to: [100, 100], duration: '0.7s', delay: 0.2, easing: 'easeOutExpo' }) }}>
  <Rect size={[600, 8]} />
  <Fill color="#4683c4" />
</Shape>
```

### 7.2 `spring`

Remotion-exact spring physics, fitted to native keys (typically 7–17 keys, verified in AE to ≤ 0.07 px, D32).

| Field | Type | Default | Meaning |
|---|---|---|---|
| `from`, `to` | `Vec \| ControlRef` | rest | As for `tween`. |
| `delay` | `Time \| ControlRef` | `0` | Live when a control. |
| `stiffness` | `number \| ControlRef` | `100` | Higher is faster. |
| `damping` | `number \| ControlRef` | `10` | Lower is bouncier: 8–12 lively, 14–20 controlled, 26+ no visible overshoot. |
| `mass` | `number \| ControlRef` | `1` | Heavier is slower and floatier. |
| `overshootClamping` | `boolean` | `false` | Stop at the target (no overshoot). |
| `duration` | `Time \| ControlRef` | natural settle | Stretch the spring to settle in exactly this time (Remotion `durationInFrames`). |
| `rig` | `'keys' \| 'expression'` | `'keys'` | `'expression'` emits a closed-form spring expression in which `stiffness`/`damping`/`mass`/`delay` controls are all live. With `'keys'`, only `delay`, `duration` and the `from` distance can be controls. |

```tsx
<Text id="pop" size={160} animate={{ scale: spring({ from: 0, damping: 11, stiffness: 200 }), y: spring({ from: 60, delay: 0.05 }) }}>POP</Text>
```

```tsx
const bounce = control('Bounce Damping', 9, { min: 4, max: 30 });
const el = <Text size={140} animate={{ y: spring({ from: 200, damping: bounce, rig: 'expression' }) }}>LIVE SPRING</Text>;
```

### 7.3 `keys`

Explicit keyframes. `t` is relative to the layer start, and `v` is an **absolute** value (no offset rule). `easing` is the easing of the segment *leaving* that key (default `easeOutCubic`). `hold: true` holds until the next key.

```tsx
<Shape id="dot" animate={{ position: keys(
  { t: 0, v: [400, 540], easing: 'easeInOutCubic' },
  { t: 1.2, v: [1500, 540], easing: 'easeOutBack' },
  { t: 2.0, v: [1500, 300] },
) }}>
  <Ellipse size={[60, 60]} />
  <Fill color="#ffd23f" />
</Shape>
```

### 7.4 `seq`, `wiggle`, `loop`, `expr`, `sample`

| Helper | Signature | Meaning |
|---|---|---|
| `seq` | `seq(...parts: (tween \| spring)[])` | Plays parts back to back. Each part's `delay` counts from the end of the previous part, and a part without `from` starts where the previous one ended. |
| `wiggle` | `wiggle(freq, amp, { octaves?, ampMult?, seed? })` | AE `wiggle()` expression, seeded (`seedRandom`). `freq`/`amp` may be controls. The seed defaults to the scene seed. |
| `loop` | `loop(anim, mode = 'cycle')` | Keys of `anim` plus `loopOut(mode)`; mode `'cycle' \| 'pingpong' \| 'offset' \| 'continue'`. |
| `expr` | `expr(code, refs?)` | Raw expression. Reference controls as `__AEC_CONTROL(Name)__` (listing them in `refs`) and layers as `__AEC_LAYER(id)__`. |
| `sample` | `sample((t) => value, { duration, delay? })` | Any function of seconds-from-start, sampled and reduced to native keys within tolerance. Values are absolute. |

```tsx
<Text id="beat" size={120} animate={{
  opacity: seq(fade.in('0.4s'), fade.out(2.2, '0.3s')),
  rotation: wiggle(1.5, 3, { seed: 7 }),
  y: seq(tween({ from: 40, duration: '0.5s', easing: 'easeOutExpo' }), tween({ to: 520, duration: '0.3s', delay: 1.9, easing: 'easeInCubic' })),
}}>
  IN, HOLD, OUT
</Text>
```

```tsx
const show = control('Show Badge', true);
const badge = (
  <Shape id="badge" opacity={expr('__AEC_CONTROL(Show Badge)__ ? 100 : 0', [show])}
    animate={{ rotation: loop(tween({ from: 0, to: 360, duration: '4s', easing: 'linear' })), y: sample((t) => 540 + Math.sin(t * Math.PI) * 20, { duration: 2 }) }}>
    <Star points={5} outerRadius={60} innerRadius={28} />
    <Fill color="#ffd23f" />
  </Shape>
);
```

### 7.5 Easing

`EasingSpec` = a name, a `[x1, y1, x2, y2]` cubic bezier, a `"cubic-bezier(…)"` string, or a function `(t) => p` (for example from `Easing`). Bezier forms become exactly 2 keys, and everything else is baked into fitted keys.

| Group | Names |
|---|---|
| Basic / CSS | `linear`, `ease` (CSS ease), `easeIn`, `easeOut`, `easeInOut` |
| Sine | `easeInSine`, `easeOutSine`, `easeInOutSine` |
| Quad | `easeInQuad`, `easeOutQuad`, `easeInOutQuad` |
| Cubic | `easeInCubic`, `easeOutCubic`, `easeInOutCubic` |
| Quart | `easeInQuart`, `easeOutQuart`, `easeInOutQuart` |
| Quint | `easeInQuint`, `easeOutQuint`, `easeInOutQuint` |
| Expo | `easeInExpo`, `easeOutExpo`, `easeInOutExpo` |
| Circ | `easeInCirc`, `easeOutCirc`, `easeInOutCirc` |
| Back (overshoot) | `easeInBack`, `easeOutBack`, `easeInOutBack` |
| Motion shorthands | `smooth` (Material standard), `snappy`, `punchy`, `gentle`, `anticipate` (pulls back first), `overshoot` |
| AE Easy Ease | `easyEase`, `easyEaseIn`, `easyEaseOut` |
| Baked (not bezier) | `bounce` / `easeOutBounce` (exact, 5 keys), `easeInBounce`, `elastic` / `easeOutElastic` |

Unknown names fail with "did you mean…". `Easing` exposes Remotion's set (`Easing.linear`, `ease`, `quad`, `cubic`, `poly(n)`, `sin`, `circle`, `exp`, `elastic(b)`, `back(s)`, `bounce`, `bezier(x1,y1,x2,y2)`, `in(f)`, `out(f)`, `inOut(f)`) for function easings:

```tsx
<Text size={120} animate={{ y: tween({ from: 100, duration: '0.8s', easing: Easing.out(Easing.back(2.2)) }) }}>CUSTOM</Text>
```

### 7.6 Presets: `fade`, `slideIn`, `popIn`

| Preset | Signature | Produces |
|---|---|---|
| `fade.in` | `fade.in(duration = '0.4s', { delay?, easing = 'easeOutCubic' })` | Opacity 0 → rest. Use on `opacity`. |
| `fade.out` | `fade.out(at, duration = '0.4s', { easing = 'easeInCubic' })` | Opacity → 0 starting at `at`. |
| `slideIn` | `slideIn(dir, distance = 80, { duration = '0.6s', delay?, easing = 'easeOutExpo', spring? })` | An offset tween (or spring). `'up'`/`'down'` go on **`y`**, and `'left'`/`'right'` on **`x`**. `'up'` starts below and rises. |
| `popIn` | `popIn({ delay?, damping = 12, stiffness = 180 })` | Spring from 0. Use on `scale`. |

```tsx
<Text id="cta" y={820} size={64} animate={{ y: slideIn('up', 60, { delay: 0.3 }), opacity: fade.in('0.3s', { delay: 0.3 }), scale: popIn({ delay: 0.3, damping: 14 }) }}>
  Shop now
</Text>
```

One prop takes one animation. To fade in *and* out, use `seq(fade.in(), fade.out(holdSeconds))` (the out's `at` counts from the end of the fade-in), or end the layer with `duration`.

---

## 8. Text

### 8.1 `<Text>` props (plus LayerProps)

| Prop | Type | Default | Meaning |
|---|---|---|---|
| children / `text` | `string` | | The text. Use `\r` for a hard line break. |
| `font` | `string` | `'Inter-Bold'` | **PostScript name** (`Inter-Black`, `Inter-Medium`, `Montserrat-SemiBold`). If AE substitutes, the build warns. |
| `size` | `number` | `72` | Font size, px. |
| `color` | *V* `ColorSpec` | white | Fill. A color `control()` drives it live (Source Text expression). |
| `stroke`, `strokeWidth`, `strokeOverFill` | `ColorSpec`, `number`, `boolean` | none, 2, false | Text stroke. |
| `tracking` | `number` | `0` | AE tracking (1/1000 em). |
| `leading` | `number \| 'auto'` | `'auto'` | Line spacing, px. |
| `align` | `'left' \| 'center' \| 'right' \| 'justify'` | `'center'` | Paragraph justification. Combine with `anchor` (`align="left" anchor="left"` for left-aligned blocks). |
| `caps` | `'normal' \| 'all' \| 'small'` | `'normal'` | All caps / small caps. |
| `fauxBold`, `fauxItalic` | `boolean` | | Faux styles. |
| `box` | `{ width: number; height?: number }` | point text | Paragraph (box) text that wraps at `width` (height defaults to 6 × size). |
| `runs` | `TextStyleRun[]` | | Per-character style ranges (below). |
| `eg` | `boolean \| string` | | Expose Source Text in Essential Graphics (`true` = layer name, or a label). |
| `perCharacter3D` | `boolean` | | Per-character 3D (makes the layer 3D). Needed for `rotationX`/`rotationY`/`z` per-unit animation. |
| `anchor` | | `'center'` | Measured from the real text bounds in AE. |

`TextStyleRun`: `{ start, end, font?, size?, color?, tracking?, baselineShift? }`. Indices are 0-based and `end` is exclusive.

```tsx
<Text id="headline" font="Inter-Black" size={120} tracking={-10} color="#eef1f6"
  runs={[{ start: 5, end: 10, color: '#4683c4', font: 'Inter-BlackItalic' }]} eg="Headline">
  MAKE MOTION
</Text>
```

```tsx
<Text id="body" font="Inter-Regular" size={40} leading={54} align="left" anchor="topLeft" x={192} y={300} box={{ width: 900 }}>
  Box text wraps at the given width. Use it for paragraphs and with perLine reveals.
</Text>
```

### 8.2 Per-unit animators: `perChar`, `perWord`, `perLine`

`animate={{ text: perWord({...}) }}` (or an array of them, e.g. an in and an out) builds a **native AE text animator** for each entry:
- the animator's properties hold the **"from" state** (Position, Scale, Rotation, Opacity, Blur, Tracking, Fill…), and units animate from it to rest;
- an **Expression Selector** (Based On chars / chars excluding spaces / words / lines) computes every unit's progress from its `textIndex` with the exact bezier easing or Remotion spring: `t = time − inPoint − delay − index·each`;
- `each`, `duration`, `delay` and spring `stiffness`/`damping`/`mass` may be `control()`s, which the expression reads live;
- `live: true` puts that timing in one "aec Text Reveal" (or "aec Spring Reveal") effect on the text layer, named like the animator, so a designer retimes it in Effect Controls (§21.2);
- the easing is an expression-library call (`L.bezier(…)` / `L.spring(…)`, §21.1);
- scale/rotation animators set anchor-point grouping per unit, so each unit pivots around its own centre.

`TextUnitsAnim` options (`perChar(o)`, `perWord(o)`, `perLine(o)`):

| Field | Type | Default | Meaning |
|---|---|---|---|
| `from` | `TextUnitFrom` | required | Start state (below). |
| `each` | `Time \| ControlRef` | chars `35ms`, words `80ms`, lines `150ms` | Stagger between units. |
| `duration` | `Time \| ControlRef` | `0.5s` | Per-unit duration (ignored by springs, which settle naturally). |
| `delay` | `Time \| ControlRef` | `0` | From the layer start (or before its end, see `anchor`). |
| `anchor` | `'start' \| 'end'` | `'start'` | What `delay` counts from. With `'end'`, the unit starts `delay` seconds **before the layer's out point**, so an exit follows the end when a Sequence gets longer or a ripple edit moves it: `{ direction: 'out', anchor: 'end', delay: 0.6 }`. |
| `easing` | bezier `EasingSpec` | `'easeOutCubic'` | Must be a bezier (name/array). `bounce`/`elastic`/functions throw, so use `spring` instead. |
| `spring` | `{ stiffness?, damping?, mass? }` (numbers or controls) | | Per-unit spring instead of easing. |
| `order` | `'start' \| 'end' \| 'center' \| 'edges' \| 'random'` | `'start'` | Stagger order. |
| `seed` | `number` | scene seed | For `order: 'random'`. |
| `direction` | `'in' \| 'out'` | `'in'` | `'out'` animates rest → `from`, starting at `delay` (exits). |
| `name` | `string` | `Reveal (words)` / `Exit (chars)` | Animator name in AE. |

`TextUnitFrom`: `x`, `y`, `z`, `opacity`, `scale` (percent, uniform), `rotation`, `rotationX`, `rotationY`, `blur` (px), `tracking`, `skew`, `fill` (color), `characterOffset` (scramble).

```tsx
<Text id="title" font="Inter-Black" size={160}
  animate={{ text: [
    perWord({ from: { y: 120, opacity: 0 }, spring: { damping: 12, stiffness: 170 }, each: control('Word Stagger', 0.08), delay: 0.2 }),
    perChar({ from: { y: -40, opacity: 0, blur: 12 }, easing: 'easeInCubic', duration: '0.25s', each: '12ms', delay: 0.8, anchor: 'end', direction: 'out' }),
  ] }}>
  MAKE IT MOVE
</Text>
```

The exit above starts 0.8 s before the layer ends, wherever that end ends up.

**Range Selector mode** (`selector: 'range'`): instead of the Expression Selector, a native Range Selector whose Offset is keyframed, the way designers build reveals by hand: the sweep is ordinary keys in the graph editor, easy to retime by dragging. A Ramp window (Ramp Up for reveals from the start, Ramp Down for exits or `order: 'end'`) of width W = 100·duration / ((n−1)·each) % sweeps Offset from −W to 100 %, so each unit takes `duration` and units are `each` apart. With no stagger (`each: 0`) the selector's Amount is keyed instead. Limits: fixed times (no live controls), an easing rather than a spring, orders `start` / `end` / `random`; AE caps the window at 100 %, so a very loose stagger is stretched (a build warning says by how much).

```tsx
<Text animate={{ text: perWord({ from: { y: 60, opacity: 0 }, easing: 'easeOutCubic', each: '300ms', duration: '0.5s', selector: 'range' }) }}>
  NATIVE RANGE KEYS
</Text>
```

**Per-character 3D** turns on by itself when a unit animator uses `rotationX`, `rotationY` or `z` (AE ignores them otherwise), or set `perCharacter3D`.

**Text on a path**: `path` (an SVG `d` or pen points, in comp pixels unless the layer is positioned) becomes a mask (mode None) that Path Options follow; `pathOptions` sets `firstMargin` / `lastMargin` (animatable: tween `firstMargin` to run the text along the curve), `reverse`, `perpendicular` and `forceAlign`.

```tsx
<Text font="Inter-Bold" size={64} align="left" path="M260 980 C 700 700, 1220 700, 1660 980"
  pathOptions={{ firstMargin: tween({ from: -560, to: 260, duration: '2.4s', easing: 'easeOutCubic' }) }}>
  TEXT ON A PATH
</Text>
```

Unit animators and layer animations combine: `animate={{ text: perChar(...), scale: tween(...) }}`.

### 8.3 `textPresets`

Every preset accepts overrides (`each`, `duration`, `delay`, `easing`, `spring`, `order`, `direction`, even `from`). The first argument picks the unit: `'char' | 'charNoSpaces' | 'word' | 'line'`.

| Preset | Unit default | From | Motion |
|---|---|---|---|
| `riseIn(by?, o?)` | word | `y 60, opacity 0` | easeOutExpo |
| `fadeUp(by?, o?)` | word | `y 24, opacity 0` | easeOutCubic |
| `blurIn(by?, o?)` | char | `blur 18, opacity 0, scale 110` | easeOutQuart |
| `popIn(by?, o?)` | char | `scale 0, opacity 0` | spring (damping 11, stiffness 220) |
| `trackingIn(o?)` | char | `tracking 60, opacity 0, blur 6` | easeOutExpo, `each 0`, 0.9 s (all chars at once) |
| `typewriter(o?)` | char | `opacity 0` | 1-frame steps every 45 ms |
| `flipIn(by?, o?)` | char | `rotationX -90, opacity 0, y 20` | easeOutBack (set `perCharacter3D`) |
| `slideMask(by?, o?)` | line | `y 110, opacity 0` | easeOutQuint, 0.7 s |
| `scramble(o?)` | char | `characterOffset 20, opacity 0` | easeOutCubic, 0.6 s |

```tsx
<Text id="sub" font="Inter-Medium" size={46} y={740} color="#9aa4b2"
  animate={{ text: textPresets.fadeUp('char', { each: '18ms', delay: 1.1 }) }}>
  Native After Effects, written in code
</Text>
```

```tsx
<Text id="flip" font="Inter-Black" size={140} perCharacter3D animate={{ text: textPresets.flipIn('char', { each: '40ms' }) }}>FLIP</Text>
```

---

## 9. Shapes, paths, gradients, SVG

Children of `<Shape>` (and `<Group>`) follow AE Contents order (§3). Props marked *V* animate.

### 9.1 Primitives

| Element | Props (defaults) |
|---|---|
| `<Rect>` | `size` *V* `[w,h]` (`[100,100]`), `position` *V* (`[0,0]`), `roundness` *V* (`0`), `name` |
| `<Ellipse>` | `size` *V* (`[100,100]`), `position` *V*, `name` |
| `<Star>` | `type` `'star' \| 'polygon'` (`'star'`), `points` *V* (`5`), `outerRadius` *V* (`100`), `innerRadius` *V* (`50`, star only), `outerRoundness` *V*, `innerRoundness` *V*, `rotation` *V*, `position` *V* |
| `<Path>` | `d` (SVG path data, M/L/H/V/C/S/Q/T/A/Z, absolute and relative; several subpaths become several paths), or `points` (pen points), `closed` (`true`), `morph` (§9.2) |
| `<Group>` | `position`, `anchor`, `scale`, `rotation`, `opacity`, `skew` (all *V*), `name`, children |

`PathPoint`: `{ p: [x, y], in?: [dx, dy], out?: [dx, dy] }`. Tangents are relative to the point.

```tsx
<Shape id="badge" x={1600} y={200}>
  <Group name="Ring">
    <Ellipse size={[180, 180]} />
    <Stroke color="#ffffff" width={6} />
  </Group>
  <Group name="Dot" scale={popIn({ delay: 0.4 })}>
    <Ellipse size={[90, 90]} />
    <Fill color="#ee4266" />
  </Group>
</Shape>
```

### 9.2 Pen paths and morphing

`morph: { t, d? | points?, easing? }[]` keyframes the path (`t` relative to layer start). Keep the same vertex count across keys for clean interpolation. Only the first subpath of each `d` is used. Easings use bezier influence (speeds are 0, so overshooting curves are flattened); the default is `easeInOutCubic`.

```tsx
<Shape id="blob">
  <Path closed points={[{ p: [-100, 0], in: [0, 55], out: [0, -55] }, { p: [0, -100], in: [-55, 0], out: [55, 0] }, { p: [100, 0], in: [0, -55], out: [0, 55] }, { p: [0, 100], in: [55, 0], out: [-55, 0] }]}
    morph={[
      { t: 0, d: 'M-100 0 C-100 -55 -55 -100 0 -100 C55 -100 100 -55 100 0 C100 55 55 100 0 100 C-55 100 -100 55 -100 0 Z' },
      { t: 1.2, d: 'M-140 0 C-140 -40 -40 -70 0 -70 C40 -70 140 -40 140 0 C140 40 40 70 0 70 C-40 70 -140 40 -140 0 Z', easing: 'easeInOutQuint' },
    ]} />
  <Fill color="#7a3cff" />
</Shape>
```

### 9.3 Paint

| Element | Props (defaults) |
|---|---|
| `<Fill>` | `color` *V* (white), `opacity` *V*, `rule` `'nonZero' \| 'evenOdd'` |
| `<Stroke>` | `color` *V* (white), `width` *V* (`4`), `opacity` *V*, `cap` `'butt' \| 'round' \| 'square'`, `join` `'miter' \| 'round' \| 'bevel'`, `dash` (`[dash, gap, …]`, up to 6), `dashOffset` *V*, `taperStart`, `taperEnd` |
| `<GradientFill>` / `<GradientStroke>` | `stops` (required), `type` `'linear' \| 'radial'` (`'linear'`), `start` *V* (`[-100,0]`), `end` *V* (`[100,0]`), `opacity` *V*, `width` *V* (stroke, `4`) |

`stops`: `{ offset: 0..1, color, opacity? }[]`, 2–8 stops (more are resampled to 8 with a warning). `start`/`end` are in the shape's local space: for a radial gradient, `start` is the centre and `end` sets the radius.

**How gradients are built:** AE 26.5 crashes when scripts read or write gradient stops (D15), so the compiler writes a `.ffx` animation preset carrying the stops (cached in `~/.ae-compose/ffx`). The runtime adds the G-Fill/G-Stroke, applies the preset to it, then sets only Type/Start/End/Opacity. The stops are recorded in the group name, e.g. `Gradient Fill [#4683c4@0 #7a3cff@0.5 #ff5a8a@1]`, so `inspect_comp` can report them. Never touch gradient internals with `run_extendscript`. To change stops, change the TSX and rebuild.

```tsx
<Shape id="card" x={640} y={540}>
  <Rect size={[460, 300]} roundness={36} />
  <GradientFill type="linear" start={[-230, 0]} end={[230, 0]} stops={[{ offset: 0, color: '#4683c4' }, { offset: 0.5, color: '#7a3cff' }, { offset: 1, color: '#ff5a8a' }]} />
</Shape>
```

### 9.4 Path operators

| Element | Props (defaults) |
|---|---|
| `<Trim>` | `start` *V* (`0`), `end` *V* (`100`), `offset` *V* (`0`, degrees), `individually` (trim multiple shapes individually) |
| `<Repeater>` | `copies` *V* (`3`), `offset` *V*, `position` *V* (`[100,0]`), `scale` *V*, `rotation` *V*, `anchor` *V*, `startOpacity` *V*, `endOpacity` *V*, `order` `'below' \| 'above'` |
| `<Merge>` | `mode` `'merge' \| 'add' \| 'subtract' \| 'intersect' \| 'exclude'` |
| `<OffsetPaths>` | `amount` *V*, `copies`, `copyOffset` *V* |
| `<RoundCorners>` | `radius` *V* |
| `<Twist>` | `angle` *V*, `center` *V* |
| `<PuckerBloat>` | `amount` *V* |
| `<WigglePaths>` | `size` *V*, `detail` *V*, `points` `'corner' \| 'smooth'`, `wigglesPerSecond` *V*, `seed` (scene seed) |
| `<ZigZag>` | `size` *V*, `ridges` *V*, `points` |

```tsx
<Shape id="ring" y={500}>
  <Ellipse size={[600, 600]} />
  <Trim end={tween({ from: 0, to: 100, duration: '1.2s', easing: 'easeInOutCubic' })} offset={tween({ from: -90, to: 0, duration: '1.2s' })} />
  <Stroke color="#4683c4" width={10} cap="round" />
</Shape>
```

```tsx
<Shape id="dots" x={560}>
  <Ellipse size={[24, 24]} />
  <Fill color="#ffffff" />
  <Repeater copies={9} position={[100, 0]} endOpacity={20} />
</Shape>
```

---

## 10. Effects and masks

### 10.1 `<Effect>`

A child of any layer (or an entry in `effects`). Only **vanilla AE effects** are known (446 in the catalog; Red Giant and other third-party effects are excluded by design).

| Prop | Type | Meaning |
|---|---|---|
| `name` | `string` | Display name (`"Gaussian Blur"`), matchName (`"ADBE Gaussian Blur 2"`) or alias. Fuzzy, and unknown names fail with "did you mean". |
| `label` | `string` | Name shown in Effect Controls. Edits can then target it. |
| `params` | `Record<string, V<any>>` | By display name (`"Glow Radius"`) or matchName (`"ADBE Glo2-0003"`). Values are numbers, `[x, y]` points (comp px), color strings, popup options by **label** (`'Glow Operation': 'Screen'`, case-insensitive, resolved from the harvested catalog) or 1-based index, animations or controls. Layer params take `{ layer: 'id' }`. A string that is neither a known option nor a color fails with a hint. |
| `enabled` | `boolean` | Effect switch. |

Aliases: `glow`, `blur`/`gaussianBlur`, `fastBlur`, `directionalBlur`, `dropShadow`, `fill`, `tint`, `ramp`/`gradientRamp`, `fractalNoise`, `turbulentDisplace`, `curves`, `levels`, `hueSaturation`, `exposure`, `lensFlare`, `vignette`, and the particle systems (`particleWorld`, `shatter`, …).

Use `list_effects` to search and `describe_effect` to get exact param names, ranges, defaults and popup labels before setting params you're unsure of. Some effects repeat a display name in different groups (Particle Playground's "Position", "Force"), so use the matchName for those.

```tsx
<Text id="logo-type" size={160} color="#ffffff">
  GLOW
  <Effect name="Glow" params={{ 'Glow Threshold': 40, 'Glow Radius': control('Glow Radius', 30, { min: 0, max: 120 }), 'Glow Intensity': keys({ t: 0.3, v: 0 }, { t: 0.8, v: 1.6 }, { t: 1.6, v: 0.8 }) }} />
  <Effect name="Drop Shadow" label="Soft Shadow" params={{ 'Shadow Color': '#000000', 'Opacity': 60, 'Distance': 12, 'Softness': 30 }} />
</Text>
```

```tsx
<Solid id="ramp" name="Ramp">
  <Effect name="Gradient Ramp" params={{ 'Start of Ramp': [960, 0], 'Start Color': '#1b2436', 'End of Ramp': [960, 1080], 'End Color': '#07090d', 'Ramp Shape': 'Linear Ramp' }} />
</Solid>
<Adjustment id="bloom">
  <Effect name="Glow" params={{ 'Glow Based On': 'Color Channels', 'Glow Operation': 'Screen', 'Glow Radius': 80, 'Glow Intensity': 0.6 }} />
</Adjustment>
```

### 10.2 `<Mask>`

A child of a layer. Coordinates are in **layer** space (a comp-size solid's top-left is `[0, 0]`).

| Prop | Type | Default | Meaning |
|---|---|---|---|
| `path` / `points` / `rect` | SVG `d` / `PathPoint[]` / `{ x, y, width, height }` | one required | Mask shape. |
| `mode` | `'add' \| 'subtract' \| 'intersect' \| 'none' \| 'lighten' \| 'darken' \| 'difference'` | `'add'` | Mask mode. |
| `feather` | *V* `number \| [x, y]` | | Feather px. |
| `expansion` | *V* `number` | | Expansion px. |
| `opacity` | *V* `number` | `100` | Mask opacity. |
| `inverted` | `boolean` | | Invert. |
| `name` | `string` | | Mask name. |

```tsx
<Solid id="letterbox" color="#000000">
  <Mask rect={{ x: 0, y: 140, width: 1920, height: 800 }} mode="add" inverted feather={2} />
</Solid>
```

---

## 11. Live controls

### 11.1 `control(name, value, opts?)`

Marks a value as tweakable in AE without rebuilding. Each control becomes an expression control effect on a hidden **`Controls`** null at the top of the comp, plus an **Essential Graphics** entry (the comp's EG template is named after the scene). The property reads it through an expression. Name controls the way a designer reads them: `"Title Delay"`, `"Accent Color"`.

| `value` | Kind |
|---|---|
| `number` | Slider (`opts.kind: 'angle'` gives an Angle control) |
| `boolean` | Checkbox (reads as 1/0) |
| color string, or `[r,g,b]` in 0–1 with a non-0/1 channel | Color |
| `[x, y]` | Point |
| `[x, y, z]` | 3D Point |
| `{ items: string[]; default?: string }` | Dropdown (reads as a 1-based index) |

`opts`: `{ min?, max?, kind?, eg? = true, group? }`. `min`/`max` clamp the value in the expression. `eg: false` keeps the control off the EG panel.

The same name means the same control: use a name twice to drive several props from one slider. Using one name with two kinds is an error.

### 11.2 Where controls work

| Use | Live behaviour |
|---|---|
| Static prop (`opacity={control('Logo Opacity', 100)}`, `<Fill color={accent}>`, `position={control('Logo Pos', [960, 540])}`, effect params) | Property expression reads the control. A slider on `scale` drives both axes. |
| `<Text color={…}>` | Source Text style expression sets the fill. |
| `tween`/`spring` `delay`, `duration` | **Retimable-keys rig** (below). |
| `tween`/`spring` `from` on `x`/`y`/`z`/`position` (offset form) | Rig: live **distance** (amplitude). |
| Per-unit text `each`, `duration`, `delay`, spring params | Read live by the Expression Selector. |
| `wiggle(freq, amp)` | Live in the expression. |
| `spring({ rig: 'expression' })` `stiffness`/`damping`/`mass`/`delay` | Live closed-form spring. |
| `expr(code, [refs])` | `__AEC_CONTROL(Name)__` placeholders. |
| `OrbitCamera` `speed`/`startAngle`, particle presets | Live in the rig/effect. |

A control on `to`, or on `from` of a non-offset prop, is a build error. Without `rig: 'expression'`, a control on spring `stiffness`/`damping`/`mass` is created but has no effect. `keys()` doesn't read controls.

### 11.3 The retimable-keys rig

For a keyed tween/spring with a controlled delay, duration or distance, the **real keyframes stay on the property** (authored at the controls' default values, so the graph editor still shows the curve), and an expression remaps time and value:

```js
// ae-compose rig: live timing/amplitude controls (keys authored at default values)
var t0 = 0.300000;
var d = (thisComp.layer("Controls").effect("Title Delay")(1)) - 0.3;
var s = Math.max((thisComp.layer("Controls").effect("Rise Duration")(1)) / 0.6, 0.0001);
var v = valueAtTime(t0 + (time - t0 - d) / s);
v = 540 + (v - 540) * ((thisComp.layer("Controls").effect("Rise Distance")(1)) / 80);
v;
```

The curve shape is preserved exactly. To add this rig to an existing (even hand-built) animation, use the `addControls` edit op (§16).

```tsx
const delay = control('Title Delay', 0.3, { min: 0, max: 3 });
const dur = control('Rise Duration', 0.6, { min: 0.1, max: 2 });
const dist = control('Rise Distance', 80, { min: 0, max: 400 });
const title = <Text id="title" size={140} animate={{ y: tween({ from: dist, duration: dur, delay, easing: 'easeOutExpo' }) }}>RETIME ME</Text>;
```

### 11.4 Dropdowns and checkboxes

Read them with `expr`:

```tsx
const style = control('Style', { items: ['Light', 'Dark'], default: 'Dark' });
const bg = <Solid id="bg" color="#ffffff" opacity={expr('__AEC_CONTROL(Style)__ == 2 ? 0 : 100', [style])} />;
```

### 11.5 Sticky controls

When a scene is rebuilt in place, the current control values in AE are read first and re-applied afterwards (the build report says `kept N live control value(s)`). A designer's tweaks survive code changes. The flip side: **changing a control's default in code doesn't change an existing comp**. Rename the control, or set the value with `{"op": "setEffect", "layer": "Controls", "effect": "Title Delay", "params": {"#1": 0.5}}`.

---

## 12. Layout

Layout containers position their child layers **inside After Effects with real text and shape metrics** (`sourceRectAtTime`, measured before animators distort the bounds), in the same eval and undo step as the build. A `<Stack>` of two texts is centred and spaced exactly, whatever the font.

Rules:
- Containers are not layers; only their leaves (Text, Shape, Solid, Footage, Precomp…) become layers. A layout tree at the top of `<Composition>` fills the comp, and inside `<SafeArea>` it fills the safe area.
- A leaf's position is its solved slot. `x`, `y` and position animations are **offsets from the slot**: `animate={{ y: spring({ from: 80 }) }}` rises into place.
- The leaf's `anchor` maps to the same point of its slot. A left-anchored text sits at the slot's left edge (use `align="left" anchor="left"` for left-aligned blocks), and `anchor="left"` on a bar makes it grow from the left.
- A static `scale` is included in the measured size.

### 12.1 Containers

Common props (all containers): `id`, `padding` (`number` or CSS-style `[t, r, b, l]` / `[v, h]` / `[t, h, b]`), `width`, `height` (outer size), `minWidth`, `maxWidth`, `offset` (`[dx, dy]` after placement), `grow` (as a stack child).

| Container | Extra props | Meaning |
|---|---|---|
| `<Stack>` | `direction` `'column' \| 'row'` (`'column'`), `gap`, `align` `'start' \| 'center' \| 'end' \| 'stretch'` (cross axis, `'center'`), `justify` `'start' \| 'center' \| 'end' \| 'spaceBetween' \| 'spaceAround' \| 'spaceEvenly'` (main axis, `'start'`) | Flexbox-like stack. Shrink-wraps its content unless `justify`/`grow` makes it fill. |
| `<Column>` / `<Row>` | as Stack minus `direction` | Shorthands for `<Stack direction="column">` / `<Stack direction="row">`. |
| `<Grid>` | `columns` (`ceil(√n)`), `gap`, `rowGap`, `colGap`, `align` | Row-major grid. Columns and rows are sized to their largest item. |
| `<Align>` | `at` `'center' \| 'top' \| 'bottom' \| 'left' \| 'right' \| 'topLeft' \| 'topRight' \| 'bottomLeft' \| 'bottomRight'` (required) | Places its child at a side/corner of the available area (comp, safe area or parent cell). |
| `<Center>` | | `<Align at="center">`. |
| `<Padding>` | | Insets its children. |
| `<Box>` | `align` | Fixed-size box (`width`/`height`); children overlaid inside. |
| `<Overlay>` | `align` | Children stacked in the same slot. |
| `<SafeArea>` | `kind` `'title' \| 'action' \| [t, r, b, l]` (`'title'`) | Constrains its children to title-safe (10 % inset), action-safe (5 %) or custom px insets. Top level of the composition only. |

### 12.2 The leaf `layout` prop

`layout={{ grow?, align?, width?, height?, offset? }}` on a layer inside a container: `grow` takes a share of leftover main-axis space, `align` is self-alignment (overrides the stack's `align`), `width`/`height` give an explicit slot size instead of the measured one, and `offset` shifts the slot.

```tsx
<Stack gap={28}>
  <Text font="Inter-Black" size={120} animate={{ text: perWord({ from: { y: 80, opacity: 0 }, spring: { damping: 13, stiffness: 170 }, each: '80ms' }) }}>LAYOUT, SOLVED</Text>
  <Text font="Inter-Regular" size={44} color="#8b95a5" animate={{ y: spring({ from: 40, delay: 0.5 }), opacity: tween({ from: 0, duration: '0.5s', delay: 0.5 }) }}>Measured in After Effects</Text>
</Stack>
```

```tsx
<SafeArea kind="title">
  <Align at="bottomLeft">
    <Stack gap={10} align="start">
      <Shape anchor="left" animate={{ scale: spring({ from: [0, 100], delay: 1 }) }}><Rect size={[340, 8]} /><Fill color="#4683c4" /></Shape>
      <Text font="Inter-Bold" size={56} align="left" anchor="left">Jordan Reyes</Text>
      <Text font="Inter-Medium" size={30} align="left" anchor="left" color="#9aa4b2">Motion Designer</Text>
    </Stack>
  </Align>
</SafeArea>
```

```tsx
<Grid columns={3} gap={40}>
  <Text size={60}>ONE</Text>
  <Text size={60}>TWO</Text>
  <Text size={60}>THREE</Text>
  <Text size={60} layout={{ align: 'start' }}>FOUR</Text>
</Grid>
```

```tsx
<Stack direction="row" gap={24} width={1400} justify="spaceBetween">
  <Text size={48}>Left</Text>
  <Text size={48} layout={{ offset: [0, -20] }}>Lifted</Text>
  <Text size={48}>Right</Text>
</Stack>
```

`maxWidth` doesn't wrap text. Give the `<Text>` a `box={{ width }}` to wrap.

---

## 13. 3D

### 13.1 3D layers

Set `threeD` on any layer to make it 3D (cameras, lights, models and `perCharacter3D` text are 3D automatically). 3D layers gain `z`, `rotationX`, `rotationY`, `orientation`, `material`, `geometry` and `autoOrient` (`'none' | 'path' | 'camera' | 'characters'`). Units: 1 = 1 px at z = 0, +z is away from the default camera, and −y is up.

### 13.2 `<Camera>`

| Prop | Type | Default | Meaning |
|---|---|---|---|
| `lens` | `number` (mm) | `50` | Focal length on a 36 mm film back, converted to zoom: `zoom = lens × compWidth / 36`. |
| `zoom` | *V* `number` | from `lens` | Raw AE zoom px. |
| `position` / `x` `y` `z` | *V* | `[w/2, h/2, −zoom]` | Default framing shows z = 0 pixel-exact. `from`-alone offsets work: `animate={{ z: tween({ from: -400 }) }}` pushes in. |
| `pointOfInterest` | *V* `Vec` | comp centre | Two-node target. |
| `lookAt` | `string` | | Aim at a layer id (expression). |
| `oneNode` | `boolean` | `false` | One-node camera (no point of interest). |
| `dof` | `boolean` | | Depth of field (turned on by `focusDistance`/`focusOn`). |
| `focusDistance` | *V* `number` | zoom | Focus distance px. Animate it for a rack focus. |
| `focusOn` | `string` | | Keep focus on a layer id (expression). |
| `aperture` | *V* `number` px | AE default | Blur amount. **20–60 is subtle, 80–200 is cinematic.** |
| `fStop` | `number` | | AE's definition: `aperture = zoom / fStop`. Real-world stops give extreme blur at AE's scale (f/2.8 at 50 mm on 1280 px ≈ 635 px aperture), so prefer `aperture`. |
| `blurLevel` | *V* `number` | `100` | DOF blur level %. |
| `iris` | `{ shape?, rotation?, roundness?, aspect?, diffraction?, highlightGain?, highlightThreshold?, highlightSaturation? }` | | Bokeh shape (`'fastRectangle' 'triangle' 'square' 'pentagon' 'hexagon' 'heptagon' 'octagon' 'nonagon' 'decagon'`). |

```tsx
<Text id="hero" font="Inter-Black" size={200} threeD>HERO</Text>
<Camera id="cam" name="Camera" lens={35} dof focusOn="hero" aperture={60}
  animate={{ z: tween({ from: -500, duration: '5s', easing: 'easeInOutSine' }), x: tween({ from: -120, duration: '5s', easing: 'easeInOutSine' }) }} />
```

Rack focus: animate `focusDistance` between the distances of two subjects (camera z distance to each).

```tsx
<Camera id="cam" lens={50} dof aperture={90} focusDistance={tween({ from: 2667, to: 3467, duration: '0.8s', delay: 2, easing: 'easeInOutCubic' })} />
```

### 13.3 `OrbitCamera(...)`

A two-node camera parented to a 3D null that turns around Y; all speeds and angles may be controls. It takes every Camera prop (except `position`/`pointOfInterest`/`parent`) plus:

| Prop | Type | Default | Meaning |
|---|---|---|---|
| `id` | `string` | `'orbitCam'` | Camera id. The rig null is `<id>.rig`. |
| `target` | `[x, y, z]` | `[960, 540, 0]` | World point to orbit (set it for non-1080p comps). |
| `radius` | `number` | `1400` | Distance from target. |
| `speed` | `number \| ControlRef` | `15` | Degrees per second. |
| `startAngle` | `number \| ControlRef` | `0` | Degrees. |
| `height` | `number` | `0` | Camera height above the target (positive is up). |
| `delay` | `number` | `0` | Seconds before the orbit starts. |

```tsx
<Text id="hero" font="Inter-Black" size={200} threeD position={[960, 520, 0]}>HERO</Text>
{OrbitCamera({ target: [960, 520, 0], radius: 1600, height: 250, speed: control('Orbit Speed', 12), startAngle: -25, lens: 50, dof: true, focusOn: 'hero', aperture: 50 })}
```

**Camera moves**: `CameraMove({ target, move: [x, y, z], aim, duration, delay, easing, shake, distance, rig, ...CameraProps })` builds a target null, a "move" null and the camera parented to it at AE's 1:1 framing distance for the lens (read live from its zoom, or `distance`). `aim: 'follow'` moves the aim with the camera (truck, pedestal, push-in); `'fixed'` keeps looking at the target (crane, arc). By default the move is a **live rig**: one "Camera Move" effect on the move null holds Travel X/Y/Z, Delay, Duration (0 = until the layer ends, so it follows Sequence length and ripple edits), Easing (Ease In-Out Sine/Cubic, Ease Out Expo, Linear, or "As Built" = the `easing` given) and the handheld shake (amount, frequency); retime or retarget it in Effect Controls (§21.2). `rig: 'keys'` (needs `duration`) makes the move ordinary keys on the move null instead. `shake: { amount, freq, seed }` sets the handheld wiggle. Presets:

| Helper | Move | Aim |
|---|---|---|
| `PushIn({ travel = 400 })` | toward the target | follow |
| `PullOut({ travel = 400 })` | away from the target | follow |
| `Truck({ travel = 500 })` | sideways (+ right) | follow |
| `Pedestal({ travel = 300 })` | up | follow |
| `Crane({ travel = 400 })` | up, view tilts down onto the subject | fixed |

```tsx
<Crane name="Camera" lens={35} target={[640, 360, 0]} travel={350} duration="3s" delay={0.4} shake={{ amount: 4, freq: 1 }} />
<ThreePointLights target={[640, 360, 0]} intensity={control('Key Intensity', 110)} />
```

**`ThreePointLights({ target, intensity, color, distance, castsShadows })`**: key spot high front-left (casts shadows), soft fill front-right (45 %), rim behind and above (70 %), all aimed at `target`. `intensity` may be a control.

### 13.4 `<Light>`

| Prop | Type | Default | Meaning |
|---|---|---|---|
| `kind` | `'point' \| 'spot' \| 'parallel' \| 'ambient' \| 'environment'` | `'point'` | Light type. |
| `intensity` | *V* `number` | `100` | Percent. |
| `color` | *V* `ColorSpec` | white | Light color. |
| `position` | *V* | `[w/2, h/2, −600]` | Not used by ambient/environment (they have no transform). |
| `pointOfInterest` / `lookAt` | *V* `Vec` / id | comp centre | Spot/parallel aim. |
| `coneAngle`, `coneFeather` | *V* | `90`, `50` | Spot cone. |
| `falloff` | `'none' \| 'smooth' \| 'inverseSquare'` | `'none'` | Falloff. |
| `radius`, `falloffDistance` | *V* | `500` | Falloff start/distance. |
| `castsShadows` | `boolean` | | Shadows (Advanced 3D: spot/parallel only). |
| `shadowDarkness`, `shadowDiffusion` | *V* | `100`, `0` | Shadow look. |
| `hdri` | `string` | | Environment light image (equirectangular `.hdr`/`.exr`/`.png`). Requires `kind="environment"`. Advanced 3D. |
| `backgroundVisible`, `backgroundOpacity`, `backgroundBlur` | | | Show the environment as background. |

```tsx
<Text id="hero" font="Inter-Black" size={240} threeD geometry={{ extrusion: 40 }} material={{ castsShadows: true, metal: 80, reflection: 30 }}>HERO</Text>
<Light id="env" kind="environment" hdri="hdri/studio.hdr" intensity={80} backgroundVisible={false} />
<Light id="key" kind="spot" intensity={120} position={[500, 100, -900]} lookAt="hero" castsShadows shadowDarkness={60} shadowDiffusion={30} coneAngle={60} />
<Light id="rim" kind="spot" intensity={150} color="#7fb3ff" position={[1500, 300, 900]} lookAt="hero" coneAngle={50} />
```

### 13.5 `<Model>`

A 3D model layer (`.glb`, `.gltf`, `.obj`, absolute or relative to the scene file). Advanced 3D (auto-selected). Its `material` maps to the model's Compositing Options (`castsShadows`, `acceptsShadows`, `acceptsLights`, `appearsInReflections`, `shadowColor`). Model scale depends on the file's units, so check the contact sheet.

```tsx
<Model id="product" src="models/product.glb" position={[960, 560, 0]} scale={400} material={{ castsShadows: true }}
  animate={{ rotationY: tween({ from: -30, to: 30, duration: '6s', easing: 'easeInOutSine' }) }} />
```

### 13.6 `material` (Material Options)

| Field | Range | Notes |
|---|---|---|
| `castsShadows`, `acceptsShadows` | `boolean \| 'only'` | `'only'` = shadow only (invisible itself). |
| `acceptsLights`, `appearsInReflections` | `boolean` | |
| `ambient`, `diffuse`, `specular`, `shininess`, `metal` | *V* 0–100 | Classic material. |
| `reflection`, `reflectionSharpness`, `reflectionRolloff` | *V* 0–100 | PBR (Advanced 3D). |
| `transparency`, `transparencyRolloff`, `ior` | *V* | PBR (Advanced 3D). |
| `lightTransmission` | *V* 0–100 | Classic 3D only. |
| `shadowColor` | `ColorSpec` | |

### 13.7 `geometry` (Geometry Options)

| Field | Type | Notes |
|---|---|---|
| `extrusion` | *V* px | Text/shape extrusion (Advanced 3D or Cinema 4D). |
| `bevel` | `{ style?: 'none' \| 'angular' \| 'concave' \| 'convex'; depth?; direction?: 'inward' \| 'outward' \| 'center' }` | Bevel. |
| `holeBevelDepth` | *V* % | |
| `curvature`, `segments` | *V* −100..100, `number` | Footage planes (curved footage: Advanced 3D/Cinema 4D). |

```tsx
<Text id="hero" font="Inter-Black" size={240} color="#e8833a" threeD position={[960, 500, 0]}
  geometry={{ extrusion: 60, bevel: { style: 'convex', depth: 6 } }} material={{ castsShadows: true, specular: 60, shininess: 40 }}>
  AE
</Text>
```

### 13.8 Renderers

From AE 26.5's own Composition Settings strings, verified by rendering (`src/compile/renderers.ts`):

| Feature | Classic 3D | Cinema 4D | Advanced 3D |
|---|:-:|:-:|:-:|
| Extruded/beveled 3D text or shapes | ✗ | ✓ | ✓ |
| 3D model layers (glTF/GLB/OBJ) | ✗ | ✗ | ✓ |
| Environment (HDRI) lights | ✗ | ✗ | ✓ |
| Camera depth of field | ✓ | ✗ | ✓ |
| Motion blur | ✓ | ✗ | ✗ |
| Light transmission | ✓ | ✗ | ✗ |
| Effects/masks/mattes/blend modes on 3D text, shape or model layers | ✓ | ✗ | ✗ |
| Shadows from point/ambient lights | ✓ | ✓ | ✗ |
| Curved footage planes | ✗ | ✓ | ✓ |
| PBR materials (reflection, transparency, IOR) | ✗ | ✗ | ✓ |

**Auto-selection** (when a comp has 3D layers and no `renderer`): models, environment lights or PBR materials pick **Advanced 3D**, and so do extrusion or curved footage. Otherwise it's **Classic 3D**. The build warns when it picks Advanced 3D.

**Conflicts:** extrusion, models, environment lights, effects on 3D vector layers and curved footage are **hard** requirements, and the build stops with a message naming the renderer that supports it. Motion blur, DOF, light transmission, point-light shadows and PBR on the wrong renderer are **soft**: a warning, and the feature is ignored.

**Advanced 3D restrictions**:
- no layer motion blur (put `<MotionBlur />` above, §15);
- no effects, masks, mattes or blend modes on 3D text/shape/model layers (put the effect on an adjustment layer above, or precompose the 3D layers);
- `motionBlur: 'force'` on a 3D text/shape counts as an effect, so it fails;
- shadows only from spot/parallel lights;
- no light transmission;
- frames are slow: about 3.5 s each with HDRI and DOF, plus a ~100 s warm-up on the first render. Pass `frames: 6` to `build_scene`.

Renderer quality settings aren't scriptable.

### 13.9 3D layout helpers

Computed in Node (no measurement). Each child becomes `threeD`, and its own `x`/`y`/`z` are offsets from the computed spot. They return arrays, so call them as functions (typing note at the top).

| Helper | Props (defaults) | Meaning |
|---|---|---|
| `ZStack` | `origin` (`[960,540,0]`), `spacing` (`400`) | Child *i* at `origin + i·spacing` along z. |
| `Grid3D` | `origin`, `columns` (`ceil(√n)`), `spacing` `[x, y]` (`[420,300]`), `plane` `'xy' \| 'xz'` | Grid on a wall (xy) or floor (xz), centred on origin. |
| `Circle3D` | `center`, `radius` (`800`), `startAngle` (`0`), `arc` (`360`), `face` `'out' \| 'center' \| 'camera'` (`'out'`) | Ring/arc in the XZ plane, each child turned to face out, in, or toward the camera. |
| `Parallax` | `factor` (`1`) | Child `z = depth × factor`, where `depth` is a prop on each child (untyped today, see §20). |

```tsx
{ZStack({ spacing: 600, children: [
  <Text size={140}>NEAR</Text>,
  <Text size={140}>MIDDLE</Text>,
  <Text size={140}>FAR</Text>,
] })}
{Circle3D({ radius: 900, face: 'center', children: [<Solid width={400} height={240} color="#4683c4" />, <Solid width={400} height={240} color="#7a3cff" />, <Solid width={400} height={240} color="#ee4266" />] })}
<Camera lens={35} />
```

---

## 14. Particles

All systems are vanilla AE effects on ordinary layers (a solid or adjustment host, an `Effect`, an optional texture precomp, expressions and hold keys), so everything stays editable. Give each particle component a unique `id`: the default ids collide when you use two of the same.

### 14.1 `ParticleWorld(...)` (CC Particle World)

Builds a comp-size black solid whose pixels are replaced by particles. Takes LayerProps plus:

| Prop | Type | Default | Meaning |
|---|---|---|---|
| `id` | `string` | `'particles'` | Layer id (also the default seed source). |
| `name` | `string` | preset name in Title Case | Layer name. Also the prefix of the live controls. |
| `preset` | `ParticlePreset` | | Starting point (below). |
| `params` | `Record<string, any>` | | CC Particle World params by display name or matchName. These override the preset. Values may be animations, `expr()` or controls. |
| `controls` | `boolean` | `true` | Expose the preset's key params as live controls. |
| `seed` | `number` | hash of `id` | Random Seed. Pass `seed={p.seed}` to vary with variants. |
| `texture` | `string \| Element` | | A layer id, or an element (wrapped in a hidden precomp) used as the particle texture. Sets Particle Type to Textured QuadPolygon unless a textured type is given. |
| `textureSize` | `[w, h]` | `[256, 256]` | Texture precomp size (element textures). |
| `emitter` | `{ follow: string }` | | Producer follows a layer's anchor in world space (expressions on Position X/Y/Z), for example an animated null or a logo. |
| `burst` | `{ at: Time \| { marker: string }; duration?: Time; rate?: number }` | `duration 0.15s`, `rate` = the preset's Birth Rate | Emit only in a burst: Birth Rate hold keys 0 → `rate` at `at` → 0. `at: { marker: 'hit' }` fires at the comp marker with that comment instead (an expression reads it, so moving the marker in AE retimes the burst). Frame times (`'12f'`) work. |
| `width`, `height` | `number` | comp size | Host solid size. |

Units: producer Position and Radius X/Y/Z are in **host layer widths** (`Position X 0.25` = +480 px on a 1920 layer), and +y is down. CC Particle World **follows the comp camera** automatically when the comp has one.

### 14.2 Presets (`particlePresets`)

The live params become controls named `"<name> <param>"`, e.g. `Sparks Birth Rate`. Longevity is never a control (CC Particle World rejects expressions on it).

| Preset | Live controls (defaults) | Look |
|---|---|---|
| `dustBokeh` | Birth Rate 0.25, Velocity 0.04, Birth Size 0.035 | Slow floating bokeh, 6 s life, warm → cool, low opacity, wide volume. |
| `sparks` | Birth Rate 2.5, Velocity 1.3, Gravity 0.7 | Fast short-lived sparks, yellow → orange, point emitter. |
| `confettiBurst` | Birth Rate 12, Velocity 1.6, Gravity 0.9 | Spinning confetti, yellow → pink, 3 s life. Pair with `burst`. |
| `energyTrail` | Birth Rate 3, Velocity 0.08, Birth Size 0.06 | Cyan → violet glow trail that inherits velocity. Pair with `emitter.follow`. |
| `magicSparkle` | Birth Rate 1.2, Velocity 0.25, Birth Size 0.05 | White → gold twinkles, rotating. |
| `logoDisintegrate` | Birth Rate 6, Velocity 0.6, Gravity −0.15 | Textured fragments drifting up. Pair with `texture`. |
| `snowfall` | Birth Rate 0.8, Velocity 0.05, Gravity 0.06 | Wide emitter above frame, slow white flakes, 8 s life. |

```tsx
{ParticleWorld({ id: 'dust', preset: 'dustBokeh', seed: 3 })}
<Null id="comet" animate={{ position: keys({ t: 0, v: [150, 560], easing: 'easeInOutCubic' }, { t: 2.6, v: [1130, 180] }) }} />
{ParticleWorld({ id: 'trail', name: 'Comet Trail', preset: 'energyTrail', emitter: { follow: 'comet' } })}
{ParticleWorld({ id: 'confetti', preset: 'confettiBurst', burst: { at: 1.2, duration: 0.2, rate: 14 }, params: { 'Position Y': -0.1 } })}
{ParticleWorld({ id: 'stars', name: 'Star Sparks', preset: 'magicSparkle', blend: 'ADD',
  texture: <Shape><Star points={4} outerRadius={60} innerRadius={14} /><Fill color="#ffffff" /></Shape> })}
```

A `texture` element must be a layer (`<Shape>`, `<Text>`, `<Footage>`…). It's wrapped in a hidden precomp of `textureSize`. To use a layer that's already in the comp, pass its id instead.

**Multi-color confetti**: `<Confetti colors={['#ffd23f', '#ee4266', '#3bceac']} burst={{ at: { marker: 'pop' }, rate: 30 }} />`. CC Particle World has one color ramp per system, so this stacks one confetti system per color (same position, emitter and burst, own seed, birth rate split evenly). One set of live controls drives them all: "<name> Amount" (total birth rate, continuous emission only), "<name> Velocity", "<name> Gravity". Default colors: yellow, pink, teal, blue, white.

### 14.3 Other systems

All take LayerProps, `id`, `name`, `params`, `seed` (where the effect has one) and `width`/`height`.

| Component | Effect | Host | Notes |
|---|---|---|---|
| `<ParticleSystemsII>` | CC Particle Systems II | solid | 2D fountain. Has Random Seed. |
| `<StarBurst>` | CC Star Burst | solid | Star field flying at the camera. No seed. |
| `<Rainfall>` | CC Rainfall | adjustment | Rain over everything below. Has Random Seed. |
| `<Snowfall>` | CC Snowfall | adjustment | Snow over everything below. Has Random Seed. |
| `<ParticlePlayground>` | Particle Playground | solid | Cannon/grid/layer exploder plus physics. Layer refs: `{ 'Explode Layer': { layer: 'logo' } }`. Duplicate param names, so use matchNames. |

```tsx
<Footage id="street" src="footage/street.mp4" />
<Rainfall id="rain" params={{ 'Drops': 8000, 'Speed': 5000, 'Opacity': 30 }} seed={4} />
```

### 14.4 Content effects: `PixelPolly`, `Shatter`, `CardDance`

Apply an effect to their content. With a single layer child, the effect is added to that layer. With several children, they're precomposed (`id`, `name`, `width`, `height`) first.

| Component | Effect | Useful params |
|---|---|---|
| `<PixelPolly>` | CC Pixel Polly | `Force`, `Gravity`, `Spinning`, `Force Center`, `Direction Randomness`, `Speed Randomness`, `Grid Spacing`, `Start Time (sec)` |
| `<Shatter>` | Shatter | `Pattern`, `Repetitions`, `Extrusion Depth`, `Gravity`, `Camera System` (Comp Camera in 3D scenes) |
| `<CardDance>` | Card Dance | Rows/columns and gradient-layer driven cards |

```tsx
<PixelPolly params={{ 'Force': 120, 'Gravity': 1, 'Start Time (sec)': 1.5 }}>
  <Text id="breakme" font="Inter-Black" size={140} color="#ffffff">BREAK IT</Text>
</PixelPolly>
```

### 14.5 Seeds and determinism

Seeds are always explicit, so a rebuild is pixel-identical. `ParticleWorld` and the host systems default to a hash of their `id` (not the scene seed), so pass `seed={p.seed}` (or `p.seed + 1` for a second layer) to vary them per variant. `wiggle`, random text order and Wiggle Paths use the scene seed.

---

## 15. Motion blur

| Level | How | Notes |
|---|---|---|
| Comp | `scene({ motionBlur: true })` or `{ enabled, shutterAngle (180), shutterPhase (−90), samples, adaptiveLimit }`. Also `<Composition motionBlur shutterAngle>`. | The comp switch and render settings. |
| Layer (native) | `motionBlur` / `motionBlur="native"` | The layer switch. Turns the comp switch on automatically. Only blurs transform motion. Ignored in Advanced 3D and Cinema 4D. |
| Layer (forced) | `motionBlur="force"` or `{ mode: 'force', samples: 16, shutterAngle }` | Adds CC Force Motion Blur (sub-frame sampling). Works for effects, particles, precomps and text animators. Fails on 3D text/shape in Advanced 3D. |
| Layer (pixel) | `motionBlur="pixel"` or `{ mode: 'pixel', samples: 8, shutterAngle }` | Adds Pixel Motion Blur (optical flow), for footage. |
| Everything below | `<MotionBlur mode? samples? shutterAngle? shutterPhase? name? id? from? duration? />` (`mode`: `'force'` default, or `'pixel'`) | An adjustment layer ("Force Motion Blur") that blurs all layers below it. The way to get blur in Advanced 3D comps. |

```tsx
<Text id="whip" size={180} motionBlur="force" animate={{ x: tween({ from: -1400, duration: '0.5s', easing: 'easeOutExpo' }) }}>WHOOSH</Text>
<MotionBlur mode="force" samples={16} shutterAngle={200} />
```

---

## 16. Edit ops (`apply_edits`)

`apply_edits({ comp, ops, frames? })` applies a batch of ops to an **existing** comp (generated or hand-built) in **one undo group**, then returns what changed (before → after) and a contact sheet. `undo` reverts the whole batch. Validation runs before AE is touched, and the batch is **atomic**: if any op fails, everything is rolled back (`rolledBack: true`). Run `inspect_comp` first on anything you didn't build. Every op is covered by `tests/integration/edit-ops.ts` on a hand-built project (applied, asserted, undone in one step).

**Targets.** `comp` is a comp name, aec id or item id (default: the active comp). `layer` is an aec id (the TSX `id`), a layer name (it must be unique, or the op fails and lists the candidates) or a 1-based index.

**Property names.** Friendly: `position`, `x`, `y`, `z` (only on separated positions), `scale`, `rotation`, `rotationX`, `rotationY`, `orientation`, `opacity`, `anchor`, `sourceText`. Anything else is an AE path of matchNames, display names or `#index` segments, with the prefixes `Effects/`, `Contents/`, `Masks/`: `"Effects/Glow/Glow Radius"`, `"Contents/Card/Contents/Fill 1/Color"`, `"Masks/Mask 1/Mask Feather"`. Values use the DSL units: colors as strings, times in comp seconds (strings like `"400ms"` work in `keys[].t`).

### 16.1 Properties and keys

```json
{ "comp": "Hello_v001", "ops": [
  { "op": "set", "layer": "title", "prop": "opacity", "value": 80 },
  { "op": "set", "layer": "title", "prop": "position", "keys": [{ "t": 0.2, "v": [960, 640], "easing": "easeOutExpo" }, { "t": 0.9, "v": [960, 540] }] },
  { "op": "set", "layer": "badge", "prop": "rotation", "expr": "wiggle(2, 4)" },
  { "op": "set", "layer": "badge", "prop": "rotation", "removeExpr": true, "value": 0 },
  { "op": "set", "layer": "card", "prop": "Contents/Group 1/Contents/Fill 1/Color", "value": "#ee4266" }
] }
```

`set` takes `value` (static, removes keys), `keys` (`[{ t, v, easing?, hold? }]`, where `easing` is the easing leaving that key, default `easeInOutCubic`), `expr` and/or `removeExpr`.

### 16.2 Curve editing

```json
{ "comp": "Hello_v001", "ops": [
  { "op": "ease", "layer": "title", "prop": "position", "easing": "easeOutQuint" },
  { "op": "ease", "layer": "title", "prop": "scale", "easing": [0.2, 0.9, 0.1, 1], "keys": [1, 2] },
  { "op": "easeKey", "layer": "title", "prop": "opacity", "key": 2, "side": "in", "influence": 85 },
  { "op": "interpolation", "layer": "title", "prop": "rotation", "type": "hold", "keys": [2] }
] }
```

- **`ease` with a bezier** (any name in §7.5 except the baked ones, or `[x1, y1, x2, y2]`) is exact. It is computed in AE from the real key values and times, keeps key count, times and values, and applies to every segment between selected keys (default: all).
- **`ease` with `bounce` / `easeInBounce` / `elastic`** re-bakes the selected segments: it reads the keys, then replaces each segment with fitted keys (more keys, exact shape). Springs aren't nameable here; rebuild from TSX with `spring()` for spring motion.
- `easeKey` sets AE speed/influence (0.1–100) on one key's `in`/`out`/`both` side. `interpolation` is `linear`/`bezier`/`hold`.

```json
{ "op": "ease", "layer": "ball", "prop": "position", "easing": "bounce" }
```

### 16.3 Timing

```json
{ "ops": [
  { "op": "retime", "layer": "title", "shift": 0.25 },
  { "op": "retime", "layer": "subtitle", "scale": 0.8, "pivot": 0 },
  { "op": "layerTiming", "layer": "cta", "in": 3.5, "out": 6 },
  { "op": "addControls", "layer": "title", "prop": "position", "delay": "Title Delay", "speed": "Title Speed" }
] }
```

**Ripple edits** add, remove or stretch comp time and shift *everything after it* (layer timing, keys, markers, comp length, and the insides of precomps that span the edit), so nothing needs retiming by hand. Keys of layers that span the edit are remapped with eases rescaled, and ae-compose expressions (text reveals, springs, timing rigs) are time-warped or re-anchored.

```json
{ "ops": [
  { "op": "ripple", "scene": { "at": "1:02" }, "by": 1.5 },
  { "op": "ripple", "scene": "Beat 2", "scale": 1.25 },
  { "op": "ripple", "at": 4, "by": -0.5 },
  { "op": "ripple", "span": [2, 3.5], "duration": 2 },
  { "op": "ripple", "scene": "Lockup", "by": 1, "where": "end" }
] }
```

| Field | Meaning |
|---|---|
| `at` + `by` | Insert (`by` > 0) or remove (`by` < 0) seconds starting at `at`. |
| `span: [a, b]` + `scale` / `duration` / `by` | Stretch a time range. |
| `scene` | A scene by name, or `{ at: time }` for the scene containing that time. Scenes are named `<Sequence>`s (comp markers with a duration, §4). With `by`, the extra time is added as a **hold** at the scene's quietest moment (`where: 'quiet'`, default), or at `'start'`, `'end'` or a given time. With `scale`/`duration`, the whole scene stretches. |
| `deep` | Ripple inside precomps that span the edit (default `true`). |

This is how to fix "the text in the scene at 1:02 isn't on screen long enough": `{ "op": "ripple", "scene": { "at": "1:02" }, "by": 1.5 }`. Times accept seconds, `"1.5s"`, `"12f"`, `"1:02"`.

`retime` shifts and/or scales key times around `pivot` (default: first key) on the given `props` (default: every animated transform property). Speeds rescale, so curve shapes are preserved. `layerTiming` sets `in`, `out`, `start` (source start time) and `stretch` (%). `addControls` adds the live timing rig to an existing animation: a `delay` slider (seconds) and/or a `speed` slider (%, 200 = twice as fast) on the `Controls` null (created if missing). The keys stay editable.

### 16.4 Effects

```json
{ "ops": [
  { "op": "addEffect", "layer": "logo", "effect": "Glow", "params": { "Glow Radius": 60, "Glow Intensity": 1.5 }, "label": "Bloom" },
  { "op": "setEffect", "layer": "logo", "effect": "Bloom", "params": { "Glow Radius": 90 } },
  { "op": "setEffect", "layer": "Controls", "effect": "Title Delay", "params": { "#1": 0.5 } },
  { "op": "setEffect", "layer": "bg", "effect": 1, "enabled": false },
  { "op": "moveEffect", "layer": "logo", "effect": "Bloom", "to": 1 },
  { "op": "removeEffect", "layer": "logo", "effect": "Bloom" }
] }
```

`effect` is a name/label as shown in Effect Controls, or an index. `addEffect` resolves friendly names like `<Effect>` does, and layer-ref params take `{ "layer": "<id>" }`.

### 16.5 Text and paths

```json
{ "ops": [
  { "op": "text", "layer": "title", "text": "NEW HEADLINE", "size": 150, "color": "#ffffff", "tracking": -10 },
  { "op": "path", "layer": "blob", "prop": "Contents/Path 1/Path", "d": "M-120 0 C-120 -60 120 -60 120 0 C120 60 -120 60 -120 0 Z" },
  { "op": "path", "layer": "matteShape", "prop": "Masks/Mask 1/Mask Path", "points": [{ "p": [0, 0] }, { "p": [800, 0] }, { "p": [800, 400] }, { "p": [0, 400] }], "t": 1.5 }
] }
```

`text` changes text, font, size, color, tracking or leading and keeps the rest of the style. `path` sets a path (static, or a key at `t`) from SVG `d` or pen points.

### 16.6 Layers and comps

```json
{ "comp": "Hello_v001", "ops": [
  { "op": "layer", "layer": "logo", "set": { "parent": "rig", "blend": "SCREEN", "motionBlur": true, "index": 2 } },
  { "op": "layer", "layer": "photo", "set": { "matte": { "layer": "maskShape", "type": "alpha" } } },
  { "op": "layer", "layer": "photo", "set": { "matte": null, "parent": null } },
  { "op": "duplicateLayer", "layer": "title", "name": "Title Shadow" },
  { "op": "removeLayer", "layer": "oldBadge" },
  { "op": "comp", "set": { "renderer": "classic3d", "bg": "#0b0d12", "duration": 8, "motionBlur": true, "shutterAngle": 180 } },
  { "op": "precompose", "layers": ["logo", "tagline"], "name": "Logo Lockup" },
  { "op": "duplicateComp", "name": "Hello_v001 backup" }
] }
```

`layer.set` takes `name`, `parent` (id/name/index or `null`), `blend` (AE `BlendingMode` name), `enabled`, `threeD`, `motionBlur`, `shy`, `locked`, `label`, `index` (move before that index), and `matte` (`{ layer, type }` or `null`).

### 16.7 Media: `place` and `key`

```json
{ "comp": "Interview_v001", "ops": [
  { "op": "key", "layer": "talent", "color": "auto", "strength": "normal" },
  { "op": "place", "item": "office_bg.jpg", "below": "talent", "fit": "cover", "name": "Background" },
  { "op": "place", "file": "E:/footage/broll_02.mp4", "index": 1, "start": 4, "in": 4, "out": 7.5, "fit": "cover", "muted": true }
] }
```

- **`place`** adds project media (footage, still or comp, found by item id, exact name or a unique name/file substring) or a file (imported first) as a layer. Position it with `below`/`above`/`index`. Timing is `start` (comp time where the clip starts), `in`, `out`. `fit` defaults to `none` (native size, centred); `muted` and `loop` are also available. Find media with `list_project_items` (filter by `kind: "video" | "still" | "audio" | "comp" | "solid"`) and look at it with `preview_item` before placing.
- **`key`** chroma-keys a greenscreen/bluescreen layer with built-in effects: Keylight, plus Advanced Spill Suppressor (`spill`, default on), plus Key Cleaner only with `cleanup: true` (for hair and motion-blurred edges; on solid foregrounds it softens the matte into a speckled, semi-transparent one, so it is off by default). Each batch is atomic: if any op fails, the whole batch is rolled back. `color: "auto"` (default) samples the screen color from the layer's own source frame (at `at`, default mid-layer) and reports it in the result's `notes`. Otherwise use `"green"`, `"blue"` or a hex color. `strength`: `soft` / `normal` / `hard` presets for clip black/white and choke.

### 16.8 3D, particles and gradients

```json
{ "ops": [
  { "op": "camera", "set": { "lens": 85, "focusDistance": 900, "aperture": { "keys": [{ "t": 0, "v": 10 }, { "t": 2, "v": 60, "easing": "easeInOutSine" }] } } },
  { "op": "light", "layer": "Key Light", "set": { "intensity": 140, "color": "#ffe8cc", "coneAngle": 50 } },
  { "op": "material", "layer": "card", "set": { "specular": 80, "shininess": 60, "castsShadows": false } },
  { "op": "geometry", "layer": "word", "set": { "extrusion": 60, "bevel": { "style": "convex", "depth": 4 } } },
  { "op": "particles", "layer": "sparks", "set": { "birthRate": 5, "Longevity (sec)": 1.6 } },
  { "op": "gradient", "layer": "card", "prop": "Contents/Gradient Fill 1", "stops": [{ "offset": 0, "color": "#ffff00" }, { "offset": 1, "color": "#00ff00" }], "type": "radial" }
] }
```

- **`camera`** (default: the top camera layer), **`light`**, **`material`**, **`geometry`**: the same names as the DSL props (§13). A value, or `{ "keys": [{ t, v, easing }] }`.
- **`particles`** finds the layer's particle effect (CC Particle World, Particle Systems II, Playground, Star Burst, Rainfall, Snowfall, …; or name it with `effect`). Params by display name or camelCase. When an ae-compose preset drives a param from a live control, the control is set instead (the result's `notes` says which), so the rig keeps working.
- **`gradient`** sets the stops (2–8, more are resampled), and optionally type/start/end, of an existing Gradient Fill or Gradient Stroke, hand-built ones included. Stops go in through a generated .ffx preset (the Colors property is never read: that crashes AE 26.5), and the group name records them (`Gradient Fill 1 [#ffff00@0 #00ff00@1]`), the only place a script can read them back.
- **`place`** with `"shapes": true` (and `"width"`) converts vector art (.ai, .eps, .pdf) into an editable shape layer.

### 16.9 `addLayer` (IR layer spec) and `raw`

`addLayer` takes a layer in IR form, the JSON the compiler emits (see the `IR:` file path in any build report). Colors are `[r, g, b(, a)]` in 0–1, times are seconds, and `props[].p` paths are relative to the layer. `groups` adds contents/effects under an indexed group. It's best for small additions. For anything bigger, add it to the TSX and rebuild.

```json
{ "ops": [
  { "op": "addLayer", "index": 2, "spec": { "id": "edit.shade", "type": "solid", "name": "Shade", "in": 0, "out": 6, "solid": { "color": [0, 0, 0], "w": 1920, "h": 1080 }, "props": [{ "p": "ADBE Transform Group/ADBE Opacity", "v": 30 }] } },
  { "op": "addLayer", "index": 1, "spec": { "id": "edit.badge", "type": "shape", "name": "Badge", "in": 0, "out": 6,
    "groups": [{ "at": "ADBE Root Vectors Group", "items": [
      { "mn": "ADBE Vector Shape - Ellipse", "props": [{ "p": "ADBE Vector Ellipse Size", "v": [120, 120] }] },
      { "mn": "ADBE Vector Graphic - Fill", "props": [{ "p": "ADBE Vector Fill Color", "v": [0.93, 0.26, 0.4, 1] }] }
    ] }],
    "props": [{ "p": "ADBE Transform Group/ADBE Position", "v": [1700, 160] }] } }
] }
```

Layer `type`: `solid | null | text | shape | adjustment | footage | precomp | camera | light | model`. Keys in IR are `{ t, v, i?, o?, ie?: [{ speed, influence }], oe?: [...] }`. `raw` passes a runtime op straight through, e.g. footage replacement:

```json
{ "op": "raw", "runtime": { "op": "replaceFootage", "layer": "clip", "file": "E:/footage/new_take.mp4" } }
```

---

## 17. Lint

Every `build_scene` and `apply_edits` result carries a **lint report** for the comp it built or edited; `lint_comp` (CLI `aec lint`) checks any comp, generated or hand-built. Each issue names the layer and the time range.

| Rule | Severity | What it catches |
|---|---|---|
| `reading-time` | warn | A text is readable for less than 0.5 s + words ÷ 3.5 (about 210 wpm). "Readable" = on screen, at ≥ 90 % of its peak opacity, nearly still, and past its per-unit reveal (until its exit starts). |
| `off-frame` | warn | A readable text is cut off by the frame edge. Entrances and exits from off-screen don't count. |
| `safe-area` | warn | A readable text is outside action-safe (5 % inset per side; `safe: 'title'` for 10 %, or a fraction). |
| `overlap` | warn | Two visible texts overlap (≥ 15 % of the smaller one) for 0.3 s or more. |
| `occlusion` | warn / note | A readable 2D text is ≥ 40 % covered for 0.3 s or more by a normal-blend layer stacked above it: a warning for solids and opaque footage, a note ("may be hidden") for footage with alpha and shape layers, whose bounding boxes overstate their pixels. Precomps, adjustment layers, 3D layers and solids with effects are not judged. |
| `overflow` | warn | Box text that doesn't fit its box (AE hides the last lines). |
| `missing-font` | warn | AE substituted a font that isn't installed. |
| `blank-frame` | warn | A rendered frame mid-comp is almost empty (background only). The first and last frame are ignored (fades from and to black are normal). |
| `linear-motion` | note | Position/scale keys whose moving segments are all linear. |

**Style lint** (the craft rules of SKILL.md §2, judged from the motion samples, D78) joins the same list:

| Rule | Severity | What it catches |
|---|---|---|
| `transition-repeat` | warn | The same transition kind twice in a row (layers tagged `transition:<kind>`). |
| `crowded-entrance` | warn | More than 3 elements starting their arrival within 0.2 s (cloner instances count as one). |
| `short-hold` | warn | A non-text element that lands and leaves within 0.8 s (text holds are `reading-time`). |
| `easing-monotony` | note | With 4 or more moves, every move has the same easing class. |
| `linear-move` | warn | A move judged linear that isn't a constant drift (camera drifts, tickers and loops are fine) or a fade. |
| `slide-furniture` | warn | A small element in the outer 22 % of the frame, still across 2 scenes or 70 % of the piece (tag it `persistent` or `bg` when intended). |
| `short-end-hold` | warn | The final state holds less than 2 s. |
| `everything-moves` | warn | More than 70 % of at least 3 visible elements move at once for 1 s (no focal point). |
| `dead-air` | warn | 0.6 s or more with nothing but the background on screen inside the piece. |
| `off-beat` | warn | With beat markers on the comp (§21.5), a scene start or entrance between a frame and 150 ms off a beat. |

Layer `tags` (`bg`, `persistent`, `hero`, `transition:<kind>`, `group:<id>`) tell the style lint what a layer is for; layers sharing a `group:` tag (a chart's parts) count as one element. Tags are stored in the layer comment, so edits, `lint_comp` and `motion_preview` see them too (D88).

How it measures: inside the build's (or edit's) own undo group, one temporary text layer samples every visible text layer every 0.1 s in comp coordinates with `sourceRectAtTime` + `toComp`. That is exact for parenting, 3D layers, cameras and nested precomps; 3D text behind the camera counts as off screen. Per-unit animators are read too: ae-compose reveals and exits use the current values of their live controls (stagger, delay, spring physics), and hand-built Range Selectors are read from their Start/End/Offset keys. Blank frames are judged from the contact sheet frames. A build or edit is still one undo step.

Lint judges text against text, layers stacked above text (by their bounds) and empty frames. It can't judge pixels inside precomps, 3D occlusion, or whether a composition reads well. That's what the contact sheet is for.

Tune or skip it:

```tsx
scene({ name: 'Promo', duration: '6s', lint: { safe: 'title', readingRate: 4, ignore: ['linear-motion'] } }, () => …)
```

`build_scene` / `apply_edits` take the same `lint` option (`false` skips it; options merge over the scene's). CLI: `--no-lint`, `--safe title|action|0.07`, `--reading-rate 4`, `--ignore rule,rule`.

## 18. MCP tools and CLI

### MCP tools (`aec-mcp`, stdio)

| Tool | What it does |
|---|---|
| `build_scene` | Compile TSX (`source` or `file`) into native comps. Returns a report (comps, warnings, expression errors with TSX lines, kept controls, the lint report (§17), IR path) plus contact sheets. Options: `params`, `variants` (`false` or a list of keys), `frames` (default 8, max 24), `times`, `cwd`, `resetControls`, `lint`, `motion` (previews + style lint, default on; §21.7), `reframe` (§21.6). The result also carries the speed graph image and the motion summary. |
| `create_variants` | Build a scene with several param sets as sibling comps (`{ A: {...}, B: {...} }`). One contact sheet per variant. |
| `inspect_project` | Compact list of every comp/footage/folder (names, sizes, durations, aec ids). |
| `list_project_items` | Search the Project panel: comps, footage, stills, audio, solids, folders, with size, fps, duration, alpha, file path, folder and how often each is used. Filter by `type`, `kind` (`video`, `still`, `audio`, `comp`, `solid`) or a `name`/file substring. |
| `preview_item` | Contact sheet of any project item (clip, still or comp) without placing it, e.g. to find the greenscreen take or the right background. `frames` (default 6), `times` (item-local seconds). |
| `inspect_comp` | Readable outline of a comp: layers, timing, animated props with inferred easing names (`easeOutCubic≈`, overshoot), expressions with errors, effects with changed params, text, shapes, 3D, **scenes** (named spans, the ripple targets) and markers. `detail: "full"` returns raw JSON. `sheet: true` adds a contact sheet. |
| `apply_edits` | Batched edit ops in one undo step (§16), plus a contact sheet (default 6 frames) and the lint report. The result lists each change and any `notes` (e.g. the sampled key color). |
| `lint_comp` | Lint any comp (§17): too-short reads, text cut off or outside the safe area, overlapping texts, box overflow, missing fonts, near-empty frames. `frames` (default 8) are rendered for the blank-frame check; `safe`, `readingRate`, `ignore`. |
| `snapshot` | Exact frames at given times (as AE renders them). |
| `contact_sheet` | N evenly spaced frames with timecodes (default 12). Use 12–16 for particles. |
| `render` | Final deliverable through AE's Render Queue at full quality (live project state). `format`: `mp4` (H.264; `quality` draft/standard/high = 5/15/40 Mbps), `mov` (ProRes 422), `mov-alpha` / `prores4444` (ProRes 4444 with alpha), `prores` (422 HQ via ffmpeg), `png` / `tiff` (sequences with alpha), `avi` (lossless); `settings` best/draft, `start`/`end` or `workArea`, `out` (file or folder), `template` (any AE output module). Default folder: `renders/` next to the saved project, else `~/.ae-compose/renders/`; never overwrites. Returns codec, size, frames, alpha and a poster frame. **A scripted render clears AE's undo history**: `undo` afterwards reports that earlier steps can't be undone. |
| `export_mogrt` | The comp as a Motion Graphics template (.mogrt) for Premiere. Its Essential Graphics properties (`eg=` texts, `control()`s, `field()`s) become the fields an editor fills in; the result lists their names (pr-cut `titles` set them by name). Build it transparent (no background layer) at the sequence size. AE exports only from a **saved project with no unsaved changes**: an unsaved project is refused, and pending changes need `save: true` (saves the project in place: ask the user). `out` (file or folder), `overwrite`; default folder: `mogrt/` next to the project. AE's modal warning about fonts that aren't from Adobe Fonts is answered OK and its capture returned (the machine using the template needs those fonts installed). **The export clears AE's undo history**, like a render: export when the design is approved. |
| `render_preview` | Short low-res MP4 (or GIF, returned inline) of a time range, to judge motion feel. It captures the live, unsaved state; `aerender: true` renders the saved project instead. |
| `list_effects` | Search vanilla effects by name/matchName/category. |
| `describe_effect` | Full param list of one effect: names, matchNames, types, defaults, ranges, popup options, layer-ref params. |
| `import_footage` | Import a file (footage, image, audio, 3D model, HDRI, SVG) into the project. |
| `list_dialogs` | Modal dialogs blocking AE, each with an image capture (AE draws its own controls, so read the image). |
| `answer_dialog` | Press a dialog button by label, or Cancel/Close, or Enter for the default. |
| `undo` | Undo the last ae-compose change(s) with AE's own Edit > Undo (`steps`, default 1). An edit batch or a single build is one step; a build with variants is one step per variant plus one for the compare comp (the report says `undo steps`). Read-only probes in between are skipped; manual changes made in AE since then are undone first. |
| `recover_ae` | Get AE working again: answers known dialogs (Crash Repair → Continue) and reports others with captures, launches AE when it isn't running and waits for the bridge, reports a hung AE. `force: true` kills a hung AE and relaunches it (unsaved work is lost): only with the user's go-ahead. |
| `doctor` | Check AE, the CEP bridge, the runtime and tools, with a fix for each failure. |
| `motion_preview` | A dense frame strip of one segment (default: a second around the busiest moment) plus the speed graph, the motion summary, the style lint, and a GIF for humans (§21.7). |
| `deliver` | Build every target frame (`targets`, default 16:9, 9:16, 1:1) and render each (`format`, default mp4) plus a master of the first (`master`, default ProRes 422 HQ) (§21.6). |
| `analyze_beats` | Tempo, confidence, beat and bar times of a music file, for planning a beat-synced scene (§21.5). |
| `designer_inbox` | Unread notes a designer sent from the panel's Ask Claude box, with comp, time and selection (§21.8). |
| `plan_scene` | Check a beat sheet against the direction rules and scaffold a buildable scene (§21.12). |
| `list_recipes` / `instantiate_recipe` / `save_recipe` | Search the recipe library, make a new scene from a recipe with new params and brand, save a finished scene as a recipe (§21.13). |
| `find_assets` | Search local folders and free asset APIs (icons, photos, video, textures, HDRIs, models, fonts, audio); numbered results plus a thumbnail grid; license allowlist applied (§22). |
| `fetch_asset` | Download one asset, check and convert it, copy it next to the saved project, import it in one undo step and credit it in CREDITS.md; fonts install only with `install: true` (§22). |
| `run_extendscript` | Raw ES3 escape hatch (logged). Never touch shape-gradient properties with it. Wrap mutations in an undo group. |

### CLI (`aec`)

```
aec doctor                         check the whole environment
aec build <scene.tsx> [--no-variants] [--variant A] [--version 3] [--frames 8] [--param k=v,..] [--reset-controls] [--no-lint]
aec watch <scene.tsx>              rebuild in place on save (keeps live control values)
aec inspect [comp] [--full] [--project] [--layers 1,2]
aec edit <ops.json> [--comp name]  apply edit ops (one undo step); file is [ops] or { comp, ops }
aec lint [comp] [--frames 8]       lint a comp (§17); build/edit/lint take --safe, --reading-rate, --ignore
aec undo [steps]                   undo the last ae-compose build/edit (AE's Edit > Undo)
aec snapshot [comp] --times 0,1.5,3
aec sheet [comp] [--frames 12]     contact sheet
aec preview [comp] [--range 0-3] [--scale 0.5] [--fps 15] [--gif]
aec render [comp] [--format mp4|mov|mov-alpha|prores|prores4444|png|tiff|avi] [--quality high] [--out path] [--range 0-5] [--work-area] [--draft]
aec mogrt [comp] [--out file.mogrt|folder] [--overwrite]
aec effects [query] [--describe <name>] [--refresh]
aec import <file> [--folder name]
aec assets find <query> [--kind …] | fetch <id> [--variant …] [--install] | index   (§22)
aec dialogs [--answer <hwnd> <button>]
aec recover [--force]
aec eval "<extendscript>"
```

Most commands accept `--json` for machine-readable output. Review outputs (IR, frames, contact sheets, previews) go to `~/.ae-compose/out/<Scene>/`; final renders go to `renders/` next to the saved project (or `~/.ae-compose/renders/`).

---

## 19. AE gotchas handled for you

- **Gradient stops crash AE 26.5** when scripts read or write them. Gradients are applied as generated `.ffx` presets, and their stops are recorded in the group name (D15, D47).
- **`addText` inherits the Character panel.** Every TextDocument field is reset and set explicitly. `allCaps`/`smallCaps` are read-only (the `fontCapsOption` enums are used instead), and horizontal/vertical scale are multipliers in scripting (D30). Font substitution is reported as a warning.
- **Renderer IDs are confusing:** `ADBE Calder` = Advanced 3D, `ADBE Ernst` = Cinema 4D, `ADBE Advanced 3d` = **Classic 3D**. After enabling 3D, the renderer is re-assigned, otherwise AE reports Geometry Options as hidden (D36).
- **Hidden properties** (unavailable in the current renderer/light kind) become warnings, not build failures. Ambient and environment lights get no transform (D38).
- **Keyframe eases:** interpolation is set to BEZIER before eases, both in and out eases are always passed, and the ease array length follows the value type (spatial = one ease over arc length). Colors take one ease in 0–255 units per second (D31). HOLD/LINEAR are re-applied after `setTemporalEaseAtKey`, which silently resets them (D43).
- **Overshooting position** (springs, back easings) uses separated dimensions automatically, because spatial eases can't overshoot along a path.
- **Shape group references go stale** after `addProperty`, so they're re-fetched by index path every time. Contents index 1 is frontmost.
- **Text is measured** right after its document is set, before animators distort its bounds, so layout and anchors use the real glyph box (D46).
- **Dropdown items** can't be read back in 26.5, so the IR keeps them (D20).
- **CC Particle World** producer units are host-layer widths with +y down, and it follows the comp camera. Longevity can't take expressions (D41, D42).
- **Layer-reference effect params** (`LAYER_INDEX`) are set by resolving `{ layer: id }` to the layer's index.
- **ExtendScript has no `JSON`**, so the runtime ships its own (D11). `saveFrameToPng` is async and awaited (D12). Syntax errors that would open modal alerts are caught by eval-wrapping.
- **Undo groups don't span evals**, so every build/edit is one eval and one undo group (D34).
- **ExtendScript's `?:` is left-associative** (`true ? 'A' : false ? 'B' : 'C'` is `'B'`): the runtime build parenthesizes nested conditionals; do the same in `run_extendscript` (D82). Expressions use the JavaScript engine and are unaffected.
- **A Property object is always truthy in expressions**: checkbox controls and rig params are read with `.value` (D75).
- **A long, heavy session slows AE down** (Source Text evaluation went from 11 ms to 0.6–1.5 s after many big cloner builds; a cache purge didn't help, a restart did; D79).
- **Modal dialogs and crashes** are detected by a watchdog (`list_dialogs`/`answer_dialog`), with a recovery routine (D17).
- **Expression re-evaluation storms** during builds are avoided by controlling what the viewer shows. The result comp opens afterwards.

## 20. Known limitations

- **Vanilla AE only.** Third-party effects aren't in the catalog and are never applied (D2, D19).
- **8/16 bpc only.** 32 bpc projects get a passive capture fix and no other support (D29).
- **Gradients:** 2–8 stops (more are resampled). Stops can be set on any gradient (`gradient` edit op). `inspect_comp` reports every gradient's stops (colors, midpoints, opacity) read from the saved .aep, because AE can't read them by script (touching them crashes AE 26.5); unsaved changes since the last save aren't included (the outline says so), and an unsaved project falls back to the stop tag ae-compose writes in gradient names. Gradient stops can't be animated by ae-compose.
- **Renderer quality, shadow and environment settings aren't scriptable**; only the renderer choice is.
- **Advanced 3D:** no motion blur, no effects/masks/mattes/blend modes on 3D text/shape/model layers, no point-light shadows. Snapshots are slow (~3.5 s per frame with HDRI and DOF, ~100 s first-render warm-up) (D37, D40).
- **`fStop` follows AE's px definition** and produces extreme blur at real-world values, so use `aperture` (D39).
- **Controls inside `<Precomp>` children** read the main comp's Controls null as `comp("<main comp name>").layer("Controls")`, so renaming the main comp in AE breaks them (rebuild, or fix the name in the expressions).
- **Spring `stiffness`/`damping`/`mass` controls** switch that spring to the closed-form expression automatically. `keys()` rejects controls on key times/values with a clear error, and `sample({ as: 'expression' })` is rejected (a JS function can't run in AE).
- **Per-unit text easings** must be bezier (or use `spring`).
- **Sticky controls** keep values you changed in AE; untouched controls take new code defaults on rebuild (`resetControls` / `--reset-controls` drops the tweaks too) (§11.5).
- **Rebuilds replace in place**, and `version` only renames.
- **Seeds:** particle components default to a hash of their `id`. Pass `seed={p.seed}` to make the scene/variant `seed` param drive them. The same seed rebuilds pixel-identical frames (tests/integration/renderer-seeds.ts).
- **Lint** judges bounds, not pixels: occlusion by footage with alpha or shapes is only a note, and precomps and 3D occlusion aren't judged (§17).
- **A scripted render (and a full cache purge) clears AE's undo history**: `undo` then only reaches the steps made since, and says so.
- **Not available:** choosing a glTF animation clip on `<Model>` (AE 26.5 exposes no scripting for it; re-verified), and text wrapping from layout `maxWidth` (use `box`).
- **Range Selector mode** (`selector: 'range'`) takes fixed times, an easing (not a spring) and orders start/end/random; AE caps the window at 100 %.
- **Edit ops:** frame strings (`"12f"`) use the comp's own fps. `ease` can't name a spring (use a bezier preset, `bounce` or `elastic`). `x`/`y`/`z` only exist on separated positions.
- **Typing:** `Parallax` reads each child's `depth` prop (any number), which isn't in the layer prop types.

---

## 21. Creative toolkit (Phase 5)

Higher-level tools that make many native, live elements from one statement (docs/TOOLKIT.md). Everything here stays editable in AE: real layers, keys, expressions and one tidy effect per rig.

### 21.1 Expression library (`L.*`)

Any expression ae-compose writes, and any `expr()` you write, may call the expression library: `L.spring(t, fps, damping, stiffness, mass)`, `L.bezier(x1, y1, x2, y2, u)`, `L.scatter(i, n, w, h, seed, jitter)`… The compiler adds what an expression uses (D73):

- **inline** (default): the functions it calls are carried in the expression on one `function aecLib() {…}` line under its header comment, then `var L = aecLib();` and the readable call lines. The project needs nothing else.
- **footage** (`scene({ lib: 'footage' })`): expressions read `var L = footage("aec-lib.jsx").sourceData;` from one shared item in `ae-compose/_lib` (the file is copied next to the saved project as `ae-compose-lib/aec-lib-<version>.jsx`, so Collect Files takes it). Shorter expressions, but a missing file disables every expression that uses it.

| Group | Functions |
|---|---|
| Math | `clamp(v, lo, hi)`, `lerp(a, b, t)`, `remap(v, a, b, c, d)`, `smooth(e0, e1, x)`, `step(v, size)`, `wrap(v, lo, hi)`, `mixv(a, b, t)` |
| Random | `hash(i, k)` (0–1), `rand(i, k, lo, hi)`, `srand(i, k)` (−1–1), `pick(list, i, seed)`, `noise1(x, seed)`, `noise2(x, y, seed)` |
| Easing, physics | `bezier(x1, y1, x2, y2, u)`, `eased(bezierArray, u)`, `tween(t, t0, dur, from, to, bezier)`, `spring(t, fps, damping, stiffness, mass)` (Remotion-exact), `overshoot(t, amp, freq, decay)`, `inertia(v, t, freq, decay)`, `bounce(t, height, gravity, elasticity, max)`, `follow(t, i, lag)` |
| Timing | `stagger(i, n, each, order, seed)` (order 0 start, 1 end, 2 center, 3 edges, 4 random), `cascade(distance, speed)` |
| Distributions | `line(i, n, spacing, angle, centered)`, `grid(i, n, cols, gapX, gapY)`, `circle(i, n, radius, start, arc)`, `circleAngle(…)`, `scatter(i, n, w, h, seed, jitter)` (jittered grid: even spacing), `sphere(i, n, radius)`, `helix(i, n, radius, height, turns)`, `onPath(path, u, closed)`, `pathAngle(path, u, closed)` |
| Falloffs (1 inside → 0 outside) | `falloff(d, radius, softness)`, `radial(p, center, radius, softness)`, `box(p, center, size, softness)`, `linear(p, center, angle, width)` |
| Color | `hsl(h, s, l, a)`, `toHsl(rgba)`, `shade(rgba, dh, ds, dl)`, `hex("#rrggbb")`, `palette(list, i)`, `gradient(list, t)` |
| Markers | `pulse(t, starts, len)` (1 during a pulse), `since(t, starts)` (seconds since the last start, −1 before) |
| Text | `pad(n, digits)`, `num(v, decimals, sep, dec)` (1,234.5), `scramble(text, p, seed, t, chars)`, `typed(text, p, caret, t, blink)` |

`inspect_comp` shows an expression's header comment and its first `L.` call, not the inlined helpers. The same functions are available in Node (`libObject()` in `src/aeclib`) for tests.

### 21.2 Rig effects, grouped controls, live rigs

A **rig effect** is one pseudo effect holding exactly a rig's controls, generated as a `.ffx` preset (D74): the project stores its definition, so it opens and renders anywhere.

```tsx
const SPIN = { name: 'aec Spin', params: [
  { kind: 'slider', name: 'Speed', default: 45, min: 0, max: 360 },
  { kind: 'checkbox', name: 'Reverse', default: false },
  { kind: 'group', name: 'Look', params: [{ kind: 'color', name: 'Tint', default: [1, 0.5, 0] }, { kind: 'popup', name: 'Mode', items: ['Calm', 'Wild'] }] },
] };
<Shape id="spinner" rotation={expr('(effect("Spinner")("Reverse").value ? -1 : 1) * effect("Spinner")("Speed").value * time;')}>
  <Rect size={[80, 80]} /><Fill color="#f5a623" />
  <RigEffect def={SPIN} name="Spinner" values={{ Speed: 90, Mode: 'Wild' }} />
</Shape>
```

Param kinds: `slider` (`min`/`max` = slider range, `validMin`/`validMax`, `precision`, `display: 'percent' | 'pixel'`), `angle`, `checkbox`, `color` ([r, g, b] 0–1, or a color string in `values`), `point`, `popup` (`items`; values may be the label), `layer`, `group` (nested params, `collapsed`). Values may be numbers, colors, booleans, popup labels, animations or `control()` refs. Read a param in expressions with `.value`: a Property object is always truthy in AE's JavaScript engine, so `effect(…)(…) ? a : b` without `.value` is always `a` (D75). Names: at most 31 bytes, no `/`. Rig sliders store float32 (0.02 reads back as 0.0199999996).

- **Grouped controls:** `control('Delay', 0.3, { group: 'Title' })` puts every control of that group into one "Title" rig effect on the Controls null (Essential Graphics names them "Title Delay"). Expressions read `thisComp.layer("Controls").effect("Title")("Delay").value`.
- **Live text reveals:** `perWord({ …, live: true })` (any per-unit animator with the expression selector) adds an "aec Text Reveal" effect on the text layer, named like the animator ("Reveal (words)"), with Each, Duration, Delay (and Damping, Stiffness for springs). A designer retimes the reveal in Effect Controls.
- **Live camera moves:** `CameraMove` and its presets (§13.3) put Travel X/Y/Z, Delay, Duration (0 = until the layer ends), Easing and the handheld shake in one "Camera Move" effect on the move null by default; `rig: 'keys'` keeps a keyframed move instead.
- Sticky controls (§11.5) cover every rig param: rebuilds keep values changed in AE.

### 21.3 Fields: `field(name, value)`

`field('Card Color', '#4683c4')` marks any property of a precomp's content as an Essential Graphics property of that comp, so every layer that uses the comp gets it under Essential Properties and can override it. `<Text eg="Label">` does the same for a text's source text (also inside precomps now). Fields are how cloner instances differ (§21.4).

### 21.4 `<Cloner>`

One master, many instances, every parameter live (D77):

```tsx
<Cloner id="cards" name="Cards" count={100} size={[260, 160]} seed={7}
  distribute={scatter({ width: 2700, height: 640, jitter: 0.9 })}
  motion={{ speed: 210, direction: -4, wrap: 2900, variation: 30 }}
  effectors={[
    noise({ position: 14, rotation: 6, scale: 12, opacity: 20, speed: 0.35 }),
    falloff({ radius: 300, softness: 650, scale: [68, 108], opacity: [45, 100] }),
    colorize({ field: 'Card Color', palette: ['#3f6db3', '#4683c4', '#5577cf'], mode: 'random' }),
  ]}
  of={[<Shape><Rect size={[236, 136]} roundness={18} /><Fill color={field('Card Color', '#4683c4')} /></Shape>]} />
```

It builds: a **master** precomp `<name> Master` (`of`, at `size`: keep it tight around the content, since every instance renders that area); a **controller** null `<name>` carrying one "Cloner" rig effect (Seed, Scale, Rotation, Opacity, then a group per distribution and effector); and **instance 1**, whose expressions find their index from the stacking order (`i = n − (index − controller index)`: instance 1 at the bottom, later ones on top) and call the library. AE duplicates it into the rest (`Cards 001…100`). Instances are parented to the controller: move, scale or rotate it to move them all. Only `count` needs a rebuild; edit the master comp or any Cloner param in AE and every instance follows. Lint skips instances (tagged `aec:<id>;clone`).

| Prop | Meaning |
|---|---|
| `id` (required), `name` | Ids of the parts derive from `id`; `name` names the controller and the instances. |
| `count` | Instances (default: data rows, else 10). |
| `of`, `size` (required), `masterDuration` | The master's content, its comp size, its duration (default the cloner's span). |
| `distribute` | `line({ spacing, angle, centered })`, `grid({ columns, gap })`, `circle({ radius, start, arc, orient })` (0° = top, clockwise), `onPath({ d, start, end, orient, closed, show })` (SVG path in comp px; a guide layer holds it), `scatter({ width, height, jitter })`, `sphere({ radius })`, `helix({ radius, height, turns })` (sphere and helix make the instances 3D). |
| `motion` | `{ speed, offset, direction, wrap, variation }`: travel along `direction` in px/s (circle: °/s around; path: % per second); `wrap` (px) loops them; `variation` is ±% per instance; `offset` may be animated (a rush in or out). |
| `effectors` | `noise({ position, rotation, scale, opacity, z, speed })` (seeded; `speed` > 0 wobbles), `falloff({ shape: 'radial' \| 'linear', center, radius, softness, angle, width, scale: [out, in], opacity: [out, in], blur: [out, in], brightness: [out, in] })` (a draggable "<name> Field" null; `blur` adds a Gaussian Blur and `brightness` a Brightness & Contrast per instance), `stagger({ each, order, by: 'index' \| 'distance' \| 'random' })` (time-remaps the master per instance), `follow({ lag })` (each instance replays the controller's motion `lag` s after the previous one: animate the controller), `step({ position, rotation })` (quantize), `colorize({ field, palette, mode: 'cycle' \| 'random' \| 'gradient' })` (on a master color field). The radial falloff's params are "Falloff Radius" and "Falloff Softness" on the Cloner effect. |
| `data` | One row per instance. Keys naming a master field set that instance's field (`dataMode: 'expression'`, the default: one expression per field holding all values, nothing written per instance; `'overrides'`: static Essential Properties values, slower to build, easy to retype one). Keys `x`, `y`, `z`, `rotation`, `scale`, `opacity`, `delay` offset that instance. `csv('rows.csv')` reads a CSV (header row, numbers parsed). |
| `seed`, `scale`, `rotation`, `opacity` | Rig base values (may be animated). |
| `mode` | `'layers'` (default) or `'repeater'`: a shape-only master as one shape layer copied by native Repeaters (line, grid, circle; `motion.speed` moves or spins them). Much cheaper to render, and the count stays live, but no effectors, data or fields. |

**Performance** (measured in a 32-bpc project, warm frames; D77):

| Setup | Build (fresh) | Render per frame |
|---|---|---|
| 100 instances, identical | 3.3 s | 1.2 s |
| 100 instances, 4-colour palette | 3.3 s | 1.8 s |
| 100 instances, a unique text label each | 3.3 s | 5–22 s |
| 300 instances, palette | 12.7–19.9 s | 11 s |
| 300 instances, unique labels | 12.7 s | 20–44 s |
| 1000 copies, `mode: 'repeater'` | ~3 s | 0.6 s |

Every distinct set of field values renders the master once per frame, so prefer a few palette values over a unique value per instance, and keep text out of masters you clone in large numbers. Rebuilds of a heavy cloner cost more (AE re-renders in the background after each call). The cloner warns past 300 instances and for per-instance text past 40.

### 21.5 Beat sync

```tsx
const B = beatsOf('music/track.mp3');            // analyzed once, cached as track.mp3.beats.json
<Audio id="music" src="music/track.mp3" />
<BeatMarkers beats={B} to={15} />                // "bar N" on downbeats (counted from 1: B.bar(0) is "bar 1"), "beat" on the others
<Series>
  <Series.Sequence name="Hook" duration={B.bar(0) + B.bars(2)}>…</Series.Sequence>
  <Series.Sequence name="Drop" duration={B.bars(4)}>…</Series.Sequence>
</Series>
```

`beatsOf(file, { minBpm, maxBpm, beatsPerBar, offset })` returns `{ bpm, confidence, beats, downbeats, beat(n), bar(bar, beat), bars(n, unit), snap(t, { tolerance, subdivision }), between(a, b), offBeat(cuts) }`. Accuracy (D81): F = 1.00 at ±70 ms and BPM within 0.07 % on synthetic house, hip-hop (swung), rock, ambient, drum & bass and drifting tracks; a low `confidence` (< 0.3) means there is no steady pulse. `<CompMarkers markers={[{ t, comment }]} />` adds any comp markers. Ripples never move beat/bar markers (the music keeps playing), and `{ op: 'ripple', scene: 'Intro', by: 0.4, snap: 'beats' }` rounds the change so the edited scene ends on a beat. The `off-beat` lint rule flags scene starts and entrances between a frame and 150 ms off a beat. The `analyze_beats` tool reports the grid for planning.

### 21.6 Responsive reframe and delivery packs

`build_scene { reframe: ['9:16', '1:1'] }` (the API and CLI also take `{ width, height, typeScale }`) builds sibling comps `Name_v001_9x16`, `…_1x1` from the same scene (D80). Layouts re-solve in AE (in 9:16, top-level containers and title-safe areas use the platform's UI-free zone: left 60, top 250, right 120, bottom 400 px at 1080×1920). Given positions map into the new frame (that zone in 9:16). Frame fillers (solids, footage, full-frame rectangles) fill the new frame. Type scales ×0.8 (9:16) or ×0.85 (1:1, 4:5), and a line that is still too wide shrinks to fit in AE. Lint judges 9:16 against the platform zone (`safe: 'reels'`). Cameras re-frame because `lens` converts to zoom from the comp width.

`deliver { file, targets: ['16:9', '9:16', '1:1'], format: 'mp4', master: 'prores' }` builds every target and renders each, plus a ProRes master of the first, into `renders/`. Renders clear AE's undo history, so deliver approved work.

### 21.7 Motion previews and style lint

Every build and edit samples the comp's motion inside its undo group (D78; `motion: false` skips it) and returns a **speed graph** (one row per animated layer: speed curve, holds shaded, easing class per move, how many layers move at once), a motion **summary** ("title arrives 0.20–0.85 s (ease-out), holds 2.4 s") and the **style lint** rules (§17). Per-unit text reveals are included from their animator timing. `motion_preview { comp, start, end, frames }` renders a dense frame strip (default: one second around the busiest moment) and a GIF, plus the graph. Cost: 3–6 s per build; expression-heavy comps (charts: 1–2 s per sample) are sampled within a 40 s budget on a coarser grid, and the summary and lint say so (D87).

### 21.8 Designer panel

Window > Extensions > ae-compose: **Controls** (the active comp's rig effects and expression controls, grouped by rig, editable), **Lint** (the latest lint and style lint the tools saved for the comp; click an issue to jump to it), **Variants** (sibling comps: variants, Compare, reframes), **Recipes**, and **Ask Claude** (queues a note with the comp, time and selection; the agent reads it with `designer_inbox`). D83.

### 21.9 Typography kit

Native text plus one "aec <Name>" rig effect each, so retiming and recoloring happen in Effect Controls.

| Component | What it makes | Live in AE |
|---|---|---|
| `<Captions src="talk.srt" style="karaoke" />` | One Text layer per cue (fix a typo in that layer, drag it to retime), lines balanced to the title-safe area (the platform-safe zone on vertical frames), bottom-centre. `src` is .srt/.vtt/word-timing .json or the text itself; or `cues`, or `words` (Whisper-style, grouped into cues by pauses and line fit). Styles `clean`, `boxed`, `karaoke`, `boldPop`; `karaoke: { mode: 'current'\|'past', underline, scale, sync }`. Reading speed is checked (`reading: 'warn'\|'error'\|'off'`). | "Captions" effect on the controller: Text Color, Highlight, Pop Scale, Fade, Ramp, Sync Offset, box color/opacity/padding |
| `<Emphasis word="MOTION" kind="bar">` around a `<Text>` | A bar, underline, box or hand-drawn circle that follows one word, plus an optional color pop (`wordColor`) and scale punch. The word is measured in AE (`sourceRectAtTime` on hidden measuring copies), so it stays right when the text is retyped. `emphasize(text, opts)` returns the text and the marks separately for texts inside a layout. Point text only. | "Emphasis": Word (index), Start, Draw, Out, colors, padding, thickness |
| `<Decode duration delay chars seed>` | Characters resolve from random glyphs, left to right. | "Decode": Progress, Rate, Seed |
| `<Typewriter cps delay caret humanize>` | Characters appear at a typing pace with a blinking caret. `typingProgress()` gives the same timing in TS. | "Typewriter": Progress, Blink, Show Caret |
| `<SplitFlap flips each duration delay>` | Airport-board characters flip through glyphs before landing. | "Split Flap": Flips, Each, Duration, Delay |
| `<VariableFont fonts={['Inter-Regular', …, 'Inter-Black']} fromWeight toWeight duration>` | A weight shift by stepping through the family's PostScript names (AE doesn't expose variable axes to scripts). | "Font Weight": Weight 0–100 |
| `<AutoFit fit={{ width, height }} minSize maxLines>` | Point text whose lines are balanced and size shrunk at build to fit the box (`autoFitLines()` does the same in TS). | "Auto Fit": Width, Height, Max Scale (re-fits live when retyped) |

### 21.10 Procedural backgrounds

`GradientField` (a slowly turning Gradient Ramp), `MeshGradient` (drifting 4-Color Gradient warped by Turbulent Displace; `kaleido` adds CC Kaleida), `FilmGrain` (Noise or Add Grain on an adjustment layer), `LightSweep` (CC Light Sweep passing over what's below; `at`, `sweep`, `every`), `BokehField` (soft drifting circles in two depth layers, or `mode: 'particles'`), `DotGrid` and `LineGrid` (shape Repeaters that scroll without a seam). Common props: `id`, `palette` (or `brand`; brand tokens and controls stay linked), `speed` (0 = still), `seed`. Each has one "aec <Name>" effect with its colors, Speed and a few look params; the effects underneath stay ordinary effects. Every background is tagged `bg` for the style lint.

```tsx
<MeshGradient id="bg" palette={[B.colors.deep, B.colors.violet, B.colors.accent, B.colors.ink]} speed={0.6} />
<FilmGrain id="grain" amount={4} />
```

### 21.11 Data viz kit

`BarChart` (vertical/horizontal, grouped, `stacked`, `style: 'grow'|'pop'`), `StackedBarChart`, `LineChart` (`style: 'draw'|'rise'`, `curve: 'smooth'|'linear'`, `area`, `points`), `AreaChart`, `DonutChart` and `PieChart` (`style: 'stagger'|'sweep'`, outside % labels, a centre total), and `Counter`.

```tsx
<BarChart id="rev" name="Revenue Chart" x={192} y={240} width={1536} height={732}
  data={[{ label: 'JAN', value: 42 }, { label: 'FEB', value: 58 }, /* … */ { label: 'JUN', value: 128 }]}
  format={{ prefix: '$', suffix: 'k' }} animation={{ delay: 0.45, stagger: 0.07, duration: 0.8 }}
  highlight={{ at: 'JUN', after: 0.2 }} annotate={{ at: 'JUN', text: 'Record month', after: 0.3 }} />
<Counter id="count" value={1.2} decimals={1} suffix="M" countFrom={0} delay={0.5} countDuration={1.4} font="Inter-Black" size={150} />
```

- **Data:** `data` (numbers, `{ label, value }` rows, or rows with several numeric columns = one series each, picked with `keys`), or `series` + `labels`; `colors`.
- **Box:** `x y width height` (default: the title-safe area). `scale` (min, max, ticks; a nice scale by default), `grid`, `axis`, `categories`, `legend`, `valueLabels`, `format` / `tickFormat` (`prefix`, `suffix`, `decimals`, `separator`).
- **Story:** `highlight` (one category pops after the data lands, the others dim), `annotate` (a callout with a leader line), `animation` (`delay`, `stagger`, `duration`, `easing`, `exit: 'auto'` leaves only when the chart ends before the comp).
- **Live in AE:** each chart has one controller null with one effect ("Bar Chart", "Line Chart", "Donut Chart"…): every value (named after its label), axis min/max, colors, bar/line width, timing, easing, exit and a Highlight dropdown. Change a number and the bar, its label, the ticks and the animation follow. Changing the number of categories or series needs a rebuild.
- `niceScale(min, max)` and `formatNumber(v, format)` are exported for your own labels (`formatNumber` matches the live `L.num`).

### 21.12 Storyboard first: `plan_scene`

Give a beat sheet (`message`, then `beats` with `name`, `purpose`, `duration`, `text`, `visual`, `transitionIn`, `hold`; an `end` card; optional `format`, `brand`, `music`). The plan is checked before any TSX exists: reading time per text against the beat, the final hold (≥ 2 s), a hook in the first second, beats without a purpose, empty or duplicate beats, the same transition twice in a row, overlaps outside 0.2–0.4 s, one idea per beat, slide furniture, pacing, plus the style lint on the planned timing. It returns a buildable scaffold (`file` writes it): a `<Series>` of named beats, headline/subline reveals with exits anchored to each beat's end, a placeholder card per visual, transitions named by kind, an end card, and live controls (Title Delay, Word Stagger, Exit Lead, Accent Color). Fix the warnings, re-plan (`overwrite: true`), replace the TODO placeholders, build.

### 21.13 Recipes

A recipe is a finished scene saved for reuse: its `.tsx`, the modules and assets it reaches by relative path, a params schema read from `config.params`, its live controls, named scenes, tags and an intent sentence. Shipped: `kinetic-title`, `lower-third`, `logo-reveal`, `end-card`, `product-promo`, `data-chart` (in `recipes/`; saved ones go to `~/.ae-compose/recipes`, more folders via `AEC_RECIPES`).

- `list_recipes { query: "lower third interview" }` searches by intent, tags and name.
- `instantiate_recipe { name, params, brand, outFile }` writes a new editable scene with the params baked in as defaults and an optional new `brand.ts` (missing tokens are listed), copies its assets, and compiles it to check; then `build_scene` it.
- `save_recipe { sceneFile, name, intent, tags, thumbnails }` saves your finished scene (to `~/.ae-compose/recipes` unless `dir` is given). `npx tsx src/recipes/reindex.ts` refreshes the shipped manifests.

### 21.14 UI kit

Product-UI components drawn as native shapes and text, for app demos and onboarding pieces. Every component takes `id` (required), `theme` (`'dark'`, `'light'`, or overrides such as `{ base: 'light', accent: '#ff5a00', scale: 1.6 }`; `themeFromBrand(brand)`), `position` (absolute centre; omit inside layout containers), `enterAt` / `exitAt`, and `flow` (the events of a `uiSteps` script).

| Group | Components |
|---|---|
| Controls | `Button` (primary, secondary, ghost, danger; the label re-fits live), `Toggle`, `Checkbox`, `Slider`, `ProgressBar`, `Input` (types its `text` with a blinking caret), `Tabs` |
| Display | `Card`, `Avatar`, `Badge`, `Tooltip`, `Toast`, `Modal`, `ListItem`, `Feed` (a Cloner of list rows from `rows`), `ScrollView` |
| Frames | `PhoneFrame`, `TabletFrame`, `LaptopFrame`, `BrowserFrame` (children are the screen), `ScreenInsert` (a screen recording with zoom keys and a focus point that can follow the cursor) |
| Interaction | `Cursor` (arrow or touch dot, click ripples) driven by `uiSteps(steps, { targets, start })` |

```tsx
const flow = uiSteps([
  { at: 1.1, click: 'email' }, { at: 1.2, type: 'email' },
  { at: 2.3, hover: 'agree' }, { at: 2.9, click: 'agree' },
  { at: 3.4, click: 'signup' }, { at: 3.5, show: 'toast', hold: 2 },
], { targets: { email: [560, 337], agree: [548, 404], signup: [640, 474] }, start: [980, 610] });

<BrowserFrame id="browser" url="app.example.dev" position={[960, 540]}>
  <Input id="email" label="Work email" text="ada@example.dev" width={380} position={[640, 326]} flow={flow} />
  <Checkbox id="agree" label="Send me product updates" position={[640, 404]} flow={flow} />
  <Button id="signup" label="Create account" size="lg" width={380} position={[640, 474]} flow={flow} />
  <Toast id="toast" title="Account created" body="Welcome aboard." position={[1086, 66]} flow={flow} />
  <Cursor id="cursor" flow={flow} />
</BrowserFrame>
```

- **Steps:** `cursor` (move), `click`, `hover`, `drag` + `to` (+ `value` for a Slider), `type`, `scroll` + `stop` (a ScrollView), `show` / `hide` (Toast, Modal, Tooltip), each at `at` seconds. `sliderPoint()` and `modalButtonPoints()` give the points to aim at.
- **Live in AE:** each stateful component has one rig effect ("Button", "Toggle", "Reveal"…) and its states are layer markers ("press", "hover", "toggle", "select 1", "type", "show"): drag a marker to retime that state, no rebuild.
- Cursor waypoints are points, so give clicked components a `position` (or list them in `targets`). `Modal`, `Feed`, `ScreenInsert` and `Cursor` sit at the top level of a comp or screen, not in layout containers.

### 21.15 Transitions library

Transitions made from the scenes' own elements, timed from the boundary between two beats. Put them between `<Beat>`s inside `<Beats>`: each beat becomes a named Sequence (a scene marker, so ripple edits work), and the next beat starts when the transition starts (or at the cut, for cut kinds).

```tsx
<Beats>
  <Beat name="Hook" duration={3}>…</Beat>
  <ShapeWipe id="wipe" shape={<Shape x={1500} y={300}><Ellipse size={[80, 80]} /><Fill color={B.colors.accent} /></Shape>} duration={0.7} />
  <Beat name="Build" duration={3.5}>…</Beat>
  <HandOff id="handoff" element={logoMark} from={{ x: 960, y: 540, scale: 100 }} to={{ layer: 'cta.slot', scale: 40 }} duration={0.9} />
  <Beat name="End" duration={4}>…</Beat>
</Beats>
```

| Transition | What it does |
|---|---|
| `HandOff` | A match cut: one element travels from its pose in the outgoing beat to its pose in the incoming one (`from`/`to` points or layer ids, `arc`, or a planned `path`; `match: 'size'`). |
| `ShapeWipe` | A shape from the outgoing beat grows to fill the frame and reveals the next beat (`grow`, `show`, `color`). |
| `ZoomThrough` | The camera dives into an element (`through`, `focus` on a letter for text) and comes out in the next beat. |
| `PushThrough` | The outgoing beat recedes in depth while the incoming one arrives (`depth`, `lens`). |
| `ParallaxSplit` | The frame splits into layers moving at different speeds (`direction`, `distance`, `spread`). |
| `LiquidWipe`, `SliceWipe`, `GridWipe` | Organic edge, angled slices, or tiles from an origin (`direction`, `count`, `columns`/`rows`, `stagger`, `color`). |
| `LightLeakCut` | A warm light leak flares over a hard cut (`color`, `intensity`, `flash`); a steady drift unless `easing` is given. |

Each transition has one controller null with an "aec <Kind>" effect: keyed Progress plus its amounts, so it can be retimed or softened in AE. Its layers are tagged `transition:<kind>` (the style lint flags the same kind twice in a row). `beatTimeline()` returns the beat and transition times without building. Standalone use: `at`, `outgoing` and `children`. Scene elements a transition takes over (`shape`, `through`) need explicit positions and must be at rest when it starts.

### 21.16 Path tools

- `<FollowPath id d progress|duration orient>`: a layer travels along an SVG path (live progress, optional orientation).
- `<Trail id count lag opacity>` / `<Echo>` around an animated element: copies follow it with a live lag and fading opacity.
- `<DrawOn d color width duration>`: a stroke draws on along the path (Trim Paths), or from a `progress` control.
- `<Morph from to | shapes={[a, b, c]} duration>`: one shape morphs into another; vertices are matched (subdivided, same winding, start point with the least travel) so the morph doesn't twist.

## 22. Asset sources (Phase 6)

Material ae-compose can't draw (icons, photos, stock video, textures, HDRIs, 3D models, fonts, sound) comes from the user's local folders and free asset APIs through two tools and one scene scheme. Design: `docs/ASSETS.md`; decisions D90–D101.

### 22.1 Sources

| Source | Kinds | Key | License |
|---|---|---|---|
| `local` | everything AE imports | none | the user's own files (credited as "license unknown") |
| `iconify` | icon | none | per set: MIT, ISC, Apache-2.0, OFL, CC0, CC BY, CC BY-SA (flagged); GPL/NC/MPL/BSD sets are left out; brand sets flagged as trademarks |
| `polyhaven` | hdri, texture, model | none | CC0 |
| `ambientcg` | texture, hdri | none | CC0 |
| `pixabay` | photo, video | `pixabay` | Pixabay Content License |
| `unsplash` | photo | `unsplash` (Access Key) | Unsplash License |
| `pexels` | photo, video | `pexels` | Pexels License |
| `openverse` | photo, audio | optional `openverse` token | CC0, PDM, CC BY, CC BY-SA (never NC or ND) |
| `fontsource` | font | none | OFL, Apache-2.0, UFL |

Keys live in `~/.ae-compose/keys.json` (`{ "pixabay": "…", "unsplash": "…" }`) or environment variables (`AEC_PIXABAY_KEY`, `AEC_UNSPLASH_KEY`, `AEC_PEXELS_KEY`, `AEC_OPENVERSE_TOKEN`), never in scenes or the repo. A source without a key is skipped, and `find_assets` and `doctor` say how to get one. The local index samples `E:\Projects` and `\\goblin\depot\{3D,Evan,Work}` (`AEC_ASSET_ROOTS`, `;`-separated) for 8 s per root (`AEC_LOCAL_INDEX_SEC`) and is rebuilt weekly or with `aec assets index`; queries never scan.

**Licenses.** Only the allowlist comes back: CC0, public domain, MIT, ISC, Apache-2.0, OFL, CC BY (any version), and the Pexels, Pixabay and Unsplash licenses. NonCommercial and NoDerivatives never do. ShareAlike items and brand logos are flagged in every result and in their credit line. `license: 'cc0'` keeps only public domain (no credit required).

### 22.2 `find_assets`

`{ query, kind?, orientation?, minWidth?, minDuration?, license?, sources?, limit? }` → numbered lines (`id [kind] "title" size · license · flags · by author · variants`) and one numbered thumbnail grid image (up to 16 cells; icons drawn light on dark, fonts as text cards). Local results come first, then each API in turn. Sources that were skipped or failed are listed with the reason.

### 22.3 `fetch_asset`

`{ id, variant?, import?, folder?, install? }`:
1. Gets the record (`variant` = a label from the results, e.g. `1k-hdr`, `2k-jpg`, `1080p`, `web`, `full`; a prefix like `2k` works; default: the source's recommended one) and refuses anything off the allowlist.
2. Downloads into the cache `~/.ae-compose/assets/<source>/<id>/<variant>/` (5 GB, least recently used evicted first; `AEC_ASSET_CACHE_GB`), with a size cap per kind.
3. Checks every file **by its content** (executables, scripts and HTML pages are refused; the extension follows the content; a glTF's `.bin` buffers are copied into the `.glb` as data, never opened otherwise), strips scripts and external references from SVGs, converts what AE can't import (WebP/AVIF → PNG, OGG/FLAC → WAV, WebM → H.264 MP4), unpacks ambientCG ZIPs (the color map is the main file; the other maps come along), and packs Poly Haven glTF models with their `.bin` and textures into **one `.glb`**.
4. Copies the files into `footage/<source>/<id>/` **next to the saved project**, so Collect Files and a moved project folder keep them. With an unsaved project the files stay in the cache and the result says so.
5. Imports them in one undo step (not icons, which are for `<Svg>`, and not fonts), tagged `aec:asset=<id>` in the item comment.
6. Adds the credit line to `CREDITS.md` next to the project: `- "Title" by Author (url), Source (page), License (url). Files: … [id]`.

**Fonts** download the full-coverage files from google/fonts (variable fonts list every named instance as a PostScript name, e.g. `SpaceGrotesk-Bold`). `install: true` installs them for the current user (Windows, no admin), only with the user's OK. The files are loaded into the Windows session, so the running AE sees them at once (D102), and the result lists the PostScript names AE now resolves. Use those in `font=`; lint's missing-font check flags any substitute.

### 22.4 `asset:` sources in scenes

Any `src` (and `hdri`) takes `asset:<id>[@variant]`:

```tsx
<Svg src="asset:iconify:lucide:rocket" width={240} color="#f2f4f8" draw={tween({ from: 0, to: 100, duration: '1.2s' })} />
<Footage src="asset:pixabay:video:4006@1080p" fit="cover" muted />
<Model src="asset:polyhaven:rubber_duck_toy@1k-gltf" position={[960, 600, 0]} scale={300} />
<Light kind="environment" hdri="asset:polyhaven:brown_photostudio_02@1k-hdr" />
<Audio src="asset:openverse:audio:eab8a6e2-0ac8-4615-9e0d-ebde30523783" />
```

An asset the scene uses some other way than a `src` (a font it names by PostScript name, a file an expression reads) is recorded with `asset('fontsource:space-grotesk@full')` inside the scene function, which returns its cached path; the build then copies and credits it like the rest.

They resolve at compile time, synchronously like `beatsOf`: from the cache, or by fetching in a child process. The build copies each into the project's footage folder, points the comp at the copy, and credits it in `CREDITS.md` next to the project **and** next to the scene file, so a scene folder carries its credits. The build report lists `assets` and `credits`. Use the refs in JSX props (resolved during the compile), not in module-level code that runs once per process. `deliver` copies `CREDITS.md` next to the renders.

`<Svg>` handles icon sets: `currentColor` takes `color`, `color` recolors strokes and fills, and outline icons (`fill="none"`) stay outlines, so `draw` draws them on stroke by stroke.

### 22.5 CLI

```
aec assets find <query> [--kind icon|photo|video|texture|hdri|model|font|audio] [--sources a,b] [--limit 12] [--license cc0]
aec assets fetch <id> [--variant 2k-hdr] [--no-import] [--install]
aec assets index                   rebuild the local-folder index
```

`pnpm test:live` calls each API once (search only) to catch response changes; unit tests run on recorded responses in `tests/fixtures/assets/`.
