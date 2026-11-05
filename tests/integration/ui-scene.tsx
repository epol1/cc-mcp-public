// K1 UI kit integration scene: "sign up, then it's everywhere".
// Beat 1 (0–5.9 s): a browser rises in; a cursor switches to the Sign up tab, types an email, hovers the checkbox
// (tooltip), checks it and presses Create account; a toast with the user's avatar slides in.
// Hand-off (5.1–5.85 s): the browser recedes exactly into the laptop's display, where the product recording plays.
// Beat 2 (5.4–10 s): tablet and phone join the laptop. Tablet: a toggle is tapped, the volume slider dragged, sync
// progress fills. Phone: a notifications dialog is allowed, then the activity feed (a Cloner of rows) scrolls. The
// laptop's recording slowly zooms toward the product. Every UI component of the kit appears once.
// The kit is imported by path until src/dsl/index.ts re-exports it (then: from 'ae-compose').
import { scene, Composition, Sequence, Solid, Text, keys, spring, tween } from 'ae-compose';
import {
  uiSteps, BrowserFrame, LaptopFrame, TabletFrame, PhoneFrame, ScreenInsert, Cursor, Card, Tabs, Input, Checkbox, Tooltip, Button,
  Badge, Toast, Toggle, Slider, ProgressBar, Avatar, Modal, ScrollView, Feed, modalButtonPoints, sliderPoint,
} from 'ae-compose';

const BG = '#0b0d12';

// ---------- Beat 1: the sign-up page (browser screen, 1280 × 760 pt) ----------
const at = { tabs: [542, 186] as [number, number], email: [560, 337] as [number, number], agree: [548, 404] as [number, number], signup: [640, 474] as [number, number] };
const signup = uiSteps([
  { at: 0.7, click: 'tabs', index: 0 },
  { at: 1.1, click: 'email' }, { at: 1.2, type: 'email' },
  { at: 2.25, hover: 'agree' }, { at: 2.85, click: 'agree' },
  { at: 3.35, click: 'signup' },
  { at: 3.5, show: 'toast', hold: 2.0 },
], { targets: at, start: [980, 610], startAt: 0.2 });

// ---------- Beat 2 (times relative to its Sequence) ----------
// Tablet (portrait 820 × 1180 pt, UI at 1.6×): tap the toggle, drag the volume from 30 to 75.
const tabletUi = { scale: 1.6 };
const vol = { pos: [410, 491] as [number, number], width: 620 };
const tablet = uiSteps([
  { at: 1.0, click: 'notif' },
  { at: 1.4, cursor: sliderPoint(vol.pos, 30, vol.width) },
  { at: 1.5, drag: 'vol', to: sliderPoint(vol.pos, 75, vol.width), value: 75, duration: 0.6 },
], { targets: { notif: [679, 330] }, start: [600, 900], startAt: 0.5 });

// Phone (390 × 844 pt): allow notifications, then the feed scrolls.
const dialog = { width: 330, title: 'Turn on notifications?', body: 'Know when you are mentioned.', primary: 'Allow', secondary: 'Not now' };
const phone = uiSteps([
  { at: 0.55, show: 'dialog' },
  { at: 2.2, click: 'dialog.primary' },
  { at: 2.3, hide: 'dialog' },
  { at: 3.0, scroll: 'activity', stop: 1, duration: 0.7 },
], { targets: { 'dialog.primary': modalButtonPoints(dialog, [195, 422]).primary }, start: [300, 700], startAt: 1.3 });

const people = ['Ada Lovelace', 'Alan Turing', 'Grace Hopper', 'Linus Torvalds', 'Margaret Hamilton', 'Katherine Johnson', 'Dennis Ritchie', 'Barbara Liskov', 'Ken Thompson', 'Radia Perlman', 'Tim Berners-Lee', 'Frances Allen'];
const actions = ['shipped onboarding v2', 'commented on Pricing', 'merged #482', 'invited you to Design', 'closed 3 issues', 'starred the roadmap'];
const rows = people.map((p, i) => ({ title: p, subtitle: actions[i % actions.length], meta: `${2 + i * 3}m` }));

