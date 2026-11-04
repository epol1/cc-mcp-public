---
name: ae-compose
description: Make and edit motion graphics in Adobe After Effects with ae-compose. Claude writes Remotion-style TSX that compiles into native, editable AE 2026 comps (real layers, eased keyframes, text animators, shape layers, effects, live expression controls with Essential Graphics, 3D cameras/lights/extrusion/models, particles), then reviews the returned contact sheets and refines. Use when the user wants an animation, motion graphic, title or kinetic typography, lower third, logo reveal, social/ad spot, end card, product hero, 3D or particle shot made in After Effects; when they want to inspect, retime, ripple-edit, re-ease, restyle, chroma-key or add effects to an existing AE comp (generated or hand-built); or when they mention ae-compose, .aep comps, keyframes, easing curves, expression controls or the ae-compose MCP tools (build_scene, apply_edits, inspect_comp, contact_sheet).
---

# ae-compose: motion design in After Effects, from TSX

You write a scene in a small TSX DSL, `build_scene` compiles it into **native, editable AE comps** (no plugins, no pre-renders), and every build or edit returns a **contact sheet** that you must look at. The full API (every component, prop, default and edit op) is in [`docs/DSL.md`](reference/DSL.md), so read the relevant section before using something unfamiliar. This file covers the workflow, recipes and design judgement.

## 1. The loop

1. **Pin the brief** in one line: canvas (1920×1080, 1080×1920, 1080×1080), duration, platform, brand colors/fonts, the one message. Ask only if something critical is missing. Otherwise pick sensible defaults and say what you picked.
2. **Write the TSX** and call `build_scene` (`source` or `file`). Give every layer you might edit an `id`. Expose key timings, colors and distances as `control()` (§4).
3. **Look at the contact sheet** before saying anything is done. Check:
   - spacing and alignment, overlaps, text overflow or clipping, safe areas;
   - blank or near-black frames (layer timing, opacity 0, `hidden`);
   - the first frames (is there a hook by 1 s?) and the final hold (is the end state complete and clean?);
   - timing: does each message stay on screen long enough to read (§5.6)?
   - the build report's **warnings and expression errors**.
4. **Fix and rebuild.** It replaces in place, and live control values are kept.
5. For **subjective choices** (color, pacing, type, spring feel), offer **2–3 variants** with `variants` + `compare: true` (one call builds A/B/C plus a side-by-side Compare comp), or with `create_variants`.
6. For **surgical changes** to an existing comp (yours or hand-built), use `apply_edits`: one batch is one undo step. **Run `inspect_comp` first on anything you didn't build.**
7. **Judge motion**, not just frames: `render_preview` (GIF/MP4) for easing and spring feel, `snapshot` for exact moments (overshoot peak, transition midpoint, last frame).
8. **Report**: the comp name, what the controls are called, and what you'd tweak next.

| Need | Tool |
|---|---|
| New scene or a rebuild | `build_scene` (`frames` default 8; use 6 for Advanced 3D, 12–16 for particles) |
| A/B/C options | `variants` in the scene + `compare: true`, or `create_variants` |
| Understand an existing comp | `inspect_project`, `inspect_comp` (`detail: "full"` for raw JSON) |
| Change an existing comp | `apply_edits` → `undo` if wrong |
| More time for a scene (reading time) | `apply_edits` `{ "op": "ripple", "scene": { "at": "1:02" }, "by": 1.5 }` |
| Find, look at and use project media | `list_project_items` (`kind: "video"`…) → `preview_item` → `apply_edits` `place` / `key` (chroma key) |
| Look again | `contact_sheet`, `snapshot`, `render_preview` |
| Effect params | `list_effects`, `describe_effect` |
| AE stuck | `list_dialogs` → `answer_dialog`; `doctor` |

## 2. A complete minimal scene

