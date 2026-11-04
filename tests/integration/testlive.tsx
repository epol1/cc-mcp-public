import { scene, Composition, Solid, Text, tween, control } from 'ae-compose';
export default scene({ name: 'TestLive', width: 1280, height: 720, fps: 30, duration: '4s' }, () => (
  <Composition>
    <Solid color="#101216" />
    <Text id="t" name="Title" font="Inter-Bold" size={90} y={360}
      animate={{ y: tween({ from: control('Rise', 80), duration: control('Rise Duration', 0.6), delay: control('Rise Delay', 0.2), easing: 'easeOutCubic' }) }}>LIVE</Text>
  </Composition>
));