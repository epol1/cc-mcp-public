// P1/P2 integration scene: one card master cloned `count` times (scatter band, flowing right with wrap), seeded
// noise, a falloff that grows cards near the centre, a palette on the master's color field, and labels from data.
import { scene, Composition, Solid, Shape, Rect, Fill, Text, Cloner, scatter, noise, falloff, colorize, field } from 'ae-compose';

export default scene({ name: 'ClonerTest', duration: '5s', bg: '#0b0d12', params: { count: 100, labels: true, palette: true } }, (p) => (
  <Composition>
    <Solid id="bg" color="#0b0d12" />
    <Cloner id="cards" name="Cards" count={p.count} size={[260, 150]} seed={7}
      distribute={scatter({ width: 2400, height: 760, jitter: 0.9 })}
      motion={{ speed: 260, direction: 0, wrap: 2600, variation: 35 }}
      effectors={[
        noise({ position: 18, rotation: 7, scale: 12, opacity: 25, speed: 0.4 }),
        falloff({ radius: 380, softness: 520, scale: [72, 112], opacity: [55, 100] }),
        ...(p.palette ? [colorize({ field: 'Card Color', palette: ['#4683c4', '#7a5cff', '#2bb3a3', '#e8a33d'], mode: 'random' })] : []),
      ]}
      data={p.labels ? Array.from({ length: p.count }, (_, i) => ({ Label: `#${String(i + 1).padStart(3, '0')}` })) : undefined}
      of={[
        <Shape id="card.bg"><Rect size={[240, 130]} roundness={18} /><Fill color={field('Card Color', '#4683c4')} /></Shape>,
        <Text id="card.label" eg="Label" font="Inter-Bold" size={34} color="#ffffff">#000</Text>,
      ]} />
  </Composition>
));
