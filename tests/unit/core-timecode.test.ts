// Spec for packages/core/src/time/timecode.ts: ticks, rates, drop-frame timecode, parsing. Off-by-one-frame bugs
// are the main risk in an editing tool, so every common rate is checked exhaustively where it is cheap.
import { describe, expect, it } from 'vitest';
import {
  TICKS_PER_SECOND, clock, fps, framesToSeconds, framesToTicks, framesToTimecode, fromTicksPerFrame, parseTime, rate,
  secondsToFrames, ticksPerFrame, ticksToFrames, timecodeToFrames, xmlRate,
} from '@ae-mcp/core/time/timecode.ts';

const R = {
  r23976: rate('23.976'), r24: rate(24), r25: rate(25), r2997: rate(29.97), r30: rate(30), r50: rate(50), r5994: rate('59.94'), r60: rate(60),
};

describe('rates and ticks', () => {
  it('parses decimals, fractions and Premiere timebases', () => {
    expect(rate('23.976')).toEqual({ num: 24000, den: 1001 });
    expect(rate('24000/1001')).toEqual({ num: 24000, den: 1001 });
    expect(rate(29.97)).toEqual({ num: 30000, den: 1001 });
    expect(rate('30000/1001')).toEqual({ num: 30000, den: 1001 });
    expect(rate(10594584000)).toEqual({ num: 24000, den: 1001 }); // sequence.timebase from Premiere
    expect(fromTicksPerFrame('8475667200')).toEqual({ num: 30000, den: 1001 });
    expect(() => rate('fast')).toThrow(/not a number/);
  });
  it('has an integer number of ticks per frame at every common rate', () => {
    for (const r of Object.values(R)) expect(Number.isInteger(ticksPerFrame(r))).toBe(true);
    expect(ticksPerFrame(R.r23976)).toBe(10594584000); // measured in Premiere 26.5.2 (spike)
    expect(ticksPerFrame(R.r24)).toBe(10584000000);
  });
  it('maps rates to FCP7 XML timebase + ntsc', () => {
    expect(xmlRate(R.r23976)).toEqual({ timebase: 24, ntsc: true });
    expect(xmlRate(R.r2997)).toEqual({ timebase: 30, ntsc: true });
    expect(xmlRate(R.r25)).toEqual({ timebase: 25, ntsc: false });
  });
  it('converts frames, ticks and seconds without drift over long durations', () => {
    for (const r of Object.values(R)) {
      for (const f of [0, 1, 23, 24, 1799, 1800, 17982, 107892, 863136]) {
        expect(ticksToFrames(framesToTicks(f, r), r)).toBe(f);
        expect(secondsToFrames(framesToSeconds(f, r), r, 'floor')).toBe(f);
        expect(secondsToFrames(framesToSeconds(f, r), r, 'ceil')).toBe(f);
      }
    }
    expect(framesToTicks(48, R.r23976)).toBe(508540032000); // pproTicksIn of the spike clip
    expect(TICKS_PER_SECOND / ticksPerFrame(R.r23976)).toBeCloseTo(fps(R.r23976), 9);
  });
  it('rounds seconds to frames as asked', () => {
    const half = framesToSeconds(10.5, R.r25);
    expect(secondsToFrames(half, R.r25, 'floor')).toBe(10);
    expect(secondsToFrames(half, R.r25, 'ceil')).toBe(11);
  });
});

describe('timecode', () => {
  it('labels 29.97 drop-frame at the minute boundaries', () => {
    expect(framesToTimecode(1799, R.r2997)).toBe('00:00:59;29');
    expect(framesToTimecode(1800, R.r2997)).toBe('00:01:00;02');
    expect(framesToTimecode(17981, R.r2997)).toBe('00:09:59;29');
    expect(framesToTimecode(17982, R.r2997)).toBe('00:10:00;00');
    expect(framesToTimecode(107892, R.r2997)).toBe('01:00:00;00');
  });
  it('labels 59.94 drop-frame (4 dropped labels per minute)', () => {
    expect(framesToTimecode(3599, R.r5994)).toBe('00:00:59;59');
    expect(framesToTimecode(3600, R.r5994)).toBe('00:01:00;04');
    expect(framesToTimecode(35964, R.r5994)).toBe('00:10:00;00');
  });
  it('round-trips every frame of the first 40 minutes at 29.97 DF and 59.94 DF', () => {
    for (const r of [R.r2997, R.r5994]) {
      for (let f = 0; f < 40 * 60 * fps(r); f += 1) {
        const tc = framesToTimecode(f, r);
        if (timecodeToFrames(tc, r) !== f) throw new Error(`${f} → ${tc} → ${timecodeToFrames(tc, r)}`);
      }
    }
  });
  it('round-trips non-drop rates and can force NDF at 29.97', () => {
    for (const r of [R.r23976, R.r24, R.r25, R.r30, R.r50, R.r60]) {
      for (const f of [0, 1, 59, 1440, 86399, 86400, 999999]) expect(timecodeToFrames(framesToTimecode(f, r), r)).toBe(f);
    }
    expect(framesToTimecode(1800, R.r2997, { dropFrame: false })).toBe('00:01:00:00');
    expect(timecodeToFrames('00:01:00:00', R.r2997)).toBe(1800);
    expect(framesToTimecode(86400, R.r23976)).toBe('01:00:00:00');
  });
  it('rejects labels that drop-frame skips and frames beyond the base', () => {
    expect(() => timecodeToFrames('00;01;00;00', R.r2997)).toThrow(/does not exist/);
    expect(() => timecodeToFrames('00;01;00;01', R.r2997)).toThrow(/does not exist/);
    expect(timecodeToFrames('00;10;00;00', R.r2997)).toBe(17982);
    expect(() => timecodeToFrames('00:00:01:25', R.r25)).toThrow(/out of range/);
  });
});

describe('parseTime', () => {
  it('reads seconds, ms, m:ss, frames and timecode', () => {
    expect(parseTime(3.5)).toBe(3.5);
    expect(parseTime('3.5s')).toBe(3.5);
    expect(parseTime('250ms')).toBe(0.25);
    expect(parseTime('1:02.5')).toBe(62.5);
    expect(parseTime('1:00:02')).toBe(3602);
    expect(parseTime('12f', R.r24)).toBe(0.5);
    expect(parseTime('00:00:01:12', R.r24)).toBe(1.5);
    expect(parseTime('00;01;00;02', R.r2997)).toBeCloseTo(1800 * 1001 / 30000, 9);
    expect(() => parseTime('00:00:01:12')).toThrow(/frame rate/);
    expect(() => parseTime('soon')).toThrow(/use seconds/);
  });
  it('formats readable clocks', () => {
    expect(clock(62.53)).toBe('1:02.5');
    expect(clock(3725)).toBe('1:02:05.0');
    expect(clock(5.04, 2)).toBe('0:05.04');
  });
});
