# Remotion authoring model, AE temporal-ease math, and Lottie prior art

Research for **ae-compose**: Claude writes Remotion-style TSX, and the compiler emits native After Effects keyframes (not per-frame renders).

**Sources read (pinned):**

- Remotion `packages/core/src` at commit `682cad29` (2026-11-04). `VERSION = '4.0.540'`. Files: `spring/index.ts`, `spring/spring-utils.ts`, `spring/measure-spring.ts`, `interpolate.ts`, `easing.ts`, `bezier.ts`, `Sequence.tsx`, `series/index.tsx`, `AbsoluteFill*.tsx`, `use-current-frame.ts`, `interpolate-colors.ts`.
- bodymovin-extension `bundle/jsx` and `src/helpers/importers/lottie` at commit `a400a255` (2024-06-25). This is the AE→Lottie exporter and the Lottie→AE importer.
- lottie-web `player/js/utils/PropertyFactory.js` at commit `bede03d2` (2024-11-19). This is the Lottie player's keyframe evaluator.
- The AE Scripting Guide (docsforadobe): Property, KeyframeEase and matchName pages.

**Verification:** every numeric claim marked ✔ was checked in Node 22.

- I ported the algorithms and compared them against the real `remotion@4.0.540` npm package.
- The scripts are in the session scratchpad: `verify.mjs`, `fit.mjs`, `expr.mjs`, `cmp-pkg.cjs`, `bounce.mjs`, `rdp.mjs`. The code you need is reproduced (re-expressed) below.
- Anything that needs a live AE to confirm is marked **[verify in AE]**.

> **Note on quoting:** Remotion uses its own source-available license, and bodymovin/lottie-web are MIT. Rather than pasting their source verbatim, I describe the algorithms precisely, give file and line pointers, and supply our own re-implementations. Each re-implementation was checked numerically against the original: max deviation 4.6e-13 against the Remotion package. To get bit-identical reference values in tests, import `spring`, `interpolate`, `Easing` and `measureSpring` from the `remotion` package directly (they are pure functions). `remotion/no-react` exports only `interpolate` and `random`.

---

## 1. Remotion's authoring model

### 1.1 Composition / root

```tsx
registerRoot(Root);
const Root = () => (
  <Composition id="Intro" component={Intro} durationInFrames={150} fps={30}
               width={1920} height={1080} defaultProps={{...}} /* schema, calculateMetadata */ />
);
```

- `useVideoConfig()` returns `{ fps, width, height, durationInFrames, id, defaultProps }`.
- Frames are 0-indexed integers during rendering. Frame `f` is shown at time `f / fps`.
- **AE mapping:** `CompItem` with `width`, `height`, `frameRate = fps`, `duration = durationInFrames / fps` and `pixelAspect = 1`. Use `f * comp.frameDuration` for times so that 29.97 and other NTSC rates don't drift.

### 1.2 `useCurrentFrame()`

The implementation is in `use-current-frame.ts`:

```
frameLocal = (absoluteFrame − (ctx.cumulatedFrom + ctx.relativeFrom)) * (ctx.playbackRate ?? 1)
```

- It returns the frame **relative to the innermost enclosing `<Sequence>`**.
- `cumulatedFrom` is the sum of all ancestor `from`s.
- It throws if called outside a composition.

### 1.3 `<Sequence>`

The implementation is in `Sequence.tsx`, `RegularSequenceRefForwardingFunction`, lines ~1016–1140.

| prop | default | meaning |
|---|---|---|
| `from` | `0` | Start frame in the parent's timeline. May be negative, which trims the start. |
| `durationInFrames` | `Infinity` | Visible window `[from, from + duration)`. The end is exclusive. It is also clipped by the parent's remaining duration and by the composition length (`min(comp.duration − from, parent.duration − from)`). |
| `layout` | `'absolute-fill'` | `'absolute-fill'` wraps children in an AbsoluteFill div. `'none'` adds no wrapper, and then `style` and `crop*` are not allowed. |
| `name`, `showInTimeline`, `hidden` | | Studio metadata. |
| `premountFor`, `postmountFor` | | Mount early or late but stay invisible. Irrelevant for AE. |
| `trimBefore` (new) | `0` | Shifts content: the child clock origin is `from − trimBefore / playbackRate`. |
| `playbackRate` (new) | `1` | Child frames advance at `rate ×`. Must be constant over time. |
| `loop` (new) | `false` | Repeats the child range of length `durationInFrames`. Needs a finite duration. |
| `freeze` (new) | `null` | Child sees a constant frame. |

The child clock is:

```
childFrame = (absFrame − [cumulatedFrom + (from + loopIndex*loopPeriod − trimBefore/rate)/parentRate]) * parentRate * rate
```

**AE mapping:** a Sequence becomes either a **layer time window** or a **precomp layer**.

- **Flatten (default):** child layers get `inPoint = from/fps` and `outPoint = (from + d)/fps`. Their keyframes go at comp time `(from + localFrame)/fps`. Set `layer.startTime = from/fps` so that layer-local time equals the Sequence-local frame. Keyframes move with the layer if a user slides it.
- **Precomp:** used when the Sequence has `loop`, `playbackRate`, `trimBefore`, `freeze`, or is reused.
  - `startTime = (from − trimBefore)/fps`.
  - Trim with in/out points.
  - `playbackRate` becomes `layer.stretch = 100/rate`.
  - `freeze` becomes Time Remap with a hold key.
  - `loop` becomes Time Remap with `loopOut("cycle")` (or "Enable Time Remapping" plus cycle).

### 1.4 `<Series>` / `<Series.Sequence durationInFrames offset>`

The implementation is in `series/index.tsx`. It renders nested Sequences with a running start frame:

```
start_0 = 0
from_i  = start_i + offset_i
start_{i+1} = start_i + durationInFrames_i / (playbackRate_i ?? 1) + offset_i
```

- A negative `offset` overlaps the previous item. A positive one leaves a gap.
- `offset` shifts this item **and all following items**, and must be an integer.
- Only the last item may have `durationInFrames = Infinity`.
- **AE:** sequential layer windows or precomps. Same as 1.3.

### 1.5 `<AbsoluteFill>`

- It is a `div` with `position:absolute; top:0; left:0; right:0; bottom:0; width:100%; height:100%; display:flex; flex-direction:column`.
- Tailwind classes override individual keys.
- In 4.0.540 it also accepts Sequence-timing props.
- **AE:** not a layer on its own. It is a full-frame layout box: the comp-sized coordinate frame for flex layout.
- If it has a `backgroundColor`, it becomes a comp-sized solid or shape rectangle. If it has transforms, it becomes a null that is the parent of its children.

### 1.6 `interpolate()`

**Signature** (`interpolate.ts:1277–1468`):

```ts
interpolate(input: number, inputRange: readonly number[], outputRange: readonly number[] /* or string[] | boolean[] | number-tuples */,
  options?: {
    easing?: EasingFunction | EasingFunction[];            // array: one per segment (length = inputRange.length − 1)
    extrapolateLeft?:  'extend' | 'clamp' | 'identity' | 'wrap';   // default 'extend'
    extrapolateRight?: 'extend' | 'clamp' | 'identity' | 'wrap';   // default 'extend'
    output?: 'linear' | 'perceptual-scale';                  // default 'linear'
    outputType?: 'font-weight' | 'scale' | 'translate' | 'rotate' | 'transform-origin';
    posterize?: number;                                     // > 0
  }): number
```

**Validation:**

- `inputRange` must be finite, strictly increasing, and the same length as `outputRange`.
- If `easing` is an array, its length must be `n − 1`.

**Numeric algorithm** (`interpolateNumber`, `interpolateSegment`, `interpolateFunction`, `findRange`, `getInputForInterpolation`, lines 583–827). I re-expressed it below and verified it against the package ✔.

```ts
function interpolateRef(x: number, inR: number[], outR: number[], o: Opts = {}): number {
  const L = o.extrapolateLeft ?? 'extend', R = o.extrapolateRight ?? 'extend';
  if (inR.length === 1) return outR[0];
  if (o.posterize !== undefined) x = Math.floor(x / o.posterize) * o.posterize;      // 1. posterize
  const lo = inR[0], hi = inR[inR.length - 1];
  const mod = (a: number, m: number) => ((a % m) + m) % m;
  if ((x < lo && L === 'wrap') || (x > hi && R === 'wrap')) x = mod(x - lo, hi - lo) + lo; // 2. whole-range wrap
  let i = 1; while (i < inR.length - 1 && inR[i] < x) i++;                           // 3. findRange
  const s = i - 1;                                  // first/last segment is reused for x outside the range
  const ease = Array.isArray(o.easing) ? o.easing[s] : (o.easing ?? ((t) => t));
  return segment(x, inR[s], inR[s + 1], outR[s], outR[s + 1], ease, L, R, o.output);
  // (+ tail superposition for Easing.spring({allowTail:true}), see below)
}
function segment(x, a, b, A, B, ease, L, R, output) {
  if (x < a) { if (L === 'identity') return x; if (L === 'clamp') x = a; if (L === 'wrap') x = mod(x - a, b - a) + a; }
  if (x > b) { if (R === 'identity') return x; if (R === 'clamp') x = b; if (R === 'wrap') x = mod(x - a, b - a) + a; }
  if (A === B) return A;                      // equal outputs: the easing is ignored entirely
  const t = ease((x - a) / (b - a));
  if (output === 'perceptual-scale') {        // interpolate in signed "area" space: sign(v)·v²
    const sa = (v) => Math.sign(v) * v * v, fa = (v) => Math.sign(v) * Math.sqrt(Math.abs(v));
    return fa(t * (sa(B) - sa(A)) + sa(A));
  }
  return A + t * (B - A);
}
```

Facts verified against `remotion@4.0.540` ✔:

