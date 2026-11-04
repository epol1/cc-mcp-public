// Showcase 11 — 3D fly-through (Classic 3D): six product cards staggered in depth, a camera dollying through them
// with depth of field (cards sharpen as they pass the focus distance) and motion blur, then a title card.
// Live controls: Focus Distance, Blur Amount.
import { scene, Composition, Solid, Footage, Text, Camera, Null, keys, tween, spring, perWord, control } from 'ae-compose';

const CARDS = ['01', '02', '03', '04', '05', '06'];

export default scene({ name: 'FlyThrough', width: 1920, height: 1080, fps: 30, duration: '7s', bg: '#07080c', renderer: 'classic3d', motionBlur: { shutterAngle: 180, samples: 16 } }, () => {
  const focus = control('Focus Distance', 1300, { min: 200, max: 4000 });
  const blur = control('Blur Amount', 45, { min: 0, max: 200 });
  return (
    <Composition>
      <Solid name="BG" color="#07080c" />
      {CARDS.map((n, i) => (
        <Footage src={`../../assets/footage/stills/${n}.png`} name={`Card ${n}`} threeD motionBlur fit="none" scale={115}
          position={[960 + (i % 2 ? 430 : -430) + (i % 3) * 30, 540 + ((i * 137) % 3 - 1) * 90, 700 + i * 1000]}
          rotationY={i % 2 ? -22 : 22} material={{ acceptsLights: false }} />
      ))}
      {/* Final title sits beyond the last card. */}
      <Text id="title" name="Title" font="Inter-Black" size={170} color="#f2f4f8" threeD position={[960, 540, 7900]} scale={150}
        animate={{ text: perWord({ from: { y: 80, opacity: 0 }, spring: { damping: 15, stiffness: 150 }, each: '120ms', delay: 3.9 }) }}>
        ONE OF ONE
      </Text>
      {/* One-node camera dollying forward on an eased path. */}
      <Camera id="cam" name="Dolly" oneNode lens={35} dof focusDistance={focus} aperture={blur}
        animate={{ position: keys({ t: 0, v: [960, 540, -1400], easing: 'easeInOutCubic' }, { t: 5.2, v: [960, 540, 5900], easing: 'easeOutCubic' }, { t: 7, v: [960, 540, 6150] }) }} />
    </Composition>
  );
});
