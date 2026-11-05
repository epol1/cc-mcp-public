// Showcase 14 — Particle Playground: the title holds, then at the drop it is turned into particles by Playground's
// Layer Exploder (the source is a hidden precomp holding the text for one frame, so the letters are emitted once) and
// crumbles under Playground gravity. A light cannon fountain and a CC Star Burst starfield sit behind it.
// Live controls: Gravity, Scatter, Fountain Rate.
import { scene, Composition, Solid, Text, Precomp, ParticlePlayground, StarBurst, Effect, Adjustment, perWord, control } from 'ae-compose';

export default scene({ name: 'Playground', width: 1920, height: 1080, fps: 30, duration: '6s', bg: '#05060a' }, () => {
  const DROP = 2.8; // seconds: the 4-word title is readable for ~1.9 s before it explodes
  const gravity = control('Gravity', 420, { min: 0, max: 1200 });
  const scatter = control('Scatter', 90, { min: 0, max: 400 });
  const rate = control('Fountain Rate', 60, { min: 0, max: 600 });
  return (
    <Composition>
      <Solid name="BG" color="#05060a" />
      <StarBurst name="Stars" params={{ Speed: 0.35, 'Grid Spacing': 5, Size: 160, Scatter: 300 }} opacity={85} />
      {/* The title as real text until the drop... */}
      <Text name="Title" font="Inter-Black" size={150} color="#9cc8ff" y={470} duration={DROP}
        animate={{ text: perWord({ from: { y: 50, opacity: 0 }, spring: { damping: 14, stiffness: 160 }, each: '110ms', delay: 0.2 }) }}>
        PLAY IT YOUR WAY
      </Text>
      {/* ...then it is exploded into particles exactly once. Layer Exploder samples its source at every frame and
          ignores the source layer's in/out points, so the source is a hidden precomp whose CONTENT is the text for
          one frame only (the drop frame) and empty otherwise. */}
      <Precomp id="source" name="Title (exploder source)" hidden>
        <Text font="Inter-Black" size={150} color="#9cc8ff" y={470} from={DROP} duration={1 / 30}>PLAY IT YOUR WAY</Text>
      </Precomp>
      <ParticlePlayground id="pg" name="Playground"
        params={{
          'Position': [960, 1040],
          'Particles Per Second': rate,
          'Direction Random Spread': 16,
          'Velocity': 620,
          'Velocity Random Spread': 90,
          'Color': '#4683c4',
          'Particle Radius': 2,
          'Explode Layer': { layer: 'source' },
          'Radius of New Particles': 2,
          'Velocity Dispersion': scatter,
          'Force': gravity,
        }} />
      <Adjustment name="Bloom">
        <Effect name="Glow" params={{ 'Glow Radius': 20, 'Glow Intensity': 0.5, 'Glow Threshold': 75 }} />
      </Adjustment>
    </Composition>
  );
});
