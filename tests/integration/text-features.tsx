// Text features scene for the round-trip and visual checks: Range Selector animators (native keyed Offset),
// text on a path with an animated First Margin, and per-character 3D (switched on automatically by rotationX).
import { scene, Composition, Solid, Text, Camera, perWord, perChar, textPresets, tween } from 'ae-compose';

export default scene({ name: 'TextFeatures', width: 1920, height: 1080, fps: 30, duration: '5s', bg: '#0b0d12' }, () => (
  <Composition>
    <Solid name="BG" color="#0b0d12" />
    {/* Range Selector reveal (by word, Ramp Up sweep) and exit (by char, Ramp Down), native keys. */}
    <Text id="range" name="Range Reveal" font="Inter-Black" size={120} color="#eef1f6" y={260}
      animate={{ text: [
        perWord({ from: { y: 60, opacity: 0 }, easing: 'easeOutCubic', each: '300ms', duration: '0.5s', delay: 0.2, selector: 'range' }),
        perChar({ from: { opacity: 0, blur: 10 }, easing: 'easeInCubic', each: '20ms', duration: '0.3s', delay: 0.6, anchor: 'end', direction: 'out', selector: 'range' }),
      ] }}>
      NATIVE RANGE KEYS
    </Text>
    {/* Text running along an arc. */}
    <Text id="arc" name="Arc Text" font="Inter-Bold" size={64} color="#4683c4" align="left"
      path="M260 980 C 700 700, 1220 700, 1660 980"
      pathOptions={{ firstMargin: tween({ from: -560, to: 260, duration: '2.4s', easing: 'easeOutCubic' }) }}>
      TEXT ON A PATH
    </Text>
    {/* Per-character 3D flip. */}
    <Text id="flip" name="Flip 3D" font="Inter-Black" size={110} color="#f2f4f8" y={520}
      animate={{ text: textPresets.flipIn('char', { each: '60ms', delay: 1.2, duration: '0.6s' }) }}>
      FLIP IN 3D
    </Text>
    <Camera name="Camera" lens={50} />
  </Composition>
));