- **Default extrapolation is `extend`, not clamp.** `interpolate(60,[0,30],[0,100])` returns `200`. AE keyframes always hold the first and last value outside the keyed range, so **the compiler must add boundary keys** whenever an `extend` or `identity` curve is visible outside its input range.
- `extend` keeps evaluating the **first or last segment's easing** with `t < 0` or `t > 1`. With `Easing.quad`, `interpolate(45,[0,30],[0,100])` returns `225`. `Easing.bezier` clamps `x` to [0,1] inside its solver, so a bezier easing effectively *holds* (`100`).
- `identity` returns the input itself (`60`). `wrap` returns `50` for 45 in [0,30]. `clamp` returns `100`.
- `A === B` returns `A` even with an overshooting easing. `interpolate(15,[0,30],[5,5],{easing:Easing.back(3)})` returns `5`.
- Easing arrays apply per segment: `interpolate(15,[0,10,20],[0,100,0],{easing:[linear,quad]})` returns `75`.
- Tuple outputs interpolate per axis: `[[0,0],[100,200]]` gives `[50,100]` at the midpoint.
- Booleans and non-numeric strings require `Easing.step1` on every segment and use discrete selection.
- `outputType` string modes (`'translate(…px)'`, `'rotate(…deg)'`, `'scale(…)'`, `'transform-origin'`) parse CSS, interpolate each axis with `interpolateNumber`, and re-serialize. Units must match.
- `interpolateColors(input, inR, colors, {easing, posterize})` (`interpolate-colors.ts:668–730`) parses CSS colors (hex, rgb[a], hsl[a], oklch, oklab, lab, lch, hwb) to RGBA. It interpolates **each 8-bit sRGB channel separately with clamp extrapolation**. RGB channels are rounded to integers; alpha uses `toFixed(3)`. `#ff0000 → #0000ff` at the midpoint gives `rgba(128, 0, 128, 1)`.
  - AE: Color props are float `[r/255, g/255, b/255, a]`. Interpolating encoded sRGB values matches AE keyframe interpolation. Linearize-working-space affects blending, not key values.
- **Tail superposition** (only for easings with `remotionShouldExtendRight`, i.e. `Easing.spring({allowTail:true})`): for every earlier segment whose easing has a tail, add `segmentValue_extended(x) − outR[seg+1]` to the result. A spring's ringing therefore continues into later segments. **The AE equivalent is additive**: bake it, or sum the curves with an expression.

### 1.7 `Easing` (`easing.ts`, all formulas)

Derived from React Native's Easing.

| function | formula | exact AE mapping? |
|---|---|---|
| `linear(t)` | `t` | yes: LINEAR keys (or bezier, speed = avg, influence 33.33%) |
| `ease(t)` | `bezier(0.42, 0, 1, 1)(t)`. **This is CSS `ease-in`, not CSS `ease` (0.25,0.1,0.25,1).** ✔ | yes (2 keys) |
| `quad(t)` | `t²` | **yes, exactly `cubic-bezier(1/3, 0, 2/3, 1/3)`** ✔ |
| `cubic(t)` | `t³` | **yes, exactly `cubic-bezier(1/3, 0, 2/3, 0)`** ✔ |
| `poly(n)(t)` | `tⁿ` | exact only for n ∈ {1,2,3}; otherwise fit (n=4: 3e-4, n=5: 9e-4 normalized error with 1 segment) |
| `sin(t)` | `1 − cos(πt/2)` | ≈ `cubic-bezier(0.3613, 0, 0.6739, 0.4875)`, max error 2.4e-5 |
| `circle(t)` | `1 − √(1 − u²)`, with `u = clamp(t,0,1)` | ≈ `(0.5211, −0.0055, 0.9990, 0.4241)`, error 9.4e-4. Infinite slope at t=1: in-ease speed is huge. |
| `exp(t)` | `2^(10(t − 1))`. **Note `exp(0) = 2⁻¹⁰ ≈ 0.000977`, not 0** ✔ | ≈ `(0.6365, 0.0184, 0.8453, −0.0588)`, error 9.8e-4. There is a jump of 0.1% of Δv at t=0. |
| `elastic(b = 1)(t)` | `1 − cos(πt/2)³ · cos(b·π·t)` | no: bake (5 keys at 0.5 px, 7 keys at 0.1 px for 500 px over 30 f) |
| `back(s = 1.70158)(t)` | `t²((s+1)t − s)` | **yes, exactly `cubic-bezier(1/3, 0, 2/3, −s/3)`** ✔ |
| `bounce(t)` | piecewise on `u=clamp(t)`: `7.5625u²` for u<1/2.75; `7.5625(u−1.5/2.75)²+0.75` for u<2/2.75; `7.5625(u−2.25/2.75)²+0.9375` for u<2.5/2.75; else `7.5625(u−2.625/2.75)²+0.984375` | **yes, exactly 5 keys** (4 parabolas), see §2.2. Note: `Easing.bounce` itself already has the "bounce-at-the-end" (out) shape. |
| `bezier(x1,y1,x2,y2)` | CSS cubic-bezier. Throws unless x1, x2 ∈ [0,1]. Clamps x. Linear shortcut when x1=y1 and x2=y2. 11-sample Float32 table, then 4 Newton iterations (slope ≥ 0.001) or bisection (precision 1e-7, max 10 iterations). | yes (2 keys). Remotion's solver agrees with exact bisection to 4.4e-16 ✔ |
| `in(f)` | `f` | |
| `out(f)(t)` | `1 − f(1 − t)` | exact if f is exact (mirror). E.g. `out(quad)` = `(1/3, 2/3, 2/3, 1)`, `out(cubic)` = `(1/3, 1, 2/3, 1)`, `out(back)` = `(1/3, 1+s/3, 2/3, 1)` ✔ |
| `inOut(f)(t)` | `t<0.5 ? f(2t)/2 : 1 − f(2(1−t))/2` | exact if f is exact: **3 keys** (mid key at t=0.5, v=0.5; speed there = `f′(1)·Δv/Δt`) ✔ |
| `step0(n)` | `n > 0 ? 1 : 0` | HOLD key at t0 with v0, then HOLD key one frame later with v1 |
| `step1(n)` | `n ≥ 1 ? 1 : 0` | HOLD out of key0 (AE hold semantics are identical) |
| `spring({damping, mass, stiffness, overshootClamping, allowTail=false, durationRestThreshold})` (new) | `t ≤ 0 → 0`. If !allowTail: `t ≥ 1 → 1`, else `spring({fps:30, frame:30t, durationInFrames:30, …})`. If allowTail: `spring({fps:30, frame: t·measureSpring(fps 30)})`, extended right. | bake (see §2.3). `Easing.spring()(0.5) = 1.10414` ✔ |

**General rule:** any easing that is a polynomial of degree ≤ 3 in t is *exactly* an AE segment with **both influences = 33.333%** and speeds equal to the analytic end slopes:

- `speed_out = p′(0)·Δv/Δt`
- `speed_in = p′(1)·Δv/Δt`

This holds because a bezier with x-controls (1/3, 2/3) has x(u) = u, so it reduces to cubic Hermite interpolation. Consequence: **AE 33.33%/33.33% keys are a cubic Hermite spline in time**, the backbone of the baking algorithm in §2.3.

### 1.8 `spring()`, exact algorithm (`spring/index.ts`, `spring/spring-utils.ts`, `spring/measure-spring.ts`)

**Signature:**

```ts
spring({ frame, fps, config?: { damping = 10, mass = 1, stiffness = 100, overshootClamping = false },
         from = 0, to = 1, durationInFrames?, durationRestThreshold?, delay = 0, reverse = false }): number
```

- `frame` may be fractional and negative. Negative frames clamp to 0.
- An explicitly `undefined` config key falls back to the default (`??`).
- `damping ≤ 0` throws.

**Integrator** (`spring-utils.ts`):

- `springCalculation` always simulates a normalized spring from 0 to 1, starting at rest (velocity 0).
- It steps `f = 0 … floor(frame)` at timestamps `f/fps·1000` ms, then one extra fractional step to `frame/fps·1000` if `frame % 1 > 0`.
- Each `advance()` (lines 25–103) applies the **closed-form solution** of `m·x″ + c·x′ + k·(x − 1) = 0` over `Δt = min(now − last, 64 ms)` from the current state (x, v):
  - `ζ = c / (2√(km))`, `ω0 = √(k/m)` rad/s, `ω1 = ω0√(1−ζ²)`.
  - If `ζ < 1`, it uses the underdamped solution. Otherwise it uses the critically damped solution (with ω0). There is no separate overdamped branch.
- There is a memo cache keyed by frame and config.

Because each step is the exact analytic flow of the ODE, **stepping composes exactly**. The curve is therefore the closed form evaluated at the effective time:

```
t_eff(frame) = ( floor(frame) · min(1000/fps, 64) + min(frac(frame) · 1000/fps, 64) ) / 1000     [seconds]

ζ < 1 :  x(t) = 1 − e^(−ζ ω0 t) · ( cos(ω1 t) + (ζ ω0 / ω1) · sin(ω1 t) )
         x′(t) = (ω0² / ω1) · e^(−ζ ω0 t) · sin(ω1 t)
ζ ≥ 1 :  x(t) = 1 − e^(−ω0 t) · (1 + ω0 t)            // critical formula, even when over-damped
         x′(t) = ω0² · t · e^(−ω0 t)
```

✔ The max difference between stepping and the closed form is 3.3e-16 for fps 12, 24, 30 and 60.

Quirks to reproduce:

1. **64 ms step cap.** Below 15.625 fps the spring runs in slow motion (each frame advances only 64 ms). At 12 fps the naive `t = f/fps` is off by 0.21 (normalized) ✔.
2. **Over-damping is ignored.** For `damping ≥ 2√(km)`, every curve equals the critically damped one. damping 20 and damping 2000 (k=100, m=1) are identical, difference 0 ✔. `measureSpring` gives 23 frames for both.
3. **`overshootClamping` is `min(x, 1)` on the normalized value.** It removes overshoots but **keeps undershoot dips**. The default spring with clamping still dips to 0.9735 after first reaching 1 ✔. It is not a monotone curve.

**Wrapper** (`spring/index.ts:13–95`):

