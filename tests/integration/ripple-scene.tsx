import { scene, Composition, Series, Solid, Text, Shape, Rect, Fill, Precomp, spring, tween, keys, perWord, perChar, control } from 'ae-compose';

export default scene({ name: 'RippleTest', width: 1280, height: 720, fps: 30, duration: '6s', bg: '#101216' }, () => (
  <Composition>
    <Solid id="bg" name="BG" color="#101216" />
    <Series>
      <Series.Sequence duration="2s" name="Beat 1">
        <Text id="t1" font="Inter-Black" size={110} color="#ffffff"
          animate={{ text: [perWord({ from: { y: 60, opacity: 0 }, easing: 'easeOutCubic', duration: '0.5s', each: '100ms', delay: 0.1 }), perChar({ from: { opacity: 0 }, easing: 'easeInCubic', duration: '0.2s', each: '10ms', delay: 0.3, anchor: 'end', direction: 'out' })] }}>
          FIRST BEAT
        </Text>
      </Series.Sequence>
      <Series.Sequence duration="2s" name="Beat 2">
        <Text id="t2" font="Inter-Black" size={110} color="#4683c4" y={300}
          animate={{ text: perWord({ from: { y: 60, opacity: 0 }, easing: 'easeOutCubic', duration: '0.5s', each: '100ms', delay: 0.1 }) }}>
          SECOND BEAT
        </Text>
        <Shape id="bar" name="Bar" y={420} animate={{ scale: keys({ t: 0.2, v: [0, 100], easing: 'easeOutExpo' }, { t: 0.8, v: [100, 100] }, { t: 1.6, v: [100, 100], easing: 'easeInExpo' }, { t: 1.95, v: [0, 100] }) }}>
          <Rect size={[600, 10]} />
          <Fill color="#4683c4" />
        </Shape>
        <Shape id="dot" name="Dot" y={520} animate={{ x: spring({ from: -300, delay: 0.3, damping: control('Dot Damping', 12) }) }}>
          <Rect size={[40, 40]} roundness={20} />
          <Fill color="#ffd23f" />
        </Shape>
      </Series.Sequence>
      <Series.Sequence duration="2s" name="Beat 3">
        <Precomp id="card" name="Card" width={600} height={300}>
          <Solid id="cardbg" color="#2ec4b6" />
          <Text id="ct" font="Inter-Bold" size={60} color="#0b0d12" animate={{ text: perChar({ from: { scale: 0, opacity: 0 }, spring: { damping: 12, stiffness: 200 }, each: '30ms', delay: 0.2 }) }}>THIRD</Text>
        </Precomp>
      </Series.Sequence>
    </Series>
  </Composition>
));
