// Every cloner distribution plus follow, step, stagger (time remap), a linear falloff with blur, and data channels
// from a CSV. Small counts: tests/integration/p5/distributions.ts checks the positions against aec-lib.
import { scene, Composition, Solid, Shape, Rect, Ellipse, Fill, Text, Null, Cloner, line, grid, circle, onPath, scatter, sphere, helix, noise, falloff, stagger, follow, step, csv, field, tween, keys } from 'ae-compose';

const Dot = (c: string) => [<Shape><Ellipse size={[40, 40]} /><Fill color={c} /></Shape>];
const Pop = [<Shape id="pop.s" animate={{ scale: tween({ from: 0, to: 100, duration: 0.4, easing: 'easeOutBack' }) }}><Rect size={[50, 50]} roundness={8} /><Fill color="#e8a33d" /></Shape>];

export default scene({ name: 'DistTest', width: 1920, height: 1080, duration: '4s', bg: '#0b0d12' }, () => (
  <Composition>
    <Solid id="bg" color="#0b0d12" />
    <Cloner id="ln" count={6} size={[60, 60]} distribute={line({ spacing: 80, angle: 30 })} position={[300, 200]} effectors={[step({ position: 25, rotation: 15 })]} rotation={7} of={Dot('#4683c4')} />
    <Cloner id="gr" count={12} size={[60, 60]} distribute={grid({ columns: 4, gap: [70, 60] })} position={[960, 200]} effectors={[stagger({ each: 0.1, order: 'center' })]} of={Pop} />
    <Cloner id="ci" count={8} size={[60, 60]} distribute={circle({ radius: 150, start: 20, arc: 270, orient: true })} position={[1600, 260]} motion={{ speed: 30 }} of={Dot('#7a5cff')} />
    <Cloner id="pa" count={7} size={[60, 60]} distribute={onPath({ d: 'M200 600 C 500 400 800 800 1100 600', start: 10, end: 90, show: true })} of={Dot('#2bb3a3')} />
    <Cloner id="sc" count={9} size={[60, 60]} distribute={scatter({ width: 500, height: 260, jitter: 0.5 })} position={[1500, 750]} seed={3}
      effectors={[falloff({ shape: 'linear', center: [1500, 750], angle: 0, width: 300, scale: [50, 120], opacity: [40, 100], blur: [8, 0] })]} of={Dot('#e05a7a')} />
    <Cloner id="lead" count={5} size={[60, 60]} effectors={[follow({ lag: 0.15 })]}
      position={keys({ t: 0, v: [200, 950] }, { t: 3, v: [900, 950], easing: 'easeInOutSine' }) as any} of={Dot('#f2f4f8')} />
    <Cloner id="dat" count={3} size={[160, 60]} distribute={line({ spacing: 200 })} position={[1300, 980]} data={csv('data/rows.csv')}
      of={[<Text id="dat.t" eg="Tag" font="Inter-Bold" size={34} color="#ffffff">tag</Text>]} />
    <Cloner id="sp" count={20} size={[40, 40]} distribute={sphere({ radius: 160 })} position={[400, 760, 0]} of={Dot('#4683c4')} />
    <Cloner id="hx" count={16} size={[40, 40]} distribute={helix({ radius: 90, height: 260, turns: 2 })} position={[700, 760, 0]} of={Dot('#7a5cff')} />
  </Composition>
));
