// Showcase 03 — Lower third with exposed controls over footage. Name and Title are Essential Graphics
// text fields; Accent Color, In Delay and Out Delay are live controls (the out animation retimes live).
import { scene, Composition, Footage, Solid, Text, Shape, Rect, Fill, SafeArea, Align, Stack, keys, tween, perChar, perWord, control } from 'ae-compose';

export default scene({ name: 'LowerThird', width: 1920, height: 1080, fps: 30, duration: '6s', bg: '#000000' }, () => {
  const accent = control('Accent Color', '#4683c4');
  const inDelay = control('In Delay', 0.4, { min: 0, max: 3 });
  const outDelay = control('Out Delay', 4.6, { min: 1, max: 5.6 });
  return (
    <Composition>
      <Footage src="../../assets/footage/virtualinsanity.mp4" fit="cover" muted animate={{ scale: tween({ from: 108, to: 100, duration: '6s', easing: 'easeOutSine' }) }} />
      <Solid name="Shade" color="#000000" opacity={28} />
      <SafeArea kind="title">
        <Align at="bottomLeft">
          <Stack gap={14} align="start">
            <Shape name="Bar" anchor="left"
              animate={{ scale: keys({ t: 0.25, v: [0, 100], easing: 'easeOutExpo' }, { t: 1.0, v: [100, 100] }, { t: 4.55, v: [100, 100], easing: 'easeInExpo' }, { t: 5.0, v: [0, 100] }) }}>
              <Rect size={[420, 8]} roundness={4} />
              <Fill color={accent} />
            </Shape>
            <Text name="Name" eg="Name" font="Inter-Bold" size={68} color="#ffffff" align="left" anchor="left"
              animate={{ text: [perChar({ from: { y: 50, opacity: 0 }, spring: { damping: 14, stiffness: 190 }, each: '22ms', delay: inDelay }), perChar({ from: { y: -30, opacity: 0 }, easing: 'easeInCubic', duration: '0.3s', each: '10ms', delay: outDelay, direction: 'out' })] }}>
              Jordan Reyes
            </Text>
            <Text name="Title" eg="Title" font="Inter-Medium" size={34} color="#d7dde6" align="left" anchor="left" tracking={30}
              animate={{ text: [perWord({ from: { x: -30, opacity: 0 }, easing: 'easeOutQuint', duration: '0.6s', each: '60ms', delay: 0.75 }), perWord({ from: { opacity: 0 }, easing: 'easeInCubic', duration: '0.25s', each: '30ms', delay: 4.5, direction: 'out' })] }}>
              CREATIVE DIRECTOR, CUSTOM CONTROLLERZ
            </Text>
          </Stack>
        </Align>
      </SafeArea>
    </Composition>
  );
});
