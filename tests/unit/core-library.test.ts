// Spec for the media library database and search (packages/core/src/library), on a temporary database.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aec-lib-'));
process.env.AEC_LIBRARY_DIR = dir;
const db = await import('@ae-mcp/core/library/db.ts');
const { search, formatHits } = await import('@ae-mcp/core/library/search.ts');

beforeAll(() => {
  const iv = db.upsertMedia({ hash: 'aaa111', path: 'D:/shoot/ana.mp4', name: 'ana.mp4', folder: 'D:/shoot', kind: 'video', duration: 1800, status: 'done', role: 'interview', width: 1920, height: 1080, orientation: 'horizontal' });
  db.setSentences(iv, [
    { sid: 's1', w0: 0, w1: 9, start: 1, end: 5, text: 'We were losing a customer every single day.' },
    { sid: 's2', w0: 10, w1: 22, start: 6, end: 12, text: 'Then we rebuilt the onboarding around speed.' },
  ]);
  const b = db.upsertMedia({ hash: 'bbb222', path: 'D:/broll/desk_typing.mp4', name: 'desk_typing.mp4', folder: 'D:/broll', kind: 'video', duration: 14, status: 'done', role: 'broll', width: 1080, height: 1920, orientation: 'vertical' });
  db.setShots(b, [{ n: 1, start: 0, end: 6 }, { n: 2, start: 6, end: 14 }], 'desk_typing.mp4');
  db.annotateShot(b, 2, { description: 'close-up of hands typing on a laptop keyboard', tags: ['laptop', 'work'], shot_type: 'close' });
  db.upsertMedia({ hash: 'ccc333', path: 'D:/music/bed.wav', name: 'bed.wav', folder: 'D:/music', kind: 'audio', duration: 150, status: 'done', role: 'music', tempo: 118 });
});

describe('library search', () => {
  it('finds what was said, with the sentence id and time range', () => {
    const h = search('losing customers every day');
    expect(h[0]).toMatchObject({ name: 'ana.mp4', via: 'said', start: 1, end: 5 });
    expect(h[0].text).toMatch(/^s1:/);
    expect(formatHits(h)).toMatch(/lib:\d+ ana\.mp4 \(interview/);
  });
  it('finds what was seen from shot descriptions and tags (stemmed)', () => {
    const h = search('hands typing laptop');
    expect(h[0]).toMatchObject({ name: 'desk_typing.mp4', via: 'seen', start: 6, end: 14 });
  });
  it('falls back to any word when every word finds too little', () => {
    expect(search('rebuilt pricing').some((x) => x.name === 'ana.mp4')).toBe(true);
  });
  it('filters by role, orientation and tempo; an empty query lists', () => {
    expect(search('', { role: 'music' }).map((x) => x.name)).toEqual(['bed.wav']);
    expect(search('', { orientation: 'vertical' }).map((x) => x.name)).toEqual(['desk_typing.mp4']);
    expect(search('', { minTempo: 120 })).toEqual([]);
  });
  it('keeps shot descriptions when shots are re-detected with the same boundaries', () => {
    const m = db.mediaByHash('bbb222')!;
    db.setShots(m.id, [{ n: 1, start: 0, end: 6 }, { n: 2, start: 6, end: 14 }], m.name);
    expect(db.shotsOf(m.id)[1].description).toMatch(/hands typing/);
    expect(search('keyboard')[0].name).toBe('desk_typing.mp4');
  });
  it('resolves lib: ids to paths, and says when a known file has moved', () => {
    expect(() => db.libraryPath(String(db.mediaByHash('aaa111')!.id))).toThrow(/file is gone/);
    expect(db.libraryPath('999999')).toBeNull();
  });
});
