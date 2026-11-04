// Showcase 07 — Transition pack, each transition a reusable precomp: three cover wipes (bar wipe, circle iris,
// slices) that hide the cut under a color, a MASK reveal (the next shot grows in through an animated rounded mask)
// and a ZOOM-through (punch-in with blur and a flash). Six shots. Live control: Transition Color.
import { scene, Composition, Series, Footage, Precomp, Shape, Rect, Ellipse, Fill, Stroke, GradientFill, Text, Solid, Mask, Effect, keys, tween, perWord, control } from 'ae-compose';
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

/** Mask reveal: shot B grows in from the centre through a rounded-rect mask (Mask Expansion animated) over shot A. */
function MaskReveal({ a, b, name, from, color }: { a: string; b: string; name: string; from?: number; color: ControlRef | string }) {
  const D = 1.0;
  return (
    <Precomp name={name} from={from} width={W} height={H} compDuration={D}>
      <Footage src={a} fit="cover" />
      <Footage src={b} fit="cover" animate={{ scale: tween({ from: 112, to: 100, duration: D, easing: 'easeOutCubic' }) }}>
        <Mask rect={{ x: 0, y: 0, width: W, height: H, roundness: 260 }} feather={30}
          expansion={keys({ t: 0, v: -560, easing: 'easeInOutCubic' }, { t: D * 0.85, v: 40 })} />
      </Footage>
      {/* An accent frame riding the mask edge (same timing), so the reveal reads even between similar shots. */}
      <Shape name="Mask Edge" animate={{ opacity: keys({ t: D * 0.7, v: 100, easing: 'easeInQuad' }, { t: D * 0.9, v: 0 }) }}>
        <Rect size={keys({ t: 0, v: [W - 1120, 1], easing: 'easeInOutCubic' }, { t: D * 0.85, v: [W + 80, H + 80] })} roundness={260} />
        <Stroke color={color} width={14} />
      </Shape>
    </Precomp>
  );
}

/** Zoom-through: shot A punches in (scale + blur), a flash at the cut, shot B settles out of the zoom. */
function ZoomThrough({ a, b, name, from }: { a: string; b: string; name: string; from?: number }) {
  const D = 1.0, C = D / 2;
  return (
    <Precomp name={name} from={from} width={W} height={H} compDuration={D}>
      <Footage src={b} fit="cover" from={C} animate={{ scale: tween({ from: 180, to: 100, duration: C, easing: 'easeOutCubic' }) }}>
        <Effect name="Fast Box Blur" params={{ 'Blur Radius': keys({ t: 0, v: 40, easing: 'easeOutCubic' }, { t: C, v: 0 }), 'Repeat Edge Pixels': 1 }} />
      </Footage>
      <Footage src={a} fit="cover" duration={C} animate={{ scale: tween({ from: 100, to: 260, duration: C, easing: 'easeInCubic' }) }}>
        <Effect name="Fast Box Blur" params={{ 'Blur Radius': keys({ t: 0, v: 0, easing: 'easeInCubic' }, { t: C, v: 40 }), 'Repeat Edge Pixels': 1 }} />
      </Footage>
      <Solid name="Flash" color="#ffffff" animate={{ opacity: keys({ t: C - 0.12, v: 0, easing: 'easeInQuad' }, { t: C, v: 70, easing: 'easeOutQuad' }, { t: C + 0.2, v: 0 }) }} />
    </Precomp>
  );
}

const SHOTS = [
  { src: '../../assets/footage/Controllers.mp4', title: 'COLOURS' },
  { src: '../../assets/footage/xbox.mov', title: 'FINISHES' },
  { src: '../../assets/footage/stills/04.png', title: 'SHELLS' },
  { src: '../../assets/footage/stills/05.png', title: 'BUTTONS' },
  { src: '../../assets/footage/stills/02.png', title: 'DESIGN' },
  { src: '../../assets/footage/stills/06.png', title: 'YOURS' },
];

export default scene({ name: 'TransitionPack', width: W, height: H, fps: 30, duration: '12s', bg: '#000000' }, () => {
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
      {/* Transitions straddle each cut (2, 4, 6, 8, 10 s): they start half their length before it. */}
      <MaskReveal name="Transition: Mask Reveal" color={color} a={SHOTS[3].src} b={SHOTS[4].src} from={8 - 0.5} />
      <ZoomThrough name="Transition: Zoom Through" a={SHOTS[4].src} b={SHOTS[5].src} from={10 - 0.5} />
      <BarWipe name="Transition: Bar Wipe" color={color} from={2 - T / 2} />
      <Iris name="Transition: Iris" color={color} from={4 - T / 2} />
      <Slices name="Transition: Slices" color={color} from={6 - T / 2} />
    </Composition>
  );
});
