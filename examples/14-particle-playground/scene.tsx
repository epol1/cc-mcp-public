// Showcase 14 — Particle Playground: a cannon fountain arcing under gravity behind a title, over a CC Star Burst
// starfield, with the cannon's direction sweeping. Live controls: Fountain Rate, Fountain Speed, Gravity.
import { scene, Composition, Solid, Text, ParticlePlayground, StarBurst, Effect, Adjustment, keys, perWord, control } from 'ae-compose';

export default scene({ name: 'Playground', width: 1920, height: 1080, fps: 30, duration: '6s', bg: '#05060a' }, () => (
  <Composition>
    <Solid name="BG" color="#05060a" />
    <StarBurst name="Stars" params={{ Speed: 0.35, 'Grid Spacing': 5, Size: 160, Scatter: 300 }} opacity={85} />
    <ParticlePlayground id="fountain" name="Fountain"
      params={{
        'Position': [960, 1000],
        'Particles Per Second': control('Fountain Rate', 320, { min: 0, max: 900 }),
        'Direction': keys({ t: 0, v: -18, easing: 'easeInOutSine' }, { t: 3, v: 18, easing: 'easeInOutSine' }, { t: 6, v: -18 }),
        'Direction Random Spread': 14,
        'Velocity': control('Fountain Speed', 720, { min: 0, max: 1500 }),
        'Velocity Random Spread': 60,
        'Color': '#7fb3ff',
        'Particle Radius': 4,
        'Force': control('Gravity', 380, { min: 0, max: 1200 }),
      }}>
    </ParticlePlayground>
    <Adjustment name="Bloom">
      <Effect name="Glow" params={{ 'Glow Radius': 30, 'Glow Intensity': 0.8, 'Glow Threshold': 65 }} />
    </Adjustment>
    <Text name="Title" font="Inter-Black" size={140} color="#f2f4f8" y={430}
      animate={{ text: perWord({ from: { y: 60, opacity: 0 }, spring: { damping: 14, stiffness: 160 }, each: '120ms', delay: 0.6 }) }}>
      PLAY IT YOUR WAY
    </Text>
  </Composition>
));
