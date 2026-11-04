// Showcase 03 — Lower third with exposed controls over footage. Name and Title are Essential Graphics
// text fields; Accent Color, In Delay and Out Delay are live controls (the out animation retimes live).
// The footage push-in scale is relative to the cover fit (100 = exactly covering the frame).
import { scene, Composition, Footage, Text, Shape, Rect, Fill, GradientFill, SafeArea, Align, Stack, tween, perChar, perWord, control, plus } from 'ae-compose';

export default scene({ name: 'LowerThird', width: 1920, height: 1080, fps: 30, duration: '6s', bg: '#000000' }, () => {
  const accent = control('Accent Color', '#4683c4');
  const inDelay = control('In Delay', 0.4, { min: 0, max: 3 });
  const outDelay = control('Out Delay', 4.6, { min: 1, max: 5.6 });
  return (
    <Composition>
      <Footage src="../../assets/footage/virtualinsanity.mp4" fit="cover" muted animate={{ scale: tween({ from: 108, to: 100, duration: '6s', easing: 'easeOutSine' }) }} />
      {/* Legibility: a soft dark gradient under the lower third instead of darkening the whole shot. */}
      <Shape name="Lower Shade" space="comp">
        <Rect size={[1920, 540]} position={[960, 810]} />
        <GradientFill start={[960, 560]} end={[960, 1080]} stops={[{ offset: 0, color: '#000000', opacity: 0 }, { offset: 1, color: '#000000', opacity: 0.75 }]} />
      </Shape>
      <SafeArea kind="title">
        <Align at="bottomLeft">
          <Stack gap={14} align="start">
            {/* Every element is timed off the two controls (plus() offsets), so dragging In/Out Delay moves the whole lower third together. */}
            <Shape name="Bar" anchor="left"
              animate={{ scale: tween({ from: [0, 100], to: [100, 100], duration: '0.75s', delay: plus(inDelay, -0.15), easing: 'easeOutExpo' }),
                opacity: tween({ from: 100, to: 0, duration: '0.35s', delay: plus(outDelay, -0.05), easing: 'easeInCubic' }) }}>
              <Rect size={[420, 8]} roundness={4} />
              <Fill color={accent} />
            </Shape>
            <Text name="Name" eg="Name" font="Inter-Bold" size={68} color="#ffffff" align="left" anchor="left"
              animate={{ text: [perChar({ from: { y: 50, opacity: 0 }, spring: { damping: 14, stiffness: 190 }, each: '22ms', delay: inDelay }), perChar({ from: { y: -30, opacity: 0 }, easing: 'easeInCubic', duration: '0.3s', each: '10ms', delay: outDelay, direction: 'out' })] }}>
              Jordan Reyes
            </Text>
            <Text name="Title" eg="Title" font="Inter-Medium" size={34} color="#d7dde6" align="left" anchor="left" tracking={30}
              animate={{ text: [perWord({ from: { x: -30, opacity: 0 }, easing: 'easeOutQuint', duration: '0.6s', each: '60ms', delay: plus(inDelay, 0.35) }), perWord({ from: { opacity: 0 }, easing: 'easeInCubic', duration: '0.25s', each: '30ms', delay: plus(outDelay, -0.1), direction: 'out' })] }}>
              CREATIVE DIRECTOR, CUSTOM CONTROLLERZ
            </Text>
          </Stack>
        </Align>
      </SafeArea>
    </Composition>
  );
});
