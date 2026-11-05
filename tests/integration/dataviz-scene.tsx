// K2 data viz integration scene (1920×1080, 30 fps, 10 s): every chart of the kit, live from one rig effect each.
// Beat 1: monthly revenue bars grow, June is highlighted and called out, then the chart leaves.
// Beat 2: the player curve fills in (area + draw-on), a counter lands on 1.2M, a pie splits the platforms.
// Beat 3 (final, holds): revenue mix donut, retention lines, stacked quarters and grouped regions arrive in turn.
// Check in AE: the "Bar Chart"/"Area Chart"/… effects on the chart nulls (Revenue Chart, Players Chart, …): change a
// value and the bar/point/segment, its label and the axis follow; "Highlight" picks a bar live.
import { scene, Composition, Sequence, Solid, Text, perWord, keys } from 'ae-compose';
import { BarChart, StackedBarChart, LineChart, AreaChart, DonutChart, PieChart, Counter } from 'ae-compose';

const INK = '#0c0f15';
const SMALL = { labelSize: 26, tickSize: 26, valueSize: 30, legendSize: 26 };

// Beat headline: words rise in; it leaves with its beat (the final one holds).
const headline = (id: string, text: string, exit = true) => (
  <Text id={id} font="Inter-Bold" size={64} color="#f2f4f8" align="left" anchor="left" x={192} y={160}
    animate={{ text: [
      perWord({ from: { y: 40, opacity: 0 }, easing: 'easeOutQuint', duration: '0.7s', each: '70ms', delay: 0.1 }),
      ...(exit ? [perWord({ from: { y: -24, opacity: 0 }, easing: 'easeInCubic', duration: '0.3s', each: '30ms', delay: 0.45, anchor: 'end', direction: 'out' })] : []),
    ] }}>
    {text}
  </Text>
);
// In at `t`, out with the beat (ends at 3.3 s).
const inOut = (t: number) => keys({ t, v: 0, easing: 'easeOutCubic' }, { t: t + 0.35, v: 100 }, { t: 2.9, v: 100, easing: 'easeInCubic' }, { t: 3.2, v: 0 });

export default scene({ name: 'DataVizKit', width: 1920, height: 1080, fps: 30, duration: '10s', bg: INK }, () => (
  <Composition>
    <Solid id="bg" name="BG" color={INK} />

    <Sequence name="Revenue" from={0} duration={4.1}>
      {headline('rev.title', 'Revenue doubled in six months')}
      <BarChart id="rev" name="Revenue Chart" x={192} y={240} width={1536} height={732}
        data={[{ label: 'JAN', value: 42 }, { label: 'FEB', value: 58 }, { label: 'MAR', value: 51 }, { label: 'APR', value: 77 }, { label: 'MAY', value: 96 }, { label: 'JUN', value: 128 }]}
        format={{ prefix: '$', suffix: 'k' }}
        animation={{ delay: 0.45, stagger: 0.07, duration: 0.8 }}
        highlight={{ at: 'JUN', after: 0.2 }}
        annotate={{ at: 'JUN', text: 'Record month', offset: [-90, -70], after: 0.3 }} />
    </Sequence>

    <Sequence name="Players" from={3.8} duration={3.3}>
      {headline('play.title', 'Players keep coming back')}
      <AreaChart id="players" name="Players Chart" x={192} y={240} width={960} height={732}
        data={[310, 380, 360, 450, 520, 610, 690, 820].map((v, i) => ({ label: `W${i + 1}`, value: v }))}
        format={{ suffix: 'k' }} colors={['#3bceac']}
        animation={{ delay: 0.35, duration: 1.3 }} />
      <Counter id="play.count" value={1.2} decimals={1} suffix="M" from={0} delay={0.5} countDuration={1.4}
        font="Inter-Black" size={150} color="#f2f4f8" x={1460} y={330} animate={{ opacity: inOut(0.45) }} />
      <Text id="play.countLabel" font="Inter-Medium" size={34} color="#8b95a5" x={1460} y={430}
        animate={{ text: perWord({ from: { y: 20, opacity: 0 }, easing: 'easeOutExpo', duration: '0.6s', each: '60ms', delay: 0.9 }), opacity: inOut(0) }}>
        monthly players
      </Text>
      <PieChart id="platforms" name="Platforms Chart" x={1192} y={500} width={536} height={472}
        data={[{ label: 'CONSOLE', value: 46 }, { label: 'PC', value: 34 }, { label: 'MOBILE', value: 20 }]}
        colors={['#4683c4', '#9b7bff', '#ff8c42']} theme={SMALL}
        animation={{ delay: 1.0 }} />
    </Sequence>

    <Sequence name="Glance" from={6.8}>
      {headline('glance.title', '2026 at a glance', false)}
      <DonutChart id="mix" name="Mix Chart" x={192} y={240} width={748} height={360}
        data={[{ label: 'HARDWARE', value: 46 }, { label: 'SOFTWARE', value: 31 }, { label: 'SERVICES', value: 23 }]}
        center={{ format: { prefix: '$', suffix: 'k' } }} theme={SMALL}
        animation={{ delay: 0.3 }} highlight={{ at: 'SOFTWARE', after: 0.4 }} />
      <LineChart id="retention" name="Retention Chart" x={980} y={240} width={748} height={360}
        series={[{ name: '2025', values: [100, 62, 48, 41, 37, 35] }, { name: '2026', values: [100, 74, 63, 57, 54, 52] }]}
        labels={['D1', 'D7', 'D14', 'D30', 'D60', 'D90']} format={{ suffix: '%' }} colors={['#8b95a5', '#ffd23f']}
        lineWidth={5} theme={SMALL} animation={{ delay: 0.55, duration: 1.2 }} />
      <StackedBarChart id="quarters" name="Quarters Chart" x={192} y={630} width={748} height={342}
        series={[{ name: 'Hardware', values: [9, 11, 12, 14] }, { name: 'Software', values: [6, 7, 8, 10] }, { name: 'Services', values: [4, 5, 6, 8] }]}
        labels={['Q1', 'Q2', 'Q3', 'Q4']} format={{ prefix: '$', suffix: 'k' }} colors={['#4683c4', '#ffd23f', '#ee4266']} theme={SMALL}
        animation={{ delay: 0.8, stagger: 0.1 }} />
      <BarChart id="regions" name="Regions Chart" orientation="horizontal" x={980} y={630} width={748} height={342}
        series={[{ name: '2025', values: [38, 44, 21] }, { name: '2026', values: [52, 57, 36] }]}
        labels={['EU', 'NA', 'APAC']} format={{ prefix: '$', suffix: 'k' }} colors={['#8b95a5', '#3bceac']} theme={SMALL}
        animation={{ delay: 1.05, stagger: 0.09 }} />
    </Sequence>
  </Composition>
));