```tsx
import { scene, Composition, Solid, Text, Shape, Rect, Fill, Stack, spring, tween, perWord, control } from 'ae-compose';

export default scene({ name: 'Hello', width: 1920, height: 1080, fps: 30, duration: '4s' }, () => {
  const accent = control('Accent Color', '#4683c4');
  const delay = control('Title Delay', 0.2, { min: 0, max: 2 });
  return (
    <Composition>
      <Solid id="bg" name="BG" color="#0e1117" />
      <Stack gap={24}>
        <Text id="title" font="Inter-Black" size={150} color="#eef1f6"
          animate={{ text: perWord({ from: { y: 110, opacity: 0 }, spring: { damping: 13, stiffness: 170 }, each: '80ms', delay }) }}>
          HELLO WORLD
        </Text>
        <Shape id="bar" animate={{ scale: spring({ from: [0, 100], delay: 0.6, damping: 16 }) }}>
          <Rect size={[520, 10]} roundness={5} />
          <Fill color={accent} />
        </Shape>
        <Text id="sub" font="Inter-Medium" size={44} color="#8b95a5"
          animate={{ y: spring({ from: 30, delay: 0.8, damping: 16 }), opacity: tween({ from: 0, duration: '0.4s', delay: 0.8 }) }}>
          Native After Effects, written in code
        </Text>
      </Stack>
    </Composition>
  );
});
```