export default scene({ name: 'UIKitTest', width: 1920, height: 1080, fps: 30, duration: '10s', bg: BG }, () => (
  <Composition>
    <Solid id="bg" name="BG" color={BG} />

    <Sequence name="Sign up" duration={5.9}>
      <BrowserFrame id="browser" url="app.northwind.dev" position={[960, 540]}
        animate={{
          scale: keys({ t: 0, v: 94, easing: 'easeOutQuint' }, { t: 0.7, v: 100, hold: true }, { t: 5.1, v: 100, easing: 'easeInOutCubic' }, { t: 5.8, v: 66 }),
          position: keys({ t: 0, v: [960, 540], hold: true }, { t: 5.1, v: [960, 540], easing: 'easeInOutCubic' }, { t: 5.8, v: [960, 450] }),
          opacity: keys({ t: 0, v: 0, easing: 'easeOutCubic' }, { t: 0.35, v: 100, hold: true }, { t: 5.6, v: 100, easing: 'easeInCubic' }, { t: 5.85, v: 0 }),
        }}>
        <Card id="signupCard" size={[440, 520]} position={[640, 392]}>{null}</Card>
        <Tabs id="tabs" tabs={['Sign up', 'Log in']} selected={1} tabWidth={196} position={[640, 186]} flow={signup} />
        <Text id="signupTitle" font="Inter-Bold" size={24} color="#eef1f6" position={[640, 250]}>Create your account</Text>
        <Input id="email" label="Work email" placeholder="you@company.com" text="ada@northwind.dev" width={380} typingSpeed={18} position={[640, 326]} flow={signup} />
        <Checkbox id="agree" label="Send me product updates" position={[640, 404]} flow={signup} />
        <Tooltip id="agreeTip" text="Monthly. No spam." for="agree" linger={0.9} position={[548, 388]} flow={signup} />
        <Button id="signup" label="Create account" size="lg" width={380} position={at.signup} flow={signup} />
        <Badge id="trial" label="Free for 14 days" tone="success" popAt={0.9} position={[640, 548]} />
        <Toast id="toast" icon="avatar" person="Ada Lovelace" title="Account created" body="Welcome aboard, Ada." width={340} position={[1086, 66]} flow={signup} />
        <Cursor id="cursor" flow={signup} />
      </BrowserFrame>
    </Sequence>

    <Sequence name="Everywhere" from={5.4}>
      {/* The laptop sits where the browser lands: its display is the browser page at 66 %. */}
      <LaptopFrame id="laptop" position={[960, 470]} scale={66} animate={{ opacity: tween({ from: 0, to: 100, duration: 0.35, delay: 0.15, easing: 'easeOutCubic' }) }}>
        <ScreenInsert id="rec" src="../../assets/footage/cc.mp4" trim={['2s', '8s']}
          zooms={[{ at: 1.0, scale: 1.45, duration: 1.2, hold: 5 }]} focus={[{ t: 0, p: [700, 420] }, { t: 3, p: [820, 440] }]} />
      </LaptopFrame>

      <TabletFrame id="tablet" portrait position={[430, 620]} scale={40}
        animate={{ x: spring({ from: -320, delay: 0.2, damping: 18, stiffness: 120 }), opacity: tween({ from: 0, to: 100, duration: 0.3, delay: 0.2 }) }}>
        <Text id="settingsTitle" font="Inter-Bold" size={44} color="#eef1f6" align="left" anchor="left" position={[90, 170]}>Settings</Text>
        <Card id="settingsCard" size={[700, 520]} position={[410, 500]} theme={tabletUi}>{null}</Card>
        <Toggle id="notif" label="Notifications" width={620} position={[410, 330]} theme={tabletUi} flow={tablet} />
        <Slider id="vol" label="Volume" showValue value={30} width={vol.width} position={[410, 470]} theme={tabletUi} flow={tablet} />
        <ProgressBar id="sync" label="Syncing library" showValue width={620} position={[410, 640]} theme={tabletUi} valueAt={[{ t: 0.5, v: 0 }, { t: 2.4, v: 100 }]} />
        <Cursor id="tabletTouch" kind="touch" theme={tabletUi} flow={tablet} />
      </TabletFrame>

      <PhoneFrame id="phone" position={[1500, 640]} scale={62}
        animate={{ x: spring({ from: 320, delay: 0.35, damping: 18, stiffness: 120 }), opacity: tween({ from: 0, to: 100, duration: 0.3, delay: 0.35 }) }}>
        <ScrollView id="activity" size={[390, 734]} position={[195, 477]} contentHeight={940} stops={[0, 300]} flow={phone}>
          <Feed id="feed" rows={rows} position={[195, 50]} enterAt={0.5} />
        </ScrollView>
        <Avatar id="me" person="Ada Lovelace" status="online" position={[36, 80]} />
        <Text id="phoneTitle" font="Inter-Bold" size={24} color="#eef1f6" align="left" anchor="left" position={[66, 80]}>Activity</Text>
        <Badge id="unread" label="3" tone="danger" variant="solid" popAt={1.0} position={[354, 80]} />
        <Modal id="dialog" {...dialog} flow={phone} />
        <Cursor id="phoneTouch" kind="touch" flow={phone} />
      </PhoneFrame>
    </Sequence>
  </Composition>
));
