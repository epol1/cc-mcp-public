// A deliberately flawed piece for the style lint: five shapes landing together, a corner label parked across both
// beats, a linear slide, and an end state that holds under 2 s. tests/integration/p5/motion.ts expects the rules.
import { scene, Composition, Solid, Shape, Rect, Fill, Text, Sequence, tween } from 'ae-compose';

export default scene({ name: 'StyleTest', duration: '5s', bg: '#0b0d12' }, () => (
  <Composition>
    <Solid id="bg" color="#0b0d12" />
    <Sequence name="Beat 1" duration="2.5s" />
    <Sequence name="Beat 2" from="2.5s" duration="2.5s" />
    {[0, 1, 2, 3, 4].map((i) => (
      <Shape id={`box${i}`} position={[560 + i * 200, 420]} animate={{ scale: tween({ from: 0, to: 100, duration: 0.4, delay: 0.5, easing: 'easeOutBack' }) }}>
        <Rect size={[140, 140]} roundness={16} /><Fill color="#4683c4" />
      </Shape>
    ))}
    <Text id="corner" font="Inter-Bold" size={28} color="#9aa4b2" position={[1760, 70]}>01 / 04</Text>
    <Shape id="bar" position={[960, 720]} animate={{ x: tween({ from: -700, to: 0, duration: 1.2, delay: 1.0, easing: 'linear' }) }}>
      <Rect size={[600, 14]} roundness={7} /><Fill color="#e8a33d" />
    </Shape>
    <Text id="end" font="Inter-Black" size={110} color="#eef1f6" position={[960, 900]} from={3.4}
      animate={{ y: tween({ from: 60, duration: 0.5, easing: 'easeOutExpo' }), opacity: tween({ from: 0, to: 100, duration: 0.4 }) }}>ENDS SOON</Text>
  </Composition>
));
