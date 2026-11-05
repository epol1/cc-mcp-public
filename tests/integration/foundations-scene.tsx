// F1/F2 integration scene: expression-library calls (text reveal spring + bezier, spring rig, marker bursts),
// grouped controls as one rig effect on the Controls null, and a custom <RigEffect> read by an expression.
import { scene, Composition, Solid, Text, Shape, Rect, Fill, RigEffect, Stack, spring, tween, perWord, perChar, control, expr } from 'ae-compose';

const SPIN = { name: 'aec Spin Test', params: [
  { kind: 'slider', name: 'Speed', default: 45, min: 0, max: 360 },
  { kind: 'checkbox', name: 'Reverse', default: false },
  { kind: 'group', name: 'Look', params: [{ kind: 'color', name: 'Tint', default: [1, 0.5, 0] }, { kind: 'popup', name: 'Mode', items: ['Calm', 'Wild'], default: 1 }] },
] } as const;

export default scene({ name: 'FoundationsTest', duration: '4s' }, () => {
  const delay = control('Delay', 0.3, { group: 'Title', min: 0, max: 2 });
  const accent = control('Accent', '#4683c4', { group: 'Title' });
  const each = control('Each', 0.09, { group: 'Title', min: 0, max: 0.4 });
  return (
    <Composition>
      <Solid id="bg" color="#0e1117" />
      <Stack gap={30}>
        <Text id="title" font="Inter-Black" size={140} color="#eef1f6"
          animate={{ text: perWord({ from: { y: 90, opacity: 0 }, spring: { damping: 13, stiffness: 170 }, each, delay }) }}>
          LIBRARY CALLS
        </Text>
        <Text id="sub" font="Inter-Medium" size={46} color="#9aa4b2"
          animate={{ text: perChar({ from: { opacity: 0, y: 20 }, easing: 'easeOutQuint', duration: '0.5s', each: '20ms', delay: 0.8, live: true }) }}>
          short, readable, live
        </Text>
        <Shape id="bar" animate={{ scale: spring({ from: [0, 100], delay: 0.6, damping: control('Bar Damping', 12, { group: 'Title', min: 5, max: 40 }), rig: 'expression' }) }}>
          <Rect size={[520, 12]} roundness={6} />
          <Fill color={accent} />
        </Shape>
      </Stack>
      <Shape id="spinner" position={[1700, 900]}
        rotation={expr('var e = effect("Spinner")("Speed"); (effect("Spinner")("Reverse").value ? -1 : 1) * e * time;')}>
        <Rect size={[80, 80]} roundness={12} />
        <Fill color="#f5a623" />
        <RigEffect def={SPIN as any} name="Spinner" values={{ Speed: 90, Tint: '#33cc99', Mode: 'Wild' }} />
      </Shape>
    </Composition>
  );
});
