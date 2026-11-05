// Recipe: product promo (from showcase 04). Three beats in a <Series> (each a named scene): a hero headline over the
// product (footage, or a placeholder backdrop), a details beat with a media card and copy, and an end card with the
// logo drawing on. The transitions differ: an angled accent wipe covers the first cut, a disc zooms through the
// second. Params: brandLine, headline, detail, detailCopy, tagline, cta, hero/card (optional footage or stills),
// logo (an .svg). Live controls: Accent Color (brand), Copy Delay.
import { scene, Composition, Series, Footage, Solid, Shape, Rect, Ellipse, Fill, GradientFill, Text, Svg, Mask, Row, Column, Effect, spring, tween, keys, perWord, perLine, perChar, textPresets, control } from 'ae-compose';
import { BRAND } from './brand.ts';

const INK = BRAND.value('ink'), WHITE = BRAND.value('white'), MUTED = BRAND.value('muted');
/** Beat lengths and overlaps (s). Lengthen a beat to give it more hold; the transitions follow. */
const T = { hero: 3.4, details: 3.6, end: 3.4 }, O = 0.2;
const AT = { details: T.hero - O, end: T.hero + T.details - 2 * O };

/** shape-wipe: two angled bars sweep across, covering the frame at `at` (the cut) and clearing on the far side. */
function AccentWipe({ at, color }: { at: number; color: any }) {
  return (
    <>
      {[0, 1].map((i) => (
        <Shape name={`Wipe ${i + 1}`} tags={['transition:shape-wipe']} rotation={-12} from={at - 0.45} duration={0.9}
          animate={{ x: keys({ t: i * 0.06, v: -1500, easing: 'easeInCubic' }, { t: 0.42 + i * 0.03, v: 960, hold: true }, { t: 0.5 + i * 0.03, v: 960, easing: 'easeOutCubic' }, { t: 0.88, v: 3400 }) }}>
          <Rect size={[2400, 2400]} />
          <Fill color={i === 0 ? INK : color} />
        </Shape>
      ))}
    </>
  );
}

/** zoom-through: an accent disc grows from the card's centre to cover the cut at `at`, then opens onto the end card. */
function DiscZoom({ at, color }: { at: number; color: any }) {
  return (
    <Shape name="Disc Zoom" tags={['transition:zoom-through']} from={at - 0.4} duration={0.8}
      animate={{ scale: keys({ t: 0, v: 0, easing: 'easeInCubic' }, { t: 0.4, v: 100, easing: 'easeOutCubic' }, { t: 0.8, v: 150 }), opacity: keys({ t: 0.4, v: 100, easing: 'easeOutCubic' }, { t: 0.8, v: 0 }) }}>
      <Ellipse size={[2300, 2300]} />
      <Fill color={color} />
    </Shape>
  );
}

