// A karaoke caption template for Premiere: one placeholder caption; Premiere fills "Caption" and "Word Times".
import { scene, Composition, Captions } from 'ae-compose';

const words = 'Every word lights up as it is said'.split(' ').map((text, i) => ({ text, start: i * 0.4, end: i * 0.4 + 0.35 }));
export default scene({ name: 'AecKaraokeCaption', width: 1920, height: 1080, fps: 30, duration: '10s', lint: { ignore: ['reading-time'] } }, () => (
  <Composition>
    <Captions id="cap" style="karaoke" template cues={[{ start: 0, end: 3.2, text: words.map((w) => w.text).join(' '), words }]} />
  </Composition>
));