```
D       = durationInFrames                    (optional)
natural = measureSpring({fps, config, threshold: durationRestThreshold})   // computed only if reverse || D defined
rp = reverse ? (D ?? natural) − frame : frame
dp = rp + (reverse ? +delay : −delay)
p  = D === undefined ? dp : dp / (D / natural)     // time-scale so the natural settle time maps onto D frames
if (D && dp > D) return to                          // hard snap to `to` after the duration
x  = springCalculation(p).current
if (overshootClamping) x = min(x, 1)
return (from === 0 && to === 1) ? x : from + (to − from)·x     // via interpolate(x,[0,1],[from,to]) (extend)
```

What the wrapper implies:

- **`delay`:** for frames before `delay`, `p < 0` clamps to 0, so the value stays `from`.
- **`durationInFrames`:** a pure time-stretch by `natural/D`. From frame `delay + D + 1` on, the value is exactly `to`. The step at that boundary is at most `durationRestThreshold·|to−from|`, i.e. 0.5% by default. `spring({frame:20, fps:30, durationInFrames:20})` gives 0.99685, and frame 21 gives 1 ✔.
- **`reverse`:** the curve is time-mirrored over `[delay, delay + D]`. Frame 0 is about `to`, and frame `D` is exactly `from` with zero velocity. With `D` passed, frames before `delay` return `to`.

**`measureSpring({fps, config, threshold = 0.005})`** (`measure-spring.ts:23–106`):

- threshold 0 returns Infinity, and threshold 1 returns 0.
- Otherwise it increments `frame` until `|x(frame) − 1| < threshold`.
- It then requires 20 more consecutive frames inside the threshold. Any frame outside resets the counter (`i = 0`, then `i++`, so the reset needs 19 more frames) and sets `finished = frame + 1`.
- Results ✔: default config at 30 fps gives **28** frames (56 at 60 fps). damping 20 or 200 gives 23. `{damping:12, stiffness:200}` gives 26. `mass:2` gives 62.

**Reference implementation** (closed form, ES3-compatible, so the **same code** runs in Node, ExtendScript and AE expressions). ✔ Max difference against `remotion@4.0.540` is **4.6e-13** over 6,204 samples: fps 12, 24, 30 and 60; damping 4, 10, 12, 20, 200; mass and stiffness variants; overshootClamping, delay 7.5, durationInFrames, reverse, custom threshold; fractional frames.

```js
function aecSpringUnit(f, fps, c, k, m) {            // == springCalculation(...).current
  if (f <= 0) return 0;
  var stepMs = Math.min(1000 / fps, 64);
  var whole = Math.floor(f);
  var t = (whole * stepMs + Math.min((f - whole) * 1000 / fps, 64)) / 1000;
  var zeta = c / (2 * Math.sqrt(k * m)), w0 = Math.sqrt(k / m);
  if (zeta < 1) {
    var w1 = w0 * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(w1 * t) + (zeta * w0 / w1) * Math.sin(w1 * t));
  }
  return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
}
function aecMeasureSpring(fps, c, k, m, thr) {       // == measureSpring()
  if (thr === 0) return Infinity; if (thr === 1) return 0;
  var frame = 0, fin, i;
  while (Math.abs(aecSpringUnit(frame, fps, c, k, m) - 1) >= thr) frame++;
  fin = frame;
  for (i = 0; i < 20; i++) {
    frame++;
    if (Math.abs(aecSpringUnit(frame, fps, c, k, m) - 1) >= thr) { i = 0; fin = frame + 1; }
  }
  return fin;
}
function aecSpring(frame, fps, c, k, m, clampOvershoot, from, to, dur /* <=0: not passed */, thr, delay, reverse) {
  var hasDur = dur > 0, nat = (reverse || hasDur) ? aecMeasureSpring(fps, c, k, m, thr) : 0;
  var rp = reverse ? (hasDur ? dur : nat) - frame : frame;
  var dp = rp + (reverse ? delay : -delay);
  var p = hasDur ? dp / (dur / nat) : dp;
  if (hasDur && dp > dur) return to;
  var x = aecSpringUnit(p, fps, c, k, m);
  if (clampOvershoot) x = Math.min(x, 1);
  return from + (to - from) * x;
}
```

**Analytic structure of the underdamped spring** (used in §2.3):

- **Extrema are equally spaced:** `x′ = 0 ⇔ sin(ω1 t) = 0 ⇔ t_n = nπ/ω1`.
- **Values at the extrema:** `x(t_n) = 1 − (−1)ⁿ·rⁿ`, where `r = e^(−πζ/√(1−ζ²))`.
  - Default spring: `T = π/ω1 = 0.36276 s = 10.883 frames at 30 fps`, `r = 0.16303`, first peak 1.16303 ✔.
- **Self-similarity:** `1 − x(t_n + τ) = (−1)ⁿ e^(−ζω0 t_n) · (1 − x(τ))`. Every half-period segment between consecutive extrema is a scaled copy of the first one (✔ 3e-14). Normalized to [0,1]², each segment is:

  ```
  g_q(u) = (1 − e^(−q u)(cos πu + (q/π) sin πu)) / (1 + e^(−q)),   q = πζ/√(1−ζ²)
  ```

  It depends **only on ζ**.

---

## 2. Mapping Remotion → AE

Remotion's model is `value = F(frame)`, a pure function evaluated per frame. AE's model is keyframes plus temporal ease, evaluated as piecewise cubic beziers in (time, value). There are three bridges, in order of preference.

### 2.1 (a) Exact analytic mapping (no sampling)

Applies when the property's value is `interpolate(frame − c, inR, outR, {easing})` (optionally times a constant unit factor), or a `spring(...)` with known config.

1. **One AE key per `inputRange` entry**, at comp time `(sequenceFrom + inR[i] + c)/fps`.
2. Per segment, map the easing:
   - **CSS/bezier easing:** 2 keys per segment using the formulas in §3.3.
   - **quad, cubic, back, or any polynomial of degree ≤ 3:** influence 33.333% on both sides, `speed_out = p′(0)·Δv/Δt`, `speed_in = p′(1)·Δv/Δt`:
     - `quad`: out 0, in `2·avg`
     - `cubic`: out 0, in `3·avg`
     - `back(s)`: out 0, in `(s+3)·avg` (4.70158·avg for the default s)
     - `out(f)`: mirror
   - **`inOut(f)`** for exact f: add a middle key at the segment midpoint with `v = (v0+v1)/2` and speed `f′(1)·avg` on both sides (continuous).
   - **`bounce`:** 5 keys exact ✔. Keys at `u = 0, 1/2.75, 2/2.75, 2.5/2.75, 1`, values `0, 1, 1, 1, 1`, all influences 33.333%. Speeds, as a multiple of `avg = Δv/Δt`:

     | key at u | in speed | out speed |
     |---|---|---|
     | 0 | – | 0 |
     | 1/2.75 | +5.5 | −2.75 |
     | 2/2.75 | +2.75 | −1.375 |
     | 2.5/2.75 | +1.375 | −0.6875 |
     | 1 | +0.6875 | – |

     The keys are non-continuous. **The three middle segments have `v0 == v1` with non-zero speeds, which Lottie cannot represent (§4.9) but AE can.** [verify in AE]
   - **`step1`:** HOLD out. **`step0`:** a hold key one frame later.
   - **Linear:** `KeyframeInterpolationType.LINEAR` on both sides, which is cleaner in the UI than an equivalent bezier.
3. **Segments with `outR[i] == outR[i+1]`:** speed 0 (Remotion returns a constant regardless of easing).
4. **Extrapolation** (AE always holds outside the first and last key):

   | Remotion extrapolation | AE emission |
   |---|---|
   | `clamp` | nothing extra |
   | `extend` | if the layer is visible outside `[inR₀, inRₙ]`, add a key at the visible-window boundary with the extrapolated value. Linear easing: exact. Polynomial easing: the extended polynomial is still cubic, so emit one more Hermite segment. Bezier easing: Remotion clamps x, so it is effectively `clamp`. |
   | `identity` | a linear key pair with slope 1 unit/frame (`fps` units/s) out to the window boundary |
   | `wrap` | `loopOut("cycle")` or `loopIn("cycle")` expression, or repeated keys (bake) if it must stay expression-free |

5. **Springs:** see §2.3 and §2.4.

### 2.2 Spring as keys: analytic seeding

- **Underdamped (ζ<1):** keys at the **extrema** `t_n = delay + nπ/ω1` (scaled by `D/natural` if `durationInFrames` is set), values `from + (to−from)(1 − (−1)ⁿ rⁿ)`, **speed 0** at every extremum (also at t=0, since the spring starts at rest).
  - By self-similarity one influence pair fits *every* segment ✔. Normalized minimax error, relative to the segment amplitude `|Δv|` (which decays like rⁿ):

    | ζ | out influence | in influence | max error (% of segment amplitude) |
    |---|---|---|---|
    | 0.1 | 34.13% | 39.07% | 0.057% |
    | 0.2 | 31.96% | 41.98% | 0.110% |
    | 0.3 | 29.93% | 45.31% | 0.179% |
    | 0.5 (default) | 26.23% | 53.98% | 0.415% |
    | 0.7 | 23.08% | 68.17% | 1.04% |
    | 0.9 | 21.27% | 100% (clamped) | 4.1% (needs extra keys) |

  - Extrema-only keys for the default spring 0→500 px: 8 keys, max frame error 2.41 px. That is too coarse for strict work, so §2.3 refines it adaptively. Stop emitting extrema once `|to−from|·rⁿ < tol`, then put the final key at `to`.
- **ζ ≥ 1 (critical formula):** monotone. Key at t=0 (speed 0), then adaptive refinement. The final key goes where `|to−from|·(1 − x) < tol`.
- **overshootClamping:** add keys at the crossings of 1, at `t_c = (π − atan2(ω1, ζω0))/ω1 + nπ/ω1`, and HOLD (or speed-0 flat) segments while clamped. Bake the dips normally.
- **durationInFrames:** after `delay + D`, add a key at `to`. The 1-frame snap is ≤ threshold·Δv, so either keep a 1-frame step or absorb it if it is below tol.

### 2.3 (b) Baking arbitrary curves: recommended algorithm with error bounds

