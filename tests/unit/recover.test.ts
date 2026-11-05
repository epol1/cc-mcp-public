// recover(): decision logic with AE's window state, the bridge and process launch mocked (the live paths that
// close or launch After Effects are not exercised in tests).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = { windows: [] as any[], health: [] as boolean[], spawned: 0, killed: 0, answered: [] as string[] };
vi.mock('@cc-mcp/core/bridge/dialogs.ts', () => ({
  aeWindows: vi.fn(async () => state.windows.length > 1 ? state.windows.shift() : state.windows[0]),
  autoAnswerKnown: vi.fn(async (w: any) => { const a = (w?.dialogs ?? []).filter((d: any) => /Crash Repair/.test(d.title)).map((d: any) => `"${d.title}" → Continue`); state.answered.push(...a); return a; }),
}));
vi.mock('../../src/bridge/cep.ts', () => ({ CepBackend: class { async health() { const ok = state.health.length > 1 ? state.health.shift()! : state.health[0]; return { ok, detail: ok ? 'bridge v0' : 'not reachable' }; } } }));
vi.mock('../../src/bridge/locate.ts', () => ({ findAfterEffects: () => ({ exe: 'C:/AE/AfterFX.exe' }) }));
vi.mock('../../src/bridge/index.ts', () => ({ resetBackend: () => {} }));
vi.mock('node:child_process', () => ({ spawn: vi.fn(() => { state.spawned++; return { unref() {} }; }), execFileSync: vi.fn(() => { state.killed++; return ''; }) }));
vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 1000 });

const { recover } = await import('../../src/api/recover.ts');
const W = (o: Partial<{ running: boolean; hung: boolean; dialogs: any[] }>) => ({ running: true, hung: false, main: null, dialogs: [], ...o });

beforeEach(() => { state.windows = []; state.health = []; state.spawned = 0; state.killed = 0; state.answered = []; });

describe('recover', () => {
  it('reports ready when AE and the bridge answer', async () => {
    state.windows = [W({})]; state.health = [true];
    const r = await recover();
    expect(r).toMatchObject({ ok: true, state: 'ready' });
  });
  it('answers Crash Repair, then is ready', async () => {
    state.windows = [W({ dialogs: [{ hwnd: 1, title: 'Crash Repair Options' }] }), W({})]; state.health = [true];
    const r = await recover();
    expect(state.answered[0]).toMatch(/Crash Repair/);
    expect(r.state).toBe('ready');
  });
  it('reports unknown dialogs instead of guessing', async () => {
    state.windows = [W({ dialogs: [{ hwnd: 2, title: 'Save changes?', capture: 'x.png' }] })]; state.health = [true];
    const r = await recover();
    expect(r).toMatchObject({ ok: false, state: 'dialog' });
    expect(r.dialogs?.[0].title).toBe('Save changes?');
  });
  it('never kills a hung AE without force', async () => {
    state.windows = [W({ hung: true })]; state.health = [false];
    const r = await recover();
    expect(r).toMatchObject({ ok: false, state: 'hung' });
    expect(state.killed).toBe(0);
    expect(r.steps.join(' ')).toMatch(/ask the user first/);
  });
  it('with force: kills, relaunches and waits for the bridge', async () => {
    state.windows = [W({ hung: true }), W({ running: false }), W({ running: true })]; state.health = [false, false, true];
    const r = await recover({ force: true, timeoutSec: 60 });
    expect(state.killed).toBe(1);
    expect(state.spawned).toBe(1);
    expect(r.state).toBe('ready');
  }, 30_000);
  it('launches AE when it is not running', async () => {
    state.windows = [W({ running: false }), W({ running: true })]; state.health = [false, true];
    const r = await recover({ timeoutSec: 60 });
    expect(state.spawned).toBe(1);
    expect(r).toMatchObject({ ok: true, state: 'ready' });
  }, 30_000);
});
