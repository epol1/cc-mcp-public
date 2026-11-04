// Showcase 02 — Logo reveal: the Custom Controllerz SVG draws on (trim paths), fills, settles with a spring and
// blooms (Glow); a light sweep crosses it (gradient shine matted to the logo), then the tagline and its rules
// draw out. Live controls: Draw Duration, Glow Amount, Logo Color.
import { scene, Composition, Solid, Shape, Rect, Path, GradientFill, Stroke, Trim, Text, Svg, Effect, spring, tween, keys, perWord, control } from 'ae-compose';

const INK = '#07090d';

export default scene({ name: 'LogoReveal', width: 1920, height: 1080, fps: 30, duration: '5s', bg: INK }, () => {
  const draw = control('Draw Duration', 1.5, { min: 0.3, max: 4 });
  const glow = control('Glow Amount', 40, { min: 0, max: 150 });
  const color = control('Logo Color', '#4683c4');
  return (
    <Composition>
      <Solid name="BG" color={INK} />
      <Shape name="Backlight">
        <Rect size={[1920, 1080]} />
        <GradientFill type="radial" start={[0, -60]} end={[1000, 0]} stops={[{ offset: 0, color: '#17263f' }, { offset: 0.6, color: '#0c121c' }, { offset: 1, color: INK }]} />
      </Shape>
      <Svg id="logo" src="../../assets/logo/cc-logo.svg" name="Logo" width={980} y={470}
        color={color} stroke={{ color, width: 3 }}
        draw={tween({ from: 0, to: 100, duration: draw, delay: 0.15, easing: 'easeInOutCubic' })}
        fillOpacity={tween({ from: 0, to: 100, duration: '0.6s', delay: 1.35, easing: 'easeOutCubic' })}
        animate={{ scale: spring({ from: 94, delay: 1.3, damping: 13, stiffness: 140 }) }}>
        <Effect name="Glow" params={{ 'Glow Threshold': 55, 'Glow Radius': glow, 'Glow Intensity': keys({ t: 1.35, v: 0, easing: 'easeOutQuad' }, { t: 1.75, v: 0.9, easing: 'easeInOutSine' }, { t: 2.8, v: 0.2 }) }} />
      </Svg>
      {/* Shine: a soft diagonal band crossing the logo once, visible only where the logo is. */}
      <Shape name="Shine" y={470} blend="ADD" matte={{ layer: 'logo', type: 'alpha', showSource: true }} rotation={18}
        animate={{ x: keys({ t: 2.0, v: 260, easing: 'easeInOutCubic' }, { t: 2.9, v: 1660 }) }}>
        <Rect size={[220, 1400]} />
        <GradientFill start={[-110, 0]} end={[110, 0]} stops={[{ offset: 0, color: '#ffffff', opacity: 0 }, { offset: 0.5, color: '#ffffff', opacity: 0.55 }, { offset: 1, color: '#ffffff', opacity: 0 }]} />
      </Shape>
      <Text name="Tagline" font="Inter-Medium" size={40} color="#a9bbd0" y={880} tracking={260}
        animate={{ text: perWord({ from: { y: 24, opacity: 0 }, easing: 'easeOutCubic', each: '90ms', delay: 2.2, duration: '0.6s' }) }}>
        CUSTOM CONTROLLERS. MADE YOURS.
      </Text>
      {/* Rules either side of the tagline, drawing outward. */}
      {[-1, 1].map((side) => (
        <Shape name={side < 0 ? 'Rule L' : 'Rule R'} space="comp" opacity={45}>
          <Path points={[{ p: [960 + side * 590, 878] }, { p: [960 + side * 770, 878] }]} closed={false} />
          <Trim end={tween({ from: 0, to: 100, duration: '0.7s', delay: 2.5, easing: 'easeOutCubic' })} />
          <Stroke color="#a9bbd0" width={2} />
        </Shape>
      ))}
    </Composition>
  );
});
