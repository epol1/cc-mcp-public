// Showcase 02 — Logo reveal: the Custom Controllerz SVG draws on (trim paths), fills, settles with a spring
// and blooms (Glow). A gradient arc sweeps behind. Live controls: Draw Duration, Glow Amount, Logo Color.
import { scene, Composition, Solid, Shape, Ellipse, GradientFill, GradientStroke, Trim, Text, Svg, Effect, spring, tween, keys, perWord, control } from 'ae-compose';

const INK = '#07090d';

export default scene({ name: 'LogoReveal', width: 1920, height: 1080, fps: 30, duration: '5s', bg: INK }, () => {
  const draw = control('Draw Duration', 1.5, { min: 0.3, max: 4 });
  const glow = control('Glow Amount', 30, { min: 0, max: 120 });
  const color = control('Logo Color', '#4683c4');
  return (
    <Composition>
      <Solid name="BG" color={INK} />
      <Shape name="Backlight" opacity={85}>
        <Ellipse size={[1700, 1300]} />
        <GradientFill type="radial" start={[0, 0]} end={[850, 0]} stops={[{ offset: 0, color: '#142238' }, { offset: 1, color: INK }]} />
      </Shape>
      <Shape name="Arc" y={500} opacity={60} animate={{ rotation: tween({ from: -40, to: 30, duration: '5s', easing: 'easeInOutSine' }) }}>
        <Ellipse size={[1180, 1180]} />
        <Trim start={0} end={tween({ from: 0, to: 42, duration: '1.8s', delay: 0.2, easing: 'easeInOutCubic' })} offset={tween({ from: 0, to: 20, duration: '5s', easing: 'linear' })} />
        <GradientStroke width={5} start={[-590, 0]} end={[590, 0]} stops={[{ offset: 0, color: '#4683c4', opacity: 0 }, { offset: 0.6, color: '#7fb3ff' }, { offset: 1, color: '#ffffff' }]} />
      </Shape>
      <Svg src="../../assets/logo/cc-logo.svg" name="Logo" width={1150} y={500}
        color={color} stroke={{ color, width: 3 }}
        draw={tween({ from: 0, to: 100, duration: draw, delay: 0.15, easing: 'easeInOutCubic' })}
        fillOpacity={tween({ from: 0, to: 100, duration: '0.6s', delay: 1.35, easing: 'easeOutCubic' })}
        animate={{ scale: spring({ from: 94, delay: 1.3, damping: 13, stiffness: 140 }) }}>
        <Effect name="Glow" params={{ 'Glow Radius': glow, 'Glow Intensity': keys({ t: 1.35, v: 0, easing: 'easeOutQuad' }, { t: 1.7, v: 1.6, easing: 'easeInOutSine' }, { t: 2.6, v: 0.6 }), 'Glow Threshold': 40 }} />
      </Svg>
      <Text name="Tagline" font="Inter-Medium" size={44} color="#9fb2c8" y={830} tracking={40}
        animate={{ text: perWord({ from: { y: 26, opacity: 0 }, easing: 'easeOutCubic', each: '90ms', delay: 2.1, duration: '0.6s' }) }}>
        CUSTOM CONTROLLERS. MADE YOURS.
      </Text>
    </Composition>
  );
});
