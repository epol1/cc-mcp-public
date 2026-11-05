// Showcase 11 — 3D fly-through (Classic 3D): six product cards and three words staggered in depth. A stop-and-go
// dolly eases in to each word, holds on it while it reads (each word fades in as the camera nears it), then moves on,
// with depth of field and motion blur, and lands on the title card.
// Live controls: Focus Distance, Blur Amount.
import { scene, Composition, Solid, Footage, Text, Camera, Null, keys, tween, spring, perWord, control } from 'ae-compose';

const CARDS = ['01', '02', '03', '04', '05', '06'];

export default scene({ name: 'FlyThrough', width: 1920, height: 1080, fps: 30, duration: '8.5s', bg: '#07080c', renderer: 'classic3d', motionBlur: { shutterAngle: 180, samples: 16 } }, () => {
  const focus = control('Focus Distance', 1750, { min: 200, max: 4000 });
  const blur = control('Blur Amount', 45, { min: 0, max: 200 });
  return (
    <Composition>
      <Solid name="BG" color="#07080c" />
      {CARDS.map((n, i) => (
        <Footage src={`../../assets/footage/stills/${n}.png`} name={`Card ${n}`} threeD motionBlur fit="none" scale={115}
          position={[960 + (i % 2 ? 430 : -430) + (i % 3) * 30, 540 + ((i * 137) % 3 - 1) * 90, 700 + i * 1000]}
          rotationY={i % 2 ? -22 : 22} material={{ acceptsLights: false }} />
      ))}
      {/* Text cards interleaved with the product cards. Each word fades in as the camera approaches it, so the
          fly-through reads one word per beat (SHELLS, BUTTONS, COLOURS, then the title) and distant words never
          stack up behind the near one. */}
      {['SHELLS', 'BUTTONS', 'COLOURS'].map((w, i) => (
        <Text name={`Word ${w}`} font="Inter-Black" size={150} color="#4683c4" threeD motionBlur
          position={[900, 240, 1700 + i * 2000]}
          expressions={{ 'ADBE Transform Group/ADBE Opacity': 'var d = length(toWorld(anchorPoint), thisComp.activeCamera.toWorld([0, 0, 0])); linear(d, 2600, 4200, 100, 0);' }}>
          {w}
        </Text>
      ))}
      {/* Final title sits beyond the last card. */}
      <Text id="title" name="Title" font="Inter-Black" size={170} color="#f2f4f8" threeD position={[960, 540, 7900]} scale={150}
        animate={{ text: perWord({ from: { y: 80, opacity: 0 }, spring: { damping: 15, stiffness: 150 }, each: '120ms', delay: 6.0 }) }}>
        ONE OF ONE
      </Text>
      {/* One-node camera: a stop-and-go dolly. It eases in to ~1800 px in front of each word, drifts slowly while the
          word reads (a hold, not a freeze), then moves on; the last move lands on the title. */}
      <Camera id="cam" name="Dolly" oneNode lens={35} dof focusDistance={focus} aperture={blur}
        animate={{ position: keys(
          { t: 0, v: [960, 540, -1400], easing: 'easeOutCubic' },
          { t: 1.1, v: [960, 540, -150], easing: 'linear' }, { t: 2.1, v: [960, 540, 50], easing: 'easeInOutCubic' },
          { t: 2.9, v: [960, 540, 1850], easing: 'linear' }, { t: 3.9, v: [960, 540, 2050], easing: 'easeInOutCubic' },
          { t: 4.7, v: [960, 540, 3850], easing: 'linear' }, { t: 5.7, v: [960, 540, 4050], easing: 'easeInOutCubic' },
          { t: 6.6, v: [960, 540, 5900], easing: 'easeOutSine' }, { t: 8.5, v: [960, 540, 6150] }) }} />
    </Composition>
  );
});
