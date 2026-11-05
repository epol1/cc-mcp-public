// Multi-colour confetti: five colour systems from one component, fired by a marker, sharing live controls.
import { scene, Composition, Solid, Text, Confetti, perWord } from 'ae-compose';

export default scene({ name: 'ConfettiTest', width: 1280, height: 720, fps: 30, duration: '3s', bg: '#0b0d12' }, () => (
  <Composition markers={[{ t: 0.5, comment: 'pop' }]}>
    <Solid name="BG" color="#0b0d12" />
    <Text name="Title" font="Inter-Black" size={110} color="#f2f4f8" animate={{ text: perWord({ from: { y: 40, opacity: 0 }, delay: 0.4 }) }}>PARTY TIME</Text>
    <Confetti id="confetti" burst={{ at: { marker: 'pop' }, duration: '0.3s', rate: 30 }} params={{ 'Position Y': 0.1 }} />
  </Composition>
));
