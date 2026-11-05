// Showcase 15 — "Make one. Get a hundred." One card master, cloned 100 times (P1 cloner): the cards stream across
// the frame as a river with subtle variation (seeded tilt, size and shade from one palette), the ones passing the
// centre grow (falloff), then the stream rushes out and one card stays, growing into the panel that carries the
// message. Live in AE: edit the "Cards Master" comp (every card follows), or the Cloner effect on "Cards" (Speed,
// Seed, Randomness, Falloff, Palette) with no rebuild.
//
// Beats: Stream (hook from frame 0, 0–3.4 s) → Gather (the stream rushes out, one card holds and grows, 3.4–4.6 s)
// → Message (headline, then the line under it, holding to the end, 4.6–9 s).
import { scene, Composition, Solid, Shape, Rect, Ellipse, Fill, GradientFill, Text, Group, Cloner, scatter, noise, falloff, colorize, field, spring, tween, keys, perWord, control } from 'ae-compose';
import { BRAND } from '../brand.ts';

const INK = '#090b10';
const SHADES = ['#3f6db3', '#4683c4', '#5577cf', '#6266c8'];

/** The card master: a tinted card with an avatar dot and two text lines, the way a feed card reads at a glance. */
const Card = [
  <Shape id="card.face">
    <Rect size={[236, 136]} roundness={18} />
    <Fill color={field('Card Color', '#4683c4')} />
  </Shape>,
  <Shape id="card.lines" opacity={72}>
    <Group position={[-78, -28]}><Ellipse size={[34, 34]} /><Fill color="#ffffff" /></Group>
    <Group position={[22, -34]}><Rect size={[150, 12]} roundness={6} /><Fill color="#ffffff" /></Group>
    <Group position={[-4, 12]}><Rect size={[196, 10]} roundness={5} /><Fill color="#dfe6f3" /></Group>
    <Group position={[-30, 36]}><Rect size={[144, 10]} roundness={5} /><Fill color="#dfe6f3" /></Group>
  </Shape>,
];

export default scene({ name: 'ClonerCards', width: 1920, height: 1080, fps: 30, duration: '9s', bg: INK, params: { seed: 7 } }, (p) => {
  const panel = control('Panel Color', '#4683c4');
  return (
    <Composition>
      <Solid id="bg" name="BG" color={INK} tags={['bg']} />
      <Shape id="glow" name="Glow" tags={['bg']}>
        <Rect size={[1920, 1080]} />
        <GradientFill type="radial" start={[0, 0]} end={[1050, 0]} stops={[{ offset: 0, color: '#17243f' }, { offset: 1, color: INK }]} />
      </Shape>

      {/* Stream: 100 cards in a band, flowing right and wrapping; the rush out is a keyed Offset on the rig. */}
      <Cloner id="cards" name="Cards" count={100} size={[260, 160]} seed={p.seed} duration={4.6}
        distribute={scatter({ width: 2700, height: 640, jitter: 0.9 })}
        motion={{ speed: 210, direction: -4, wrap: 2900, variation: 30, offset: keys({ t: 0, v: 0 }, { t: 3.3, v: 0, easing: 'easeInCubic' }, { t: 4.5, v: 2400 }) }}
        opacity={keys({ t: 0, v: 100 }, { t: 3.6, v: 100, easing: 'easeInCubic' }, { t: 4.5, v: 0 })}
        effectors={[
          noise({ position: 14, rotation: 6, scale: 12, opacity: 20, speed: 0.35 }),
          falloff({ radius: 300, softness: 650, scale: [68, 108], opacity: [45, 100] }),
          colorize({ field: 'Card Color', palette: SHADES, mode: 'random' }),
        ]}
        of={Card} />

      {/* Gather: one card holds at the centre and grows into the message panel (the hand-off from the stream). */}
      {/* It starts as a card (avatar and lines, at card size) and its details fade as it grows. */}
      <Shape id="panel" name="Panel" from={3.3} y={540}
        animate={{ scale: keys({ t: 0, v: 24, easing: 'easeInOutCubic' }, { t: 0.25, v: 24, easing: 'easeOutQuint' }, { t: 1.2, v: 100 }), opacity: tween({ from: 0, to: 100, duration: 0.25 }) }}>
        <Group name="Card Lines" opacity={tween({ from: 72, to: 0, duration: 0.45, delay: 0.3, easing: 'easeInCubic' })}>
          <Group position={[-343, -123]}><Ellipse size={[150, 150]} /><Fill color="#ffffff" /></Group>
          <Group position={[97, -150]}><Rect size={[660, 53]} roundness={26} /><Fill color="#ffffff" /></Group>
          <Group position={[-18, 53]}><Rect size={[862, 44]} roundness={22} /><Fill color="#dfe6f3" /></Group>
          <Group position={[-132, 158]}><Rect size={[634, 44]} roundness={22} /><Fill color="#dfe6f3" /></Group>
        </Group>
        <Group name="Face"><Rect size={[1080, 600]} roundness={40} /><Fill color={panel} /></Group>
      </Shape>

      {/* Message: the headline lands on the panel, then the line that explains it; both hold to the end. */}
      <Text id="head1" font={BRAND.fonts.display} size={128} tracking={-20} color="#ffffff" from={4.4} y={440}
        animate={{ text: perWord({ from: { y: 60, opacity: 0 }, spring: { damping: 15, stiffness: 170 }, each: '90ms' }) }}>
        Make one.
      </Text>
      <Text id="head2" font={BRAND.fonts.display} size={128} tracking={-20} color="#ffffff" from={4.9} y={590}
        animate={{ text: perWord({ from: { y: 60, opacity: 0 }, spring: { damping: 15, stiffness: 170 }, each: '90ms' }) }}>
        Get a hundred.
      </Text>
      <Text id="sub" font={BRAND.fonts.body} size={40} color="#dce7f7" from={5.6} y={720}
        animate={{ text: perWord({ from: { y: 24, opacity: 0 }, easing: 'easeOutCubic', duration: '0.5s', each: '45ms' }) }}>
        One master. Every card live in After Effects.
      </Text>
    </Composition>
  );
});
