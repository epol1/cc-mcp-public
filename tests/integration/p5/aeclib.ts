// F1 in AE: every aec-lib function, called the way generated expressions call it, gives the Node value in both
// modes (inlined helpers and the shared aec-lib.jsx footage item). onPath/pathAngle run on a real shape path.
import { libFunctionNames, libObject, withLib, writeLibFile, LIB_ITEM } from '../../../src/aeclib/index.ts';
import { check, done, es } from './harness.ts';

const L = libObject();
// One call per function; each expression returns a number (arrays/strings reduced to a number).
const CALLS: Record<string, string> = {
  clamp: 'L.clamp(7, 0, 5)', lerp: 'L.lerp(2, 10, 0.25)', remap: 'L.remap(5, 0, 10, 100, 200)', smooth: 'L.smooth(0, 1, 0.3)',
  step: 'L.step(17, 5)', wrap: 'L.wrap(-3, 0, 10)', mixv: 'L.mixv([0, 10], [10, 30], 0.5)[1]',
  hash: 'L.hash(12, 3)', rand: 'L.rand(4, 2, 10, 20)', srand: 'L.srand(9, 1)', pick: 'L.pick([3, 5, 7], 6, 2)',
  noise1: 'L.noise1(2.7, 4)', noise2: 'L.noise2(1.3, 2.9, 5)',
  bezier: 'L.bezier(0.16, 1, 0.3, 1, 0.4)', eased: 'L.eased([0.65, 0, 0.35, 1], 0.3)', tween: 'L.tween(0.5, 0, 2, [0, 0], [100, 50], [0.37, 0, 0.63, 1])[1]',
  spring: 'L.spring(0.37, 30, 12, 170, 1)', overshoot: 'L.overshoot(0.3, 20, 2, 4)', inertia: 'L.inertia(800, 0.2, 2, 5)', bounce: 'L.bounce(0.42, 300)', follow: 'L.follow(2, 3, 0.1)',
  stagger: 'L.stagger(3, 10, 0.1, 2) + L.stagger(3, 10, 0.1, 4, 9)', cascade: 'L.cascade(400, 800)',
  line: 'L.line(2, 5, 120, 30)[1]', grid: 'L.grid(7, 12, 4, 100, 80)[0]', circle: 'L.circle(3, 8, 300, 10, 270)[0]', circleAngle: 'L.circleAngle(3, 8, 10, 270)',
  scatter: 'L.scatter(41, 100, 1600, 900, 7)[1]', sphere: 'L.sphere(5, 30, 400)[2]', helix: 'L.helix(4, 20, 200, 600, 3)[0]',
  onPath: 'L.onPath(thisComp.layer("path").content("Group 1").content("Path 1").path, 0.3)[0]',
  pathAngle: 'L.pathAngle(thisComp.layer("path").content("Group 1").content("Path 1").path, 0.3)',
  falloff: 'L.falloff(180, 200, 60)', radial: 'L.radial([120, 40, 10], [0, 0, 0], 150, 60)', box: 'L.box([120, 0], [0, 0], [200, 100], 40)', linear: 'L.linear([20, 0], [0, 0], 30, 100)',
  hsl: 'L.hsl(210, 0.5, 0.4)[2]', toHsl: 'L.toHsl([0.2, 0.4, 0.8, 1])[0]', shade: 'L.shade([0.2, 0.4, 0.8, 1], 20, -0.1, 0.1)[0]', hex: 'L.hex("#4683c4")[1]',
  palette: 'L.palette([1, 2, 3], 7)', gradient: 'L.gradient([[0, 0, 0], [1, 0.5, 0], [1, 1, 1]], 0.6)[1]',
  pulse: 'L.pulse(1.05, [1, 2], 0.1)', since: 'L.since(2.5, [1, 2])',
  pad: 'L.pad(7, 3).length', num: 'L.num(1234567.891, 2).length', scramble: 'L.scramble("HELLO WORLD", 0.5, 3, 1).charCodeAt(7)', typed: 'L.typed("HELLO", 0.6, "|", 0, 0).length',
};
const missing = libFunctionNames().filter((n) => !CALLS[n]);
check('every library function has a call in this scene', missing.length === 0, missing.join(', '));

const file = writeLibFile();
const names = Object.keys(CALLS);
const exprs = names.flatMap((n) => [withLib(`// aec-lib ${n}\n${CALLS[n]};`, 'inline'), withLib(`// aec-lib ${n}\n${CALLS[n]};`, 'footage')]);
const res = await es(`
var out = [];
app.beginUndoGroup("aec-lib check");
var it = app.project.importFile(new ImportOptions(new File(${JSON.stringify(file)}))); it.name = ${JSON.stringify(LIB_ITEM)};
var c = app.project.items.addComp("_check_aeclib", 400, 400, 1, 2, 30);
var sh = c.layers.addShape(); sh.name = "path";
var g = sh.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
var pth = g.property("ADBE Vectors Group").addProperty("ADBE Vector Shape - Group");
var s = new Shape(); s.vertices = [[0, 0], [200, 0], [200, 100]]; s.inTangents = [[0, 0], [0, 0], [0, 0]]; s.outTangents = [[0, 0], [0, 0], [0, 0]]; s.closed = false;
pth.property("ADBE Vector Shape").setValue(s);
var n = c.layers.addNull(), fxp = n.property("ADBE Effect Parade");
var E = ${JSON.stringify(exprs)};
for (var i = 0; i < E.length; i++) { var p = fxp.addProperty("ADBE Slider Control").property(1); p.expression = E[i]; out.push(p.valueAtTime(0, false) + "|" + String(p.expressionError).replace(/[^A-Za-z0-9 .:]/g, " ").substring(0, 120)); }
var nullSrc = n.source;
app.endUndoGroup();
c.remove(); it.remove(); try { nullSrc.remove(); } catch (e) {}
out.join(String.fromCharCode(10));`);
const rows = res.split('\n');
// Node reference for path calls: the same 3-point open path.
const P = [[0, 0], [200, 0], [200, 100]];
const pathRef: Record<string, number> = { onPath: NaN, pathAngle: NaN };
void P;
names.forEach((n, i) => {
  const want = n in pathRef ? NaN : new Function('L', `return (${CALLS[n]});`)(L);
  for (const [k, mode] of [[0, 'inline'], [1, 'footage']] as const) {
    const [v, err] = rows[2 * i + k].split('|');
    const ok = !err.trim() && (Number.isNaN(want) ? Number.isFinite(+v) : Math.abs(+v - +want) < 1e-6 * Math.max(1, Math.abs(+want)));
    check(`${n} (${mode})`, ok, `AE ${v} vs Node ${want} ${err.trim()}`);
  }
});
done();
