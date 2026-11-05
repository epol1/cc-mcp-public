// A5 beat sync: the track's beat grid drives the cut points (scenes are whole bars), accents pop on beats, and
// beat/bar comp markers show the grid in AE. Uses the user's music fixture (git-ignored media under assets/).
import { scene, Composition, Solid, Shape, Ellipse, Rect, Fill, Text, Series, Audio, BeatMarkers, beatsOf, spring, tween } from 'ae-compose';

const MUSIC = '../../assets/handmade/languages_proj/(Footage)/Diafano_AdobeStock_357626701_preview.m4a';

export default scene({ name: 'BeatTest', duration: '10s', bg: '#0b0d12', params: { offbeat: false } }, (p) => {
  const B = beatsOf(MUSIC);
  const first = B.bar(0); // first downbeat
  return (
    <Composition>
      <Solid id="bg" color="#0b0d12" />
      <Audio id="music" src={MUSIC} />
      <BeatMarkers beats={B} to={10} />
      {p.offbeat ? <Shape id="late" position={[960, 900]} from={B.beat(6) + 0.07}><Rect size={[300, 20]} /><Fill color="#e05a7a" /></Shape> : null}
      <Series>
        <Series.Sequence name="Intro" duration={first + B.bars(2)}>
          <Text id="t1" font="Inter-Black" size={160} color="#eef1f6" animate={{ scale: spring({ from: 80, delay: first, damping: 14 }), opacity: tween({ from: 0, to: 100, duration: 0.3, delay: first }) }}>ON THE BEAT</Text>
        </Series.Sequence>
        <Series.Sequence name="Drop" duration={B.bars(2)}>
          {[0, 1, 2, 3, 4, 5, 6, 7].map((k) => (
            <Shape id={`dot${k}`} position={[360 + k * 170, 540]} from={B.beats.length > 1 ? B.bars(k / 4) : 0}
              animate={{ scale: spring({ from: 0, damping: 11, stiffness: 220 }) }}>
              <Ellipse size={[90, 90]} /><Fill color={k % 4 === 0 ? '#e8a33d' : '#4683c4'} />
            </Shape>
          ))}
        </Series.Sequence>
      </Series>
    </Composition>
  );
});