export default scene({
  name: 'ProductPromo', width: 1920, height: 1080, fps: 30, duration: AT.end + T.end, bg: INK, motionBlur: true,
  params: {
    brandLine: 'CUSTOM CONTROLLERZ', headline: 'CREATE YOUR OWN', detail: 'Pick every\rpart.', detailCopy: 'Shells. Buttons. D-pads. Triggers.',
    tagline: 'Built for your hands.', cta: 'Design yours →', hero: '', card: '', logo: './assets/mark.svg',
  },
}, (p) => {
  const accent = BRAND.colors.accent;
  const copyDelay = control('Copy Delay', 0.35, { min: 0, max: 1.5 });
  return (
    <Composition>
      <Series>
        {/* Hero: the product with a slow push-in and the bold claim. */}
        <Series.Sequence duration={T.hero} name="Hero">
          {p.hero
            ? <Footage id="hero" src={p.hero} fit="cover" muted animate={{ scale: tween({ from: 100, to: 109, duration: T.hero, easing: 'easeOutSine' }) }} />
            : (
              <Shape id="hero" name="Hero (placeholder)" tags={['bg']} animate={{ scale: tween({ from: 100, to: 106, duration: T.hero, easing: 'easeOutSine' }) }}>
                <Rect size={[1920, 1080]} />
                <GradientFill type="radial" start={[300, -200]} end={[1500, 0]} stops={[{ offset: 0, color: '#2a3e5e' }, { offset: 0.7, color: '#111722' }, { offset: 1, color: INK }]} />
              </Shape>
            )}
          <Solid name="Dim" color="#05070b" opacity={30} />
          <Shape name="Bottom Shade">
            <Rect size={[1920, 1080]} />
            <GradientFill start={[0, -80]} end={[0, 540]} stops={[{ offset: 0, color: '#05070b', opacity: 0 }, { offset: 1, color: '#05070b', opacity: 0.95 }]} />
          </Shape>
          <Column gap={26} offset={[0, 290]}>
            <Text id="brand-line" name="Brand Line" font={BRAND.fonts.bold} size={34} color="#9cc3ee" tracking={300}
              animate={{ text: textPresets.trackingIn({ delay: copyDelay }) }}>
              {p.brandLine}
            </Text>
            <Text id="headline" name="Headline" eg="Headline" font={BRAND.fonts.display} size={132} color={WHITE} tracking={-10}
              animate={{ text: [perWord({ from: { y: 90, opacity: 0 }, spring: { damping: 14, stiffness: 160 }, each: '110ms', delay: 0.55 }), perWord({ from: { y: -40, opacity: 0 }, easing: 'easeInCubic', duration: '0.25s', each: '40ms', delay: 0.35, anchor: 'end', direction: 'out' })] }}>
              {p.headline}
            </Text>
          </Column>
        </Series.Sequence>

        {/* Details: a media card and the copy that explains it. */}
        <Series.Sequence duration={T.details} offset={-O} name="Details">
          <Solid name="BG" color={INK} tags={['bg']} />
          <Shape name="Glow" x={560} opacity={80} tags={['bg']}>
            <Rect size={[1400, 1100]} roundness={550} />
            <GradientFill type="radial" start={[0, 0]} end={[700, 0]} stops={[{ offset: 0, color: '#18263d' }, { offset: 1, color: INK }]} />
          </Shape>
          <Row gap={90}>
            {p.card
              ? (
                <Footage id="card" src={p.card} fit="none" scale={118} muted
                  animate={{ x: spring({ from: -160, damping: 18, stiffness: 120 }), opacity: tween({ from: 0, duration: '0.4s' }) }}>
                  <Mask rect={{ x: 0, y: 0, width: 800, height: 534, roundness: 28 }} />
                  <Effect name="Drop Shadow" params={{ Opacity: 60, Distance: 24, Softness: 60, Direction: 180 }} />
                </Footage>
              )
              : (
                <Shape id="card" name="Card (placeholder)" animate={{ x: spring({ from: -160, damping: 18, stiffness: 120 }), opacity: tween({ from: 0, duration: '0.4s' }) }}>
                  <Rect size={[760, 500]} roundness={28} />
                  <GradientFill start={[-380, -250]} end={[380, 250]} stops={[{ offset: 0, color: '#26354f' }, { offset: 1, color: '#151b26' }]} />
                </Shape>
              )}
            <Column gap={22} align="start">
              <Shape name="Accent Bar" anchor="left" animate={{ scale: spring({ from: [0, 100], delay: 0.3, damping: 18 }) }}>
                <Rect size={[120, 10]} roundness={5} />
                <Fill color={accent} />
              </Shape>
              <Text id="detail" name="Detail" font={BRAND.fonts.bold} size={76} color={WHITE} align="left" anchor="left" leading={84}
                animate={{ text: perLine({ from: { y: 50, opacity: 0 }, easing: 'easeOutQuint', duration: '0.7s', each: '120ms', delay: copyDelay }) }}>
                {p.detail}
              </Text>
              <Text id="detail-copy" name="Detail Copy" font={BRAND.fonts.body} size={36} color={MUTED} align="left" anchor="left"
                animate={{ text: perWord({ from: { x: -24, opacity: 0 }, easing: 'easeOutCubic', duration: '0.5s', each: '70ms', delay: 0.9 }) }}>
                {p.detailCopy}
              </Text>
            </Column>
          </Row>
        </Series.Sequence>

        {/* End card: the logo draws on, the tagline and CTA follow, and it holds. */}
        <Series.Sequence duration={T.end} offset={-O} name="End Card">
          <Solid name="BG" color={INK} tags={['bg']} />
          <Column gap={46}>
            <Svg src={p.logo} name="Logo" width={300}
              color={WHITE} stroke={{ color: WHITE, width: 2 }}
              draw={tween({ from: 0, to: 100, duration: '1.1s', delay: 0.1, easing: 'easeInOutCubic' })}
              fillOpacity={tween({ from: 0, to: 100, duration: '0.5s', delay: 0.95 })} />
            <Row gap={24}>
              <Text id="tagline" name="Tagline" font={BRAND.fonts.body} size={40} color={MUTED}
                animate={{ text: perWord({ from: { y: 20, opacity: 0 }, easing: 'easeOutCubic', each: '80ms', delay: 1.2 }) }}>
                {p.tagline}
              </Text>
              <Text id="cta" name="CTA" eg="CTA" font={BRAND.fonts.bold} size={40} color={accent}
                animate={{ text: perChar({ from: { opacity: 0, x: -10 }, easing: 'easeOutCubic', duration: '0.3s', each: '25ms', delay: 1.6 }) }}>
                {p.cta}
              </Text>
            </Row>
          </Column>
        </Series.Sequence>
      </Series>
      {/* Transitions at the cuts (the middle of each overlap), each a different kind. */}
      <AccentWipe at={AT.details + O / 2} color={accent} />
      <DiscZoom at={AT.end + O / 2} color={accent} />
    </Composition>
  );
});
