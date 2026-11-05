// Recipe: kinetic title (from showcase 01 / SKILL.md 4.1). A punchy headline springs in word by word, an accent bar
// grows under it, the supporting line follows once the headline has landed, everything holds, and leaves together
// at the end (exits are anchored to the layer end, so a longer duration just holds longer).
// Params: headline, sub. Live controls: Word Stagger, Title Delay, Accent Color (brand). EG text: Headline, Subline.
import { scene, Composition, Solid, Shape, Rect, Fill, GradientFill, Text, Column, spring, tween, perWord, control } from 'ae-compose';
import { BRAND } from './brand.ts';

const INK = BRAND.value('ink'), WHITE = BRAND.value('white'), MUTED = BRAND.value('muted');
const DUR = 5;

export default scene({
  name: 'KineticTitle', width: 1920, height: 1080, fps: 30, duration: DUR, bg: INK,
  params: { headline: 'MAKE IT MOVE', sub: 'Native After Effects, written in code' },
}, (p) => {
  const stagger = control('Word Stagger', 0.08, { min: 0, max: 0.3 });
  const delay = control('Title Delay', 0.15, { min: 0, max: 2 });
  const accent = BRAND.colors.accent;
  // Big type for a short headline; smaller for longer ones (SKILL.md §6.7: hero 120–200 px).
  const n = p.headline.trim().split(/\s+/).length;
  const size = n <= 3 ? BRAND.sizes.hero - 20 : n <= 5 ? BRAND.sizes.headline + 10 : BRAND.sizes.headline - 20;
  return (
    <Composition>
      <Solid name="BG" color={INK} tags={['bg']} />
      {/* Soft vignette glow behind the type (full-frame so the falloff has no edge). */}
      <Shape name="Glow" tags={['bg']}>
        <Rect size={[1920, 1080]} />
        <GradientFill type="radial" start={[0, -40]} end={[1150, 0]} stops={[{ offset: 0, color: '#1c2740' }, { offset: 0.55, color: '#11151f' }, { offset: 1, color: INK }]} />
      </Shape>
      <Column gap={30}>
        <Text id="headline" eg="Headline" font={BRAND.fonts.display} size={size} tracking={-20} color={WHITE}
          animate={{ text: [
            perWord({ from: { y: 140, opacity: 0 }, spring: { damping: 12, stiffness: 170 }, each: stagger, delay }),
            perWord({ from: { y: -40, opacity: 0, blur: 12 }, easing: 'easeInCubic', duration: '0.25s', each: '40ms', delay: 0.6, anchor: 'end', direction: 'out' }),
          ] }}>
          {p.headline}
        </Text>
        <Shape id="bar" name="Accent Bar"
          animate={{ scale: spring({ from: [0, 100], delay: 0.7, damping: 15, stiffness: 140 }), opacity: tween({ to: 0, duration: '0.25s', delay: DUR - 0.55, easing: 'easeInCubic' }) }}>
          <Rect size={[560, 10]} roundness={5} />
          <Fill color={accent} />
        </Shape>
        <Text id="sub" eg="Subline" font={BRAND.fonts.body} size={BRAND.sizes.body + 2} color={MUTED}
          animate={{ text: [
            perWord({ from: { y: 30, opacity: 0 }, easing: 'easeOutCubic', duration: '0.5s', each: '60ms', delay: 1.0 }),
            perWord({ from: { opacity: 0 }, easing: 'easeInCubic', duration: '0.25s', each: '20ms', delay: 0.55, anchor: 'end', direction: 'out' }),
          ] }}>
          {p.sub}
        </Text>
      </Column>
    </Composition>
  );
});
