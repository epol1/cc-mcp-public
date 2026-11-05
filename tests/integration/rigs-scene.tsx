// Camera and light rigs: a crane (aim fixed on the subject) with a little handheld shake, three-point lighting,
// and a second comp-length move. Used by tests/integration/rigs.ts.
import { scene, Composition, Solid, Text, Crane, ThreePointLights, control } from 'ae-compose';

export default scene({ name: 'RigTest', width: 1280, height: 720, fps: 30, duration: '4s', bg: '#0b0d12', renderer: 'classic3d' }, () => (
  <Composition>
    <Solid name="Floor" color="#1a2130" width={2400} height={2400} threeD position={[640, 520, 0]} rotationX={90} material={{ acceptsShadows: true }} />
    <Solid id="card" name="Card" color="#4683c4" width={360} height={240} threeD position={[640, 360, 0]} material={{ castsShadows: true, specular: 60 }} />
    <Text id="label" name="Label" font="Inter-Black" size={72} color="#f2f4f8" threeD position={[640, 200, 0]}>RIGGED</Text>
    <ThreePointLights target={[640, 360, 0]} intensity={control('Key Intensity', 110)} />
    <Crane id="cam" name="Camera" lens={35} target={[640, 360, 0]} travel={350} duration="3s" delay={0.4} shake={{ amount: 4, freq: 1 }} />
  </Composition>
));
