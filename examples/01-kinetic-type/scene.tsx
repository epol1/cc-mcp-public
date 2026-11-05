// Showcase 01 — Kinetic typography: three beats, per-word springs with overshoot, per-character pops,
// tracking reveal, exits before each new beat. Beats are a <Series> with exits anchored to each beat's end, so
// changing one beat's duration ripples the rest (and each beat is a named scene for AE-side ripple edits).
// Live controls: Word Stagger, Title Delay, Accent Color, Spring Damping.
import { scene, Composition, Series, Solid, Text, Shape, Rect, Fill, GradientFill, Column, spring, tween, perWord, perChar, textPresets, control } from 'ae-compose';

const INK = '#0b0d12';
const WHITE = '#eef1f6';
const MUTED = '#8b95a5';

export default scene({ name: 'KineticType', width: 1920, height: 1080, fps: 30, duration: '8.8s', bg: INK }, () => {
  const stagger = control('Word Stagger', 0.085, { min: 0, max: 0.4 });
  const delay = control('Title Delay', 0.15, { min: 0, max: 2 });
  const accent = control('Accent Color', '#4683c4');
  const damping = control('Spring Damping', 12, { min: 4, max: 30 });
  return (
    <Composition>
      <Solid name="BG" color={INK} />
      {/* soft vignette glow behind the type */}
      {/* Full-frame rect so the radial falloff has no visible edge (the gradient ends past the frame). */}
      <Shape name="Glow">
        <Rect size={[1920, 1080]} />
        <GradientFill type="radial" start={[0, -40]} end={[1150, 0]} stops={[{ offset: 0, color: '#1c2740' }, { offset: 0.55, color: '#11151f' }, { offset: 1, color: INK }]} />
      </Shape>

      {/* Beat 1 */}
      <Series>
      <Series.Sequence duration="2.4s" name="Beat 1">
        <Column gap={70}>
          <Text font="Inter-Black" size={190} color={WHITE} tracking={-20}
            animate={{ text: [perWord({ from: { y: 140, opacity: 0 }, spring: { damping, stiffness: 170 }, each: stagger, delay }), perChar({ from: { y: -40, opacity: 0, blur: 12 }, easing: 'easeInCubic', duration: '0.25s', each: '12ms', delay: 0.4, anchor: 'end', direction: 'out' })] }}>
            MAKE IT
          </Text>
          <Text font="Inter-Black" size={360} color={accent} tracking={-30}
            animate={{ text: [perChar({ from: { scale: 0, opacity: 0 }, spring: { damping: 10, stiffness: 220 }, each: '45ms', delay: 0.45 }), perChar({ from: { y: -60, opacity: 0, blur: 14 }, easing: 'easeInCubic', duration: '0.25s', each: '12ms', delay: 0.35, anchor: 'end', direction: 'out' })] }}>
            MOVE
          </Text>
        </Column>
      </Series.Sequence>

      {/* Beat 2 (overlaps Beat 1's exit by 0.1 s). 3.4 s: the 6-word line holds ~2.2 s after it lands. */}
      <Series.Sequence duration="3.4s" offset="-0.1s" name="Beat 2">
        <Column gap={26}>
          <Text font="Inter-Black" size={230} color={WHITE}
            animate={{ text: [textPresets.trackingIn({ duration: '0.9s' }), perChar({ from: { opacity: 0, blur: 10 }, easing: 'easeInCubic', duration: '0.3s', each: '10ms', delay: 0.4, anchor: 'end', direction: 'out' })] }}>
            NATIVE.
          </Text>
          <Text font="Inter-Medium" size={52} color={MUTED}
            animate={{ text: [perWord({ from: { y: 30, opacity: 0 }, easing: 'easeOutCubic', each: '70ms', delay: 0.5 }), perWord({ from: { opacity: 0 }, easing: 'easeInCubic', duration: '0.25s', each: '20ms', delay: 0.4, anchor: 'end', direction: 'out' })] }}>
            Real layers. Eased keyframes. Live controls.
          </Text>
        </Column>
      </Series.Sequence>

      {/* Beat 3: lockup, held ~2 s after the tagline lands (the end state is the point). */}
      <Series.Sequence duration="3.2s" offset="-0.1s" name="Lockup">
        <Column gap={30}>
          <Text font="Inter-Black" size={190} color={WHITE} tracking={-10}
            animate={{ text: perChar({ from: { y: 70, opacity: 0, rotation: 8 }, spring: { damping, stiffness: 190 }, each: '28ms' }) }}>
            ae-compose
          </Text>
          <Shape name="Underline" anchor="center" animate={{ scale: spring({ from: [0, 100], delay: 0.45, damping: 16, stiffness: 150 }) }}>
            <Rect size={[820, 14]} roundness={7} />
            <Fill color={accent} />
          </Shape>
          <Text font="Inter-Medium" size={48} color={MUTED} animate={{ y: spring({ from: 30, delay: 0.6, damping: 16 }), opacity: tween({ from: 0, duration: '0.5s', delay: 0.6 }) }}>
            Motion design, written in code.
          </Text>
        </Column>
      </Series.Sequence>
      </Series>
    </Composition>
  );
});
