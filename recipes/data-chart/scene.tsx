// Recipe: data chart (from showcase 05). Bars generated from `data` grow with staggered springs, value labels count
// up with their bar (expressions read the bar's live scale), a trend line draws on through the bar tops and dots pop
// on each point, then a callout lands on the last point. Params: title, subtitle, data ({ label, value } rows), max
// (axis top; 0 = from the data), callout ('' for none). Live controls: Bar Color, Line Color, Chart Delay.
import { scene, Composition, Solid, Shape, Rect, Ellipse, Path, Fill, Stroke, Trim, Text, Group, spring, tween, perWord, control, plus } from 'ae-compose';
import { BRAND } from './brand.ts';

const INK = BRAND.value('ink'), WHITE = BRAND.value('white'), MUTED = BRAND.value('muted');
const W = 1920, H = 1080;
const CHART = { left: 300, right: 1620, base: 860, top: 330 };

/** A round axis top above the largest value (4 gridline steps). */
const niceMax = (v: number) => {
  const step = Math.pow(10, Math.floor(Math.log10(Math.max(v, 1) / 4)));
  const nice = [1, 1.25, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7.5, 8, 10].map((m) => m * step).find((s) => s * 4 >= v * 1.05) ?? step * 10;
  return nice * 4;
};

export default scene({
  name: 'DataChart', width: W, height: H, fps: 30, duration: 6, bg: INK,
  params: {
    title: 'Custom builds per month', subtitle: 'First half of 2026 · units shipped',
    data: [{ label: 'JAN', value: 42 }, { label: 'FEB', value: 58 }, { label: 'MAR', value: 51 }, { label: 'APR', value: 77 }, { label: 'MAY', value: 96 }, { label: 'JUN', value: 128 }],
    max: 0, callout: '+205%',
  },
}, (p) => {
  const barColor = control('Bar Color', BRAND.value('accent'));
  const lineColor = control('Line Color', '#ffd23f');
  const delay = control('Chart Delay', 0.5, { min: 0, max: 2 });
  const data = p.data as { label: string; value: number }[];
  const MAX = p.max > 0 ? p.max : niceMax(Math.max(...data.map((d) => d.value)));
  const slot = (CHART.right - CHART.left) / data.length;
  const barW = slot * 0.56;
  const hOf = (v: number) => ((CHART.base - CHART.top) * v) / MAX;
  const cx = (i: number) => CHART.left + slot * (i + 0.5);
  const each = Math.min(0.09, 0.6 / Math.max(1, data.length - 1));
  const pts = data.map((d, i) => [cx(i), CHART.base - hOf(d.value)] as [number, number]);
  const last = pts[pts.length - 1];
  return (
    <Composition>
      <Solid name="BG" color={INK} tags={['bg']} />
      <Text id="title" name="Title" eg="Title" font={BRAND.fonts.bold} size={64} color={WHITE} align="left" anchor="left" x={CHART.left} y={170}
        animate={{ text: perWord({ from: { y: 40, opacity: 0 }, easing: 'easeOutQuint', duration: '0.7s', each: '70ms', delay: 0.1 }) }}>
        {p.title}
      </Text>
      <Text id="subtitle" name="Subtitle" font={BRAND.fonts.body} size={30} color={MUTED} align="left" anchor="left" x={CHART.left} y={232}
        animate={{ opacity: tween({ from: 0, duration: '0.5s', delay: 0.45 }) }}>
        {p.subtitle}
      </Text>
      {/* gridlines */}
      {[0, 1, 2, 3, 4].map((k) => (
        <Shape name={`Grid ${k}`} id={`grid${k}`} space="comp" opacity={k === 0 ? 60 : 14}>
          <Path points={[{ p: [CHART.left - 30, CHART.base - hOf((MAX * k) / 4)] }, { p: [CHART.right + 30, CHART.base - hOf((MAX * k) / 4)] }]} closed={false} />
          <Trim end={tween({ from: 0, to: 100, duration: '0.9s', delay: 0.15 + k * 0.06, easing: 'easeInOutCubic' })} />
          <Stroke color="#ffffff" width={k === 0 ? 3 : 2} />
        </Shape>
      ))}
      {/* bars + value labels that count up with them */}
      {data.map((d, i) => (
        <Shape id={`bar${i}`} name={`Bar ${d.label}`} position={[cx(i), CHART.base]} anchor={[0, 0]}
          animate={{ scale: spring({ from: [100, 0], to: [100, 100], delay: plus(delay, i * each), damping: 15, stiffness: 120 }) }}>
          <Rect size={[barW, hOf(d.value)]} position={[0, -hOf(d.value) / 2]} roundness={10} />
          <Fill color={barColor} />
        </Shape>
      ))}
      {data.map((d, i) => (
        <Text id={`val${i}`} name={`Value ${d.label}`} font={BRAND.fonts.bold} size={40} color={WHITE} x={cx(i)}
          expressions={{
            'ADBE Text Properties/ADBE Text Document': `Math.round(${d.value} * __AEC_LAYER(bar${i})__.transform.scale[1] / 100)`,
            'ADBE Transform Group/ADBE Position': `[value[0], ${CHART.base} - ${hOf(d.value)} * __AEC_LAYER(bar${i})__.transform.scale[1] / 100 - 34]`,
            'ADBE Transform Group/ADBE Opacity': `Math.min(100, __AEC_LAYER(bar${i})__.transform.scale[1] * 4)`,
          }}>
          0
        </Text>
      ))}
      {data.map((d, i) => (
        <Text name={`Label ${d.label}`} font={BRAND.fonts.bold} size={28} color={MUTED} tracking={120} x={cx(i)} y={CHART.base + 46}
          animate={{ opacity: tween({ from: 0, duration: '0.4s', delay: 0.3 + i * each }), y: spring({ from: 24, delay: 0.3 + i * each, damping: 18 }) }}>
          {d.label}
        </Text>
      ))}
      {/* trend line through the bar tops, then dots */}
      <Shape name="Trend" id="trend" space="comp">
        <Path points={pts.map((pt) => ({ p: pt }))} closed={false} />
        <Trim end={tween({ from: 0, to: 100, duration: '1.4s', delay: 1.6, easing: 'easeInOutCubic' })} />
        <Stroke color={lineColor} width={6} cap="round" join="round" />
      </Shape>
      {pts.map((pt, i) => (
        <Shape name={`Dot ${data[i].label}`} position={pt} animate={{ scale: spring({ from: 0, delay: 1.6 + (1.4 * i) / Math.max(1, data.length - 1), damping: 9, stiffness: 260 }) }}>
          <Ellipse size={[26, 26]} />
          <Fill color={lineColor} />
          <Group>
            <Ellipse size={[44, 44]} />
            <Fill color={lineColor} opacity={25} />
          </Group>
        </Shape>
      ))}
      {p.callout ? (
        <Text id="callout" name="Callout" eg="Callout" font={BRAND.fonts.bold} size={44} color={lineColor} x={last[0]} y={Math.max(CHART.top - 40, last[1] - 120)}
          animate={{ text: perWord({ from: { y: 20, opacity: 0 }, easing: 'easeOutBack', duration: '0.5s', each: '60ms', delay: 3.1 }) }}>
          {p.callout}
        </Text>
      ) : null}
    </Composition>
  );
});
