// Showcase 13 — Ambient particles in 3D: drifting bokeh dust (CC Particle World follows the comp camera, so it
// parallaxes with the move) around a 3D title and a ring of product cards, with a slow orbiting camera.
// Live controls: Orbit Speed and the dust's Velocity ("Dust Bokeh Velocity"); Birth Rate and Birth Size are fixed for this shot.
import { scene, Composition, Solid, Text, Footage, Circle3D, OrbitCamera, ParticleWorld, spring, tween, perChar, control } from 'ae-compose';

export default scene({ name: 'Ambient3D', width: 1920, height: 1080, fps: 30, duration: '8s', bg: '#06070b', renderer: 'classic3d' }, () => (
  <Composition>
    <Solid name="BG" color="#06070b" />
    {/* A carousel of product cards below the title. */}
    <Circle3D center={[960, 700, 0]} radius={1150} face="out">
      {['04', '05', '06', '01', '02', '03'].map((n) => (
        <Footage src={`../../assets/footage/stills/${n}.png`} name={`Card ${n}`} fit="none" scale={52} />
      ))}
    </Circle3D>
    <Text id="title" name="Title" font="Inter-Black" size={112} color="#f2f4f8" threeD position={[960, 400, 0]}
      animate={{ text: perChar({ from: { opacity: 0, z: -300, blur: 10 }, easing: 'easeOutCubic', duration: '0.8s', each: '50ms', delay: 0.4 }) }} perCharacter3D>
      CUSTOM CONTROLLERZ
    </Text>
    <ParticleWorld id="dust" preset="dustBokeh" params={{ 'Radius X': 1.4, 'Radius Y': 0.7, 'Radius Z': 1.4, 'Birth Size': 0.08, 'Death Size': 0.1, 'Max Opacity': 55, 'Birth Rate': 0.6 }} />
    <OrbitCamera target={[960, 560, 0]} radius={2900} height={380} speed={control('Orbit Speed', 8, { min: -30, max: 30 })} startAngle={-20} lens={40} />
  </Composition>
));
