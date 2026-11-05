// P3 integration scene: a curve draws itself on (DrawOn, tapered head, round cap) and an orange dot rides it
// (FollowPath, auto-orient) with a motion trail (Trail); a white chevron circles a loop with ghost copies (Echo,
// progress live from an expression); a shape morphs circle → star → rounded square (Morph chain, matched vertices).
import { scene, Composition, Solid, Shape, Ellipse, Path, Fill, Text, expr, perWord, control } from 'ae-compose';
import { FollowPath, Trail, Echo, DrawOn, Morph } from 'ae-compose';

const CURVE = 'M140 820 C 520 260 860 980 1180 560 S 1640 220 1780 420';
const LOOP = 'M1500 760 C 1500 690 1600 640 1680 640 C 1760 640 1840 690 1840 760 C 1840 830 1760 880 1680 880 C 1600 880 1500 830 1500 760 Z';
const CIRCLE = 'M0 -150 C 83 -150 150 -83 150 0 C 150 83 83 150 0 150 C -83 150 -150 83 -150 0 C -150 -83 -83 -150 0 -150 Z';
const STAR = 'M0 -165 L39 -54 L157 -51 L63 21 L97 134 L0 66 L-97 134 L-63 21 L-157 -51 L-39 -54 Z';
const SQUIRCLE = 'M-120 -140 L120 -140 C 131 -140 140 -131 140 -120 L140 120 C 140 131 131 140 120 140 L-120 140 C -131 140 -140 131 -140 120 L-140 -120 C -140 -131 -131 -140 -120 -140 Z';

export default scene({ name: 'PathsP3', width: 1920, height: 1080, fps: 30, duration: '6s', bg: '#0b0e14' }, () => {
  const ride = control('Ride Duration', 2.2, { min: 0.5, max: 5 });
  return (
    <Composition>
      <Solid id="bg" color="#0b0e14" />
      <DrawOn id="curve" d={CURVE} color="#3f7fd0" width={10} taper={[0, 30]} duration={1.6} delay={0.2} easing="easeInOutCubic" />
      <Trail id="trail" count={8} lag={0.03} opacity={[55, 0]} endScale={60}>
        <FollowPath id="rider" d={CURVE} duration={ride} delay={0.5} easing="easeInOutCubic">
          <Shape><Ellipse size={[34, 34]} /><Fill color="#ff7a2e" /></Shape>
        </FollowPath>
      </Trail>
      <Echo id="echo" count={3} lag={0.14}>
        <FollowPath id="looper" d={LOOP} progress={expr('(time * 28) % 100')} rotationOffset={0} show={{ color: '#2a3344', width: 2, dash: [6, 10] }}>
          <Shape><Path points={[{ p: [-16, -14] }, { p: [16, 0] }, { p: [-16, 14] }]} closed /><Fill color="#f3f5f8" /></Shape>
        </FollowPath>
      </Echo>
      <Morph id="morph" x={420} y={330} shapes={[CIRCLE, STAR, SQUIRCLE]} duration={0.7} hold={0.6} delay={2.4} easing="easeInOutQuint" fill="#3f7fd0" />
      <Text id="caption" font="Inter-Medium" size={44} color="#9fb0c6" x={960} y={980}
        animate={{ text: perWord({ from: { y: 20, opacity: 0 }, easing: 'easeOutCubic', duration: '0.5s', each: '80ms', delay: 0.6 }) }}>
        follow · trail · draw on · morph
      </Text>
    </Composition>
  );
});
