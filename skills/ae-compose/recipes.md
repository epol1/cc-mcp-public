# ae-compose recipes

Extra patterns beyond the five in `SKILL.md`. Every block type-checks against the DSL. Asset paths are relative to the scene file, so swap in the real ones. Reference: [`docs/DSL.md`](reference/DSL.md).

## End card with CTA pulse

The logo settles, the URL follows, and the button pops with a looping pulse ring. The end state holds for 2 s or more.

```tsx
import { scene, Composition, Solid, Text, Shape, Rect, Fill, Stroke, Stack, Overlay, Svg, spring, tween, loop, popIn, perChar, control } from 'ae-compose';

export default scene({ name: 'EndCard', duration: '4.5s' }, () => {
  const accent = control('Accent Color', '#4683c4');
  return (
    <Composition>
      <Solid id="bg" color="#0b0d12" />
      <Stack gap={40}>
        <Svg id="logo" src="brand/logo.svg" width={620}
          animate={{ scale: spring({ from: 85, damping: 14, stiffness: 150 }), opacity: tween({ from: 0, duration: '0.35s' }) }} />
        <Text id="url" font="Inter-Medium" size={44} color="#9aa4b2" tracking={20}
          animate={{ text: perChar({ from: { opacity: 0, y: 12 }, each: '20ms', delay: 0.5, duration: '0.4s' }) }}>
          customcontrollerz.com
        </Text>
        <Overlay>
          <Shape id="ring" animate={{ scale: loop(tween({ from: 100, to: 135, duration: '1.4s', delay: 1.2, easing: 'easeOutCubic' })), opacity: loop(tween({ from: 70, to: 0, duration: '1.4s', delay: 1.2, easing: 'easeOutCubic' })) }}>
            <Rect size={[380, 96]} roundness={48} />
            <Stroke color={accent} width={3} />
          </Shape>
          <Shape id="button" animate={{ scale: popIn({ delay: 0.8, damping: 13 }) }}>
            <Rect size={[380, 96]} roundness={48} />
            <Fill color={accent} />
          </Shape>
          <Text id="cta" font="Inter-Bold" size={38} tracking={60} animate={{ opacity: tween({ from: 0, duration: '0.3s', delay: 1.0 }) }}>SHOP NOW</Text>
        </Overlay>
      </Stack>
    </Composition>
  );
});
```

## Vertical (1080×1920) hook

Custom safe insets keep text clear of platform UI (top ~250, right ~120, bottom ~400 px). Words pop with a 120 ms stagger, and the pitch wraps in box text.

```tsx
import { scene, Composition, Solid, Text, Stack, SafeArea, spring, textPresets } from 'ae-compose';

const WORDS = ['STOP', 'SCROLLING'];

export default scene({ name: 'VerticalHook', width: 1080, height: 1920, duration: '6s' }, () => (
  <Composition>
    <Solid id="bg" color="#ff5a1f" />
    <SafeArea kind={[250, 120, 400, 60]}>
      <Stack gap={8}>
        {WORDS.map((w, i) => (
          <Text id={`hook${i}`} font="Inter-Black" size={120} tracking={-20} color="#ffffff"
            animate={{ scale: spring({ from: 0, delay: i * 0.12, damping: 11, stiffness: 220 }) }}>{w}</Text>
        ))}
        <Text id="pitch" font="Inter-Bold" size={56} leading={68} color="#1a0b05" box={{ width: 840 }}
          animate={{ text: textPresets.fadeUp('word', { delay: 0.9, each: '60ms' }) }}>
          Native After Effects motion, written in minutes
        </Text>
      </Stack>
    </SafeArea>
  </Composition>
));
```

## Stat count-up

A Source Text expression counts the number, and a spring sells the landing. Measure the layout on the *final* text ("87%"), so nothing shifts while it counts.

```tsx
import { scene, Composition, Solid, Text, Stack, spring, tween } from 'ae-compose';

export default scene({ name: 'StatCallout', duration: '4s' }, () => (
  <Composition>
    <Solid id="bg" color="#0e1117" />
    <Stack gap={10}>
      <Text id="stat" font="Inter-Black" size={280} color="#eef1f6"
        expressions={{ 'ADBE Text Properties/ADBE Text Document': 'Math.round(ease(time, 0.3, 1.6, 0, 87)) + "%"' }}
        animate={{ scale: spring({ from: 70, damping: 14, stiffness: 150 }), opacity: tween({ from: 0, duration: '0.3s' }) }}>
        87%
      </Text>
      <Text id="label" font="Inter-Medium" size={48} color="#8b95a5" animate={{ y: spring({ from: 30, delay: 1.2, damping: 16 }), opacity: tween({ from: 0, duration: '0.4s', delay: 1.2 }) }}>
        of players customise their controller
      </Text>
    </Stack>
  </Composition>
));
```

