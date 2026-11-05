// Showcase 10 — 3D product hero (Advanced 3D): the Custom Controllerz controller model on a shadow-catching floor,
// an extruded + bevelled wordmark behind it, HDRI environment light plus a shadow-casting key, and an orbiting
// camera that racks focus from the wordmark to the controller (distances measured live from the moving camera).
// Live controls: Orbit Speed, Key Light, Blur Amount, Rack Focus Time.
import { scene, Composition, Solid, Text, Model, Light, OrbitCamera, keys, spring, tween, wiggle, control, expr } from 'ae-compose';

export default scene({ name: 'ProductHero3D', width: 1920, height: 1080, fps: 30, duration: '6s', bg: '#0c0e13', renderer: 'advanced3d' }, () => {
  const orbit = control('Orbit Speed', 5, { min: -40, max: 40 });
  const key = control('Key Light', 110, { min: 0, max: 300 });
  const blur = control('Blur Amount', 70, { min: 0, max: 300 });
  const rack = control('Rack Focus Time', 1.4, { min: 0, max: 5 });
  // Focus distance = camera → wordmark, easing to camera → controller at the rack time.
  const focus = expr([
    'var cam = thisLayer.toWorld([0, 0, 0]);',
    'var w = __AEC_LAYER(word)__, p = __AEC_LAYER(pad)__;',
    'var d1 = length(cam, w.toWorld(w.anchorPoint)), d2 = length(cam, p.toWorld(p.anchorPoint));',
    'var t0 = __AEC_CONTROL(Rack Focus Time)__;',
    'ease(time, t0, t0 + 0.9, d1, d2);',
  ].join('\n'), [rack]);
  return (
    <Composition>
      {/* Floor: a large plane that receives shadows. */}
      <Solid id="floor" name="Floor" color="#15181f" width={4000} height={4000} scale={800} threeD position={[960, 700, 0]} rotationX={90}
        material={{ acceptsShadows: true, specular: 20, shininess: 10 }} />
      {/* Wordmark behind the product, extruded with a convex bevel. */}
      <Text id="word" name="Wordmark" font="Inter-Black" size={150} color="#4683c4" tracking={-10} threeD position={[960, 440, 900]}
        geometry={{ extrusion: 90, bevel: { style: 'convex', depth: 8 } }} material={{ castsShadows: true, specular: 60, shininess: 40, metal: 30 }}
        animate={{ y: spring({ from: 600, damping: 16, stiffness: 90 }), opacity: tween({ from: 0, duration: '0.6s' }) }}>
        BUILT DIFFERENT
      </Text>
      {/* The product: lying back at an angle, slowly turning and floating. */}
      <Model id="pad" name="Controller" src="../../assets/3d/controller/controller_cc_v2.glb" position={[960, 580, -60]} scale={6.5} rotationX={-62}
        material={{ castsShadows: true }}
        animate={{
          rotationY: keys({ t: 0, v: -28, easing: 'easeInOutSine' }, { t: 6, v: 24 }),
          y: wiggle(0.35, 10, { seed: 3 }),
          scale: spring({ from: 5.2, to: 6.5, delay: 0.3, damping: 14, stiffness: 110 }),
        }} />
      <Light id="env" kind="environment" hdri="../../assets/hdri/controller_studio_1k.hdr" intensity={70} />
      <Light id="keylight" name="Key" kind="spot" intensity={key} color="#fff4e6" position={[400, -200, -900]} lookAt="pad"
        coneAngle={70} coneFeather={60} castsShadows shadowDarkness={70} shadowDiffusion={30} />
      <Light id="rim" name="Rim" kind="point" intensity={60} color="#7fb3ff" position={[1700, 300, 900]} />
      <OrbitCamera target={[960, 540, 200]} radius={2000} height={430} speed={orbit} startAngle={-14} lens={50}
        dof focusDistance={focus} aperture={blur} />
    </Composition>
  );
});
