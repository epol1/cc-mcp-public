// Showcase 19 — "Morrow 35": a launch teaser for a fictional film camera, built almost entirely from fetched assets
// (Phase 6): every source is an `asset:` ref, resolved at build time, copied next to the project and credited in
// CREDITS.md (here and next to the project).
//
// Story: phones made photos weightless; this camera makes them count.
//   Hook     (0–5.6 s)  — a crowd crossing (Pixabay video) under a scrim; a flood of photo icons (Lucide, drawn on as
//                         native shapes) fills the frame while "300 photos a day." lands, then "Not one you'll print."
//   Tear     (5.3–6.5)  — a sheet of real paper (ambientCG Paper 006) rips across the noise from the left: a jagged
//                         matte with Roughen Edges, a cream fibre fringe and a drop shadow (vanilla effects), with a
//                         paper-rip sound (Openverse, CC0). Noise becomes a calm, tactile page.
//   Product  (6.5–13.5) — the camera (Poly Haven Camera 01, glTF packed to .glb) turns slowly on the page, lit by a
//                         warm studio HDRI (Poly Haven); "36 frames." / "Make each one count." The model's lens is
//                         engraved with a real maker's name: it turns between −80° and −52°, where the engraving
//                         isn't legible, so the fictional product never shows a real trademark.
//   Features (13.5–19.6) — the camera slides left; three features draw on one by one (Lucide aperture, sun, film).
//   End      (19.6–25)  — the camera returns to centre above the wordmark: MORROW 35, "Slow photography, made new.",
//                         "March 2027". Holds 3.6 s.
// Type: Space Grotesk (Fontsource / google/fonts, installed per-user with the user's OK, D100).
import { scene, Composition, Solid, Shape, Path, Fill, Rect, GradientFill, Text, Footage, Svg, Audio, Model, Light, Camera, Precomp, Effect, Sequence, tween, spring, keys, perWord, control, asset } from 'ae-compose';

const W = 1920, H = 1080;
const INK = '#1e1a15', PAPER_HI = '#fbf5e9', WHITE = '#f4f1ea';
const BOLD = 'SpaceGrotesk-Bold', MEDIUM = 'SpaceGrotesk-Medium', REGULAR = 'SpaceGrotesk-Regular';
const DUR = 25;
const TEAR = 5.3; // the rip starts here; the sheet covers the frame by TEAR + 1.1

/** Seeded 0–1 random (mulberry32), so the torn edge is the same on every build. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * A sheet whose right edge is torn: everything left of a slightly slanted, jagged line. `grow` pushes the edge out
 * (the fibre fringe sits a little proud of the paper), `seed` varies the small tears.
 */
function tornSheet(seed: number, grow = 0) {
  const r = rng(seed);
  const pts: { p: [number, number] }[] = [{ p: [-2600, -80] }];
  for (let y = -80; y <= H + 80; y += 16 + r() * 18) {
    const slant = (y - H / 2) * 0.12;
    const tear = r() < 0.12 ? (r() - 0.5) * 70 : (r() - 0.5) * 22;
    pts.push({ p: [grow + slant + tear, y] });
  }
  pts.push({ p: [-2600, H + 80] });
  return pts;
}

/** Leaves 0.35 s before a beat of `dur` seconds ends (exits are faster than entrances). */
const exit = (dur: number) => tween({ to: 0, duration: '0.3s', delay: dur - 0.35, easing: 'easeInCubic' });

const PHOTO_ICONS = Array.from({ length: 16 }, (_, i) => ({ col: i % 8, row: Math.floor(i / 8) }));

const FEATURES = [
  { icon: 'asset:iconify:lucide:aperture', text: 'Manual aperture' },
  { icon: 'asset:iconify:lucide:sun', text: 'A light meter, no screen' },
  { icon: 'asset:iconify:lucide:film', text: '36 exposures a roll' },
];

