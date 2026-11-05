// Recipe: end card (from showcase 08). Logo, headline and a call to action land in order (logo, then the headline
// per word, then the CTA after a dot pops), over a soft accent glow with slow, seeded orbs; the end state holds
// about 2 s. Params: logo (an .svg), logoWidth, headline, cta, damping (spring feel), seed (orb drift).
// Live controls: Accent Color (brand), Headline Delay. EG text: Headline, CTA.
import { scene, Composition, Solid, Shape, Rect, Ellipse, Fill, GradientFill, Text, Svg, Column, Row, spring, tween, perWord, perChar, wiggle, control } from 'ae-compose';
import { BRAND } from './brand.ts';

const INK = BRAND.value('ink'), WHITE = BRAND.value('white'), MUTED = BRAND.value('muted');

export default scene({
  name: 'EndCard', width: 1920, height: 1080, fps: 30, duration: 4.5, bg: INK,
  params: { logo: './assets/mark.svg', logoWidth: 260, headline: 'BUILT FOR YOUR HANDS', cta: 'Design yours at the configurator', damping: 12, seed: 1 },
}, (p) => {
  const accent = BRAND.colors.accent;
  const delay = control('Headline Delay', 0.35, { min: 0, max: 2 });
  return (
    <Composition>
      <Solid name="BG" color={INK} tags={['bg']} />
      <Shape name="Glow" tags={['bg']}>
        <Rect size={[1920, 1080]} />
        <GradientFill type="radial" start={[0, -80]} end={[1100, 0]} stops={[{ offset: 0, color: BRAND.value('accent'), opacity: 0.22 }, { offset: 1, color: INK, opacity: 0 }]} />
      </Shape>
      {/* Floating accent orbs: subtle life during the hold; the drift is seeded (seed param). */}
      {[0, 1, 2].map((i) => (
        <Shape name={`Orb ${i + 1}`} tags={['bg']} x={[360, 1580, 1250][i]} y={[260, 300, 860][i]} opacity={[18, 12, 10][i]}
          animate={{ position: wiggle(0.4, 30, { seed: p.seed * 10 + i }) }}>
          <Ellipse size={[[320, 220, 420][i], [320, 220, 420][i]]} />
          <Fill color={accent} />
        </Shape>
      ))}
      <Column gap={40}>
        <Svg src={p.logo} name="Logo" width={p.logoWidth} color={WHITE}
          animate={{ scale: spring({ from: 80, damping: p.damping, stiffness: 150 }), opacity: tween({ from: 0, duration: '0.3s' }) }} />
        <Text id="headline" name="Headline" eg="Headline" font={BRAND.fonts.display} size={96} color={WHITE} tracking={20}
          animate={{ text: perWord({ from: { y: 60, opacity: 0 }, spring: { damping: p.damping, stiffness: 170 }, each: '90ms', delay }) }}>
          {p.headline}
        </Text>
        <Row gap={18}>
          <Shape name="Dot" animate={{ scale: spring({ from: 0, delay: 0.9, damping: 10, stiffness: 250 }) }}>
            <Ellipse size={[16, 16]} />
            <Fill color={accent} />
          </Shape>
          <Text id="cta" name="CTA" eg="CTA" font={BRAND.fonts.body} size={40} color={MUTED}
            animate={{ text: perChar({ from: { opacity: 0 }, easing: 'easeOutCubic', duration: '0.3s', each: '18ms', delay: 0.95 }) }}>
            {p.cta}
          </Text>
        </Row>
      </Column>
    </Composition>
  );
});
