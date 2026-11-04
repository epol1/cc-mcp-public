// Spec for src/shared/units.ts: time strings and color parsing.
import { describe, expect, it } from 'vitest';
import { parseColor, parseTime, rgb, snapFrame } from '../../src/shared/units.ts';

const close = (a: number[], b: number[], digits = 9) => {
  expect(a.length).toBe(b.length);
  a.forEach((x, i) => expect(x, `component ${i}`).toBeCloseTo(b[i], digits));
};

describe('parseTime', () => {
  it('numbers are seconds and pass through unchanged', () => {
    expect(parseTime(0, 30)).toBe(0);
    expect(parseTime(1.25, 30)).toBe(1.25);
    expect(parseTime(-0.5, 24)).toBe(-0.5);
  });
  it('seconds, milliseconds and frames (frames use the comp fps)', () => {
    expect(parseTime('1.5s', 30)).toBe(1.5);
    expect(parseTime('6s', 30)).toBe(6);
    expect(parseTime('400ms', 30)).toBeCloseTo(0.4, 12);
    expect(parseTime('12f', 30)).toBeCloseTo(0.4, 12);
    expect(parseTime('12f', 24)).toBeCloseTo(0.5, 12);
    expect(parseTime('-0.25s', 30)).toBe(-0.25);
  });
  it('timecode hh:mm:ss:ff and mm:ss', () => {
    expect(parseTime('00:00:02:15', 30)).toBeCloseTo(2.5, 12);
    expect(parseTime('00:00:02:15', 25)).toBeCloseTo(2.6, 12);
    expect(parseTime('01:02:03:00', 30)).toBe(3723);
    expect(parseTime('1:30', 30)).toBe(90);
  });
  it('plain numeric strings and surrounding whitespace are accepted', () => {
    expect(parseTime('2', 30)).toBe(2);
    expect(parseTime(' 3s ', 30)).toBe(3);
    expect(parseTime('250 ms', 30)).toBeCloseTo(0.25, 12);
  });
  it('undefined/null fall back (default 0)', () => {
    expect(parseTime(undefined, 30)).toBe(0);
    expect(parseTime(undefined, 30, 7)).toBe(7);
    expect(parseTime(null as any, 30, 3)).toBe(3);
  });
  it('invalid strings throw with the accepted formats in the message', () => {
    for (const bad of ['abc', '', '2S', '1.5sec', '10px', '1e3ms', '00:02:15']) {
      expect(() => parseTime(bad, 30), JSON.stringify(bad)).toThrow(/invalid time/);
    }
    expect(() => parseTime('abc', 30)).toThrow(/"400ms".*"12f"/);
  });
  // Regression (was a bug, fixed): the number regex `[\d.]+` accepts malformed numbers, which become NaN instead of an error
  // (src/shared/units.ts:10-15). parseTime('1.2.3s') === NaN, parseTime('.') === NaN.
  it('malformed numbers ("1.2.3s", ".", "..ms") throw instead of returning NaN', () => {
    for (const bad of ['1.2.3s', '.', '..ms', '1..2f']) expect(() => parseTime(bad, 30), JSON.stringify(bad)).toThrow(/invalid time/);
  });
  it('snapFrame rounds to the frame grid', () => {
    expect(snapFrame(0.41, 30)).toBeCloseTo(12 / 30, 12);
    expect(snapFrame(1.019, 24)).toBeCloseTo(1, 12);
  });
});

