// <Vector>: EPS artwork converted to an editable shape layer (Create Shapes from Vector Layer), scaled to a width
// and drawn on with Trim Paths added by an edit later. Uses the hand-built fixture's own EPS.
import { scene, Composition, Solid, Vector, tween } from 'ae-compose';

export default scene({ name: 'VectorTest', width: 1920, height: 1080, fps: 30, duration: '2s', bg: '#0b0d12' }, () => (
  <Composition>
    <Solid name="BG" color="#0b0d12" />
    <Vector id="map" name="Map" src="../../assets/handmade/languages_proj/(Footage)/map2.eps" width={700}
      animate={{ opacity: tween({ from: 0, duration: '0.6s' }) }} />
  </Composition>
));
