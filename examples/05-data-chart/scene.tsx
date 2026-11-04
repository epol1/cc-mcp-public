// Showcase 05 — Data-driven chart: bars generated from an array grow with staggered springs, value labels count
// up with their bar (expressions read the bar's live scale), a trend line draws on through the bar tops and
// dots pop on each point. Change DATA and rebuild; tweak Bar Color / Line Color / Chart Delay live (all bars
// keep their stagger: delay = plus(Chart Delay, i × 0.09)).
import { scene, Composition, Solid, Shape, Rect, Ellipse, Path, Fill, Stroke, Trim, Text, Group, spring, tween, perWord, control, plus } from 'ae-compose';

const DATA = [
  { label: 'JAN', value: 42 }, { label: 'FEB', value: 58 }, { label: 'MAR', value: 51 },
  { label: 'APR', value: 77 }, { label: 'MAY', value: 96 }, { label: 'JUN', value: 128 },
];
const INK = '#0c0f15';
const W = 1920, H = 1080;
const CHART = { left: 300, right: 1620, base: 860, top: 330 };
const MAX = 140;

export default scene({ name: 'DataChart', width: W, height: H, fps: 30, duration: '6s', bg: INK }, () => {
  const barColor = control('Bar Color', '#4683c4');
  const lineColor = control('Line Color', '#ffd23f');
  const delay = control('Chart Delay', 0.5, { min: 0, max: 2 });
  const slot = (CHART.right - CHART.left) / DATA.length;
  const barW = slot * 0.56;
  const hOf = (v: number) => ((CHART.base - CHART.top) * v) / MAX;
  const cx = (i: number) => CHART.left + slot * (i + 0.5);
  const each = 0.09;
  const pts = DATA.map((d, i) => [cx(i), CHART.base - hOf(d.value)] as [number, number]);
  return (
    <Composition>
      <Solid name="BG" color={INK} />
      <Text font="Inter-Bold" size={64} color="#f2f4f8" align="left" anchor="left" x={CHART.left} y={170}
        animate={{ text: perWord({ from: { y: 40, opacity: 0 }, easing: 'easeOutQuint', duration: '0.7s', each: '70ms', delay: 0.1 }) }}>
        Custom builds per month
      </Text>
      <Text font="Inter-Medium" size={30} color="#8b95a5" align="left" anchor="left" x={CHART.left} y={232}
        animate={{ opacity: tween({ from: 0, duration: '0.5s', delay: 0.45 }) }}>
        First half of 2026 · units shipped
      </Text>
      {/* gridlines */}
      {[0, 35, 70, 105, 140].map((v, k) => (
        <Shape name={`Grid ${v}`} id={`grid${k}`} space="comp" opacity={k === 0 ? 60 : 14}>
          <Path points={[{ p: [CHART.left - 30, CHART.base - hOf(v)] }, { p: [CHART.right + 30, CHART.base - hOf(v)] }]} closed={false} />
          <Trim end={tween({ from: 0, to: 100, duration: '0.9s', delay: 0.15 + k * 0.06, easing: 'easeInOutCubic' })} />
          <Stroke color="#ffffff" width={k === 0 ? 3 : 2} />
        </Shape>
      ))}
      {/* bars + labels */}
      {DATA.map((d, i) => (
        <Shape id={`bar${i}`} name={`Bar ${d.label}`} position={[cx(i), CHART.base]} anchor={[0, 0]}
          animate={{ scale: spring({ from: [100, 0], to: [100, 100], delay: plus(delay, i * each), damping: 15, stiffness: 120 }) }}>
          <Rect size={[barW, hOf(d.value)]} position={[0, -hOf(d.value) / 2]} roundness={10} />
          <Fill color={barColor} />
        </Shape>
      ))}
      {DATA.map((d, i) => (
        <Text id={`val${i}`} name={`Value ${d.label}`} font="Inter-Bold" size={40} color="#f2f4f8" x={cx(i)}
          expressions={{
            'ADBE Text Properties/ADBE Text Document': `Math.round(${d.value} * __AEC_LAYER(bar${i})__.transform.scale[1] / 100)`,
            'ADBE Transform Group/ADBE Position': `[value[0], ${CHART.base} - ${hOf(d.value)} * __AEC_LAYER(bar${i})__.transform.scale[1] / 100 - 34]`,
            'ADBE Transform Group/ADBE Opacity': `Math.min(100, __AEC_LAYER(bar${i})__.transform.scale[1] * 4)`,
          }}>
          0
        </Text>
      ))}
      {DATA.map((d, i) => (
        <Text name={`Label ${d.label}`} font="Inter-SemiBold" size={28} color="#8b95a5" tracking={120} x={cx(i)} y={CHART.base + 46}
          animate={{ opacity: tween({ from: 0, duration: '0.4s', delay: 0.3 + i * each }), y: spring({ from: CHART.base + 70, delay: 0.3 + i * each, damping: 18 }) }}>
          {d.label}
        </Text>
      ))}
      {/* trend line through the bar tops, then dots */}
      <Shape name="Trend" id="trend" space="comp">
        <Path points={pts.map((p) => ({ p }))} closed={false} />
        <Trim end={tween({ from: 0, to: 100, duration: '1.4s', delay: 1.6, easing: 'easeInOutCubic' })} />
        <Stroke color={lineColor} width={6} cap="round" join="round" />
      </Shape>
      {pts.map((p, i) => (
        <Shape name={`Dot ${DATA[i].label}`} position={p} animate={{ scale: spring({ from: 0, delay: 1.6 + (1.4 * i) / (DATA.length - 1), damping: 9, stiffness: 260 }) }}>
          <Ellipse size={[26, 26]} />
          <Fill color={lineColor} />
          <Group>
            <Ellipse size={[44, 44]} />
            <Fill color={lineColor} opacity={25} />
          </Group>
        </Shape>
      ))}
      <Text font="Inter-Bold" size={44} color={lineColor} x={pts[pts.length - 1][0]} y={pts[pts.length - 1][1] - 120}
        animate={{ text: perWord({ from: { y: 20, opacity: 0 }, easing: 'easeOutBack', duration: '0.5s', each: '60ms', delay: 3.1 }) }}>
        +205%
      </Text>
    </Composition>
  );
});