Use **"extrema-seeded cubic Douglas–Peucker"**: Douglas–Peucker's split-at-worst-point recursion, but each piece is an AE bezier segment rather than a line.

```
input : f(t) evaluable at fractional t (Remotion fns accept float frames), optional f′(t);
        window [t0,t1]; fps; tolerance tol (in the property's AE units); sample set S
1. Knots K = {t0, t1} ∪ {extrema: sign changes of f′ on an 8×/frame grid, bisection-refined}
            ∪ {discontinuities of f or f′ (piecewise easings, step, Sequence edges)}.
   Optionally snap interior knots to integer frames (editable keys); then extremum speed ≠ 0 → use f′.
2. For each knot: value v = f(t); speed s = 0 at extrema, else f′(t) (analytic or central difference
   with h = 1e-5 s). If f′ jumps (bounce, inOut joins), store separate in/out speeds (non-continuous key).
3. For each interval [ta,tb]: endpoint values & speeds are FIXED (guarantees C1 at shared knots ⇒
   keyTemporalContinuous=true); fit the 2 free influences (i_out(ta), i_in(tb)) ∈ [0.1,100]² minimising
   max |f(t) − B(t)| over S∩[ta,tb]  (S = integer frames + midpoint; + shutter sub-samples if motion blur).
   Start from 33.333/33.333 (= Hermite), coarse 5% grid, then pattern search to 0.01%.
4. If err > tol: insert a knot at the worst sample (≥¼ frame from the ends), recurse on both halves.
5. Emit keys; verify against Remotion at every integer frame (and against AE read-back, §5).
```

**Error bounds:**

- *On the check set S:* `|f − B| ≤ tol` holds by construction.
- *Between samples* (spacing `h_s`), the linear-interpolation remainder applied to `g = f − B` gives:

  ```
  |f(t) − B(t)| ≤ tol + (h_s² / 8) · max|f″ − B″|
  ```

- *A-priori knot spacing:* the 33.33% seed is exactly cubic Hermite, so before any influence optimisation:

  ```
  |f − H| ≤ (h⁴ / 384) · max|f⁽⁴⁾|
  ```

  For the spring, `|x⁽⁴⁾| ≤ A·ω0⁴/√(1−ζ²)`, so `h ≤ (384·tol·√(1−ζ²) / (A·ω0⁴))^(1/4)`. ✔ Default spring 0→500 px with uniform Hermite knots:

  | knot spacing | actual error | bound |
  |---|---|---|
  | every 2 frames | 0.136 px | 0.257 px |
  | every 3 frames | 0.538 px | 1.30 px |
  | every 4 frames | 1.76 px | 4.12 px |

**Measured results** ✔ (`fit.mjs`, 500 px travel, 30 fps, error measured at integer frames):

| curve | frames | keys @ 0.5 px | keys @ 0.1 px | linear-key RDP @ 0.1 px |
|---|---|---|---|---|
| spring default (ζ=0.5), 28 f | 29 | 6 (0.37 px) | 7 (0.055 px) | 27 |
| spring damping 4 (ζ=0.2), 60 f | 61 | 10 | 17 (0.064 px) | 59 |
| spring damping 20 (critical), 23 f | 24 | 4 | 7 | – |
| `Easing.elastic(1)` over 30 f | 31 | 5 | 7 | – |
| `Easing.inOut(Easing.exp)` over 30 f | 31 | 5 | 7 | – |
| `Easing.sin` over 30 f | 31 | 2 | 3 | – |

Plain RDP with linear keys is **not** recommended. Its error is `h²/8·|f″|` rather than `h⁴/384·|f⁽⁴⁾|`, so it needs about 4× the keys and produces "robotic" linear keys in the Graph Editor. Use RDP only as a candidate-knot heuristic.

**Fallback:** if `f` is not smooth, or the fit hits depth 12 or segments shorter than one frame (noise, `random()`, Math.round of frame), emit one LINEAR key per frame. That is exact at frames, like AE's "Convert Expression to Keyframes".

### 2.4 (c) Expression mode: live-tweakable spring rig

Emit the §1.8 functions as an expression and drive them from Expression Controls. This is exact (4.6e-13) and ES3-safe, so it works in both the Legacy ExtendScript and JavaScript expression engines.

- **Controls** (on the layer or a shared "Controls" null): `ADBE Slider Control` named "Damping", "Stiffness", "Mass", "Delay (f)", "Duration (f)" (0 = natural) and "Rest Threshold"; `ADBE Checkbox Control` "Overshoot Clamp"; `ADBE Checkbox Control` "Reverse".
- **Endpoints:** `from` and `to` can be literals, Slider/Point/Color controls, or `key(1).value` and `key(2).value` of hidden keys, so the designer can still drag endpoints.

```js
// Position (2D) — paste after the three functions from §1.8
var fx = thisLayer;   // or thisComp.layer("Controls")
var c = fx.effect("Damping")("Slider"), k = fx.effect("Stiffness")("Slider"), m = fx.effect("Mass")("Slider");
var delay = fx.effect("Delay (f)")("Slider"), dur = fx.effect("Duration (f)")("Slider");
var thr = fx.effect("Rest Threshold")("Slider"), clamp = fx.effect("Overshoot Clamp")("Checkbox") == 1;
var rev = fx.effect("Reverse")("Checkbox") == 1;
var fps = 1 / thisComp.frameDuration;
var f = Math.round((time - thisLayer.startTime) * fps * 1e6) / 1e6;  // Sequence-local frame, de-jittered
var from = [960, 1200], to = [960, 540], out = [];
for (var i = 0; i < from.length; i++) out.push(aecSpring(f, fps, c, k, m, clamp, from[i], to[i], dur, thr, delay, rev));
out;
```

- **Cost:** O(1) per frame without `durationInFrames` or `reverse`, otherwise O(natural frames) for `measureSpring`. That is negligible.
- **Trade-offs:**
  - Live sliders.
  - Not visible in the Graph Editor.
  - Lottie export needs baking.
  - Slower previews in very large rigs.
- **Hybrid offer:** bake the keys, and add a rig whose expression is stored but disabled. The user enables it to tweak.

### 2.5 Structural mapping summary

| Remotion | AE |
|---|---|
| `Composition` | `CompItem` |
| `Sequence` | layer window (in/out, startTime) or precomp layer |
| `Series` | consecutive windows or precomps |
| `AbsoluteFill` | comp-sized layout frame (no layer unless styled) |
| `Loop` | precomp + Time Remap `loopOut("cycle")` |
| `Freeze` | Time Remap hold |
| `playbackRate` | `layer.stretch = 100/rate` |
| `useCurrentFrame` | key times `(from + f)/fps` |
| CSS `opacity 0..1` | `ADBE Opacity 0..100` (multiply values **and speeds** by 100) |
| CSS `scale(1)` | `ADBE Scale 100%` (×100) |
| CSS `rotate(deg)` | `ADBE Rotate Z` (same sign, y-down) |
| `transform-origin` | Anchor Point |
| `translate(x,y)` | Position (relative to the layout position) |

---

## 3. AE temporal ease math (exact)

### 3.1 Definition: one segment of a 1-D property

Key0 at `(t0, v0)` has outgoing ease `(s0, i0%)`. Key1 at `(t1, v1)` has incoming ease `(s1, i1%)`. Speeds are in value-units per **second**. The in-speed is the arrival derivative, not negated. The segment is a cubic bezier in (time, value), and time→u is solved exactly as for CSS:

```
Δt = t1 − t0
P0 = (t0, v0)
P1 = (t0 + (i0/100)·Δt,  v0 + s0·(i0/100)·Δt)
P2 = (t1 − (i1/100)·Δt,  v1 − s1·(i1/100)·Δt)
P3 = (t1, v1)
dv/dt at t0 = s0 ,  dv/dt at t1 = s1          (influence does not change the slope at the key)
```

Normalized to the unit square (Lottie `o` and `i`, CSS `cubic-bezier(x1,y1,x2,y2)`), with `Δv = v1 − v0` and `avg = Δv/Δt`:

```
x1 = i0/100           y1 = s0·(i0/100)·Δt / Δv = (s0/avg)·x1
x2 = 1 − i1/100       y2 = 1 − s1·(i1/100)·Δt / Δv = 1 − (s1/avg)·(1 − x2)
```

AE "Easy Ease" (F9) is `speed 0, influence 33.333%` on both sides, i.e. `cubic-bezier(0.333, 0, 0.667, 1)`. Influence 33.333% on both sides is cubic Hermite (§1.7).

### 3.2 Verified against bodymovin's exporter

The exporter is `bundle/jsx/utils/keyframeHelper.jsx`, function `exportKeys`. These are paraphrased with line numbers; read the file for the literal code.

- **L69–95 `buildKeyInfluence`:**
  - Spatial (TwoD/ThreeD_SPATIAL), SHAPE and NO_VALUE properties read **one** ease: `keyInTemporalEase(k+1)[0]` and `keyOutTemporalEase(k)[0]`.
  - Every other type reads the whole per-dimension arrays.
- **L176:** `duration = (keyTime(k+1) − keyTime(k)) / layerStretch`, in seconds.
- **L207–234, non-spatial (OneD/TwoD/ThreeD/COLOR):**
  - `o.x[d] = outInfluence[d]/100`, `i.x[d] = 1 − inInfluence[d]/100`.
  - `averageSpeed[d] = Δv[d]/duration`, ×255 for COLOR.
- **L253–287, non-spatial y:**
  - `yNormal = Δv[d]` (×255 for COLOR). If `|yNormal| < 1e-7`, then `yNormal = 1`.
  - `o.y[d] = outSpeed·outInfluence/100·duration / yNormal`.
  - `i.y[d] = 1 − inSpeed·inInfluence/100·duration / yNormal`.
  - **This is exactly the formula in §3.1.**