export default scene({ name: 'LaunchTeaser', width: W, height: H, fps: 30, duration: DUR, bg: '#0b0c0e' }, () => {
  asset('fontsource:space-grotesk@full'); // the typeface (installed per-user, used by PostScript name): credited like the rest
  const sweep = control('Tear Duration', 1.1, { min: 0.5, max: 2.5 });
  const productIn = TEAR + 1.0;
  const f0 = 13.5 - productIn, e0 = 19.6 - productIn; // the Features and End beats, from the product layer's start
  return (
    <Composition>
      {/* Hook: the noise. */}
      <Sequence name="Hook" duration={TEAR + 1.3}>
        <Footage id="crowd" src="asset:pixabay:video:3630@1080p" fit="cover" muted tags={['bg']}
          animate={{ scale: tween({ from: 112, to: 104, duration: TEAR + 1.3, easing: 'easeOutSine' }) }} />
        <Solid id="scrim" color="#07080a" opacity={58} tags={['bg']} />
        {PHOTO_ICONS.map(({ col, row }, i) => (
          <Svg id={`flood.${i}`} tags={['group:flood']} src="asset:iconify:lucide:image" width={78} color={WHITE}
            x={960 + (col - 3.5) * 132} y={300 + row * 118} opacity={row === 0 ? 92 : 70}
            draw={tween({ from: 0, to: 100, duration: '0.45s', delay: 0.1 + ((col * 5 + row * 3) % 16) * 0.055, easing: 'easeOutCubic' })}
            animate={{ scale: spring({ from: 70, delay: 0.1 + ((col * 5 + row * 3) % 16) * 0.055, damping: 15, stiffness: 200 }) }} />
        ))}
        <Text id="hook.title" font={BOLD} size={128} tracking={-20} color={WHITE} y={650}
          animate={{ text: perWord({ from: { y: 60, opacity: 0 }, spring: { damping: 15, stiffness: 190 }, each: '90ms', delay: 1.3 }) }}>
          300 photos a day.
        </Text>
        <Text id="hook.sub" font={MEDIUM} size={54} color="#cfd2d6" y={770}
          animate={{ text: perWord({ from: { y: 24, opacity: 0 }, easing: 'easeOutQuint', duration: '0.5s', each: '70ms', delay: 2.7 }) }}>
          Not one you'll print.
        </Text>
      </Sequence>

      {/* The tear: a sheet of paper rips in over the noise and becomes the page for the rest of the piece. */}
      <Precomp id="tear" name="Torn Sheet" from={TEAR} tags={['transition:torn-paper']}
        effects={[<Effect name="Drop Shadow" params={{ 'Opacity': 55, 'Direction': 100, 'Distance': 16, 'Softness': 36 }} />]}>
        <Shape id="tear.fringe" name="Fibre Fringe" space="comp"
          effects={[<Effect name="Roughen Edges" params={{ 'Border': 9, 'Edge Sharpness': 1.2, 'Scale': 22, 'Complexity': 5 }} />]}
          animate={{ x: tween({ from: -40, to: W + 380, duration: sweep, easing: 'easeInOutCubic' }) }}>
          <Path points={tornSheet(19, 16)} closed />
          <Fill color={PAPER_HI} />
        </Shape>
        <Footage id="tear.paper" src="asset:ambientcg:Paper006@2k-jpg" fit="cover" matte={{ layer: 'tear.matte', type: 'alpha' }} />
        <Shape id="tear.matte" name="Tear Matte" space="comp" hidden
          effects={[<Effect name="Roughen Edges" params={{ 'Border': 6, 'Edge Sharpness': 2, 'Scale': 14, 'Complexity': 4 }} />]}
          animate={{ x: tween({ from: -40, to: W + 380, duration: sweep, easing: 'easeInOutCubic' }) }}>
          <Path points={tornSheet(7)} closed />
          <Fill color="#ffffff" />
        </Shape>
      </Precomp>
      <Audio id="rip" src="asset:openverse:audio:9f96d0d6-36b1-4f00-a931-a21c8ef39093" from={TEAR - 0.05} />
      {/* Soft light falloff on the page (multiply), once the sheet covers the frame: depth behind the product.
          (Inside the sheet's precomp, multiply over its still-transparent part would wash the crowd out.) */}
      <Shape id="page.light" name="Page Light" blend="MULTIPLY" from={TEAR + 1.0} tags={['bg']}
        animate={{ opacity: tween({ from: 0, to: 75, duration: '0.8s', easing: 'easeInOutSine' }) }}>
        <Rect size={[W, H]} />
        <GradientFill type="radial" start={[0, -80]} end={[1250, -80]} stops={[{ offset: 0, color: '#ffffff' }, { offset: 1, color: '#bba98c' }]} />
      </Shape>

      {/* The product: one 3D shot (Advanced 3D) composited on the page. */}
      <Precomp id="product" name="Camera Product" from={productIn} tags={['product']}
        animate={{
          // Absolute comp positions (keys are values, not offsets): right of the headline → left of the features →
          // centred above the wordmark.
          x: keys({ t: 0, v: 1320 }, { t: f0 - 0.2, v: 1320, easing: 'easeInOutCubic' }, { t: f0 + 0.8, v: 450, easing: 'easeInOutCubic' }, { t: e0 - 0.1, v: 450, easing: 'easeInOutCubic' }, { t: e0 + 0.9, v: 960 }),
          y: keys({ t: 0, v: 560 }, { t: e0 - 0.1, v: 560, easing: 'easeInOutCubic' }, { t: e0 + 0.9, v: 420 }),
          scale: keys({ t: 0, v: 56 }, { t: f0 - 0.2, v: 56, easing: 'easeInOutCubic' }, { t: f0 + 0.8, v: 52, easing: 'easeInOutCubic' }, { t: e0 - 0.1, v: 52, easing: 'easeInOutCubic' }, { t: e0 + 0.9, v: 54 }),
          opacity: tween({ from: 0, to: 100, duration: '0.5s', easing: 'easeOutCubic' }),
        }}>
        <Model id="camera" src="asset:polyhaven:Camera_01@2k-gltf" position={[960, 560, 0]} scale={1300}
          animate={{ rotationY: tween({ from: -80, to: -52, duration: DUR - productIn, easing: 'easeInOutSine' }), y: spring({ from: 70, damping: 18, stiffness: 90 }) }} />
        <Light id="studio" kind="environment" hdri="asset:polyhaven:brown_photostudio_02@2k-hdr" intensity={110} />
        <Light id="key" kind="spot" intensity={70} color="#fff1dc" position={[420, 120, -900]} lookAt="camera" coneAngle={60} />
        <Camera id="lens" lens={70} />
      </Precomp>

      <Sequence name="Product" from={productIn} duration={13.5 - productIn}>
        <Text id="p.title" font={BOLD} size={150} tracking={-25} color={INK} x={170} y={470} align="left" anchor="left"
          animate={{ text: perWord({ from: { y: 50, opacity: 0 }, easing: 'easeOutExpo', duration: '0.7s', each: '110ms', delay: 0.8 }),
            opacity: exit(13.5 - productIn) }}>
          36 frames.
        </Text>
        <Text id="p.sub" font={MEDIUM} size={56} color="#4a4237" x={176} y={590} align="left" anchor="left"
          animate={{ text: perWord({ from: { y: 22, opacity: 0 }, easing: 'easeOutQuint', duration: '0.55s', each: '70ms', delay: 2.0 }),
            opacity: exit(13.5 - productIn) }}>
          Make each one count.
        </Text>
      </Sequence>

      <Sequence name="Features" from={13.5} duration={6.1}>
        {FEATURES.map((f, i) => {
          const at = 0.9 + i * 0.75, y = 360 + i * 170;
          return [
            <Svg id={`feat.icon.${i}`} src={f.icon} width={96} color={INK} x={1010} y={y}
              draw={tween({ from: 0, to: 100, duration: '0.9s', delay: at, easing: 'easeInOutCubic' })}
              animate={{ opacity: exit(6.1) }} />,
            <Text id={`feat.text.${i}`} font={MEDIUM} size={60} color={INK} x={1100} y={y} align="left" anchor="left"
              animate={{ text: perWord({ from: { x: -24, opacity: 0 }, easing: 'easeOutQuint', duration: '0.6s', each: '60ms', delay: at + 0.35 }),
                opacity: exit(6.1) }}>
              {f.text}
            </Text>,
          ];
        })}
      </Sequence>

      <Sequence name="End" from={19.6}>
        <Text id="end.mark" font={BOLD} size={168} tracking={40} color={INK} y={770}
          animate={{ text: perWord({ from: { y: 60, opacity: 0 }, spring: { damping: 16, stiffness: 150 }, each: '140ms', delay: 0.7 }) }}>
          MORROW 35
        </Text>
        <Text id="end.line" font={REGULAR} size={52} color="#4a4237" y={880}
          animate={{ text: perWord({ from: { y: 20, opacity: 0 }, easing: 'easeOutQuint', duration: '0.6s', each: '70ms', delay: 1.5 }) }}>
          Slow photography, made new.
        </Text>
        <Text id="end.date" font={MEDIUM} size={32} tracking={260} color="#3a3127" y={960}
          animate={{ opacity: tween({ from: 0, to: 100, duration: '0.6s', delay: 2.2, easing: 'easeOutCubic' }) }}>
          MARCH 2027
        </Text>
      </Sequence>
    </Composition>
  );
});
