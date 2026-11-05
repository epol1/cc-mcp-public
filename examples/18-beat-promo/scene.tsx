// Showcase 18 — "Build yours": a music-synced promo for Custom Controllerz (the user's client; assets from their own
// projects), cut to a 105 BPM track with the beat-sync tools (A5) and the transitions library (K4). Every cut and
// accent comes from the track's beat grid (beatsOf): words land on beats, the build swaps a colorway on every beat,
// scenes are whole bars, and the beat/bar markers on the comp show the grid in AE (ripple edits snap to it).
//
// Beats:
//   Hook  (bars 0–3)  — "PICK / EVERY / PART." on the beats (PART. holds as the punchline), then "MAKE IT YOURS." for a bar.
//   Build (bars 3–6)  — the controller changes colorway on every beat (stop-motion customizing) in front of an
//                       accent disc that pulses on each downbeat, while the part being picked is named once per
//                       bar: SHELLS. BUTTONS. STICKS.
//                       In: a light leak flares over the hard cut on the bar-3 downbeat.
//   End   (bar 6 → 21.5 s) — the disc grows to fill the frame (shape wipe) and becomes the end card: the logo draws on,
//                       the line lands on the next downbeat, and it holds ~3.5 s with the music.
import { scene, Composition, Solid, Shape, Rect, Ellipse, Fill, GradientFill, Text, Footage, Svg, Audio, BeatMarkers, Beats, Beat, LightLeakCut, ShapeWipe, beatsOf, spring, tween, keys, perChar, perWord } from 'ae-compose';

const MUSIC = '../../assets/handmade/languages_proj/(Footage)/Diafano_AdobeStock_357626701_preview.m4a';
const INK = '#0b0d12', WHITE = '#f2f4f8', ACCENT = '#ff6a2b';
const STILLS = ['01', '02', '03', '04', '05', '06'].map((n) => `../../assets/footage/stills/${n}.png`);

/** A word that lands on a beat: pops from 86 % and holds until the next word replaces it (a hard cut). */
const word = (id: string, text: string, from: number, duration: number, color = WHITE, size = 250) => (
  <Text id={id} font="Inter-Black" size={size} tracking={-20} color={color} from={from} duration={duration}
    animate={{ scale: spring({ from: 86, damping: 13, stiffness: 260 }) }}>
    {text}
  </Text>
);

const DUR = 21.5;