- **L185–198 and L241–251, spatial:**
  - `L = getCurveLength(v0, v1, to, ti)`: a 200-point polyline length of the spatial bezier (L37–67).
  - `avg = L/duration`.
  - `infOut = min(100·L/(outSpeed·duration), outInfluence)`, likewise `infIn`.
  - `o.x = infOut/100`, `i.x = 1 − infIn/100`.
  - `o.y = (outSpeed/avg)·infOut/100`, `i.y = 1 − (inSpeed/avg)·infIn/100`.
  - The `min()` caps `y ≤ 1`: the distance travelled along the path can never exceed L inside the handle.
  - If `L = 0`, it uses `y = x` (linear).
- **L199–206, SHAPE and NO_VALUE:** `avg = 1`, `infOut = min(100/outSpeed, outInfluence)`, `o.y = outSpeed·infOut/100`. No duration is used, so shape-path speed is in normalized progress units. [verify in AE]
- **L245–247 and L261–263, LINEAR** (both sides): `y = x`.
- **L147–174, HOLD:** a segment with `h: 1`.
- **L292–295:** everything is rounded to 3 decimals.

Lottie playback (`lottie-web PropertyFactory.js interpolateValue`) confirms the semantics:

- **Non-spatial, L139–160:** each dimension `i` gets its own `BezierEasing(o.x[i], o.y[i], i.x[i], i.y[i])`. A missing index falls back to `[0]`, so a 1-element ease applies to every channel. The value is `s + (e − s)·ease(perc)`.
- **Spatial, L62–114:** builds an arc-length table of the spatial bezier `(s, s+to, e+ti, e)`. `perc = ease(timeFraction)`, `distance = segmentLength·perc`, and the point is looked up by arc length. **The ease controls the fraction of path length, which is AE's model.**

### 3.3 Inverse: CSS `cubic-bezier(x1,y1,x2,y2)` → AE `KeyframeEase`

```
avg          = (v1 − v0) / (t1 − t0)                       // per dimension (non-spatial)
influenceOut = clamp(100·x1,        0.1, 100)
speedOut     = (y1 / (influenceOut/100)) · avg              // = (y1/x1)·avg when not clamped
influenceIn  = clamp(100·(1 − x2),  0.1, 100)
speedIn      = ((1 − y2) / (influenceIn/100)) · avg         // = ((1−y2)/(1−x2))·avg when not clamped
```

This matches bodymovin's **Lottie→AE importer** (`src/helpers/importers/lottie/property.js:38–69`):

- `inInfluence = (1 − i.x)·100`, `outInfluence = o.x·100`.
- `outSpeed = (o.y·Δv/Δt)/outInfluence·100`, `inSpeed = ((1 − i.y)·Δv/Δt)/inInfluence·100`.
- The importer does **not** guard `x1 = 0`, which divides by zero, and it treats spatial properties per-dimension, which is a bug for Position.

✔ Round trip `CSS → AE → evaluate AE bezier` (Δv = 600) gives errors of about 1e-13 for:

- `ease` (0.25,0.1,0.25,1) → out(160 = 0.4·avg, 25%) in(0, 75%)
- `ease-in-out` (0.42,0,0.58,1) → (0, 42%) / (0, 42%)
- `easeInSine` (0.12,0,0.39,0) → out(0, 12%) in(655.7 = 1.639·avg, 61%)
- overshooting `(0.68,−0.6,0.32,1.6)` → (−352.9 = −0.882·avg, 68%) / (−352.9, 68%)

### 3.4 The influence clamp [0.1, 100] and x1 = 0 / x2 = 1

- `KeyframeEase(speed, influence)` accepts influence only in **[0.1, 100.0]** (AE Scripting Guide).
- So `x1 ∈ [0.001, 1]` and `x2 ∈ [0, 0.999]`.
- `x1 ≤ 1` and `x2 ≥ 0` are the same as the CSS validity rule, and they guarantee x(u) is monotone, so AE can never represent a non-function curve.
- **`x1 = 0`** (e.g. `ease-out` (0,0,0.58,1), `(0, y1, …)`): use influence 0.1 and compute speed from the *clamped* influence, so the handle height stays `y1`. P1 moves from `(0, y1)` to `(0.001, y1)`.
  - ✔ The error is about **6.6e-4·|Δv|**: 0.40 px on a 600 px move for (0,0,0.58,1), 0.41 px for (0,0.5,1,0.5), and 0.35 px for (0.3,0,1,1).
  - A safe general bound is `≈ (4/9)·0.001·max|dy/dx|`.
  - If that exceeds tol (very steep starts), split the segment and bake per §2.3.
- `y1 ≠ 0` with `x1 = 0` means infinite initial speed. AE gets `1000·y1·avg`.

### 3.5 `v0 == v1` (hold-in-place keys)

- **AE:** the value graph is the absolute bezier above, so non-zero speeds produce a bulge (overshoot-and-return) even when the values are equal. This is legal and used for "dip" keys such as bounce's middle segments. [verify in AE]
- **CSS → AE:** `avg = 0`, so every speed is 0 and the segment is constant. This matches Remotion's `A === B` behavior.
- **Lottie:** `y` is normalized by Δv. bodymovin substitutes `yNormal = 1`, and the player computes `v0 + 0·ease = v0`, so **any bulge is lost**.
- **Recommendation:** emit speed 0, or HOLD if the next segment jumps. Use non-zero speeds only when the source curve really leaves the value (analytic bounce, §2.1).

### 3.6 Multi-dimensional non-spatial properties

Examples: Scale, Size, Anchor-like non-spatial 2D/3D, effect 2D sliders.

- `PropertyValueType.TwoD` uses **2** `KeyframeEase` objects per side, `ThreeD` uses **3**, and every other type (OneD, COLOR, spatial, SHAPE) uses **1** (Scripting Guide, `setTemporalEaseAtKey`).
- Each dimension uses **its own Δv** for avg and speed. A dimension with Δv = 0 gets speed 0.
- Layer **Scale is ThreeD even on 2D layers** (value `[x,y,z]`, so it takes 3 eases). **[verify in AE]** Always size the arrays from `prop.propertyValueType` or `prop.keyInTemporalEase(k).length` at runtime.
- **Lottie:** `o.x`, `o.y`, `i.x` and `i.y` are **arrays with one entry per dimension** (OneD gets a 1-element array).
- **COLOR caveat:** AE exposes a **single** ease for 4 channels.
  - bodymovin computes that ease's y using **channel 0's** `255·Δ` (L266–273, the loop runs over `easeIn.length = 1`). The speed is therefore in 0–255 units/s, but normalizing by red only looks inexact whenever red is not the dominant channel.
  - How AE defines color speed (per-channel max? Euclidean RGBA? red?) is **undocumented**. **[verify in AE] with the calibration probe in §5.**
  - Until then, colors with non-trivial easing should either use speed 0 (Easy-Ease-like) or LINEAR exactly. Other colors can be baked, or driven through three Slider-driven channels if exactness matters.

### 3.7 Spatial properties

Examples: Position, Anchor Point, Point Control, shape Position.

- **A single `KeyframeEase`.**
  - `speed` is the scalar **speed along the motion path** (px/s, ≥ 0).
  - The ease maps the time fraction to the **fraction of arc length** of the spatial bezier `B(u) = bez(v0, v0+outTangent(k), v1+inTangent(k+1), v1)`.
  - Spatial tangents (`keyOutSpatialTangent` and `keyInSpatialTangent`, relative offsets, the same as Lottie `to`/`ti`) define the *shape*, and temporal ease defines the *timing*. They are independent.
- **From a CSS easing** on a spatial segment of length L:

  ```
  L        = arcLength(B)       // Gauss–Legendre (16–24 pt) or adaptive Simpson; bodymovin's 200-pt polyline under-estimates slightly
  avg      = L / Δt
  speedOut = (y1/x1)·avg,  influenceOut = 100·x1
  speedIn  = ((1−y2)/(1−x2))·avg,  influenceIn = 100·(1−x2)
  ```

  Straight path: tangents `[0,0]` and `L = |v1 − v0|`.
- **No overshoot inside a spatial segment.** Arc-length progress is monotone, speeds are ≥ 0, and AE caps the handle so progress stays ≤ L (bodymovin models this as `influence ≤ 100·L/(speed·Δt)`). [verify in AE]
  - For `back`, spring, elastic or any overshooting curve on Position, choose one of:
    1. **Separate Dimensions:** `position.dimensionsSeparated = true` makes `ADBE Position_0/1/2` OneD, which is exact per axis. Recommended whenever x and y have different easing or timing.
    2. **Keys at the extrema along the path**, each segment monotone, with speed 0 at the extrema (§2.2). This works naturally for springs on a straight line.
- **Speed for curved paths** comes from the derivative of the path: `speed = |dP/dt| = |B′(u)|·|du/dt|`. For baked data, use `|Δposition/Δt|` from samples.
- **Spatial interpolation hygiene:**
  - New keys get **auto-bezier spatial tangents** unless the user's preference "Default Spatial Interpolation to Linear" is on.
  - Always call `setSpatialAutoBezierAtKey(k,false)`, `setSpatialContinuousAtKey(k, …)` and `setSpatialTangentsAtKey(k, inT, outT)` explicitly. Use 2 or 3 elements, matching the property's dimension.
  - Otherwise straight Remotion moves become curved.
- **Roving** (`setRovingAtKey`; not allowed on the first or last key):
  - AE re-times a roving key to give constant speed across the neighboring keys, so its time is not yours.
  - **Never emit roving keys.** bodymovin handles input roving by running "Rove Across Time" (command 3153), exporting, then undoing.
  - Auto-orient (`layer.autoOrient = AutoOrientType.ALONG_PATH`) follows the spatial path tangent and is independent of ease.

### 3.8 SHAPE (path) and NO_VALUE properties

- A single ease. Following bodymovin, speed is in normalized progress per normalized time, with `y = speed·influence/100` and `avg = 1`, capped at `y ≤ 1`.
- Path morphing in AE interpolates vertices linearly by progress. Remotion `@remotion/paths` `interpolatePath` is similar but resamples paths, so vertex counts must match for AE.
- [verify in AE] with a probe: set two path keys, set ease (s, i), and sample `valueAtTime` vertex positions.

### 3.9 Multiple consecutive keys: speed continuity

