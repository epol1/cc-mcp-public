// K4 integration scene: four beats, each handing off to the next with a different transition grown from the scene.
//   Hook → Grow: the accent bar under "EVERY CUT" stretches across and opens into the blue panel the next beat lives on
//   (ShapeWipe, grow 'xy').
//   Grow → Shot: the camera flies into the white dot beside "GROWS OUT"; the next beat is inside it (ZoomThrough).
//   Shot → End: an orange liquid edge sweeps the end card in (LiquidWipe) while the small accent dot under "OF THE SHOT"
//   travels on an arc to sit beside the logo (HandOff, same boundary).
// Live: every transition has one rig effect on its controller null (Progress keys, amounts); beats are named scenes.
import { scene, Composition, Solid, Shape, Rect, Ellipse, Fill, Text, spring, tween, perWord, perChar } from 'ae-compose';
import { Beats, Beat, ShapeWipe, ZoomThrough, LiquidWipe, HandOff } from 'ae-compose';

const NAVY = '#0b0e14', BLUE = '#3f7fd0', ORANGE = '#ff7a2e', WHITE = '#f3f5f8';

// Elements the transitions take from the scene (rendered in their beat AND passed to the transition).
const bar = <Shape id="hook.bar" y={640} animate={{ scale: spring({ from: [0, 100], delay: 0.55, damping: 16, stiffness: 150 }) }}>
  <Rect size={[560, 12]} roundness={6} />
  <Fill color={BLUE} />
</Shape>;
const dot = <Shape id="grow.dot" x={1460} y={540} animate={{ scale: spring({ from: 0, delay: 0.9, damping: 13, stiffness: 170 }) }}>
  <Ellipse size={[190, 190]} />
  <Fill color={WHITE} />
</Shape>;

export default scene({ name: 'TransitionsK4', width: 1920, height: 1080, fps: 30, duration: '11.6s', bg: NAVY }, () => (
  <Composition>
    <Beats>
      <Beat name="Hook" duration={3}>
        <Solid id="hook.bg" color={NAVY} />
        <Text id="hook.title" font="Inter-Black" size={170} tracking={-20} color={WHITE} y={470}
          animate={{ text: perWord({ from: { y: 120, opacity: 0 }, spring: { damping: 13, stiffness: 170 }, each: '90ms', delay: 0.15 }) }}>
          EVERY CUT
        </Text>
        {bar}
      </Beat>

      <ShapeWipe id="wipe" name="Wipe: bar to panel" shape={bar} grow="xy" duration={0.8} easing="easeInOutQuart" />

      <Beat name="Grow" duration={3.6}>
        <Text id="grow.title" font="Inter-Black" size={150} tracking={-15} color={WHITE} x={760} y={540}
          animate={{ text: perWord({ from: { x: -60, opacity: 0 }, easing: 'easeOutExpo', duration: '0.7s', each: '110ms', delay: 0.45 }) }}>
          GROWS OUT
        </Text>
        {dot}
      </Beat>

      <ZoomThrough id="zoom" name="Zoom: into the dot" through={dot} duration={0.9} easing="easeInOutCubic" settle={88} />

      <Beat name="Shot" duration={4}>
        <Solid id="shot.bg" color="#121722" />
        <Text id="shot.title" font="Inter-Black" size={160} tracking={-15} color={WHITE} y={500}
          animate={{ text: perWord({ from: { y: 90, opacity: 0 }, spring: { damping: 15, stiffness: 160 }, each: '90ms', delay: 0.7 }) }}>
          OF THE SHOT
        </Text>
      </Beat>

      <LiquidWipe id="liquid" name="Liquid: to the end card" color={ORANGE} direction="right" amplitude={120} duration={0.9} />
      <HandOff id="handoff" name="Hand-off: accent dot" duration={0.9} arc={140}
        element={<Shape id="accent" animate={{ scale: spring({ from: 0, delay: 1.5, damping: 12, stiffness: 200 }) }}><Ellipse size={[34, 34]} /><Fill color={ORANGE} /></Shape>}
        from={{ x: 960, y: 650 }} to={{ x: 560, y: 452, scale: 150 }} />

      <Beat name="End" duration={3.6}>
        <Solid id="end.bg" color={NAVY} />
        <Text id="end.logo" font="Inter-Black" size={140} tracking={-25} color={WHITE} x={1000} y={470}
          animate={{ text: perChar({ from: { y: 60, opacity: 0 }, spring: { damping: 14, stiffness: 190 }, each: '28ms', delay: 0.75 }) }}>
          ae-compose
        </Text>
        <Text id="end.tag" font="Inter-Medium" size={46} color="#9fb0c6" tracking={20} x={960} y={600}
          animate={{ text: perWord({ from: { y: 24, opacity: 0 }, easing: 'easeOutCubic', duration: '0.5s', each: '70ms', delay: 1.15 }), opacity: tween({ from: 0, to: 100, duration: '0.3s', delay: 1.1 }) }}>
          transitions that grow out of the scene
        </Text>
      </Beat>
    </Beats>
  </Composition>
));
