// Showcase 06 — Vertical 1080×1920 social ad laid out with a Column: logo, two-line hook, a rounded footage card,
// and a pulsing CTA button (Overlay of a shape and a text). Every element enters on its own spring; the layout
// is solved in AE with real text metrics. Live controls: Accent Color, Hook (Essential Graphics text).
import { scene, Composition, Solid, Shape, Rect, Fill, GradientFill, Text, Svg, Footage, Mask, Column, Overlay, Effect, spring, tween, keys, loop, perWord, control } from 'ae-compose';

const INK = '#0a0c12';

export default scene({ name: 'VerticalAd', width: 1080, height: 1920, fps: 30, duration: '7s', bg: INK }, () => {
  const accent = control('Accent Color', '#4683c4');
  return (
    <Composition>
      <Solid name="BG" color={INK} />
      <Shape name="Top Glow">
        <Rect size={[1080, 1920]} />
        <GradientFill type="radial" start={[0, -620]} end={[0, 520]} stops={[{ offset: 0, color: '#1b2a45' }, { offset: 1, color: INK }]} />
      </Shape>
      <Column gap={64}>
        <Svg src="../../assets/logo/cc-logo.svg" name="Logo" width={420} color="#f2f4f8"
          animate={{ opacity: tween({ from: 0, duration: '0.5s', delay: 0.1 }), y: spring({ from: -40, delay: 0.1, damping: 16 }) }} />
        <Text name="Hook" eg="Hook" font="Inter-Black" size={118} color="#f2f4f8" leading={116} tracking={-15}
          animate={{ text: perWord({ from: { y: 70, opacity: 0, scale: 92 }, spring: { damping: 13, stiffness: 170 }, each: '90ms', delay: 0.35 }) }}>
          {'YOUR\rCONTROLLER.\rYOUR RULES.'}
        </Text>
        <Footage src="../../assets/footage/Controllers.mp4" name="Card" fit="none" scale={112} muted loop
          animate={{ y: spring({ from: 140, delay: 0.9, damping: 15, stiffness: 120 }), opacity: tween({ from: 0, duration: '0.4s', delay: 0.9 }) }}>
          <Mask rect={{ x: 0, y: 0, width: 800, height: 534, roundness: 36 }} />
          <Effect name="Drop Shadow" params={{ Opacity: 55, Distance: 30, Softness: 80, Direction: 180 }} />
        </Footage>
        <Overlay>
          {/* Pulse ring behind the button, looping from 2.6 s (the layer starts then, so nothing shows before). */}
          <Shape name="CTA Pulse" from={2.6}
            animate={{ scale: loop(keys({ t: 0, v: 100, easing: 'easeOutCubic' }, { t: 1.0, v: 122 }), 'cycle'), opacity: loop(keys({ t: 0, v: 55, easing: 'easeOutCubic' }, { t: 1.0, v: 0 }), 'cycle') }}>
            <Rect size={[640, 128]} roundness={64} />
            <Fill color={accent} />
          </Shape>
          <Shape name="CTA Button"
            animate={{ scale: keys({ t: 1.6, v: 0, easing: 'easeOutBack' }, { t: 2.1, v: 100 }) }}>
            <Rect size={[640, 128]} roundness={64} />
            <Fill color={accent} />
          </Shape>
          <Text name="CTA" font="Inter-Bold" size={50} color="#ffffff" tracking={60}
            animate={{ opacity: tween({ from: 0, duration: '0.3s', delay: 1.9 }) }}>
            DESIGN YOURS
          </Text>
        </Overlay>
      </Column>
    </Composition>
  );
});
