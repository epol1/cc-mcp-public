// Procedural backgrounds (P4) scene for the AE integration check: every preset in its own short beat, colored from
// one brand (the accent is a live control), with film grain over everything. Check in AE: each layer carries one
// "aec <Name>" effect whose Speed and colors change the look live, the grids scroll without a seam, the sweep
// crosses the title, and "Accent Color" on the Controls layer re-colors every background that uses it.
import { scene, Composition, Series, Solid, Text, brand, tween } from 'ae-compose';
import { GradientField, MeshGradient, FilmGrain, LightSweep, BokehField, DotGrid, LineGrid } from 'ae-compose';

const B = brand({
  colors: { ink: '#0b0d12', deep: '#1b2a6b', violet: '#5b2a86', accent: '#4683c4', warm: '#f28c6b' },
  live: ['accent'],
});

const label = (id: string, text: string) => (
  <Text id={id} font="Inter-SemiBold" size={56} color="#eef1f6" tracking={60} y={540}
    animate={{ opacity: tween({ from: 0, duration: '0.4s', delay: 0.3 }) }}>
    {text}
  </Text>
);

export default scene({ name: 'Backgrounds', width: 1920, height: 1080, fps: 30, duration: '21s', bg: '#0b0d12' }, () => (
  <Composition>
    <Series>
      <Series.Sequence name="Gradient Field" duration="3s">
        <GradientField id="gradient" palette={[B.colors.deep, B.colors.accent]} speed={4} />
        {label('t-gradient', 'GRADIENT FIELD')}
      </Series.Sequence>
      <Series.Sequence name="Mesh Gradient" duration="3s">
        <MeshGradient id="mesh" palette={[B.colors.deep, B.colors.violet, B.colors.accent, B.colors.warm]} speed={2} />
        {label('t-mesh', 'MESH GRADIENT')}
      </Series.Sequence>
      <Series.Sequence name="Kaleido Mesh" duration="3s">
        <MeshGradient id="kaleido" palette={[B.colors.violet, B.colors.warm, B.colors.deep, B.colors.accent]} speed={1.5} kaleido={{ mirroring: 'Flower', size: 40 }} />
        {label('t-kaleido', 'KALEIDA')}
      </Series.Sequence>
      <Series.Sequence name="Bokeh" duration="3s">
        <Solid id="bokeh-bg" color="#0b0d12" tags={['bg']} />
        <BokehField id="bokeh" count={28} seed={3} palette={['#ffd8a8', B.colors.accent, '#ffffff']} />
        {label('t-bokeh', 'BOKEH FIELD')}
      </Series.Sequence>
      <Series.Sequence name="Dot Grid" duration="3s">
        <GradientField id="dots-bg" palette={[B.colors.ink, B.colors.deep]} radial />
        <DotGrid id="dots" gap={44} dot={6} dotOpacity={28} speed={2} />
        {label('t-dots', 'DOT GRID')}
      </Series.Sequence>
      <Series.Sequence name="Line Grid" duration="3s">
        <Solid id="lines-bg" color="#0e1426" tags={['bg']} />
        <LineGrid id="lines" palette={[B.colors.accent]} gap={90} line={2} lineOpacity={30} angle={90} speed={3} />
        {label('t-lines', 'LINE GRID')}
      </Series.Sequence>
      <Series.Sequence name="Light Sweep" duration="3s">
        <Solid id="sweep-bg" color="#141821" tags={['bg']} />
        {label('t-sweep', 'LIGHT SWEEP')}
        <LightSweep id="sweep" at={0.6} sweep={1.6} beam={180} intensity={80} />
      </Series.Sequence>
    </Series>
    <FilmGrain id="grain" amount={5} />
  </Composition>
));