export default scene({ name: 'BeatPromo', width: 1920, height: 1080, fps: 30, duration: DUR, bg: INK }, () => {
  const B = beatsOf(MUSIC);
  const beat = B.beats.length > 1 ? B.beats[1] - B.beats[0] : 0.57; // one beat, s
  const t0 = B.bar(0); // the first downbeat
  const wipe = beat * 1.5; // the disc starts growing 1.5 beats before the bar-6 downbeat; the End beat starts with it
  const land = wipe + B.bars(1); // the second downbeat of the end card: the logo is drawn, the line lands
  // Beat k of the Build scene, from its start (the bar-3 downbeat), on the track's own grid (not a fixed step).
  const b0 = B.bar(3), i0 = B.beats.findIndex((t) => Math.abs(t - b0) < 0.02);
  const at = (k: number) => B.beats[i0 + k] - b0;
  // The disc behind the controller: it pulses on every beat (harder on downbeats), then, at rest, grows into the end card.
  const disc = <Shape id="build.disc" name="Beat Disc" x={1230} y={560}
    animate={{ scale: keys(...Array.from({ length: 10 }, (_, k) => [{ t: Math.max(0, at(k) - 0.02), v: 100, easing: 'easeOutCubic' as const }, { t: at(k) + 0.06, v: k % 4 === 0 ? 108 : 103, easing: 'easeInOutSine' as const }, { t: at(k) + 0.4, v: 100 }]).flat()) }}>
    <Ellipse size={[600, 600]} />
    <Fill color={ACCENT} />
  </Shape>;
  return (
    <Composition>
      <Solid id="bg" name="BG" color={INK} tags={['bg']} />
      <Audio id="music" src={MUSIC} />
      <BeatMarkers beats={B} to={DUR} />
      <Beats>
        <Beat name="Hook" duration={B.bar(3)}>
          {word('w.pick', 'PICK', t0, B.beat(2) - t0)}
          {word('w.every', 'EVERY', B.beat(2), B.beat(4) - B.beat(2))}
          {word('w.part', 'PART.', B.beat(4), B.beat(8) - B.beat(4), ACCENT)}
          <Text id="w.yours" font="Inter-Black" size={170} tracking={-15} color={WHITE} from={B.beat(8)} leading={170}
            animate={{ text: perWord({ from: { y: 90, opacity: 0 }, spring: { damping: 14, stiffness: 220 }, each: beat / 4, delay: 0 }) }}>
            {'MAKE IT\rYOURS.'}
          </Text>
        </Beat>

        <LightLeakCut id="leak" name="Leak: into the build" color={ACCENT} intensity={70} duration={0.6} />

        <Beat name="Build" duration={B.bars(3)}>
          <Shape id="build.glow" name="Backlight" tags={['bg']}>
            <Rect size={[1920, 1080]} />
            <GradientFill type="radial" start={[260, 20]} end={[1100, 0]} stops={[{ offset: 0, color: '#2a2f3a' }, { offset: 0.7, color: '#12151c' }, { offset: 1, color: INK }]} />
          </Shape>
          {disc}
          {/* One colorway per beat: 12 beats, the six builds twice, hard cuts (stop motion: the disc gives the pulse). */}
          {Array.from({ length: 12 }, (_, k) => (
            <Footage id={`still${k}`} name={`Build ${k + 1}`} src={STILLS[k % 6]} fit="none" scale={205} x={1230} y={560} from={at(k)} duration={k === 11 ? B.bars(3) - at(k) : at(k + 1) - at(k)} tags={['persistent']} />
          ))}
          {['SHELLS.', 'BUTTONS.', 'STICKS.'].map((w, i) => (
            <Text id={`part${i}`} font="Inter-Black" size={140} tracking={-10} color={i === 1 ? ACCENT : WHITE} align="left" anchor="left" x={130} y={540}
              from={B.bars(i)} duration={i === 2 ? B.bars(3) - B.bars(2) - wipe : B.bars(1)}
              animate={{ text: [perChar({ from: { y: 60, opacity: 0 }, easing: 'easeOutExpo', duration: '0.45s', each: '22ms' }),
                ...(i === 2 ? [perChar({ from: { y: -40, opacity: 0 }, easing: 'easeInCubic', duration: '0.25s', each: '15ms', delay: 0, anchor: 'end' as const, direction: 'out' as const })] : [])] }}>
              {w}
            </Text>
          ))}
        </Beat>

        <ShapeWipe id="toEnd" name="Wipe: disc to end card" shape={disc} duration={wipe} easing="easeInOutQuart" />

        <Beat name="End" duration={DUR - (B.bar(6) - wipe)}>
          <Solid id="end.bg" name="End BG" color={ACCENT} tags={['bg']} />
          <Svg id="logo" src="../../assets/logo/cc-logo.svg" name="Logo" width={760} y={390}
            color={INK} stroke={{ color: INK, width: 3 }}
            draw={tween({ from: 0, to: 100, duration: B.bars(1) - 0.25, delay: wipe, easing: 'easeInOutCubic' })}
            fillOpacity={tween({ from: 0, to: 100, duration: '0.4s', delay: land - 0.25, easing: 'easeOutCubic' })}
            animate={{ scale: spring({ from: 94, delay: land, damping: 13, stiffness: 160 }) }} />
          <Text id="end.line" font="Inter-Black" size={84} tracking={60} color={WHITE} y={790}
            animate={{ text: perChar({ from: { y: 40, opacity: 0 }, easing: 'easeOutExpo', duration: '0.5s', each: '25ms', delay: land + beat }) }}>
            BUILD YOURS.
          </Text>
          <Text id="end.url" font="Inter-Medium" size={36} color={INK} y={880} tracking={120}
            animate={{ opacity: tween({ from: 0, to: 100, duration: '0.6s', delay: land + 3 * beat, easing: 'easeOutCubic' }) }}>
            CUSTOM CONTROLLERZ
          </Text>
        </Beat>
      </Beats>
    </Composition>
  );
});
