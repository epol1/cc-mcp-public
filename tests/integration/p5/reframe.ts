// A4 in AE: a 16:9 scene reframed to 9:16 and 1:1 builds sibling comps at the right sizes, lint-clean against the
// vertical platform zone, the long word shrinks to fit, and the reframe build undoes in its steps. The delivery pack
// (last: renders clear AE's undo history) writes an mp4 per target plus a ProRes master with the right sizes.
import fs from 'node:fs';
import { buildScene, deliverScene, undo } from '../../../src/api/index.ts';
import { check, done, es, findComp } from './harness.ts';

const FILE = 'examples/01-kinetic-type/scene.tsx';
for (const n of ['KineticType_v001_9x16', 'KineticType_v001_1x1']) await es(`(function(){ var c = ${findComp(n)}; if (c) c.remove(); return "ok"; })()`);
const r = await buildScene({ file: FILE }, { frames: 0, reframe: ['9:16', '1:1'], motion: false });
check('reframe builds', r.ok, r.error ?? '');
const size = async (n: string) => es(`var c = ${findComp(n)}; c ? c.width + "x" + c.height : "none"`);
check('9:16 comp is 1080×1920', (await size('KineticType_v001_9x16')) === '1080x1920');
check('1:1 comp is 1080×1080', (await size('KineticType_v001_1x1')) === '1080x1080');
check('lint is clean on both (9:16 judged against the platform zone)', !!r.lint && r.lint.length === 2 && r.lint.every((l) => l.ok && !l.issues.some((i) => i.severity === 'warn')), r.lint?.flatMap((l) => l.lines).join(' | '));
const fs9 = +(await es(`var c = ${findComp('KineticType_v001_9x16')}; var s = 0; for (var i = 1; i <= c.numLayers; i++) if (c.layer(i).name === "ae-compose") s = c.layer(i).property("ADBE Text Properties").property("ADBE Text Document").value.fontSize; s`));
check('the long lockup word shrank to fit (font size below 0.8 × the 16:9 size)', fs9 > 0 && fs9 < 0.8 * 200, String(fs9));
const u = await undo(r.undoSteps ?? 2);
check('one undo step per reframed comp removes them', u.ok && (await size('KineticType_v001_9x16')) === 'none' && (await size('KineticType_v001_1x1')) === 'none', JSON.stringify(u));

const d = await deliverScene({ file: 'tests/integration/foundations-scene.tsx' }, { targets: ['16:9', '9:16', '1:1'], master: 'prores', quality: 'draft' });
check('delivery pack: 3 mp4 + 1 master', d.ok && d.renders.length === 4, d.errors.join('; '));
const dims = d.renders.map((x) => `${x.target}${x.master ? '*' : ''}=${x.w}x${x.h}:${x.codec}`).join(' ');
check('delivery files exist with the right sizes and codecs', d.renders.every((x) => fs.existsSync(x.file)) && /16:9=1920x1080:h264/.test(dims) && /16:9\*=1920x1080:prores/.test(dims) && /9:16=1080x1920:h264/.test(dims) && /1:1=1080x1080:h264/.test(dims), dims);
done();
