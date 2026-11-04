// Showcase 07 — Transition pack: three cover transitions built as reusable precomps (bar wipe, circle iris,
// slice) cutting between four shots. Each transition covers the frame at its midpoint, where the shot underneath
// changes. Live control: Transition Color. Swap shots or reorder the <Series>: the transitions follow.
import { scene, Composition, Series, Footage, Precomp, Shape, Rect, Ellipse, Fill, GradientFill, Text, keys, spring, tween, perWord, control } from 'ae-compose';
import type { ControlRef } from 'ae-compose';

const W = 1920, H = 1080, T = 0.8; // transition length (s); the cut is at T / 2

/** Three staggered bars sweep across (left → right), covering then uncovering. */
function BarWipe({ color, name, from }: { color: ControlRef | string; name: string; from?: number }) {
  return (
    <Precomp name={name} from={from} width={W} height={H} compDuration={T}>
      {[0, 1, 2].map((i) => (
        <Shape name={`Bar ${i + 1}`} space="comp"
          animate={{ x: keys({ t: i * 0.05, v: -W, easing: 'easeOutCubic' }, { t: 0.25 + i * 0.05, v: 0 }, { t: 0.45 + i * 0.05, v: 0, easing: 'easeInCubic' }, { t: 0.7 + i * 0.05, v: W }) }}>
          <Rect size={[W, H / 3 + 2]} position={[W / 2, (H / 3) * i + H / 6]} />
          <Fill color={color} />
        </Shape>
      ))}
    </Precomp>
  );
}

/** A circle grows from the centre to cover the frame, then shrinks away. */
function Iris({ color, name, from }: { color: ControlRef | string; name: string; from?: number }) {
  return (
    <Precomp name={name} from={from} width={W} height={H} compDuration={T}>
      <Shape name="Iris" animate={{ scale: keys({ t: 0, v: 0, easing: 'easeInCubic' }, { t: T / 2, v: 100, hold: true }, { t: T / 2 + 1 / 30, v: 100, easing: 'easeOutCubic' }, { t: T, v: 0 }) }}>
        <Ellipse size={[2300, 2300]} />
        <Fill color={color} />
      </Shape>
    </Precomp>
  );
}

/** Eight vertical slices grow top-down with a stagger, then retract bottom-up. */
function Slices({ color, name, from }: { color: ControlRef | string; name: string; from?: number }) {
  const n = 8, sw = W / n;
  return (
    <Precomp name={name} from={from} width={W} height={H} compDuration={T}>
      {Array.from({ length: n }, (_, i) => (
        <Shape name={`Slice ${i + 1}`} position={[sw * i + sw / 2, 0]} anchor={[0, 0]}
          animate={{ scale: keys({ t: i * 0.025, v: [100, 0], easing: 'easeInCubic' }, { t: T / 2, v: [100, 100], hold: true }, { t: T / 2 + 1 / 30 + i * 0.02, v: [100, 100], easing: 'easeOutCubic' }, { t: T - 0.02 * (n - 1 - i) - 0.02, v: [100, 0] }) }}>
          <Rect size={[sw + 2, H]} position={[0, H / 2]} />
          <Fill color={color} />
        </Shape>
      ))}
    </Precomp>
  );
}

const SHOTS = [
  { src: '../../assets/footage/stills/04.png', title: 'SHELLS' },
  { src: '../../assets/footage/stills/05.png', title: 'BUTTONS' },
  { src: '../../assets/footage/Controllers.mp4', title: 'COLOURS' },
  { src: '../../assets/footage/xbox.mov', title: 'YOURS' },
];

export default scene({ name: 'TransitionPack', width: W, height: H, fps: 30, duration: '8s', bg: '#000000' }, () => {
  const color = control('Transition Color', '#4683c4');
  return (
    <Composition>
      <Series>
        {SHOTS.map((s) => (
          <Series.Sequence duration="2s" name={s.title}>
            <Footage src={s.src} fit="cover" muted animate={{ scale: tween({ from: 100, to: 106, duration: '2s', easing: 'linear' }) }} />
            <Shape name="Shade" space="comp">
              <Rect size={[W, 600]} position={[W / 2, H - 300]} />
              <GradientFill start={[W / 2, H - 600]} end={[W / 2, H]} stops={[{ offset: 0, color: '#000000', opacity: 0 }, { offset: 1, color: '#000000', opacity: 0.7 }]} />
            </Shape>
            <Text font="Inter-Black" size={150} color="#ffffff" tracking={80} y={870}
              animate={{ text: perWord({ from: { y: 60, opacity: 0 }, spring: { damping: 15, stiffness: 180 }, delay: 0.45 }) }}>
              {s.title}
            </Text>
          </Series.Sequence>
        ))}
      </Series>
      {/* Transitions straddle each cut (2 s, 4 s, 6 s): they start T/2 before it. */}
      <BarWipe name="Transition: Bar Wipe" color={color} from={2 - T / 2} />
      <Iris name="Transition: Iris" color={color} from={4 - T / 2} />
      <Slices name="Transition: Slices" color={color} from={6 - T / 2} />
    </Composition>
  );
});