Key rules this shows:
- **Later JSX siblings render on top**, so the background comes first. Inside `<Shape>` the order flips to AE Contents order: the first child is frontmost, and `Fill`/`Stroke` paint the paths above them.
- **`from` alone on x/y/z/position is an offset from rest**, so `y: spring({ from: 30 })` rises 30 px into place. On scale/opacity/rotation it's an absolute start value that animates to the default (100/100/0).
- **Layout containers** (`Stack`, `Grid`, `Align`, `SafeArea`…) are solved inside AE with real text metrics, and animations are relative to the solved slot.
- Fonts are **PostScript names** (`Inter-Black`, `Inter-Medium`). Time is `0.4`, `"400ms"` or `"12f"`, and it's relative to the layer's start.
- `<ParticleWorld>`, `<OrbitCamera>`, `<ZStack>`, `<Grid3D>`, `<Circle3D>` and `<Parallax>` make several layers; use them as JSX like any other component.
- **Name your beats** with `<Sequence name="Beat 2">`. Named sequences become scene markers, so `apply_edits` can ripple them later. For text exits, use `anchor: 'end'` (the delay counts back from the layer's end), so exits follow when a beat gets longer.

## 3. Recipes

### 3.1 Kinetic title with exit

```tsx
import { scene, Composition, Solid, Text, Shape, Rect, Fill, Stack, spring, tween, perWord, perChar, textPresets, control } from 'ae-compose';

export default scene({ name: 'KineticTitle', duration: '5s' }, () => {
  const stagger = control('Word Stagger', 0.08, { min: 0, max: 0.3 });
  const accent = control('Accent Color', '#4683c4');
  const out = 4.1; // exits start here; everything is gone by ~4.6 s
  return (
    <Composition>
      <Solid id="bg" color="#0b0d12" />
      <Stack gap={28}>
        <Text id="title" font="Inter-Black" size={170} tracking={-20} color="#eef1f6"
          animate={{ text: [
            perWord({ from: { y: 140, opacity: 0 }, spring: { damping: 12, stiffness: 170 }, each: stagger, delay: 0.15 }),
            // anchor: 'end' counts the delay back from the layer's out point (5 s - 0.9 s = 4.1 s here)
            perChar({ from: { y: -40, opacity: 0, blur: 12 }, easing: 'easeInCubic', duration: '0.25s', each: '12ms', delay: 0.9, anchor: 'end', direction: 'out' }),
          ] }}>
          MAKE IT MOVE
        </Text>
        <Shape id="bar" animate={{ scale: spring({ from: [0, 100], delay: 0.7, damping: 15, stiffness: 140 }), opacity: tween({ to: 0, duration: '0.25s', delay: out, easing: 'easeInCubic' }) }}>
          <Rect size={[560, 10]} roundness={5} />
          <Fill color={accent} />
        </Shape>
        <Text id="sub" font="Inter-Medium" size={46} color="#9aa4b2"
          animate={{ text: textPresets.fadeUp('char', { each: '18ms', delay: 1.0 }), opacity: tween({ to: 0, duration: '0.3s', delay: out, easing: 'easeInCubic' }) }}>
          Native After Effects, written in code
        </Text>
      </Stack>
    </Composition>
  );
});
```

### 3.2 Lower third with live controls and EG text fields

```tsx
import { scene, Composition, Footage, Solid, Text, Shape, Rect, Fill, SafeArea, Align, Stack, spring, tween, perChar, perWord, control } from 'ae-compose';

export default scene({ name: 'LowerThird', duration: '6s', params: { person: 'Jordan Reyes', role: 'CREATIVE DIRECTOR' } }, (p) => {
  const accent = control('Accent Color', '#4683c4');
  const inDelay = control('In Delay', 0.4, { min: 0, max: 3 });
  const roleDelay = control('Role Delay', 0.75, { min: 0, max: 3 });
  const outDelay = control('Out Delay', 4.6, { min: 1, max: 5.6 });
  return (
    <Composition>
      <Footage id="plate" src="footage/interview.mp4" fit="cover" muted />
      <Solid id="shade" color="#000000" opacity={25} />
      <SafeArea kind="title">
        <Align at="bottomLeft">
          <Stack gap={14} align="start">
            <Shape id="bar" anchor="left" animate={{ scale: spring({ from: [0, 100], delay: inDelay, damping: 18, stiffness: 160 }), opacity: tween({ to: 0, duration: '0.25s', delay: outDelay, easing: 'easeInCubic' }) }}>
              <Rect size={[420, 8]} roundness={4} />
              <Fill color={accent} />
            </Shape>
            <Text id="person" eg="Name" font="Inter-Bold" size={68} align="left" anchor="left"
              animate={{ text: [
                perChar({ from: { y: 50, opacity: 0 }, spring: { damping: 14, stiffness: 190 }, each: '22ms', delay: inDelay }),
                perChar({ from: { y: -30, opacity: 0 }, easing: 'easeInCubic', duration: '0.3s', each: '10ms', delay: outDelay, direction: 'out' }),
              ] }}>
              {p.person}
            </Text>
            <Text id="role" eg="Role" font="Inter-Medium" size={34} color="#d7dde6" align="left" anchor="left" tracking={30}
              animate={{ text: [
                perWord({ from: { x: -30, opacity: 0 }, easing: 'easeOutQuint', duration: '0.6s', each: '60ms', delay: roleDelay }),
                perWord({ from: { opacity: 0 }, easing: 'easeInCubic', duration: '0.25s', each: '30ms', delay: outDelay, direction: 'out' }),
              ] }}>
              {p.role}
            </Text>
          </Stack>
        </Align>
      </SafeArea>
    </Composition>
  );
});
```

Dragging **Out Delay** in the Controls null retimes every exit live (retimable keys / Expression Selector). `eg` exposes the texts in Essential Graphics.

### 3.3 Logo reveal: draw-on with trim paths, gradient arc, glow

```tsx
import { scene, Composition, Solid, Shape, Ellipse, GradientFill, GradientStroke, Trim, Text, Svg, Effect, spring, tween, perWord, control } from 'ae-compose';

export default scene({ name: 'LogoReveal', duration: '5s' }, () => {
  const draw = control('Draw Duration', 1.4, { min: 0.3, max: 4 });
  const color = control('Logo Color', '#4683c4');
  return (
    <Composition>
      <Solid id="bg" color="#07090d" />
      <Shape id="backlight" opacity={85}>
        <Ellipse size={[1700, 1300]} />
        <GradientFill type="radial" start={[0, 0]} end={[850, 0]} stops={[{ offset: 0, color: '#142238' }, { offset: 1, color: '#07090d' }]} />
      </Shape>
      <Shape id="arc" y={500} opacity={60} animate={{ rotation: tween({ from: -40, to: 30, duration: '5s', easing: 'easeInOutSine' }) }}>
        <Ellipse size={[1180, 1180]} />
        <Trim end={tween({ from: 0, to: 42, duration: '1.8s', delay: 0.2, easing: 'easeInOutCubic' })} />
        <GradientStroke width={5} start={[-590, 0]} end={[590, 0]} stops={[{ offset: 0, color: '#4683c4', opacity: 0 }, { offset: 0.6, color: '#7fb3ff' }, { offset: 1, color: '#ffffff' }]} />
      </Shape>
      <Svg id="logo" src="brand/logo.svg" width={900} y={500} color={color} stroke={{ color, width: 3 }}
        draw={tween({ from: 0, to: 100, duration: draw, delay: 0.15, easing: 'easeInOutCubic' })}
        fillOpacity={tween({ from: 0, to: 100, duration: '0.6s', delay: 1.35 })}
        animate={{ scale: spring({ from: 94, delay: 1.3, damping: 13, stiffness: 140 }) }}
        effects={[<Effect name="Glow" params={{ 'Glow Threshold': 40, 'Glow Radius': 30, 'Glow Intensity': tween({ from: 0, to: 1.2, duration: '0.6s', delay: 1.35 }) }} />]} />
      <Text id="tagline" font="Inter-Medium" size={44} color="#9fb2c8" y={830} tracking={40}
        animate={{ text: perWord({ from: { y: 26, opacity: 0 }, each: '90ms', delay: 2.1, duration: '0.6s' }) }}>
        CUSTOM CONTROLLERS. MADE YOURS.
      </Text>
    </Composition>
  );
});
```

Gradients are applied through generated `.ffx` presets because gradient stops crash AE's scripting. Change stops in TSX and rebuild, and **never** touch them with `run_extendscript`.

### 3.4 3D product hero (Advanced 3D)

```tsx
import { scene, Composition, Solid, Text, Model, Light, Camera, tween, spring, perWord } from 'ae-compose';

export default scene({ name: 'ProductHero', duration: '6s', renderer: 'advanced3d' }, () => (
  <Composition>
    <Solid id="bg" color="#0c0e12" />
    <Solid id="floor" color="#1a1d23" width={4000} height={4000} threeD position={[960, 760, 0]} rotationX={90} material={{ acceptsShadows: true }} />
    <Model id="product" src="models/product.glb" position={[960, 600, 0]} scale={400} material={{ castsShadows: true }}
      animate={{ rotationY: tween({ from: -35, to: 20, duration: '6s', easing: 'easeInOutSine' }), y: spring({ from: -60, damping: 18, stiffness: 90 }) }} />
    <Light id="env" kind="environment" hdri="hdri/studio.hdr" intensity={70} backgroundVisible={false} />
    <Light id="key" kind="spot" intensity={110} position={[400, 100, -900]} lookAt="product" castsShadows shadowDarkness={55} shadowDiffusion={35} coneAngle={55} />
    <Light id="rim" kind="spot" intensity={160} color="#9cc4ff" position={[1600, 250, 1000]} lookAt="product" coneAngle={45} />
    <Camera id="cam" lens={50} dof focusOn="product" aperture={40}
      animate={{ z: tween({ from: -600, duration: '6s', easing: 'easeInOutSine' }), x: tween({ from: 80, duration: '6s', easing: 'easeInOutSine' }) }} />
    <Text id="claim" font="Inter-Black" size={110} y={180} color="#eef1f6"
      animate={{ text: perWord({ from: { y: 50, opacity: 0 }, easing: 'easeOutExpo', duration: '0.7s', each: '90ms', delay: 0.8 }) }}>
      BUILT TO PLAY
    </Text>
  </Composition>
));
```

The claim is a 2D layer composited over the 3D scene. That matters because Advanced 3D can't take effects on 3D text/shape/model layers and has no layer motion blur (use `<MotionBlur />` above them).

### 3.5 Particle burst on a hit marker

```tsx
import { scene, Composition, Solid, Text, ParticleWorld, spring, expr } from 'ae-compose';

const HIT = 1.4; // the beat everything syncs to (seconds)

export default scene({ name: 'ConfettiHit', duration: '4s', params: { seed: 1 }, variants: { A: { seed: 1 }, B: { seed: 2 } } }, (p) => (
  <Composition>
    <Solid id="bg" color="#10131a" />
    <Text id="word" font="Inter-Black" size={220} markers={[{ t: HIT, comment: 'hit' }]}
      animate={{ scale: spring({ from: 0, delay: HIT - 0.12, damping: 10, stiffness: 220 }) }}>
      YES!
    </Text>
    {ParticleWorld({ id: 'confetti', preset: 'confettiBurst', seed: p.seed, burst: { at: HIT, duration: 0.2, rate: 14 }, params: { 'Position Y': 0.05 } })}
    {ParticleWorld({ id: 'sparks', preset: 'sparks', controls: false, seed: p.seed + 7, blend: 'ADD',
      markers: [{ t: HIT, comment: 'burst' }, { t: 2.6, comment: 'burst' }],
      params: { 'Birth Rate': expr('var m = thisLayer.marker, r = 0;\nfor (var i = 1; i <= m.numKeys; i++) { var k = m.key(i).time; if (time >= k && time < k + 0.15) r = 6; }\nr;') } })}
  </Composition>
));
```

`burst` is time-based (hold keys), so drive it from the same constant as the marker. The second system reads its own layer markers, so a designer can drag or add markers in AE to retime the bursts. Check particles with `contact_sheet` at 12–16 frames and a `render_preview` GIF.

More recipes (end card, variants, edit workflows): [`recipes.md`](recipes.md).

## 4. Rules

1. **Expose key timings, colors and distances as `control()`**: delays, durations, stagger, accent color, slide distance, glow amount. Name them for a designer ("Title Delay", "Accent Color"). They become a Controls null plus Essential Graphics entries and stay live without a rebuild.
2. **Always self-review with contact sheets** before calling anything done. Use more frames for particles (12–16) and `render_preview` for motion feel. There is no automatic lint for overflow, safe areas or reading time yet: you are the lint.
3. **Always offer 2–3 variants for subjective choices** (`variants` + `compare: true`). Vary one or two params per variant, so the comparison teaches something.
4. **Vanilla AE only.** Never apply third-party effects (Red Giant, etc.) even if installed. Use `list_effects` to find vanilla equivalents.
5. **Never touch gradient internals via `run_extendscript`**: shape-gradient properties crash AE 26.5. Avoid `run_extendscript` in general, since `build_scene`/`apply_edits` cover almost everything.
6. **One undo step per build/edit.** Batch related edits into one `apply_edits` call. If a result is wrong, `undo` once, then fix.
7. **Inspect before editing** anything you didn't build (`inspect_comp`). Target layers by `id` (the TSX `id`), not by index.
8. **Sticky controls:** rebuilds keep the designer's control values. If you change a control's *default* in code and need it applied, rename the control or `setEffect` it on the `Controls` layer (`"params": {"#1": value}`).

## 5. Motion-design principles (concrete)

### 5.1 Easing
- **Entrances: `easeOutExpo` / `easeOutQuint`** (fast start, long settle). Use `easeOutCubic` for subtler UI-like moves.
- **Exits: `easeInCubic`** (or `easeInQuart`), about 60–75 % of the entrance duration. Things leave faster than they arrive.
- **Moves between two rests: `easeInOutCubic` / `easeInOutQuint`**, or `easeInOutSine` for slow drifts and camera moves.
- **Springs for playful or physical motion:** damping 10–13 is lively (one visible overshoot), 14–20 controlled, 26+ no visible bounce. Stiffness 120–220 for UI-sized moves, and lower (60–100) or higher `mass` for heavy objects.
- **Never leave `linear`** except for constant motion (rotating rings, scrolling tickers, Trim offset loops).

### 5.2 Anticipation and overshoot
- **Overshoot sells arrival**: `easeOutBack`, a spring, or `seq(tween({ from: 0, to: 108, duration: '0.25s' }), tween({ to: 100, duration: '0.2s', easing: 'easeInOutSine' }))` on scale.
- **Anticipation sells departure**: `easeInBack` / `anticipate` on exits, or a small counter-move (5–10 % of the distance) before a big move.
- Keep overshoot small on text (≤ 5–8 % of size). Overshoot on everything at once reads as wobbly.

### 5.3 Stagger
- **Characters / words: 40–90 ms** (35 ms for long lines, ≥ 60 ms for short punchy words). **Lines / list items: 120–200 ms.**
- The total stagger should stay under ~0.8 s for a line. Longer feels sluggish, so shorten `each` for long text.
- Order: `start` for reading order, `center` for symmetric lockups, `random` (with a seed) for sparkle and scramble.

### 5.4 Durations
Small UI and accent moves take 200–400 ms. Text unit reveals take 400–700 ms each. Big moves and transitions take 600–1000 ms. Camera drifts span the whole shot (3–8 s, `easeInOutSine`).

### 5.5 Hierarchy and pacing
- **One focal point at a time.** Lead with the biggest element, bring secondary elements in 150–300 ms later, and bring supporting details last.
- Group related elements with shared timing. Separate beats with ~0.2–0.4 s of overlap, not gaps of dead air.
- Motion amount follows importance: the headline gets the big move, the legal line just fades.
- **Hold the end state** (logo/CTA) still for ≥ 1.5–2 s.

### 5.6 Marketing timing
- **Hook in the first 1–2 s** (frame 0 shouldn't be empty for social). Product or brand by 3 s.
- **Reading time per message: ~0.3 s + 0.06 s per character, minimum 1.5 s for a headline.** "MAKE IT MOVE" (12 chars) needs ≥ 1.5 s fully readable, and a 60-char line needs ~3.9 s.
- 6 s bumper: hook 0–1.5 s, message 1.5–4.5 s, logo/CTA 4.5–6 s. 15 s: 3–4 beats. CTA ≥ 2 s.
- **Too short to read?** Don't squeeze the animation. Add hold time with a ripple edit (`{ "op": "ripple", "scene": "Beat 2", "by": 1 }`), which shifts everything after it.

### 5.7 Safe areas, contrast, type sizes
- Put text inside **title-safe** (`<SafeArea kind="title">`, 10 % inset) and key visuals inside action-safe (5 %).
- **Vertical 1080×1920 (Reels/TikTok/Shorts):** keep text out of the top ~250 px and bottom ~400 px (platform UI) and away from the right ~120 px (buttons). Use the centre 80 % of the width.
- **Contrast:** aim for ≥ 4.5:1 for small text and ≥ 3:1 for large headlines. Over footage, add a scrim (`<Solid color="#000" opacity={25}>`, or a gradient), use heavier weights, and avoid thin fonts on busy plates.
- **1920×1080 sizes:** hero headline 120–200 px, headline 90–140, subhead 48–72, body/supers 36–48, lower-third name 56–72 / title 30–40, fine print ≥ 26.
- **1080×1920 sizes:** headline 100–160 px (8–14 chars per line), subhead 52–64, captions 44–56. Square 1080: about 85 % of the 16:9 sizes.
- **Tracking:** tighten big display type (−10 to −30), and open up small caps/labels (+20 to +60).

## 6. 3D cinematography basics

- **Lens:** 24 mm or wider for drama and scale (perspective exaggeration), 35–50 mm for a natural look, 85 mm or longer for product and portrait compression (flatter, more premium). `lens` converts mm to AE zoom for the comp width.
- **Moves:** animate the camera with offset tweens:
  - push-in: `z: tween({ from: -500 })`;
  - truck: `x`;
  - pedestal: `y`;
  - orbit: `OrbitCamera({...})`.

  A two-node camera keeps aiming at its point of interest, so moving `x` arcs around the subject. For a flat truck, use `oneNode` or move the point of interest too. Camera moves should be slow, continuous and `easeInOutSine`, and each shot gets one move.
- **DOF:** `dof` + `focusOn="<id>"` keeps the subject sharp. **Aperture 20–60 is subtle and 80–200 cinematic**, so don't use real f-stops (AE's `fStop` gives extreme blur). For a rack focus, animate `focusDistance` between the subjects' distances from the camera.
- **Lighting:**
  - key: spot, 30–45° off axis and above, with shadows and shadow diffusion 20–40;
  - fill: about 30–50 % of the key, from the other side;
  - rim/back light: behind the subject toward the camera, often tinted, to separate it from the background;
  - for products: an **HDRI environment light** for reflections, plus a spot key for defined shadows;
  - add a floor that accepts shadows to ground the object.
- **Renderer:** Advanced 3D for extrusion, models, HDRI and PBR (auto-picked when you use them). Classic 3D when you need layer motion blur, effects on 3D layers or light transmission. The build stops with a clear message on hard conflicts and warns on soft ones (§13.8 of DSL.md). Advanced 3D frames are slow (~3.5 s each, plus ~100 s of warm-up on the first render), so use `frames: 6`.

## 7. Particle design tips

- **Start from a preset** (`dustBokeh`, `sparks`, `confettiBurst`, `energyTrail`, `magicSparkle`, `logoDisintegrate`, `snowfall`) and adjust in ±30–50 % steps. Presets expose Birth Rate/Velocity/Gravity or Size as live controls named `<Name> <Param>`.
- **Scale and density:** fewer, larger particles read as premium (bokeh, embers), and dense tiny ones read as texture (dust, snow). Keep the hero readable, and particles should never cover the message.
- **Depth layering:** use 2–3 layers. Far: small, slow, dim. Mid: the main effect. Near: few, large, soft or blurred. Each gets its own `id`, `seed` and `name` (names prefix the controls).
- **Color and transfer modes:** light-like particles (sparks, glow, bokeh) use `blend: 'ADD'`/`'SCREEN'` and warm-to-cool color shifts. Solid objects (confetti) stay `NORMAL`. Tie particle colors to the palette.
- **Motion links:** `emitter: { follow: '<null id>' }` for trails, `texture` for logo dissolves, and `burst` or markers for hits synced to animation beats. CC Particle World follows the comp camera automatically.
- **Seeds for variants:** pass `seed={p.seed}` and build variants with different seeds. Rebuilds are deterministic.
- **Judge over time:** particles start empty and evolve, so use `contact_sheet` with 12–16 frames across the duration plus a `render_preview` GIF. If frame 0 must already be full, pre-roll with `{"op": "layerTiming", "layer": "dust", "start": -2, "out": 6}` and check frame 0 with `snapshot`.

## 8. Editing existing comps (quick reference)

```json
{ "comp": "Promo_v001", "ops": [
  { "op": "ease", "layer": "title", "prop": "position", "easing": "easeOutQuint" },
  { "op": "retime", "layer": "subtitle", "shift": 0.2 },
  { "op": "addEffect", "layer": "logo", "effect": "Glow", "params": { "Glow Radius": 60 } },
  { "op": "text", "layer": "title", "text": "NEW HEADLINE" },
  { "op": "addControls", "layer": "title", "prop": "position", "delay": "Title Delay" },
  { "op": "ripple", "scene": { "at": "1:02" }, "by": 1.5 }
] }
```

```json
{ "comp": "Interview_v001", "ops": [
  { "op": "key", "layer": "talent" },
  { "op": "place", "item": "office_bg.jpg", "below": "talent", "fit": "cover" }
] }
```

Ops:
- `set` (value, keys or expr);
- `ease` (bezier names/arrays are exact; `bounce`/`elastic` re-bake the segments into more keys);
- `easeKey`, `interpolation`, `retime`, `layerTiming`;
- `addEffect`/`setEffect`/`removeEffect`/`moveEffect`;
- `text`, `path`;
- `layer` (parent, blend, matte, index…);
- `addLayer`/`removeLayer`/`duplicateLayer`;
- `comp`, `precompose`, `duplicateComp`;
- `ripple` (insert/remove/stretch time, or add a hold to a named scene, with everything after it shifting);
- `place` (project media or a file as a layer, `below`/`above` another layer);
- `key` (chroma key with Keylight and Advanced Spill Suppressor; the screen color is sampled automatically; add `cleanup: true` for Key Cleaner on hair or soft edges only);
- `addControls`, `raw`.

Props are friendly names (`position`, `scale`, `opacity`…) or AE paths (`"Effects/Glow/Glow Radius"`, `"Contents/Group 1/Contents/Fill 1/Color"`). Full vocabulary with examples: DSL.md §16. On hand-built comps, read the `inspect_comp` outline first: it names eases (`easeOutCubic≈`), shows overshoot, and lists changed effect params only.

## 9. Troubleshooting

- **A call times out or AE seems frozen:** `list_dialogs`, read the captured image (AE draws its own controls), then `answer_dialog` with the button label (or `Cancel`). `doctor` checks the bridge.
- **"… is hidden in the current renderer/state and was not set":** the property doesn't exist for that renderer or light kind (Geometry Options on Classic 3D, background options on non-environment lights). Change `renderer` or drop the prop. It's a warning; the build still succeeded.
- **Renderer errors** ("extruded/beveled … not supported by the Classic 3D renderer…. Set renderer: …"): follow the message. "Effects/masks/mattes/blend modes on 3D text, shape or model layers" under Advanced 3D: move the effect to an adjustment layer above, or precompose.
- **Fonts:** a warning `font "X" not available; AE used "Y"` means a wrong PostScript name. Inter is installed (`Inter-Regular`, `-Medium`, `-SemiBold`, `-Bold`, `-Black`). To list installed names (AE 24+ font API): `run_extendscript` with `var o=[],g=app.fonts.allFonts;for(var i=0;i<g.length;i++)for(var j=0;j<g[i].length;j++)o.push(g[i][j].postScriptName);o.join(", ")`.
- **Expression errors** are listed in the build report with the TSX line. Common causes: a referenced layer name isn't unique, or a `__AEC_CONTROL(Name)__` wasn't listed in `expr(code, [refs])`.
- **A control does nothing:** spring `stiffness`/`damping` controls need `rig: 'expression'`. Controls on layers inside `<Precomp>` don't resolve (keep controlled layers in the main comp).
- **The animation ends at the wrong value:** with `scale`/`opacity`, `from` alone animates to 100, not to your static value, so give `to`.
- **Blank or empty frames:** check layer `from`/`duration`, opacity keys, `hidden`, a matte source that's visible or hidden, and particles that haven't emitted yet.
- **`duplicate id`:** ids are scene-global. Particle components default to ids that collide when you use two, so give each one an `id`.