describe('parseColor', () => {
  it('#rgb, #rrggbb, #rrggbbaa and #rgba', () => {
    close(parseColor('#fff'), [1, 1, 1, 1]);
    close(parseColor('#f80'), [1, 0x88 / 255, 0, 1]);
    close(parseColor('#4683c4'), [0x46 / 255, 0x83 / 255, 0xc4 / 255, 1]);
    close(parseColor('#FF800080'), [1, 0x80 / 255, 0, 0x80 / 255]);
    close(parseColor('#f008'), [1, 0, 0, 0x88 / 255]);
    close(parseColor('  #000000  '), [0, 0, 0, 1]);
  });
  it('rgb() / rgba(), comma or space syntax, percentages and alpha', () => {
    close(parseColor('rgb(70, 131, 196)'), [70 / 255, 131 / 255, 196 / 255, 1]);
    close(parseColor('rgb(255 128 0)'), [1, 128 / 255, 0, 1]);
    close(parseColor('rgba(255,0,0,0.5)'), [1, 0, 0, 0.5]);
    close(parseColor('rgba(255 0 0 / 50%)'), [1, 0, 0, 0.5]);
    close(parseColor('rgb(100%, 0%, 50%)'), [1, 0, 0.5, 1]);
  });
  it('hsl() / hsla()', () => {
    close(parseColor('hsl(0, 100%, 50%)'), [1, 0, 0, 1]);
    close(parseColor('hsl(120, 100%, 25%)'), [0, 0.5, 0, 1]);
    close(parseColor('hsl(240 100% 50%)'), [0, 0, 1, 1]);
    close(parseColor('hsl(0, 0%, 50%)'), [0.5, 0.5, 0.5, 1]);
    close(parseColor('hsl(-120, 100%, 50%)'), [0, 0, 1, 1]); // hue wraps
    close(parseColor('hsl(480, 100%, 50%)'), [0, 1, 0, 1]);
    close(parseColor('hsla(240, 100%, 50%, 0.5)'), [0, 0, 1, 0.5]);
  });
  // Regression (was a bug, fixed): hsla() takes a percentage alpha verbatim (src/shared/units.ts:52-57): 'hsla(240,100%,50%,50%)' → alpha 50, not 0.5.
  // rgba() normalises the same input correctly.
  it('hsla() with a percentage alpha normalises it to 0..1 (like rgba())', () => {
    expect(parseColor('hsla(240, 100%, 50%, 50%)')[3]).toBeCloseTo(0.5, 9);
  });
  it('named colors, case-insensitive', () => {
    close(parseColor('white'), [1, 1, 1, 1]);
    close(parseColor('Red'), [1, 0, 0, 1]);
    close(parseColor('transparent'), [0, 0, 0, 0]);
    close(parseColor('grey'), parseColor('gray'));
    close(parseColor('orange'), [1, 0x80 / 255, 0, 1]);
  });
  it('arrays: 0–1 kept, 0–255 scaled (alpha too)', () => {
    close(parseColor([1, 0.5, 0]), [1, 0.5, 0, 1]);
    close(parseColor([0.2, 0.4, 0.6, 0.5]), [0.2, 0.4, 0.6, 0.5]);
    close(parseColor([255, 128, 0]), [1, 128 / 255, 0, 1]);
    close(parseColor([255, 0, 0, 128]), [1, 0, 0, 128 / 255]);
    close(parseColor([0, 0, 2]), [0, 0, 2 / 255, 1]); // any component > 1 means 0–255
  });
  it('unknown formats throw with examples of valid ones', () => {
    for (const bad of ['nope', '#ggg', '#12', 'rgb()x', 'cmyk(0,0,0,0)']) expect(() => parseColor(bad), bad).toThrow(/invalid color/);
    expect(() => parseColor('nope')).toThrow(/#4683c4/);
  });
  // Regression (was a bug, fixed): the hex regex accepts 5- and 7-digit hex (src/shared/units.ts:41-46) and returns garbage
  // ('#12345' → [0x12, 0x34, 0x05]/255) instead of throwing.
  it('5- and 7-digit hex colors are rejected', () => {
    expect(() => parseColor('#12345')).toThrow(/invalid color/);
    expect(() => parseColor('#1234567')).toThrow(/invalid color/);
  });
  it('rgb() drops alpha', () => {
    close(rgb('#ff000080'), [1, 0, 0]);
    expect(rgb([0.1, 0.2, 0.3, 0.4])).toHaveLength(3);
  });
});
