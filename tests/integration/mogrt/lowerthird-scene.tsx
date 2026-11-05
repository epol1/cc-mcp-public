// A lower third for Premiere: transparent (no background layer), sequence-sized, two EG text fields and one control.
import { scene, Composition, Text, Shape, Rect, Fill, SafeArea, Align, Stack, spring, tween, perChar, control } from 'ae-compose';

export default scene({ name: 'AecMogrtLowerThird', width: 1920, height: 1080, fps: 30, duration: '5s', params: { person: 'Jordan Reyes', role: 'CREATIVE DIRECTOR' }, lint: { ignore: ['reading-time'] } }, (p) => {
  const accent = control('Accent Color', '#4683c4');
  return (
    <Composition>
      <SafeArea kind="title">
        <Align at="bottomLeft">
          <Stack gap={14} align="start">
            <Shape id="bar" anchor="left" animate={{ scale: spring({ from: [0, 100], delay: 0.2, damping: 18, stiffness: 160 }), opacity: tween({ to: 0, duration: '0.25s', delay: 4.4, easing: 'easeInCubic' }) }}>
              <Rect size={[420, 8]} roundness={4} />
              <Fill color={accent} />
            </Shape>
            <Text id="person" eg="Name" font="Inter-Bold" size={68} align="left" anchor="left"
              animate={{ text: perChar({ from: { y: 50, opacity: 0 }, spring: { damping: 14, stiffness: 190 }, each: '22ms', delay: 0.2 }) }}>
              {p.person}
            </Text>
            <Text id="role" eg="Role" font="Inter-Medium" size={34} color="#d7dde6" align="left" anchor="left" tracking={30}
              animate={{ opacity: tween({ from: 0, duration: '0.5s', delay: 0.6 }) }}>
              {p.role}
            </Text>
          </Stack>
        </Align>
      </SafeArea>
    </Composition>
  );
});
