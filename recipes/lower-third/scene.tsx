// Recipe: lower third (from showcase 03 / SKILL.md 4.2). Name and role build in over an accent bar, hold, and leave
// together; In Delay and Out Delay are live controls that retime the whole lower third. Over a footage plate (the
// `plate` param) or, without one, a neutral placeholder backdrop so it builds anywhere.
// Params: person, role, plate. Live controls: Accent Color (brand), In Delay, Out Delay. EG text: Name, Role.
import { scene, Composition, Footage, Text, Shape, Rect, GradientFill, Fill, SafeArea, Align, Stack, tween, perChar, perWord, control, plus } from 'ae-compose';
import { BRAND } from './brand.ts';

export default scene({
  name: 'LowerThird', width: 1920, height: 1080, fps: 30, duration: 6, bg: '#000000',
  params: { person: 'Jordan Reyes', role: 'CREATIVE DIRECTOR, CUSTOM CONTROLLERZ', plate: '' },
}, (p) => {
  const accent = BRAND.colors.accent;
  const inDelay = control('In Delay', 0.4, { min: 0, max: 3 });
  const outDelay = control('Out Delay', 4.6, { min: 1, max: 5.6 });
  return (
    <Composition>
      {p.plate
        ? <Footage id="plate" src={p.plate} fit="cover" muted animate={{ scale: tween({ from: 108, to: 100, duration: 6, easing: 'easeOutSine' }) }} />
        : (
          <Shape id="plate" name="Plate (placeholder)" tags={['bg']}>
            <Rect size={[1920, 1080]} />
            <GradientFill type="radial" start={[260, -180]} end={[1500, 0]} stops={[{ offset: 0, color: '#46526a' }, { offset: 0.6, color: '#1b2029' }, { offset: 1, color: '#0b0d12' }]} />
          </Shape>
        )}
      {/* Legibility: a soft dark gradient under the lower third instead of darkening the whole shot. */}
      <Shape name="Lower Shade" space="comp">
        <Rect size={[1920, 540]} position={[960, 810]} />
        <GradientFill start={[960, 560]} end={[960, 1080]} stops={[{ offset: 0, color: '#000000', opacity: 0 }, { offset: 1, color: '#000000', opacity: 0.75 }]} />
      </Shape>
      <SafeArea kind="title">
        <Align at="bottomLeft">
          <Stack gap={14} align="start">
            {/* Everything is timed off the two controls (plus() offsets), so dragging In/Out Delay moves the whole lower third. */}
            <Shape name="Bar" anchor="left"
              animate={{ scale: tween({ from: [0, 100], to: [100, 100], duration: '0.75s', delay: plus(inDelay, -0.15), easing: 'easeOutExpo' }),
                opacity: tween({ from: 100, to: 0, duration: '0.35s', delay: plus(outDelay, -0.05), easing: 'easeInCubic' }) }}>
              <Rect size={[420, 8]} roundness={4} />
              <Fill color={accent} />
            </Shape>
            <Text id="person" name="Name" eg="Name" font={BRAND.fonts.bold} size={68} color="#ffffff" align="left" anchor="left"
              animate={{ text: [perChar({ from: { y: 50, opacity: 0 }, spring: { damping: 14, stiffness: 190 }, each: '22ms', delay: inDelay }), perChar({ from: { y: -30, opacity: 0 }, easing: 'easeInCubic', duration: '0.3s', each: '10ms', delay: outDelay, direction: 'out' })] }}>
              {p.person}
            </Text>
            <Text id="role" name="Role" eg="Role" font={BRAND.fonts.body} size={34} color="#d7dde6" align="left" anchor="left" tracking={30}
              animate={{ text: [perWord({ from: { x: -30, opacity: 0 }, easing: 'easeOutQuint', duration: '0.6s', each: '60ms', delay: plus(inDelay, 0.35) }), perWord({ from: { opacity: 0 }, easing: 'easeInCubic', duration: '0.25s', each: '30ms', delay: plus(outDelay, -0.1), direction: 'out' })] }}>
              {p.role}
            </Text>
          </Stack>
        </Align>
      </SafeArea>
    </Composition>
  );
});
