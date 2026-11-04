// Showcase 08 — Variants + Compare: one end-card design, three param sets (palette, headline, spring feel, seed)
// built as sibling comps EndCard_v001_A/B/C plus EndCard_v001_Compare, which grids them with the params that
// differ. Change `variants` and rebuild to explore directions; each variant keeps its own live controls.
import { scene, Composition, Solid, Shape, Rect, Ellipse, Fill, GradientFill, Text, Svg, Column, Row, spring, tween, perWord, perChar, wiggle } from 'ae-compose';

interface P { bg: string; accent: string; headline: string; sub: string; damping: number; seed?: number }

export default scene<P>({
  name: 'EndCard', width: 1920, height: 1080, fps: 30, duration: '4s',
  params: { bg: '#0b0d12', accent: '#4683c4', headline: 'BUILT FOR YOUR HANDS', sub: 'Design yours at the configurator', damping: 12 },
  variants: {
    A: { accent: '#4683c4', damping: 10 },
    B: { bg: '#120b16', accent: '#ff5a8a', headline: 'MADE TO BE YOURS', damping: 16 },
    C: { bg: '#0b1412', accent: '#2ec4b6', headline: 'NO TWO ALIKE', sub: 'Every controller is one of one', damping: 22, seed: 7 },
  },
  compare: true,
}, (p) => (
  <Composition>
    <Solid name="BG" color={p.bg} />
    <Shape name="Glow">
      <Rect size={[1920, 1080]} />
      <GradientFill type="radial" start={[0, -80]} end={[1100, 0]} stops={[{ offset: 0, color: p.accent, opacity: 0.22 }, { offset: 1, color: p.bg, opacity: 0 }]} />
    </Shape>
    {/* Floating accent orbs; their drift is seeded, so variant C (seed 7) moves differently. */}
    {[0, 1, 2].map((i) => (
      <Shape name={`Orb ${i + 1}`} x={[360, 1580, 1250][i]} y={[260, 300, 860][i]} opacity={[18, 12, 10][i]}
        animate={{ position: wiggle(0.4, 30, { seed: (p.seed ?? 1) * 10 + i }) }}>
        <Ellipse size={[[320, 220, 420][i], [320, 220, 420][i]]} />
        <Fill color={p.accent} />
      </Shape>
    ))}
    <Column gap={40}>
      <Svg src="../../assets/logo/cc-logo.svg" name="Logo" width={520} color="#f2f4f8"
        animate={{ scale: spring({ from: 80, damping: p.damping, stiffness: 150 }), opacity: tween({ from: 0, duration: '0.3s' }) }} />
      <Text name="Headline" font="Inter-Black" size={96} color="#f2f4f8" tracking={20}
        animate={{ text: perWord({ from: { y: 60, opacity: 0 }, spring: { damping: p.damping, stiffness: 170 }, each: '90ms', delay: 0.35 }) }}>
        {p.headline}
      </Text>
      <Row gap={18}>
        <Shape name="Dot" animate={{ scale: spring({ from: 0, delay: 0.9, damping: 10, stiffness: 250 }) }}>
          <Ellipse size={[16, 16]} />
          <Fill color={p.accent} />
        </Shape>
        <Text name="Sub" font="Inter-Medium" size={40} color="#a7b0be"
          animate={{ text: perChar({ from: { opacity: 0 }, easing: 'easeOutCubic', duration: '0.3s', each: '18ms', delay: 0.95 }) }}>
          {p.sub}
        </Text>
      </Row>
    </Column>
  </Composition>
));
