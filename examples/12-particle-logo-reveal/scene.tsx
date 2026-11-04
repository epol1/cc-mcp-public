// Showcase 12 — Particle logo reveal synced to markers: an energy trail (CC Particle World following a null)
// sweeps across, the logo wipes on behind it, sparks fire at the comp marker "reveal", and at "explode" the logo
// bursts into particles textured from the logo layer itself (layer-reference texture) while it fades out. Move
// either marker in AE and the bursts follow (they are read by expression). Live controls: Sparks and Logo Burst
// presets' key parameters.
import { scene, Composition, Solid, Shape, Rect, GradientFill, Null, Svg, Effect, Text, ParticleWorld, keys, perWord, expr } from 'ae-compose';

const INK = '#05060a';

export default scene({ name: 'ParticleReveal', width: 1920, height: 1080, fps: 30, duration: '6s', bg: INK }, () => (
  <Composition markers={[{ t: 2.0, comment: 'reveal' }, { t: 4.4, comment: 'explode' }]}>
    <Solid name="BG" color={INK} />
    <Shape name="Glow">
      <Rect size={[1920, 1080]} />
      <GradientFill type="radial" start={[0, 0]} end={[1000, 0]} stops={[{ offset: 0, color: '#132036' }, { offset: 1, color: INK }]} />
    </Shape>
    {/* The sweep: a null crossing the logo; the trail and the wipe follow it. */}
    <Null id="sweep" name="Sweep" animate={{ position: keys({ t: 0.3, v: [260, 560], easing: 'easeInOutCubic' }, { t: 2.0, v: [1660, 520] }) }} />
    <Svg id="logo" src="../../assets/logo/cc-logo.svg" name="Logo" width={960} y={500} color="#f2f4f8"
      expressions={{ 'ADBE Transform Group/ADBE Opacity': 'var m = thisComp.marker.key("explode").time; linear(time, m, m + 0.25, 100, 0);' }}>
      {/* Linear Wipe completion tracks the sweep's x: the logo appears right behind the particles. */}
      <Effect name="Linear Wipe" params={{ 'Transition Completion': expr('var x = __AEC_LAYER(sweep)__.transform.position[0]; linear(x, 260, 1660, 100, 0);'), 'Wipe Angle': 270, Feather: 80 }} />
      <Effect name="Glow" params={{ 'Glow Radius': 30, 'Glow Intensity': keys({ t: 1.9, v: 0.2, easing: 'easeOutQuad' }, { t: 2.1, v: 1.6, easing: 'easeOutCubic' }, { t: 3.2, v: 0.4 }) }} />
    </Svg>
    {/* The trail stops emitting when the sweep ends; its last particles fade out on their own. */}
    <ParticleWorld id="trail" preset="energyTrail" emitter={{ follow: 'sweep' }} controls={false}
      params={{ 'Birth Rate': keys({ t: 0, v: 3, hold: true }, { t: 2.05, v: 0, hold: true }) }} />
    <ParticleWorld id="sparks" preset="sparks" burst={{ at: { marker: 'reveal' }, duration: '0.2s', rate: 9 }} params={{ 'Position X': 0.22, 'Position Y': -0.02 }} />
    {/* At "explode": the logo becomes the particle texture and blows apart. The texture is its own hidden copy of the
        logo (a precomp), because the visible logo fades out at that moment. */}
    <ParticleWorld id="burst" name="Logo Burst" preset="logoDisintegrate" y={500}
      texture={<Svg src="../../assets/logo/cc-logo.svg" width={960} color="#f2f4f8" />} textureSize={[1000, 600]}
      burst={{ at: { marker: 'explode' }, duration: '0.35s', rate: 28 }}
      params={{ 'Position Y': -0.02, 'Birth Size': 0.07, 'Death Size': 0.02, 'Velocity': 0.9, 'Gravity': 0.25, 'Radius X': 0.24, 'Radius Y': 0.13 }} />
    <Text name="Tagline" font="Inter-Medium" size={44} color="#9fb2c8" tracking={240} y={905}
      expressions={{ 'ADBE Transform Group/ADBE Opacity': 'var m = thisComp.marker.key("explode").time; linear(time, m - 0.2, m + 0.2, 100, 0);' }}
      animate={{ text: perWord({ from: { y: 24, opacity: 0 }, easing: 'easeOutCubic', each: '90ms', delay: 2.4, duration: '0.6s' }) }}>
      MADE YOURS.
    </Text>
  </Composition>
));
