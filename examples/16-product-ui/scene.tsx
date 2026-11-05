// Showcase 16 — "Tandem": a product demo for a (fictional) shared to-do app for two, built from the UI kit (K1).
// Every screen is native shapes and text inside device frames; taps, typing, toasts and checks are driven by one
// interaction script per phone (uiSteps), and each state is a layer marker ("press", "type", "show", "toggle"):
// drag a marker in AE to retime that tap, no rebuild.
//
// Beats:
//   Hook (0–3.2 s)  — the problem: Sam's texts pile up on Ada's phone (a feed from data, scrolling as they come in).
//   Add  (3.2–8 s)  — the texts clear and the app opens: Ada adds "Groceries (milk!)" once and assigns it to Sam.
//                     The phone stays: its screen changes under the viewer's eye instead of cutting away.
//   Done (8–11.8 s) — Sam's phone slides in beside it, the task is there, Sam ticks it, Ada's phone hears back.
//                     The accent line under "both" draws on...
//   End  (11–15 s)  — ...and grows into the end card (shape wipe): the logo (two dots, one ring) and the line. Holds.
import {
  scene, Composition, Sequence, Text, Shape, Rect, Ellipse, Fill, Stroke, Group, Solid, Beats, Beat, ShapeWipe,
  PhoneFrame, Toast, ListItem, Button, Input, Checkbox, Badge, Cursor, ScrollView, Feed, uiSteps, keys, spring, tween, perWord,
} from 'ae-compose';

const INK = '#0b0d12', WHITE = '#eef1f6', MUTED = '#8b95a5', ACCENT = '#4683c4';
const UI = { accent: ACCENT };

// Ada's phone: the texts pile up, then she adds the task and hears back from Sam.
const ada = uiSteps([
  { at: 2.4, scroll: 'chat', stop: 1, duration: 0.7 },
  { at: 4.0, click: 'add' },
  { at: 4.45, click: 'task' }, { at: 4.55, type: 'task' },
  { at: 5.95, click: 'assign' },
  { at: 6.55, click: 'save' },
  { at: 6.65, show: 'sent', hold: 2.0 },
  { at: 9.75, show: 'finished', hold: 5 },
], { targets: { add: [195, 770], task: [195, 392], assign: [120, 470], save: [195, 540] }, start: [300, 900], startAt: 3.6 });

// Sam's phone (times relative to the Done beat, which starts at 8 s): the task arrives, Sam ticks it.
const sam = uiSteps([
  { at: 1.25, click: 'done' },
], { targets: { done: [52, 214] }, start: [320, 760], startAt: 0.7 });

// The texts that pile up (the feed's data): the same questions, every week.
const TEXTS = ['did you get milk?', "who's picking up Rosie?", 'rent is due friday??', "we're out of coffee", 'did you call the vet?', 'milk???', 'can you grab bread', 'also milk', 'trash goes out tonight', 'did anyone book the vet', 'MILK'];
const chat = TEXTS.map((t, i) => ({ title: 'Sam', subtitle: t, meta: `8:${String(2 + i * 3).padStart(2, '0')}`, person: 'Sam Rivera' }));

/** A beat headline on the left: words rise in, and leave just before `out` (seconds into its Sequence). */
const headline = (id: string, text: string, size: number, out?: number, y = 470) => (
  <Text id={id} font="Inter-Black" size={size} tracking={-10} leading={size * 1.05} color={WHITE} align="left" anchor="left" x={150} y={y}
    animate={{ text: [
      perWord({ from: { y: 50, opacity: 0 }, easing: 'easeOutQuint', duration: '0.7s', each: '80ms', delay: 0.15 }),
      ...(out !== undefined ? [perWord({ from: { y: -30, opacity: 0 }, easing: 'easeInCubic', duration: '0.3s', each: '30ms', delay: 0, anchor: 'end', direction: 'out' })] : []),
    ] }}>
    {text}
  </Text>
);
const subline = (id: string, text: string, delay: number, y: number) => (
  <Text id={id} font="Inter-Medium" size={40} color={MUTED} align="left" anchor="left" x={150} y={y}
    animate={{ text: [
      perWord({ from: { y: 24, opacity: 0 }, easing: 'easeOutQuint', duration: '0.6s', each: '50ms', delay }),
      perWord({ from: { opacity: 0 }, easing: 'easeInCubic', duration: '0.25s', each: '20ms', delay: 0, anchor: 'end', direction: 'out' }),
    ] }}>
    {text}
  </Text>
);

