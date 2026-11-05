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
| `markers` | `{ t: Time; comment?: string; duration?: Time }[]` | | Layer markers. `t` is relative to the layer's start. |
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

An SVG file becomes one Shape layer with a group per `<path>`/`<rect>`/`<circle>`/`<ellipse>`/`<polygon>`/`<polyline>`. Fills and strokes come from attributes, inline styles or `<style>` classes. It's centred on the layer and scaled, and every path stays pen-editable. All Shape/LayerProps apply.

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

### 16.8 `addLayer` (IR layer spec) and `raw`

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
| `overflow` | warn | Box text that doesn't fit its box (AE hides the last lines). |
| `missing-font` | warn | AE substituted a font that isn't installed. |
| `blank-frame` | warn | A rendered frame mid-comp is almost empty (background only). The first and last frame are ignored (fades from and to black are normal). |
| `linear-motion` | note | Position/scale keys whose moving segments are all linear. |

How it measures: inside the build's (or edit's) own undo group, one temporary text layer samples every visible text layer every 0.1 s in comp coordinates with `sourceRectAtTime` + `toComp`. That is exact for parenting, 3D layers, cameras and nested precomps; 3D text behind the camera counts as off screen. Per-unit animators are read too: ae-compose reveals and exits use the current values of their live controls (stagger, delay, spring physics), and hand-built Range Selectors are read from their Start/End/Offset keys. Blank frames are judged from the contact sheet frames. A build or edit is still one undo step.

Lint only sees text against text and empty frames: it can't tell when footage or a shape covers a word, or whether a composition reads well. That's what the contact sheet is for.

Tune or skip it:

```tsx
scene({ name: 'Promo', duration: '6s', lint: { safe: 'title', readingRate: 4, ignore: ['linear-motion'] } }, () => …)
```

`build_scene` / `apply_edits` take the same `lint` option (`false` skips it; options merge over the scene's). CLI: `--no-lint`, `--safe title|action|0.07`, `--reading-rate 4`, `--ignore rule,rule`.

## 18. MCP tools and CLI

### MCP tools (`aec-mcp`, stdio)

| Tool | What it does |
|---|---|
| `build_scene` | Compile TSX (`source` or `file`) into native comps. Returns a report (comps, warnings, expression errors with TSX lines, kept controls, the lint report (§17), IR path) plus contact sheets. Options: `params`, `variants` (`false` or a list of keys), `frames` (default 8, max 24), `times`, `cwd`, `resetControls`, `lint`. |
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
| `render_preview` | Short low-res MP4 (or GIF, returned inline) of a time range, to judge motion feel. It captures the live, unsaved state; `aerender: true` renders the saved project instead. |
| `list_effects` | Search vanilla effects by name/matchName/category. |
| `describe_effect` | Full param list of one effect: names, matchNames, types, defaults, ranges, popup options, layer-ref params. |
| `import_footage` | Import a file (footage, image, audio, 3D model, HDRI, SVG) into the project. |
| `list_dialogs` | Modal dialogs blocking AE, each with an image capture (AE draws its own controls, so read the image). |
| `answer_dialog` | Press a dialog button by label, or Cancel/Close, or Enter for the default. |
| `undo` | Undo the last ae-compose change(s) with AE's own Edit > Undo (`steps`, default 1). An edit batch or a single build is one step; a build with variants is one step per variant plus one for the compare comp (the report says `undo steps`). Read-only probes in between are skipped; manual changes made in AE since then are undone first. |
| `doctor` | Check AE, the CEP bridge, the runtime and tools, with a fix for each failure. |
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
aec effects [query] [--describe <name>] [--refresh]
aec import <file> [--folder name]
aec dialogs [--answer <hwnd> <button>]
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
- **Modal dialogs and crashes** are detected by a watchdog (`list_dialogs`/`answer_dialog`), with a recovery routine (D17).
- **Expression re-evaluation storms** during builds are avoided by controlling what the viewer shows. The result comp opens afterwards.

## 20. Known limitations

- **Vanilla AE only.** Third-party effects aren't in the catalog and are never applied (D2, D19).
- **8/16 bpc only.** 32 bpc projects get a passive capture fix and no other support (D29).
- **Gradients:** 2–8 stops (more are resampled). Hand-built gradients show as "stops not readable by script". Gradient stops can't be animated.
- **Renderer quality, shadow and environment settings aren't scriptable**; only the renderer choice is.
- **Advanced 3D:** no motion blur, no effects/masks/mattes/blend modes on 3D text/shape/model layers, no point-light shadows. Snapshots are slow (~3.5 s per frame with HDRI and DOF, ~100 s first-render warm-up) (D37, D40).
- **`fStop` follows AE's px definition** and produces extreme blur at real-world values, so use `aperture` (D39).
- **Controls inside `<Precomp>` children** read the main comp's Controls null as `comp("<main comp name>").layer("Controls")`, so renaming the main comp in AE breaks them (rebuild, or fix the name in the expressions).
- **Spring `stiffness`/`damping`/`mass` controls** switch that spring to the closed-form expression automatically. `keys()` rejects controls on key times/values with a clear error, and `sample({ as: 'expression' })` is rejected (a JS function can't run in AE).
- **Per-unit text easings** must be bezier (or use `spring`).
- **Sticky controls** keep values you changed in AE; untouched controls take new code defaults on rebuild (`resetControls` / `--reset-controls` drops the tweaks too) (§11.5).
- **Rebuilds replace in place**, and `version` only renames.
- **Seeds:** particle components default to a hash of their `id`. Pass `seed={p.seed}` to make the scene/variant `seed` param drive them. The same seed rebuilds pixel-identical frames (tests/integration/renderer-seeds.ts).
- **No automatic lint yet** (text overflow, safe areas, reading time, blank frames). Review the contact sheets yourself.
- **Not available yet:** choosing a glTF animation clip on `<Model>`, camera move helpers beyond `OrbitCamera` (animate `x`/`z`/`position` keys, see showcase 11), and text wrapping from layout `maxWidth` (use `box`).
- **Edit ops:** frame strings (`"12f"`) use the comp's own fps. `ease` can't name a spring (use a bezier preset, `bounce` or `elastic`). `x`/`y`/`z` only exist on separated positions.
- **Typing:** `Parallax` reads each child's `depth` prop (any number), which isn't in the layer prop types.
