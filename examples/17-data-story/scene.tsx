// Showcase 17 — "One million rides": a data story for a (fictional) city bike share's first year, built from the
// data viz kit (K2) and the transitions library (K4). Every chart is live: its numbers, colors and timing sit on one
// effect on the chart's controller null ("Rides Chart", "Purpose Chart", "Stations Chart"), so the year can be
// re-cut with new figures in Effect Controls, no rebuild.
//
// Beats (each a named scene, so ripple edits work):
//   Hook  — the number: 1,000,000 counts up, then the line under it says what it is.
//   Climb — how it happened: rides per month rise; May, when the bridge lanes opened, is called out.
//           In: the big number shrinks into the chart's corner as its label (hand-off: the same layer travels).
//   Who   — who rides: half of all trips are commutes (donut, the commute slice highlighted).
//           In: the area's fill keeps rising and floods the frame (liquid wipe in the area's color).
//   Next  — what's next: new stations go where riders asked (bars, the top district highlighted). Holds to the end.
//           In: the donut recedes and the bars come forward (push through).
import { scene, Composition, Solid, Text, Counter, AreaChart, DonutChart, BarChart, Beats, Beat, HandOff, LiquidWipe, PushThrough, perWord } from 'ae-compose';
// The showcases' brand values (examples/brand.ts) as plain hex: each chart keeps its colors on its own effect.
const INK = '#0b0d12', WHITE = '#eef1f6', MUTED = '#8b95a5', ACCENT = '#4683c4';
const TIDE = '#1b3354'; // the area fill, the liquid wipe and the Who beat's ground: one color carries across the cut
const WARM = '#ffd23f';
const SMALL = { labelSize: 28, tickSize: 26, valueSize: 32, legendSize: 26, calloutSize: 30 };

/** Beat headline: words rise in; with `exit`, they leave just before the beat ends (`end` = the beat's length). */
const headline = (id: string, text: string, end?: number, y = 150) => (
  <Text id={id} font="Inter-Bold" size={64} color={WHITE} align="left" anchor="left" x={192} y={y}
    animate={{ text: [
      perWord({ from: { y: 40, opacity: 0 }, easing: 'easeOutQuint', duration: '0.7s', each: '70ms', delay: 0.25 }),
      ...(end !== undefined ? [perWord({ from: { y: -24, opacity: 0 }, easing: 'easeInCubic', duration: '0.3s', each: '30ms', delay: 0.15, anchor: 'end', direction: 'out' })] : []),
    ] }}>
    {text}
  </Text>
);

// The hook number. It is the hand-off element, so it lives through Hook and Climb: in Climb it is the chart's label.
const million = Counter({
  id: 'hook.count', name: 'Rides Total', value: 1000000, from: 0, delay: 0.2, countDuration: 1.5, easing: 'easeOutExpo',
  font: 'Inter-Black', size: 230, tracking: -20, color: WHITE,
});

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const RIDES = [24, 27, 33, 39, 78, 96, 112, 118, 109, 97, 86, 92]; // thousands per month (sums to ~1.0M)

export default scene({ name: 'DataStory', width: 1920, height: 1080, fps: 30, duration: '16s', bg: INK }, () => (
  <Composition>
    <Solid id="bg" name="BG" color={INK} tags={['bg']} />
    <Beats>
      <Beat name="Hook" duration={3.4}>
        <Text id="hook.sub" font="Inter-Medium" size={56} color={MUTED} y={650}
          animate={{ text: [
            perWord({ from: { y: 30, opacity: 0 }, easing: 'easeOutQuint', duration: '0.6s', each: '60ms', delay: 1.3 }),
            perWord({ from: { opacity: 0 }, easing: 'easeInCubic', duration: '0.25s', each: '20ms', delay: 0.05, anchor: 'end', direction: 'out' }),
          ] }}>
          rides in Pedal City's first year
        </Text>
      </Beat>

      <HandOff id="toCorner" name="Hand-off: total to label" element={million}
        from={{ x: 960, y: 500, scale: 100 }} to={{ x: 1540, y: 158, scale: 34 }} arc={-60} duration={0.9} easing="easeInOutCubic" />

      <Beat name="Climb" duration={5.4}>
        {headline('climb.title', 'Rides tripled when the bridge lanes opened', undefined, 150)}
        <AreaChart id="rides" name="Rides Chart" x={192} y={270} width={1536} height={700}
          data={RIDES.map((v, i) => ({ label: MONTHS[i], value: v }))} format={{ suffix: 'k' }} colors={[ACCENT]}
          area={{ gradient: false, opacity: 42 }} theme={SMALL} lineWidth={5}
          animation={{ delay: 0.5, duration: 1.6, exit: false }}
          annotate={{ at: 'MAY', text: 'Bridge lanes open', offset: [-150, -110], after: 0.25, color: WARM }} />
      </Beat>

      <LiquidWipe id="tide" name="Liquid: the tide rises" direction="up" color={TIDE} duration={0.9} />

      <Beat name="Who" duration={4.4}>
        <Solid id="who.bg" name="Who BG" color={TIDE} tags={['bg']} />
        {headline('who.title', 'Half of all rides are commutes', undefined, 150)}
        <DonutChart id="purpose" name="Purpose Chart" x={192} y={260} width={1536} height={720}
          data={[{ label: 'COMMUTE', value: 52 }, { label: 'ERRANDS', value: 27 }, { label: 'LEISURE', value: 21 }]}
          colors={[WARM, ACCENT, '#8fb4e3']} theme={SMALL}
          animation={{ delay: 0.45, exit: false }} highlight={{ at: 'COMMUTE', after: 0.35 }} />
      </Beat>

      <PushThrough id="forward" name="Push: next" duration={1.0} />

      <Beat name="Next" duration={5.6}>
        <Solid id="next.bg" name="Next BG" color={INK} tags={['bg']} />
        {headline('next.title', 'Next spring: 40 new stations, where riders asked', undefined, 150)}
        <BarChart id="stations" name="Stations Chart" orientation="horizontal" x={192} y={270} width={1536} height={640}
          data={[{ label: 'RIVERSIDE', value: 1840 }, { label: 'OLD TOWN', value: 1520 }, { label: 'HARBOR', value: 1210 }, { label: 'UPTOWN', value: 860 }, { label: 'EASTGATE', value: 640 }]}
          format={{ suffix: ' requests' }} tickFormat={{}} colors={[ACCENT]} theme={SMALL} valueLabels
          animation={{ delay: 0.6, stagger: 0.08, duration: 0.8 }} highlight={{ at: 'RIVERSIDE', after: 0.3 }} />
      </Beat>
    </Beats>
  </Composition>
));