// The accent line under "both phones" (times from the Done scene's start, 8 s): it underlines the payoff, then
// becomes the end card (the wipe's shape).
const line = <Shape id="done.line" name="Both Underline" x={392} y={612}
  animate={{ scale: keys({ t: 1.9, v: [0, 100], easing: 'easeOutQuint' }, { t: 2.5, v: [100, 100] }) }}>
  <Rect size={[484, 10]} roundness={5} />
  <Fill color={ACCENT} />
</Shape>;

export default scene({ name: 'ProductUI', width: 1920, height: 1080, fps: 30, duration: '15s', bg: INK }, () => (
  <Composition>
    <Solid id="bg" name="BG" color={INK} tags={['bg']} />
    <Beats>
      <Beat name="Story" duration={11.8}>
        <Sequence name="Hook" duration={3.2}>
          {headline('hook.title', "Who's buying\rmilk?", 112, 2.9, 430)}
          {subline('hook.sub', 'Every week, the same texts.', 0.75, 610)}
        </Sequence>
        <Sequence name="Add" from={3.2} duration={4.8}>
          {headline('add.title', 'Add it once.', 112, 4.5, 450)}
          {subline('add.sub', 'Tandem tells the right person.', 0.7, 560)}
        </Sequence>
        <Sequence name="Done" from={8}>
          {headline('done.title', 'Done shows up\ron both phones.', 92, undefined, 500)}
          {line}
        </Sequence>

        {/* Ada's phone: right of the headline, then it steps left to make room for Sam's. */}
        <PhoneFrame id="ada" name="Ada Phone" theme={UI}
          animate={{
            position: keys({ t: 0, v: [1380, 600], easing: 'easeOutQuint' }, { t: 0.7, v: [1380, 540], hold: true }, { t: 8.25, v: [1380, 540], easing: 'easeInOutCubic' }, { t: 8.95, v: [1170, 560] }),
            scale: keys({ t: 8.25, v: 100, easing: 'easeInOutCubic' }, { t: 8.95, v: 88 }),
            opacity: tween({ from: 0, to: 100, duration: 0.4, easing: 'easeOutCubic' }),
          }}>
          <Text id="chat.title" font="Inter-Bold" size={30} color={WHITE} align="left" anchor="left" position={[32, 132]}
            animate={{ opacity: keys({ t: 0.3, v: 0, easing: 'easeOutCubic' }, { t: 0.7, v: 100, hold: true }, { t: 2.95, v: 100, easing: 'easeInCubic' }, { t: 3.2, v: 0 }) }}>Messages</Text>
          <ScrollView id="chat" size={[390, 660]} position={[195, 520]} contentHeight={1180} stops={[0, 520]} exitAt={3.0} flow={ada}>
            <Feed id="chat.feed" rows={chat} width={358} enterAt={0.45} stagger={0.12} />
          </ScrollView>

          <Text id="ada.title" font="Inter-Bold" size={30} color={WHITE} align="left" anchor="left" position={[32, 132]}
            animate={{ opacity: tween({ from: 0, to: 100, duration: 0.4, delay: 3.25, easing: 'easeOutCubic' }) }}>This week</Text>
          <ListItem id="rent" title="Pay rent" subtitle="Ada · due Friday" person="Ada Lovelace" width={358} position={[195, 205]} enterAt={3.35} />
          <ListItem id="vet" title="Book the vet" subtitle="Sam · this week" person="Sam Rivera" width={358} position={[195, 285]} enterAt={3.45} />
          <Input id="task" label="New task" text="Groceries (milk!)" width={358} typingSpeed={14} position={[195, 392]} enterAt={4.2} exitAt={6.7} flow={ada} />
          <Checkbox id="assign" label="Assign to Sam" position={[130, 470]} enterAt={4.3} exitAt={6.7} flow={ada} />
          <Button id="save" label="Add task" width={358} position={[195, 540]} enterAt={4.35} exitAt={6.75} flow={ada} />
          <ListItem id="groceries" title="Groceries (milk!)" subtitle="Sam · new" person="Sam Rivera" width={358} position={[195, 365]} enterAt={6.8} />
          <Button id="add" label="+ New task" variant="secondary" width={326} position={[195, 770]} enterAt={3.5} flow={ada} />
          <Toast id="sent" icon="success" title="Sent to Sam" body="Groceries (milk!)" width={350} position={[195, 60]} flow={ada} />
          <Toast id="finished" icon="avatar" person="Sam Rivera" title="Sam finished" body="Groceries (milk!)" width={350} position={[195, 60]} flow={ada} />
          <Cursor id="ada.touch" kind="touch" flow={ada} />
        </PhoneFrame>

        {/* Sam's phone joins for the payoff. */}
        <Sequence name="Sam" from={8}>
          <PhoneFrame id="sam" name="Sam Phone" theme={UI} position={[1600, 560]} scale={88}
            animate={{ x: spring({ from: 2200, damping: 20, stiffness: 120, delay: 0.35 }), opacity: tween({ from: 0, to: 100, duration: 0.3, delay: 0.35 }) }}>
            <Text id="sam.title" font="Inter-Bold" size={30} color={WHITE} align="left" anchor="left" position={[32, 132]}>This week</Text>
            <Checkbox id="done" label="Groceries (milk!)" position={[120, 214]} flow={sam} />
            <Badge id="new" label="New" tone="accent" variant="solid" popAt={0.6} position={[330, 214]} />
            <ListItem id="sam.vet" title="Book the vet" subtitle="Sam · this week" person="Sam Rivera" width={358} position={[195, 300]} />
            <Cursor id="sam.touch" kind="touch" flow={sam} />
          </PhoneFrame>
        </Sequence>
      </Beat>

      <ShapeWipe id="toEnd" name="Wipe: underline to end card" shape={line} grow="xy" duration={0.8} easing="easeInOutQuart" />

      <Beat name="End" duration={4}>
        <Shape id="end.mark" name="Tandem Mark" x={960} y={420}
          animate={{ scale: spring({ from: 0, delay: 0.35, damping: 14, stiffness: 170 }) }}>
          <Group name="Ring" position={[0, 0]}><Ellipse size={[150, 150]} /><Stroke color={WHITE} width={10} /></Group>
          <Group name="Dot A" position={[-26, 0]}><Ellipse size={[44, 44]} /><Fill color={WHITE} /></Group>
          <Group name="Dot B" position={[26, 0]}><Ellipse size={[44, 44]} /><Fill color={INK} /></Group>
        </Shape>
        <Text id="end.word" font="Inter-Black" size={120} tracking={-10} color={WHITE} y={600}
          animate={{ text: perWord({ from: { y: 40, opacity: 0 }, easing: 'easeOutQuint', duration: '0.6s', each: '60ms', delay: 0.55 }) }}>
          Tandem
        </Text>
        <Text id="end.line" font="Inter-Medium" size={44} color="#dce6f5" y={690}
          animate={{ text: perWord({ from: { y: 24, opacity: 0 }, easing: 'easeOutQuint', duration: '0.6s', each: '50ms', delay: 0.85 }) }}>
          Shared lists for two.
        </Text>
      </Beat>
    </Beats>
  </Composition>
));