- At a middle key k, the slope from the left is `speedIn(k)` and the slope to the right is `speedOut(k)`. **C1 ⇔ `speedIn(k) == speedOut(k)`.** Influences may differ.
- Speeds are absolute (units/s), so one speed serves both neighbors even when their `avg`s differ. Normalized y-handles differ per segment: `y2_left = 1 − s·i_in·Δt_L/Δv_L` and `y1_right = s·i_out·Δt_R/Δv_R`.
- A Remotion multi-segment `interpolate` with per-segment easings is generally only C0 at joints. Example: `[0,10,20]` with `Easing.out(quad)` has slope `2·avg_L` arriving and slope `2·avg_R` leaving. Emit non-continuous keys: `setTemporalContinuousAtKey(k,false)` with different in and out speeds.
- When speeds match (inOut mid keys, spring knots, Hermite bakes), set continuous = true so the Graph Editor keeps them tied.
- `setTemporalAutoBezierAtKey(k,false)` is needed whenever you set eases explicitly. Auto-bezier recomputes speeds.
- Hold: `setInterpolationTypeAtKey(k, inType, KeyframeInterpolationType.HOLD)` freezes the value from key k until key k+1. Mixed types (e.g. LINEAR in + BEZIER out) are allowed per side.

### 3.10 ExtendScript (ES3) emission pattern

```js
function aecApplyKeys(prop, keys) {   // keys: [{t, v, inType, outType, inEase:[{s,i}..], outEase:[{s,i}..], cont, ti, to}]
  var times = [], values = [], n = keys.length, j, d;
  for (j = 0; j < n; j++) { times.push(keys[j].t); values.push(keys[j].v); }
  prop.setValuesAtTimes(times, values);                       // batch add
  for (j = 0; j < n; j++) {
    var K = keys[j], k = prop.nearestKeyIndex(K.t);
    prop.setInterpolationTypeAtKey(k, K.inType, K.outType);   // set type BEFORE ease
    if (K.inType !== KeyframeInterpolationType.HOLD || K.outType !== KeyframeInterpolationType.HOLD) {
      var ein = [], eout = [];
      for (d = 0; d < K.inEase.length; d++) {                  // length: 2 TwoD, 3 ThreeD, else 1
        ein.push(new KeyframeEase(K.inEase[d].s, Math.max(0.1, Math.min(100, K.inEase[d].i))));
        eout.push(new KeyframeEase(K.outEase[d].s, Math.max(0.1, Math.min(100, K.outEase[d].i))));
      }
      prop.setTemporalEaseAtKey(k, ein, eout);
    }
    prop.setTemporalAutoBezierAtKey(k, false);
    prop.setTemporalContinuousAtKey(k, !!K.cont);
    if (prop.propertyValueType === PropertyValueType.TwoD_SPATIAL ||
        prop.propertyValueType === PropertyValueType.ThreeD_SPATIAL) {
      prop.setSpatialAutoBezierAtKey(k, false);
      prop.setSpatialContinuousAtKey(k, false);
      prop.setSpatialTangentsAtKey(k, K.ti, K.to);            // [0,0] / [0,0,0] for straight moves
      if (j > 0 && j < n - 1) prop.setRovingAtKey(k, false);
    }
  }
}
```

Use the times `frame * comp.frameDuration`.

- **Sub-frame key times are allowed by scripting.** AE keeps off-frame keys, but they snap when a user drags them. Default to frame-snapped knots, and offer `exactTimes` (e.g. spring extrema at 10.88 f) as an option.
- **[verify in AE]:** whether `setTemporalEaseAtKey` on a LINEAR key silently converts it to BEZIER, and the exact read-back of eases on LINEAR keys (used for calibration in §5).

### 3.11 Lottie representation summary (keyframes)

```jsonc
// non-spatial (Opacity: 1-D; Scale: 3-D) — per-dimension arrays
{"a":1,"k":[{"t":0,"s":[0],"o":{"x":[0.333],"y":[0]},"i":{"x":[0.667],"y":[1]}},{"t":30,"s":[100]}]}
// spatial (Position) — scalar easing + value tangents
{"a":1,"k":[{"t":0,"s":[100,540,0],"o":{"x":0.333,"y":0},"i":{"x":0.667,"y":1},"to":[0,0,0],"ti":[0,0,0]},
            {"t":30,"s":[960,540,0]}]}
// hold
{"t":10,"s":[50],"h":1}
// split position
{"s":true,"x":{"a":1,"k":[...]},"y":{"a":1,"k":[...]}}
```

- `o` and `i` live on the *segment-start* keyframe: `o` is the start key's out ease and `i` is the *next* key's in ease.
- The old format repeated `e` (end value). The final keyframe carries only `t` and `s`.

---

## 4. Lottie/bodymovin data model (prior art)

### 4.1 Top level

```
{ v: version, fr: fps, ip, op (frames), w, h, nm, ddd, assets: [ {id, w, h, layers:[…]} | {id, w, h, u, p, e} (images) ],
  layers: [...], markers: [{tm, cm, dr}], fonts: {list:[{fName (PostScript), fFamily, fStyle, ascent}]}, chars: [...], slots }
```

### 4.2 Layers (`elements/layerElement.jsx`)

**`ty` codes:**

| code | layer type | code | layer type |
|---|---|---|---|
| 0 | precomp | 8 | image sequence |
| 1 | solid | 9 | video |
| 2 | image | 10 | placeholder still |
| 3 | null (adjustment layers are exported as 3 + `isAdjustment`) | 11 | guide |
| 4 | shape | 12 | adjustment |
| 5 | text | 13 | camera |
| 6 | audio | 14 | light |
| 7 | placeholder video | 15 | data |

**Common keys:**

- `nm`, `ind`, `parent`
- `ip` / `op` / `st`, in frames: `inPoint·fps`, `outPoint·fps`, `startTime·fps`
- `sr`: stretch/100
- `ks`: transform
- `ao`: auto-orient
- `bm`: blend mode. 0 normal, 1 multiply, 2 screen, 3 overlay, 4 darken, 5 lighten, 6 color dodge, 7 color burn, 8 hard light, 9 soft light, 10 difference, 11 exclusion, 12 hue, 13 saturation, 14 color, 15 luminosity, 16 add, 17 hard mix.
- `ddd`: 3D
- `hd`: hidden
- `cl` / `ln`: class and id from the layer name
- `ct`: collapse transformations
- `hasMask`, `masksProperties`
- `ef`: effects
- `sy`: layer styles
- `tt` / `td` / `tp`: track matte
- Precomp: `refId`, `w`, `h`, `tm`
- Solid: `sc`, `sw`, `sh`
- Shape layer: `shapes`
- Text layer: `t`

### 4.3 Transform `ks` (`utils/transformHelper.jsx`)

| Lottie | AE matchName |
|---|---|
| `a` | `ADBE Anchor Point` |
| `p` | `ADBE Position` (or `{s:true, x, y, z}` for `ADBE Position_0/_1/_2`) |
| `s` | `ADBE Scale` (%) |
| `r` | `ADBE Rotate Z` (2D layers) |
| `rx`, `ry`, `rz` | `ADBE Rotate X/Y/Z` |
| `or` | `ADBE Orientation` (3D) |
| `o` | `ADBE Opacity` (0–100) |
| `sk`, `sa` | skew and skew axis (shape-group transforms only in AE) |

The parent group is `ADBE Transform Group`. bodymovin strips default values (o=100, r=0, p=a=0, s=100).

### 4.4 Animated property

- Static: `{a:0, k:value, ix, x?, sid?}`.
- Animated: `{a:1, k:[keyframes]}`.
- `x` is an expression string.
- `ix` is the AE `propertyIndex`.
- `sid` is a slot id.
- Colors are `[r,g,b(,a)]` in 0–1.
- Gradients use `g: {p: stopCount, k: {a, k: [o1,r1,g1,b1, …, (alphaOffset, alpha)…]}}`.

### 4.5 Shape items

The type codes come from `enums/shapeTypes.jsx` and `helpers/shapeTypeResolver.jsx`; the properties from `utils/shapeHelper.jsx`.

