// Showcase 01 — Kinetic typography: per-word spring reveal, accent bar, per-character subtitle.
// Live controls: Title Delay, Word Stagger, Accent Color.
import { scene, Composition, Solid, Text, Shape, Rect, Fill, spring, perWord, textPresets, control } from 'ae-compose';

export default scene({ name: 'KineticType', width: 1920, height: 1080, fps: 30, duration: '6s', bg: '#0b0d12' }, () => {
  const stagger = control('Word Stagger', 0.09, { min: 0, max: 0.5 });
  const delay = control('Title Delay', 0.3, { min: 0, max: 3 });
  const accent = control('Accent Color', '#4683c4');
  return (
    <Composition>
      <Solid name="BG" color="#0b0d12" />
      <Shape name="Accent Bar" x={960} y={640} animate={{ scale: spring({ from: [0, 100], delay: 0.7, damping: 15, stiffness: 140 }) }}>
        <Rect size={[560, 10]} roundness={5} />
        <Fill color={accent} />
      </Shape>
      <Text font="Inter-Black" size={150} tracking={-10} y={480}
        animate={{ text: perWord({ from: { y: 120, opacity: 0 }, spring: { damping: 12, stiffness: 160 }, each: stagger, delay }) }}>
        MAKE IT MOVE
      </Text>
      <Text font="Inter-Medium" size={46} y={740} color="#9aa4b2"
        animate={{ text: textPresets.fadeUp('char', { each: '18ms', delay: 1.1, duration: '0.5s' }) }}>
        Native After Effects, written in code
      </Text>
    </Composition>
  );
});
