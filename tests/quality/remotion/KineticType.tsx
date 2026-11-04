/** @jsxImportSource react */
// The kinetic typography spec of examples/01-kinetic-type, written for Remotion (GOAL §6 quality-bar check).
// Same beats, timings, springs (Remotion's own spring()), staggers, exits, fonts and colors.
import React from 'react';
import { AbsoluteFill, Easing, interpolate, Sequence, spring, useCurrentFrame, useVideoConfig } from 'remotion';

const INK = '#0b0d12', WHITE = '#eef1f6', MUTED = '#8b95a5', ACCENT = '#4683c4';
const cubicIn = Easing.bezier(0.32, 0, 0.67, 0), cubicOut = Easing.bezier(0.33, 1, 0.68, 1), expoOut = Easing.bezier(0.16, 1, 0.3, 1);

/** Per-unit reveal: each unit gets progress p (spring or eased tween) after delay + i·each, and an optional exit. */
function Units(props: {
  text: string; by: 'word' | 'char'; style: React.CSSProperties;
  reveal: { each: number; delay: number; spring?: { damping: number; stiffness: number }; easing?: (t: number) => number; duration?: number; from: { y?: number; scale?: number; opacity?: number; rotation?: number; blur?: number; tracking?: number } };
  exit?: { start: number; each: number; duration: number; to: { y?: number; opacity?: number; blur?: number } };
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const units = props.by === 'word' ? props.text.split(/(\s+)/) : Array.from(props.text);
  let idx = -1;
  return (
    <div style={{ ...props.style, display: 'flex', justifyContent: 'center', whiteSpace: 'pre' }}>
      {units.map((u, k) => {
        if (/^\s+$/.test(u)) return <span key={k}>{u}</span>;
        idx++;
        const r = props.reveal;
        const f = frame - (r.delay + idx * r.each) * fps;
        const p = r.spring ? spring({ frame: f, fps, config: { damping: r.spring.damping, stiffness: r.spring.stiffness, mass: 1 } }) : interpolate(f, [0, (r.duration ?? 0.5) * fps], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: r.easing });
        const q = 1 - p; // amount of the "from" state still applied
        let y = (r.from.y ?? 0) * q, scale = 1 + ((r.from.scale ?? 100) / 100 - 1) * q, opacity = r.from.opacity !== undefined ? 1 - q * (1 - r.from.opacity / 100) : 1;
        let blur = (r.from.blur ?? 0) * q;
        const rot = (r.from.rotation ?? 0) * q, tracking = (r.from.tracking ?? 0) * q;
        if (props.exit) {
          const e = props.exit, fe = frame - (e.start + idx * e.each) * fps;
          const x = interpolate(fe, [0, e.duration * fps], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: cubicIn });
          y += (e.to.y ?? 0) * x; opacity *= 1 - x * (1 - (e.to.opacity ?? 100) / 100); blur += (e.to.blur ?? 0) * x;
        }
        return (
          <span key={k} style={{ display: 'inline-block', transform: `translateY(${y}px) scale(${scale}) rotate(${rot}deg)`, opacity, filter: blur > 0.01 ? `blur(${blur / 2}px)` : undefined, letterSpacing: tracking ? `${tracking / 1000}em` : undefined, transformOrigin: '50% 100%' }}>{u}</span>
        );
      })}
    </div>
  );
}

const col = (gap: number): React.CSSProperties => ({ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap, width: '100%', height: '100%' });
const font = (size: number, weight: number, color: string, tracking = 0): React.CSSProperties => ({ fontFamily: 'Inter', fontWeight: weight, fontSize: size, color, letterSpacing: `${tracking / 1000}em`, lineHeight: 0.78 });

export const KineticType: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sec = (s: number) => Math.round(s * fps);
  return (
    <AbsoluteFill style={{ background: `radial-gradient(1150px at 50% 46%, #1c2740 0%, #11151f 55%, ${INK} 100%)` }}>
      <Sequence from={0} durationInFrames={sec(2.4)}>
        <div style={col(70)}>
          <Units text="MAKE IT" by="word" style={font(190, 900, WHITE, -20)} reveal={{ each: 0.085, delay: 0.15, spring: { damping: 12, stiffness: 170 }, from: { y: 140, opacity: 0 } }}
            exit={{ start: 2.0, each: 0.012, duration: 0.25, to: { y: -40, opacity: 0, blur: 12 } }} />
          <Units text="MOVE" by="char" style={font(360, 900, ACCENT, -30)} reveal={{ each: 0.045, delay: 0.45, spring: { damping: 10, stiffness: 220 }, from: { scale: 0, opacity: 0 } }}
            exit={{ start: 2.05, each: 0.012, duration: 0.25, to: { y: -60, opacity: 0, blur: 14 } }} />
        </div>
      </Sequence>
      <Sequence from={sec(2.3)} durationInFrames={sec(2.4)}>
        <div style={col(26)}>
          <Units text="NATIVE." by="char" style={font(230, 900, WHITE)} reveal={{ each: 0, delay: 0, duration: 0.9, easing: expoOut, from: { tracking: 60, opacity: 0, blur: 6 } }}
            exit={{ start: 2.0, each: 0.01, duration: 0.3, to: { opacity: 0, blur: 10 } }} />
          <Units text="Real layers. Eased keyframes. Live controls." by="word" style={{ ...font(52, 500, MUTED), lineHeight: 1 }} reveal={{ each: 0.07, delay: 0.5, duration: 0.5, easing: cubicOut, from: { y: 30, opacity: 0 } }}
            exit={{ start: 2.0, each: 0.02, duration: 0.25, to: { opacity: 0 } }} />
        </div>
      </Sequence>
      <Sequence from={sec(4.6)}>
        <div style={col(30)}>
          <Units text="ae-compose" by="char" style={font(190, 900, WHITE, -10)} reveal={{ each: 0.028, delay: 0, spring: { damping: 12, stiffness: 190 }, from: { y: 70, opacity: 0, rotation: 8 } }} />
          <Underline />
          <Tagline />
        </div>
      </Sequence>
    </AbsoluteFill>
  );
};

const Underline: React.FC = () => {
  const frame = useCurrentFrame(), { fps } = useVideoConfig();
  const s = spring({ frame: frame - 0.45 * fps, fps, config: { damping: 16, stiffness: 150 } });
  return <div style={{ width: 820, height: 14, borderRadius: 7, background: ACCENT, transform: `scaleX(${s})` }} />;
};
const Tagline: React.FC = () => {
  const frame = useCurrentFrame(), { fps } = useVideoConfig();
  const y = 30 * (1 - spring({ frame: frame - 0.6 * fps, fps, config: { damping: 16, stiffness: 100 } }));
  const o = interpolate(frame, [0.6 * fps, 1.1 * fps], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: cubicOut });
  return <div style={{ ...font(48, 500, MUTED), lineHeight: 1, transform: `translateY(${y}px)`, opacity: o }}>Motion design, written in code.</div>;
};
