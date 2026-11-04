// Primitive test matrix for the inspector round-trip (tests/integration/roundtrip.ts): one of each primitive,
// every easing family, effects with params, masks, a matte, 3D camera/lights/materials and particles.
import { scene, Composition, Solid, Null, Text, Shape, Rect, Ellipse, Star, Path, Group, Fill, Stroke, Trim, Repeater, Effect, Mask, Camera, Light, ParticleWorld, tween, spring, keys } from 'ae-compose';

const EASINGS = ['linear', 'easeInQuad', 'easeOutCubic', 'easeInOutQuint', 'easeOutExpo', 'easeOutBack', 'easyEase', [0.2, 0.8, 0.3, 1] as [number, number, number, number]];

export default scene({ name: 'RoundTripMatrix', width: 1280, height: 720, fps: 30, duration: '3s', bg: '#101216' }, () => (
  <Composition>
    <Solid id="solid" name="Solid" color="#223344" opacity={80} />
    <Null id="null" name="Null" position={[100, 100]} rotation={15} />
    {EASINGS.map((e, i) => (
      <Shape id={`ease${i}`} name={`Ease ${typeof e === 'string' ? e : 'bezier'}`} position={[80 + i * 150, 600]}
        animate={{ y: tween({ from: 120, duration: 1, easing: e as any }), opacity: tween({ from: 0, to: 100, duration: 0.8, delay: 0.2, easing: e as any }) }}>
        <Rect size={[40, 40]} />
        <Fill color="#4683c4" />
      </Shape>
    ))}
    <Shape id="spring" name="Spring" position={[640, 360]} animate={{ scale: spring({ from: 0, damping: 10, stiffness: 160 }) }}>
      <Ellipse size={[80, 80]} />
      <Fill color="#ffd23f" />
    </Shape>
    <Shape id="shapes" name="Shapes" position={[300, 300]}>
      <Group name="Star Group" position={[20, 0]} rotation={10}>
        <Star type="star" points={6} outerRadius={60} innerRadius={30} />
        <Fill color="#ff5a8a" opacity={90} />
      </Group>
      <Path name="Pen" points={[{ p: [0, 0] }, { p: [120, 40], in: [-30, 0], out: [30, 0] }, { p: [200, 0] }]} closed={false} />
      <Trim start={10} end={keys({ t: 0, v: 0 }, { t: 1.2, v: 100, easing: 'easeInOutCubic' })} />
      <Stroke color="#2ec4b6" width={6} />
      <Repeater copies={3} position={[0, 50]} />
    </Shape>
    <Text id="text" name="Text" font="Inter-Bold" size={64} color="#eef1f6" tracking={40} position={[640, 160]}>ROUND TRIP</Text>
    <Solid id="fx" name="Effects" color="#808080" width={300} height={200} position={[1000, 300]}>
      <Effect name="Gaussian Blur" params={{ Blurriness: 12, 'Repeat Edge Pixels': 1 }} />
      <Effect name="Glow" params={{ 'Glow Radius': 40, 'Glow Intensity': keys({ t: 0, v: 0 }, { t: 1, v: 2, easing: 'easeOutCubic' }), 'Glow Threshold': 55 }} />
      <Effect name="Fill" params={{ Color: '#ff8000', Opacity: 50 }} />
      <Mask rect={{ x: 20, y: 20, width: 260, height: 160, roundness: 30 }} feather={10} expansion={-5} />
    </Solid>
    <Shape id="matte" name="Matte" position={[1000, 550]}><Ellipse size={[200, 200]} /><Fill color="#ffffff" /></Shape>
    <Solid id="matted" name="Matted" color="#7a3cff" width={300} height={300} position={[1000, 550]} matte={{ layer: 'matte', type: 'alpha' }} />
    <Solid id="card3d" name="3D Card" color="#4683c4" width={300} height={200} threeD position={[640, 360, 400]} rotationY={25}
      material={{ acceptsLights: true, castsShadows: true, specular: 40, shininess: 20 }} />
    <Light id="spot" name="Spot" kind="spot" intensity={130} color="#fff0e0" coneAngle={70} coneFeather={40} position={[300, 100, -600]} pointOfInterest={[640, 360, 400]} castsShadows shadowDarkness={60} />
    <Light id="amb" name="Ambient" kind="ambient" intensity={25} />
    <Camera id="cam" name="Camera" lens={50} dof focusDistance={1500} aperture={40} position={[640, 360, -1400]} pointOfInterest={[640, 360, 0]} />
    <ParticleWorld id="dust" preset="dustBokeh" seed={42} controls={false} />
  </Composition>
));