## Feature list with computed stagger

Plain TypeScript builds the rows. List items stagger by 150 ms (the 120–200 ms range for items).

```tsx
import { scene, Composition, Solid, Text, Shape, Ellipse, Fill, Stack, Align, SafeArea, tween, popIn } from 'ae-compose';

const FEATURES = ['Real layers', 'Eased keyframes', 'Live controls', 'Native 3D'];
const STEP = 0.15;

export default scene({ name: 'FeatureList', duration: '5s' }, () => (
  <Composition>
    <Solid id="bg" color="#0b0d12" />
    <SafeArea kind="title">
      <Align at="left">
        <Stack gap={36} align="start">
          {FEATURES.map((f, i) => (
            <Stack id={`row${i}`} direction="row" gap={24}>
              <Shape id={`dot${i}`} animate={{ scale: popIn({ delay: 0.3 + i * STEP }) }}>
                <Ellipse size={[22, 22]} />
                <Fill color="#4683c4" />
              </Shape>
              <Text id={`feat${i}`} font="Inter-SemiBold" size={64} align="left" anchor="left"
                animate={{ x: tween({ from: -40, duration: '0.6s', delay: 0.3 + i * STEP, easing: 'easeOutExpo' }), opacity: tween({ from: 0, duration: '0.4s', delay: 0.3 + i * STEP }) }}>
                {f}
              </Text>
            </Stack>
          ))}
        </Stack>
      </Align>
    </SafeArea>
  </Composition>
));
```

## Matte wipe transition

A hidden shape grows from the left edge and reveals the footage through an alpha track matte.

```tsx
import { scene, Composition, Solid, Footage, Shape, Rect, Fill, tween } from 'ae-compose';

export default scene({ name: 'WipeReveal', duration: '3s' }, () => (
  <Composition>
    <Solid id="bg" color="#0b0d12" />
    <Shape id="wipe" hidden anchor="left" x={0}
      animate={{ scale: tween({ from: [0, 100], to: [100, 100], duration: '0.9s', delay: 0.3, easing: 'easeInOutQuint' }) }}>
      <Rect size={[1920, 1080]} />
      <Fill color="#ffffff" />
    </Shape>
    <Footage id="photo" src="footage/hero.mp4" fit="cover" muted matte={{ layer: 'wipe', type: 'alpha' }} />
    <Shape id="edge" anchor="left" x={0}
      animate={{ x: tween({ from: 0, to: 1920, duration: '0.9s', delay: 0.3, easing: 'easeInOutQuint' }) }}>
      <Rect size={[12, 1080]} />
      <Fill color="#4683c4" />
    </Shape>
  </Composition>
));
```

## Editing a hand-built comp

1. `inspect_project` finds the comp. `inspect_comp { "comp": "Title Card" }` reads the outline: layer names, timing, eases such as `easeOutCubic≈`, and effects.
2. Batch the changes into one `apply_edits` call, which is one undo step:

```json
{ "comp": "Title Card", "ops": [
  { "op": "ease", "layer": "Main Title", "prop": "position", "easing": "easeOutQuint" },
  { "op": "ease", "layer": "Main Title", "prop": "scale", "easing": "easeOutBack" },
  { "op": "retime", "layer": "Subtitle", "shift": 0.15 },
  { "op": "setEffect", "layer": "BG", "effect": "Gaussian Blur", "params": { "Blurriness": 12 } },
  { "op": "addEffect", "layer": "Main Title", "effect": "Drop Shadow", "params": { "Opacity": 40, "Distance": 8, "Softness": 20 } },
  { "op": "addControls", "layer": "Main Title", "prop": "position", "delay": "Title Delay", "speed": "Title Speed" }
] }
```

3. Look at the returned contact sheet. Then `snapshot` the moment you changed (for example the overshoot peak), or `render_preview` it to feel the new ease.
4. Wrong? `undo` once reverts the whole batch.

Names that appear more than once fail with the candidates listed, so use the 1-based index from the outline instead. Layer names with spaces are fine.
