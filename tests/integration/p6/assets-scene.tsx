// Phase 6 AE check: one fetched asset of each kind used through `asset:` sources (resolved at compile time,
// copied next to the saved project, credited). Icon → native shapes; photo/video/texture → footage; HDRI →
// environment light; model → Advanced 3D; audio → audio layer.
import { scene, Composition, Footage, Svg, Model, Light, Camera, Audio, Text, tween, spring } from 'ae-compose';

export default scene({ name: 'P6Assets', width: 1920, height: 1080, fps: 30, duration: '4s', renderer: 'advanced3d', lint: { ignore: ['reading-time'] } }, () => (
  <Composition>
    <Footage id="paper" src="asset:ambientcg:Paper006@1k-jpg" fit="cover" />
    <Footage id="clip" src="asset:pixabay:video:4006@360p" fit="none" scale={60} x={330} y={240} muted />
    <Footage id="photo" src="asset:pixabay:2297204@web" fit="none" scale={45} x={1590} y={240} />
    <Footage id="desk" src="asset:unsplash:cckf4TsHAuw@regular" fit="none" scale={22} x={1590} y={820} />
    <Svg id="rocket" src="asset:iconify:lucide:rocket" width={220} x={330} y={800} color="#1b2230"
      draw={tween({ from: 0, to: 100, duration: '1.2s', easing: 'easeInOutCubic' })} />
    <Model id="duck" src="asset:polyhaven:rubber_duck_toy@1k-gltf" position={[960, 600, 0]} scale={300}
      animate={{ rotationY: tween({ from: -30, to: 30, duration: '4s', easing: 'easeInOutSine' }), y: spring({ from: -40, damping: 18 }) }} />
    <Light id="env" kind="environment" hdri="asset:polyhaven:brown_photostudio_02@1k-hdr" intensity={100} />
    <Camera id="cam" lens={50} />
    <Text id="label" font="Inter-Bold" size={56} y={140} color="#1b2230">FETCHED, NOT DRAWN</Text>
    <Audio id="sfx" src="asset:openverse:audio:eab8a6e2-0ac8-4615-9e0d-ebde30523783" />
  </Composition>
));
