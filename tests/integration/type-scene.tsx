// Typography kit (K3) scene for the AE integration check: karaoke captions from an inline word list (with the
// measured underline), an emphasis bar on one word of a headline, decode, typewriter, split-flap, font-weight
// steps and auto-fit. Check in AE: the bar sits exactly behind "MOTION" (retype the headline: it follows), the
// karaoke word and underline track the words, the Captions/Emphasis/Decode/... effects retime things live.
import { scene, Composition, Solid, Sequence, Text, spring, tween } from 'ae-compose';
import { Captions, Emphasis, Decode, Typewriter, SplitFlap, VariableFont, AutoFit } from 'ae-compose';

const WORDS = [
  { text: 'Make', start: 0.4, end: 0.7 }, { text: 'motion', start: 0.7, end: 1.1 }, { text: 'that', start: 1.15, end: 1.35 }, { text: 'reads.', start: 1.35, end: 2.0 },
  { text: 'Every', start: 2.6, end: 2.9 }, { text: 'single', start: 2.9, end: 3.25 }, { text: 'word', start: 3.25, end: 3.55 }, { text: 'lands', start: 3.55, end: 3.9 },
  { text: 'on', start: 3.9, end: 4.0 }, { text: 'the', start: 4.0, end: 4.1 }, { text: 'beat.', start: 4.1, end: 4.9 },
];

export default scene({ name: 'TypeKit', width: 1920, height: 1080, fps: 30, duration: '16s', bg: '#0b0d12' }, () => (
  <Composition>
    <Solid id="bg" name="BG" color="#0b0d12" tags={['bg']} />

    <Sequence name="Captions" duration="5.6s">
      <Emphasis id="em" word="MOTION" kind="bar" color="#ffd23f" wordColor="#0b0d12" scale={104} at={0.9}>
        <Text id="headline" font="Inter-Black" size={130} tracking={-10} color="#eef1f6" y={420}
          animate={{ y: spring({ from: 60, damping: 16, stiffness: 160 }), opacity: tween({ from: 0, duration: '0.4s' }) }}>
          MAKE MOTION
        </Text>
      </Emphasis>
      <Captions id="subs" words={WORDS} style="boldPop" karaoke={{ underline: true }} />
    </Sequence>

    <Sequence name="Decode" from="5.6s" duration="5s">
      <Decode id="decode" font="Inter-Bold" size={110} tracking={40} color="#7df9ff" y={380} duration={1.4} delay={0.3}>
        SIGNAL ACQUIRED
      </Decode>
      <Typewriter id="typed" font="Inter-Medium" size={52} color="#c9d2de" y={600} cps={16} delay={1.6}>
        Every frame is native, editable After Effects.
      </Typewriter>
    </Sequence>

    <Sequence name="Board" from="10.6s" duration="5.4s">
      <SplitFlap id="flap" font="Inter-Bold" size={120} tracking={80} color="#f5f5f5" y={300} flips={8} each={0.06} duration={1.1} delay={0.2}>
        GATE 12 BOARDING
      </SplitFlap>
      <VariableFont id="weight" fonts={['Inter-Regular', 'Inter-Medium', 'Inter-SemiBold', 'Inter-Bold', 'Inter-Black']} size={96} color="#ffd23f" y={540} fromWeight={0} toWeight={100} duration={1.6} delay={1.2} easing="easeInOutSine">
        WEIGHT SHIFT
      </VariableFont>
      <AutoFit id="fit" font="Inter-SemiBold" size={90} color="#9fb2c8" y={800} fit={{ width: 1100, height: 190 }} align="center"
        animate={{ opacity: tween({ from: 0, duration: '0.5s', delay: 1.8 }) }}>
        A longer line of copy that auto-fit balances and shrinks to stay inside its box
      </AutoFit>
    </Sequence>
  </Composition>
));
