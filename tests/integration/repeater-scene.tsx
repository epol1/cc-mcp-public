// Cloner mode "repeater": 1000 identical copies of a shape master in one shape layer (grid), plus a spinning ring.
import { scene, Composition, Solid, Shape, Rect, Ellipse, Fill, Cloner, grid, circle } from 'ae-compose';

export default scene({ name: 'RepeaterTest', duration: '4s', bg: '#0b0d12', params: { count: 1000 } }, (p) => (
  <Composition>
    <Solid id="bg" color="#0b0d12" />
    <Cloner id="field" mode="repeater" count={p.count} distribute={grid({ columns: 50, gap: [34, 34] })} position={[960, 540]}
      of={[<Shape><Rect size={[24, 24]} roundness={6} /><Fill color="#4683c4" /></Shape>]} />
    <Cloner id="ring" mode="repeater" count={36} distribute={circle({ radius: 220 })} motion={{ speed: 20 }}
      of={[<Shape><Ellipse size={[18, 18]} /><Fill color="#e8a33d" /></Shape>]} />
  </Composition>
));