| Lottie `ty` | AE matchName | Lottie keys → AE property matchNames |
|---|---|---|
| `gr` | `ADBE Vector Group` | `it` (items, last = `tr`) → `ADBE Vectors Group`; `np`, `cix`; `bm` → `ADBE Vector Blend Mode` |
| `tr` | `ADBE Vector Transform Group` | `a` `ADBE Vector Anchor`, `p` `ADBE Vector Position`, `s` `ADBE Vector Scale`, `r` `ADBE Vector Rotation`, `o` `ADBE Vector Group Opacity`, `sk` `ADBE Vector Skew`, `sa` `ADBE Vector Skew Axis` |
| `sh` | `ADBE Vector Shape - Group` | `ks` `ADBE Vector Shape` (value `{i,o,v,c}`: in/out tangents relative to vertices, closed) |
| `rc` | `ADBE Vector Shape - Rect` | `s` `ADBE Vector Rect Size`, `p` `ADBE Vector Rect Position`, `r` `ADBE Vector Rect Roundness`, `d` `ADBE Vector Shape Direction` |
| `el` | `ADBE Vector Shape - Ellipse` | `s` `ADBE Vector Ellipse Size`, `p` `ADBE Vector Ellipse Position`, `d` |
| `sr` | `ADBE Vector Shape - Star` | `sy` `ADBE Vector Star Type` (1 star, 2 polygon), `pt` `…Star Points`, `p` `…Star Position`, `r` `…Star Rotation`, `ir` `…Star Inner Radius`, `or` `…Star Outer Radius`, `is` `ADBE Vector Star Inner Roundess`, `os` `ADBE Vector Star Outer Roundess` (AE's matchName really is misspelled "Roundess") |
| `fl` | `ADBE Vector Graphic - Fill` | `c` `ADBE Vector Fill Color`, `o` `ADBE Vector Fill Opacity`, `r` `ADBE Vector Fill Rule` (1 non-zero, 2 even-odd), `bm`; AE's `ADBE Vector Composite Order` is dropped |
| `st` | `ADBE Vector Graphic - Stroke` | `c` `…Stroke Color`, `o` `…Stroke Opacity`, `w` `…Stroke Width`, `lc` `…Line Cap` (1 butt, 2 round, 3 square), `lj` `…Line Join` (1 miter, 2 round, 3 bevel), `ml` `…Miter Limit`, `d` dashes `[{n:'d'/'g'/'o', v}]` ← `ADBE Vector Stroke Dashes` → `ADBE Vector Stroke Dash 1`, `…Gap 1`, …, `ADBE Vector Stroke Offset` |
| `gf` | `ADBE Vector Graphic - G-Fill` | `t` `ADBE Vector Grad Type` (1 linear, 2 radial), `s` `…Grad Start Pt`, `e` `…Grad End Pt`, `h` `…Grad HiLite Length`, `a` `…Grad HiLite Angle`, `g` `ADBE Vector Grad Colors`, `o`, `r` |
| `gs` | `ADBE Vector Graphic - G-Stroke` | gradient keys plus stroke keys |
| `tm` | `ADBE Vector Filter - Trim` | `s` `ADBE Vector Trim Start`, `e` `…Trim End`, `o` `…Trim Offset`, `m` `ADBE Vector Trim Type` (1 simultaneous, 2 individual) |
| `rp` | `ADBE Vector Filter - Repeater` | `c` `…Repeater Copies`, `o` `…Repeater Offset`, `m` `…Repeater Order`, `tr` ← `ADBE Vector Repeater Transform` {`a` `…Repeater Anchor`, `p` `…Repeater Position`, `s` `…Repeater Scale`, `r` `…Repeater Rotation`, `so` `ADBE Vector Repeater Opacity 1`, `eo` `…Opacity 2`} |
| `rd` | `ADBE Vector Filter - RC` | `r` `ADBE Vector RoundCorner Radius` |
| `mm` | `ADBE Vector Filter - Merge` | `mm` `ADBE Vector Merge Type` (1 merge, 2 add, 3 subtract, 4 intersect, 5 exclude) |
| `op` | `ADBE Vector Filter - Offset` | `a` `…Offset Amount`, `lj` `…Offset Line Join`, `ml` `…Offset Miter Limit`; AE `…Offset Copies` and `…Copy Offset` are lost |
| `pb` | `ADBE Vector Filter - PB` | `a` `ADBE Vector PuckerBloat Amount` |
| `tw` | `ADBE Vector Filter - Twist` | `a` `ADBE Vector Twist Angle`, `c` `…Twist Center` |
| `zz` | `ADBE Vector Filter - Zigzag` | `s` `…Zigzag Size`, `r` `…Zigzag Detail`, `pt` `…Zigzag Points` (1 corner, 2 smooth) |
| none | `ADBE Vector Filter - Roughen` (Wiggle Paths), `ADBE Vector Filter - Wiggler` (Wiggle Transform), `ADBE Vector Stroke Taper` / `…Wave` | not exported |

- Every item also carries `nm`, `mn` (the AE matchName), `ix`, `hd` and `ln`/`cl`.
- The shape layer root is `ADBE Root Vectors Group`, and the layer matchName is `ADBE Vector Layer`.
- Item order matters as in AE: items are listed top to bottom, and modifiers apply to the paths above them in the group.

### 4.6 Text (`utils/textHelper.jsx`, `utils/textAnimatorHelper.jsx`)

Layer `t = { d: {k:[{t: frame, s: TextDocument}]}, p: pathOptions, m: moreOptions, a: [animators] }`.

**TextDocument `s`** (from AE `TextDocument`):

| key | meaning |
|---|---|
| `t` | text (`\r` line breaks); with `ca:1` it is all caps |
| `s` | fontSize |
| `f` | font (PostScript name → `fonts.list[].fName`) |
| `fc`, `sc` | fill and stroke color 0–1 |
| `sw` | strokeWidth |
| `of` | strokeOverFill |
| `j` | justification: 0 left, 1 right, 2 center, 3–6 justify variants |
| `tr` | tracking (1/1000 em) |
| `lh` | leading in px (default 1.2·size) |
| `ls` | baselineShift |
| `ca` | caps: 0, 1 all, 2 small |
| `sz`, `ps` | box text size and position (paragraph text) |

**Path options and more options:**

- Path options `p`: `m` mask index, `f` first margin, `l` last margin, `a` force alignment, `p` perpendicular, `r` reverse. AE: `ADBE Text Path Options` with `ADBE Text First Margin`, `ADBE Text Last Margin`, `ADBE Text Force Align Path`, `ADBE Text Perpendicular To Path` and `ADBE Text Reverse Path`.
- More options `m`: `g` anchor-point grouping, `a` grouping alignment (`ADBE Text Anchor Point Align`).

**Animators.** `a[]` items are `{nm, s: selector, a: properties}` ← `ADBE Text Animators` / `ADBE Text Animator`, which contains `ADBE Text Selectors` and `ADBE Text Animator Properties`.

Animator property keys:

| Lottie | AE matchName | Lottie | AE matchName |
|---|---|---|---|
| `a` | `ADBE Text Anchor Point 3D` | `p` | `ADBE Text Position 3D` |
| `s` | `ADBE Text Scale 3D` | `r` | `ADBE Text Rotation` |
| `rx` | `…Rotation X` | `ry` | `…Rotation Y` |
| `o` | `ADBE Text Opacity` | `fo` | `…Fill Opacity` |
| `so` | `…Stroke Opacity` | `fc` | `…Fill Color` |
| `fh` / `fs` / `fb` | `…Fill Hue/Saturation/Brightness` | `sc` | `…Stroke Color` |
| `sh` / `ss` / `sb` | `…Stroke Hue/Saturation/Brightness` | `sw` | `…Stroke Width` |
| `t` | `ADBE Text Tracking Amount` | `sk` | `ADBE Text Skew` |
| `sa` | `…Skew Axis` | `bl` | `ADBE Text Blur` |
| `ls` | `ADBE Text Line Spacing` | | |

Lost: `ADBE Text Character Offset`, `…Character Replace`, `…Line Anchor`, `…Track Type`.

**Selector `s`:**

- **Range selector** (`ADBE Text Selector`, `t:0`):
  - `s`/`e`/`o` ← `ADBE Text Percent Start/End/Offset`, or `ADBE Text Index Start/End/Offset` when `r = 2`.
  - Under `ADBE Text Range Advanced`:

    | Lottie | AE matchName | values |
    |---|---|---|
    | `r` | `ADBE Text Range Units` | 1 %, 2 index |
    | `b` | `ADBE Text Range Type2` (Based On) | 1 chars, 2 chars excl. spaces, 3 words, 4 lines |
    | `sh` | `ADBE Text Range Shape` | 1 square, 2 ramp up, 3 ramp down, 4 triangle, 5 round, 6 smooth |
    | `xe` / `ne` | `ADBE Text Levels Max/Min Ease` | |
    | `a` | `ADBE Text Selector Max Amount` | |
    | `sm` | `ADBE Text Selector Smoothness` | |
    | `rn` | `ADBE Text Randomize Order` | |
    | `m` | `ADBE Text Selector Mode` | |

- **Expression selector** (`ADBE Text Expressible Selector`, `t:1`): `b`, plus `x` on `ADBE Text Expressible Amount`.
- **`ADBE Text Wiggly Selector`** is not exported.
- Only the **first** selector is exported unless "include not supported" is on. With no selectors, a full-range default is synthesized.

### 4.7 Masks, mattes, precomps, effects, expressions

- **Masks:** `masksProperties: [{mode, inv, pt, o, x, f?, nm}]`.
  - `mode`: `n` none, `a` add, `s` subtract, `i` intersect, `l` lighten, `d` darken, `f` difference (from `MaskMode`).
  - AE: `ADBE Mask Parade` contains `ADBE Mask Atom`, which has `ADBE Mask Shape` (pt), `ADBE Mask Opacity` (o), `ADBE Mask Offset` (x, expansion) and `ADBE Mask Feather` (f, only with "include not supported"). `inv` is `maskElement.inverted`.
- **Track mattes:**
  - `tt` on the matted layer: 1 alpha, 2 alpha inverted, 3 luma, 4 luma inverted.
  - `td:1` on the matte layer.
  - `tp` = index of the matte layer. AE 2023+ `layer.trackMatteLayer` allows any layer; older versions use the layer above, `index − 1`.
- **Precomps:**
  - Layer `ty:0`, `refId` → `assets[i].layers`, `w`/`h`.
  - `tm` (`ADBE Time Remapping`, seconds) and `sr` / `st` carry time.
  - `compId` and `frameRate`, `preserveNestedFrameRate` are kept as extra data.
- **Effects:** `ef: [{ty, nm, mn: matchName, ix, en, np, ef: [params]}]`. AE container `ADBE Effect Parade`.
  - Parameter `ty`: 0 slider, 1 angle, 2 color, 3 point, 4 checkbox, 5 group, 6 no-value, 7 dropdown, 9 custom, 10 layer, 11 mask.
  - Effect `ty` for known effects:

    | ty | effect (matchName) | ty | effect (matchName) |
    |---|---|---|---|
    | 20 | Tint (`ADBE Tint`) | 28 | Set Matte (`ADBE Set Matte3`) |
    | 21 | Fill (`ADBE Fill`) | 29 | Gaussian Blur (`ADBE Gaussian Blur 2`) |
    | 22 | Stroke (`ADBE Stroke`) | 30 | Twirl (`ADBE Twirl`) |
    | 23 | Tritone (`ADBE Tritone`) | 31 | Mesh Warp (`ADBE MESH WARP`) |
    | 24 | Levels (`ADBE Pro Levels2`) | 32 | Ripple (`ADBE Ripple`) |
    | 25 | Drop Shadow (`ADBE Drop Shadow`) | 33 | Spherize (`ADBE Spherize`) |
    | 26 | Radial Wipe (`ADBE Radial Wipe`) | 34 | Puppet (`ADBE FreePin3`) |
    | 27 | Displacement Map (`ADBE Displacement Map`) | 35 | Transform (`ADBE Geometry2`) |

  - Expression controls (`ADBE Slider Control`, `ADBE Point Control`, `ADBE Color Control`, `ADBE Checkbox Control`, `ADBE Angle Control`, `ADBE Layer Control`, `ADBE Dropdown Control`, `ADBE Point3D Control`) are exported generically, with parameter matchNames like `ADBE Slider Control-0001`, so expressions can read them.
- **Expressions:** `x: "<source>"` on any property.
  - bodymovin parses AE expressions with esprima and rewrites operators to `$bm_sum`/`$bm_sub`/`$bm_mul`/`$bm_div`/`$bm_mod` to emulate AE vector math. The importer reverses this to `add`/`sub`/….
  - Properties with `lottie:bake` in the expression, or with the global setting, are **baked** per frame via `valueAtTime`.

### 4.8 Quick map: Lottie ↔ AE

| Lottie | AE matchName | Lottie | AE matchName |
|---|---|---|---|
| layer `ty:4` | `ADBE Vector Layer` | `gr` | `ADBE Vector Group` |
| `shapes` | `ADBE Root Vectors Group` | `sh` | `ADBE Vector Shape - Group` |
| `rc` | `ADBE Vector Shape - Rect` | `el` | `ADBE Vector Shape - Ellipse` |
| `sr` | `ADBE Vector Shape - Star` | `fl` | `ADBE Vector Graphic - Fill` |
| `st` | `ADBE Vector Graphic - Stroke` | `gf` / `gs` | `ADBE Vector Graphic - G-Fill` / `G-Stroke` |
| `tm` | `ADBE Vector Filter - Trim` | `rp` | `ADBE Vector Filter - Repeater` |
| `rd` | `ADBE Vector Filter - RC` | `mm` | `ADBE Vector Filter - Merge` |
| `op` | `ADBE Vector Filter - Offset` | `pb` | `ADBE Vector Filter - PB` |
| `tw` | `ADBE Vector Filter - Twist` | `zz` | `ADBE Vector Filter - Zigzag` |
| `tr` | `ADBE Vector Transform Group` | layer `ks` | `ADBE Transform Group` |
| layer `ty:5` | `ADBE Text Layer` | `t.d` | `ADBE Text Properties` → `ADBE Text Document` |
| `t.a[]` | `ADBE Text Animator` | `t.a[].s` | `ADBE Text Selector` / `…Expressible Selector` |
| `t.a[].a` | `ADBE Text Animator Properties` | `t.p` | `ADBE Text Path Options` |
| `t.m` | `ADBE Text More Options` | `masksProperties[]` | `ADBE Mask Atom` (in `ADBE Mask Parade`) |
| `ef[]` | `ADBE Effect Parade` children | `tm` | `ADBE Time Remapping` |
| markers | `ADBE Marker` | | |

### 4.9 Where Lottie loses information we must keep (native AE output)

1. **Absolute ease.** Normalized `i`/`o` cannot express non-zero speeds between equal values (bulges, bounce middles). Spatial handles are clamped to `y ≤ 1`. Values are rounded to 3 decimals.
2. **Key flags.**
   - Lost: temporal and spatial *continuous* and *auto-bezier*, roving, per-side interpolation type (LINEAR vs BEZIER), keyframe labels (colors), and the separate in-type on the final key.
   - LINEAR becomes a bezier with `x=y`, so the round trip shows Bezier keys.
3. **Color ease** is a single 1-element ease normalized by channel 0 (§3.6).
4. **Shapes.**
   - Lost: Composite order, Wiggle Paths and Wiggle Transform, stroke Taper and Wave, Offset Paths copies, Repeater blend details, Material options and extrusion.
   - Gradient `Colors` cannot be set or read through scripting. bodymovin parses the project XML, and the importer can only `addKey`. **ae-compose needs a workaround [verify in AE]:**
     - `.ffx` animation preset injection, or
     - `ADBE Ramp` (Gradient Ramp) on a solid with a matte, or
     - 4-Color Gradient.
5. **Text.**
   - Lost: per-character style runs and paragraph styles, Wiggly selectors, multiple selectors, Character Offset/Value, Line Anchor, 3D-per-character, and font embedding. Only the PostScript name and family are kept.
6. **Layers and comps.**
   - Lost: motion blur and shutter, frame blending, quality, labels, comments, guides, work area, Essential Graphics (partly kept as slots), cameras (partial), lights (none), adjustment layers become nulls, layer styles (partial), solid source items, and footage interpretation.
7. **Effects.** Only a handful render, and everything else is opaque `ef` data, though `mn` matchNames are preserved.
8. **Expressions.** AE semantics (`valueAtTime`, `posterizeTime`, `sampleImage`, …) are mostly unavailable at runtime. Baking discards rigs.

---

## 5. Recommendations for the DSL and compiler

1. **Keep Remotion's surface and numerics.** Keep `Composition`, `Sequence` (`from`, `durationInFrames`, `layout`, `name`), `Series` (`offset`), `AbsoluteFill`, `useCurrentFrame`, `useVideoConfig`, `interpolate`, `interpolateColors`, `spring`, `measureSpring` and the full `Easing` module.
   - Pin to `remotion@4.0.x`, and use the package itself, or a port golden-tested against it to ≤ 1e-9, as the **reference evaluator**.
   - Document the two gotchas Claude must know:
     - The default `extend` extrapolation.
     - `Easing.ease` is CSS ease-in, and `Easing.bounce` is already the "out" shape.
2. **Two-tier animation semantics:**
   - **Tier 1 (exact, preferred):** declarative descriptors the compiler maps analytically, e.g.

     ```tsx
     <Rect x={tween([0, 30], [0, 500], Easing.bezier(.2,.8,.2,1))}
           scale={spring({ delay: 10, damping: 12, rig: 'expression' })} />
     ```

     These produce clean, designer-editable keys: 2 per bezier segment, 3 for inOut, 5 for bounce, extrema-seeded for springs.
   - **Tier 2 (compatible):** arbitrary `useCurrentFrame()` math. Evaluate the component at each frame with a custom React reconciler (no DOM) and record each layer property's value per frame.
     - **Call-log provenance:** if a property's per-frame value is `===` the return value of one logged `interpolate`/`spring` call whose arguments are constant (input = `frame − c`), use the Tier-1 mapping.
     - Otherwise bake with §2.3.
3. **Baking defaults** (tolerances in AE units, checked at integer frames + midpoints, and at shutter sub-samples when motion blur is on):

   | property | tolerance |
   |---|---|
   | position / size (px) | 0.1 |
   | rotation | 0.05° |
   | opacity | 0.1 |
   | scale | 0.05% |
   | color | 0.5/255 |
   | trim | 0.05% |

   - Frame-snapped knots by default; `exactTimes` opt-in.
   - Fixed endpoint speeds from analytic derivatives, so keys are C1-continuous.
   - Fitted influences clamped to [0.1, 100].
   - Per-frame LINEAR fallback for non-smooth signals.
4. **Unit conversion before ease math.** Opacity ×100 and scale ×100. Speeds scale with the same factor (they are units/s). Times come from `frame·comp.frameDuration`.
5. **Position strategy:**
   - Combined spatial Position with zero tangents only when x and y share key times and normalized easing and no segment overshoots.
   - Otherwise `dimensionsSeparated = true` (exact per-axis, any overshoot).
   - Curved motion paths come only from explicit DSL path APIs: set spatial tangents and compute speed from arc length (Gauss–Legendre).
   - Never emit roving keys. Always set spatial tangents and auto-bezier explicitly.
6. **Extrapolation.** Compute each property's visible window from the Sequence and layer in/out points.
   - `extend` and `identity` get boundary keys.
   - `wrap` gets `loopOut("cycle")`, or baked repeats with `noExpressions`.
   - `clamp` gets nothing.
7. **Springs.**
   - **Default:** bake. Seed knots at the analytic extrema `delay + nπ/ω1` (time-scaled by `D/natural`) with speed 0, refine adaptively, and end with a key at `to` once the residual is below tol (or at `delay + D`).
   - **`rig: 'expression'`:** emit the verified ES3 closed-form `aecSpring` expression (§1.8) plus slider controls. Offer `rig: 'both'`: baked keys and a disabled expression.
   - Reproduce the quirks: over-damping is ignored (critical formula), the 64 ms cap below 15.6 fps, and overshoot clamping keeps dips.
8. **Calibration and verification probes** (run once per AE version through the bridge; results cached in `docs/research/ae-verify/`):
   1. **1-D sanity:** set a key pair and ease, then compare `valueAtTime` at 100 samples with §3.1 (expect ≤ 1e-6).
   2. **COLOR:** make the segment LINEAR and read `keyOutTemporalEase(1)[0].speed`, which reveals AE's color avg-speed metric (max channel? Euclidean? 255-scale?). Then sample `valueAtTime` with a bezier ease to confirm whether all channels share one progress curve.
   3. **Spatial:** read the LINEAR speed (it should equal arc length / Δt). Try `speed·influence·Δt > L` to see whether AE clamps the influence as bodymovin assumes.
   4. **SHAPE:** check the speed units.
   5. **Equal-value bulge:** check that `v0 == v1` with non-zero speeds bulges (bounce exactness).
   6. **Sub-frame keys:** check that `setValueAtTime` at non-frame times is preserved.
   7. **Easing on LINEAR keys:** check whether `setTemporalEaseAtKey` on a LINEAR key converts it to BEZIER.
9. **Round-trip check in CI.** For every compiled property, read back `valueAtTime(f·frameDuration, false)` for all frames and diff against the Remotion reference. Fail if the error exceeds tol. This is the single source of truth for the ease math.
10. **Lottie.** Use it only as prior art and as an optional quick browser preview or export target. Never use it as the internal model: it drops absolute speeds, key flags, gradients, text runs and rigs (§4.9). Our internal IR should store, per key:

    ```
    {t, v, inType, outType, inEase[], outEase[], temporalContinuous, spatial:{ti,to,continuous,autoBezier}, label}
    ```

    plus property matchName paths. That is a superset of Lottie that serializes losslessly to ExtendScript.
