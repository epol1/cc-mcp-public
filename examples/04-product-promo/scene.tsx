// Showcase 04 — Product promo cut from your own footage: three shots in a <Series> (each a named scene),
// push-ins, a masked footage card, per-line copy, and an end card with the logo drawing on.
// Live controls: Accent Color, Copy Delay.
import { scene, Composition, Series, Footage, Solid, Shape, Rect, Fill, GradientFill, Text, Svg, Mask, Row, Column, Effect, spring, tween, keys, perWord, perLine, perChar, textPresets, control } from 'ae-compose';

const INK = '#0b0d12';
const WHITE = '#f2f4f8';
const MUTED = '#9aa5b5';

export default scene({ name: 'ProductPromo', width: 1920, height: 1080, fps: 30, duration: '9s', bg: INK, motionBlur: true }, () => {
  const accent = control('Accent Color', '#4683c4');
  const copyDelay = control('Copy Delay', 0.35, { min: 0, max: 1.5 });
  return (
    <Composition>
      <Series>
        {/* Shot 1: hero footage with a slow push-in and a bold headline */}
        <Series.Sequence duration="3s" name="Hero">
          <Footage src="../../assets/footage/cc.mp4" trim={['1.5s', '4.8s']} fit="cover" muted
            animate={{ scale: tween({ from: 100, to: 109, duration: '3s', easing: 'easeOutSine' }) }} />
          <Shape name="Bottom Shade">
            <Rect size={[1920, 1080]} />
            <GradientFill start={[0, -100]} end={[0, 540]} stops={[{ offset: 0, color: '#000000', opacity: 0 }, { offset: 1, color: '#000000', opacity: 0.85 }]} />
          </Shape>
          <Column gap={10} offset={[0, 300]}>
            <Text font="Inter-SemiBold" size={34} color={accent} tracking={300}
              animate={{ text: textPresets.trackingIn({ delay: copyDelay }) }}>
              CUSTOM CONTROLLERZ
            </Text>
            <Text font="Inter-Black" size={132} color={WHITE} tracking={-10}
              animate={{ text: [perWord({ from: { y: 90, opacity: 0 }, spring: { damping: 14, stiffness: 160 }, each: '110ms', delay: 0.55 }), perWord({ from: { y: -40, opacity: 0 }, easing: 'easeInCubic', duration: '0.25s', each: '40ms', delay: 0.35, anchor: 'end', direction: 'out' })] }}>
              CREATE YOUR OWN
            </Text>
          </Column>
        </Series.Sequence>

        {/* Shot 2: footage card + copy */}
        <Series.Sequence duration="3s" offset="-0.2s" name="Details">
          <Solid name="BG" color={INK} />
          <Shape name="Glow" x={560} opacity={80}>
            <Rect size={[1400, 1100]} roundness={550} />
            <GradientFill type="radial" start={[0, 0]} end={[700, 0]} stops={[{ offset: 0, color: '#18263d' }, { offset: 1, color: INK }]} />
          </Shape>
          <Row gap={90}>
            <Footage src="../../assets/footage/Controllers.mp4" fit="none" scale={118} muted
              animate={{ x: spring({ from: -160, damping: 18, stiffness: 120 }), opacity: tween({ from: 0, duration: '0.4s' }) }}>
              <Mask rect={{ x: 0, y: 0, width: 800, height: 534, roundness: 28 }} />
              <Effect name="Drop Shadow" params={{ Opacity: 60, Distance: 24, Softness: 60, Direction: 180 }} />
            </Footage>
            <Column gap={22} align="start">
              <Shape name="Accent Bar" anchor="left" animate={{ scale: spring({ from: [0, 100], delay: 0.3, damping: 18 }) }}>
                <Rect size={[120, 10]} roundness={5} />
                <Fill color={accent} />
              </Shape>
              <Text font="Inter-Bold" size={76} color={WHITE} align="left" anchor="left" leading={84}
                animate={{ text: perLine({ from: { y: 50, opacity: 0 }, easing: 'easeOutQuint', duration: '0.7s', each: '120ms', delay: copyDelay }) }}>
                {'Pick every\rpart.'}
              </Text>
              <Text font="Inter-Medium" size={36} color={MUTED} align="left" anchor="left"
                animate={{ text: perWord({ from: { x: -24, opacity: 0 }, easing: 'easeOutCubic', duration: '0.5s', each: '70ms', delay: 0.9 }) }}>
                Shells. Buttons. D-pads. Triggers.
              </Text>
            </Column>
          </Row>
        </Series.Sequence>

        {/* Shot 3: end card */}
        <Series.Sequence duration="3.2s" offset="-0.2s" name="End Card">
          <Solid name="BG" color={INK} />
          <Footage src="../../assets/footage/stills/05.png" fit="contain" opacity={18}
            animate={{ scale: tween({ from: 64, to: 70, duration: '3.2s', easing: 'linear' }) }}>
            <Effect name="Gaussian Blur" params={{ Blurriness: 30, 'Repeat Edge Pixels': 1 }} />
          </Footage>
          <Column gap={46}>
            <Svg src="../../assets/logo/cc-logo.svg" name="Logo" width={980}
              color={WHITE} stroke={{ color: WHITE, width: 2 }}
              draw={tween({ from: 0, to: 100, duration: '1.1s', delay: 0.1, easing: 'easeInOutCubic' })}
              fillOpacity={tween({ from: 0, to: 100, duration: '0.5s', delay: 0.95 })} />
            <Row gap={24}>
              <Text font="Inter-Medium" size={40} color={MUTED}
                animate={{ text: perWord({ from: { y: 20, opacity: 0 }, easing: 'easeOutCubic', each: '80ms', delay: 1.2 }) }}>
                Built for your hands.
              </Text>
              <Text font="Inter-Bold" size={40} color={accent}
                animate={{ text: perChar({ from: { opacity: 0, x: -10 }, easing: 'easeOutCubic', duration: '0.3s', each: '25ms', delay: 1.6 }) }}>
                Design yours →
              </Text>
            </Row>
          </Column>
          <Solid name="Fade Out" color="#000000" animate={{ opacity: keys({ t: 2.7, v: 0, easing: 'easeInCubic' }, { t: 3.2, v: 100 }) }} />
        </Series.Sequence>
      </Series>
    </Composition>
  );
});
