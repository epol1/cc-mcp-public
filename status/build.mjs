#!/usr/bin/env node
// Renders status/index.html (dashboard) and docs/ROADMAP.md from status/systems.json.
// Usage: node status/build.mjs [--record <version>]   (--record appends a point to status/history.json)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'status/systems.json'), 'utf8'));
const histPath = path.join(root, 'status/history.json');
const history = fs.existsSync(histPath) ? JSON.parse(fs.readFileSync(histPath, 'utf8')) : [];
const version = fs.existsSync(path.join(root, 'VERSION')) ? fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim() : 'v0.00.000';

const W = { done: 1, wip: 0.5, todo: 0 };
const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
const systems = data.systems.map((s) => {
  const total = sum(s.tasks, (t) => t.weight || 1);
  const done = sum(s.tasks, (t) => (t.weight || 1) * W[t.status]);
  return { ...s, total, done, pct: total ? done / total : 0 };
});
const total = sum(systems, (s) => s.total);
const done = sum(systems, (s) => s.done);
const pct = total ? (100 * done) / total : 0;
const tasksDone = sum(data.systems, (s) => s.tasks.filter((t) => t.status === 'done').length);
const tasksAll = sum(data.systems, (s) => s.tasks.length);
const dodDone = data.definitionOfDone.filter((d) => d.status === 'done').length;
const show = data.systems.find((s) => s.id === 'showcases');
const showDone = show ? show.tasks.filter((t) => t.status === 'done').length : 0;

// Optional --record: append history point (used by scripts/release.mjs before committing).
const recIdx = process.argv.indexOf('--record');
if (recIdx > 0) {
  const v = process.argv[recIdx + 1] || version;
  history.push({ version: v, date: new Date().toISOString(), pct: +pct.toFixed(2), tasksDone, tasksAll });
  fs.writeFileSync(histPath, JSON.stringify(history, null, 1) + '\n');
}
const weekAgo = Date.now() - 7 * 864e5;
const base = [...history].reverse().find((h) => Date.parse(h.date) <= weekAgo);
const week = base ? tasksDone - base.tasksDone : tasksDone; // no point older than a week: the whole project is within the window

// "Counted from the code" metrics.
function walk(dir, pred, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, pred, acc); else if (pred(p)) acc.push(p);
  }
  return acc;
}
const srcFiles = walk(path.join(root, 'src'), (p) => /\.(ts|tsx)$/.test(p));
const loc = sum(srcFiles, (p) => fs.readFileSync(p, 'utf8').split('\n').length);
const testFiles = walk(path.join(root, 'tests'), (p) => /\.test\.(ts|tsx|mjs)$/.test(p));
const testCount = sum(testFiles, (p) => (fs.readFileSync(p, 'utf8').match(/\b(it|test)\s*\(/g) || []).length);
const examples = walk(path.join(root, 'examples'), (p) => /\.tsx$/.test(p)).length;
const metrics = [['Source files', srcFiles.length], ['Lines of TS', loc], ['Test cases', testCount], ['Example scenes', examples], ['Decisions logged', (fs.readFileSync(path.join(root, 'docs/DECISIONS.md'), 'utf8').match(/^\| D\d+/gm) || []).length]];

// Squarified treemap (Bruls, Huizing, van Wijk).
function squarify(items, x, y, w, h) {
  const out = [];
  const totalV = sum(items, (i) => i.value);
  let rest = items.map((i) => ({ ...i, area: (i.value / totalV) * w * h }));
  const worst = (row, len) => { const s = sum(row, (r) => r.area); const mx = Math.max(...row.map((r) => r.area)); const mn = Math.min(...row.map((r) => r.area)); return Math.max((len * len * mx) / (s * s), (s * s) / (len * len * mn)); };
  while (rest.length) {
    const len = Math.min(w, h);
    let row = [rest[0]]; let i = 1;
    while (i < rest.length && worst([...row, rest[i]], len) <= worst(row, len)) { row.push(rest[i]); i++; }
    const s = sum(row, (r) => r.area);
    if (w >= h) { const cw = s / h; let cy = y; for (const r of row) { const ch = r.area / cw; out.push({ ...r, x, y: cy, w: cw, h: ch }); cy += ch; } x += cw; w -= cw; }
    else { const ch = s / w; let cx = x; for (const r of row) { const cw = r.area / ch; out.push({ ...r, x: cx, y, w: cw, h: ch }); cx += cw; } y += ch; h -= ch; }
    rest = rest.slice(i);
  }
  return out;
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const TW = 820, TH = 470;
const order = { done: 0, wip: 1, todo: 2 };
const rects = squarify(systems.map((s) => ({ ...s, value: s.total })).sort((a, b) => b.value - a.value), 0, 0, TW, TH);
const treemap = rects.map((r) => {
  const cells = [];
  for (const t of [...r.tasks].sort((a, b) => order[a.status] - order[b.status])) for (let k = 0; k < (t.weight || 1); k++) cells.push(t);
  const n = cells.length; const ih = Math.max(r.h - 22, 8);
  const cols = Math.max(1, Math.round(Math.sqrt((n * r.w) / ih))); const rows = Math.ceil(n / cols);
  const cw = r.w / cols, ch = ih / rows;
  const cellHtml = cells.map((t, i) => `<div class="cell ${t.status}" title="${esc(r.name + ' › ' + t.name + ' — ' + t.status)}" style="left:${(100 * (i % cols) * cw / r.w).toFixed(3)}%;top:${(100 * (22 + Math.floor(i / cols) * ch) / r.h).toFixed(3)}%;width:${(100 * cw / r.w).toFixed(3)}%;height:${(100 * ch / r.h).toFixed(3)}%"></div>`).join('');
  return `<div class="sys" style="left:${(100 * r.x / TW).toFixed(3)}%;top:${(100 * r.y / TH).toFixed(3)}%;width:${(100 * r.w / TW).toFixed(3)}%;height:${(100 * r.h / TH).toFixed(3)}%">${cellHtml}<div class="lbl">${esc(r.name)} <span>${Math.round(r.pct * 100)}%</span></div></div>`;
}).join('');

const badge = (k, v, cls) => `<div class="badge"><span class="k">${esc(k)}</span><span class="v ${cls}">${esc(v)}</span></div>`;
const bars = systems.filter((s) => s.tasks.some((t) => t.status !== 'done')).map((s) => {
  const remaining = s.tasks.filter((t) => t.status !== 'done').length;
  return { name: s.name, remaining, pct: s.pct };
}).sort((a, b) => b.remaining - a.remaining);
const maxRem = Math.max(1, ...bars.map((b) => b.remaining));
const barHtml = bars.map((b) => `<div class="bar"><div class="bn">${esc(b.name)}</div><div class="bt"><div class="bf amber" style="width:${(100 * b.remaining) / maxRem}%"></div></div><div class="bc">${b.remaining}</div></div>`).join('');
const progBars = systems.map((s) => `<div class="bar"><div class="bn">${esc(s.name)}</div><div class="bt"><div class="bf green" style="width:${(s.pct * 100).toFixed(1)}%"></div></div><div class="bc">${Math.round(s.pct * 100)}%</div></div>`).join('');
const dodHtml = data.definitionOfDone.map((d) => `<li class="${d.status}"><span class="dot"></span>${esc(d.name)}</li>`).join('');
const showHtml = show ? show.tasks.map((t) => `<div class="sc ${t.status}" title="${esc(t.name + ' — ' + t.status)}">${esc(t.name.slice(0, 2))}</div>`).join('') : '';
const issuesHtml = (data.issues || []).map((i) => `<li class="${i.status}"><b>${esc(i.area)}</b> ${esc(i.text)} <em>${esc(i.status)}</em></li>`).join('');
const metricsHtml = metrics.map(([k, v]) => `<div class="metric"><div class="mv">${v.toLocaleString('en-US')}</div><div class="mk">${esc(k)}</div></div>`).join('');

// History chart (inline SVG).
const HW = 820, HH = 140;
const pts = history.length ? history : [{ version, pct, date: new Date().toISOString() }];
const px = (i) => (pts.length === 1 ? HW / 2 : 30 + (i * (HW - 60)) / (pts.length - 1));
const py = (p) => HH - 20 - (p / 100) * (HH - 40);
const poly = pts.map((p, i) => `${px(i).toFixed(1)},${py(p.pct).toFixed(1)}`).join(' ');
const histSvg = `<svg viewBox="0 0 ${HW} ${HH}" width="100%" height="${HH}"><line x1="30" x2="${HW - 30}" y1="${py(0)}" y2="${py(0)}" class="ax"/><line x1="30" x2="${HW - 30}" y1="${py(100)}" y2="${py(100)}" class="ax dim"/><polyline points="${poly}" class="ln"/>${pts.map((p, i) => `<circle cx="${px(i).toFixed(1)}" cy="${py(p.pct).toFixed(1)}" r="3.5" class="pt"><title>${esc(p.version + ' — ' + p.pct + '%')}</title></circle>`).join('')}${pts.length <= 14 ? pts.map((p, i) => `<text x="${px(i).toFixed(1)}" y="${HH - 4}" class="tl">${esc(p.version)}</text>`).join('') : ''}</svg>`;

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ae-compose status</title>
<style>
:root{--bg:#0d1117;--panel:#161b22;--line:#30363d;--text:#e6edf3;--mute:#8b949e;--gray:#6e7681;--green:#2ea043;--amber:#d29922;--blue:#2f81f7;--orange:#f0883e}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.4 "Segoe UI",system-ui,sans-serif}
main{max-width:1760px;margin:0 auto;padding:32px 48px}
h1{font-size:40px;margin:0 0 4px;font-weight:600}.sub{color:var(--mute);margin-bottom:18px;border-bottom:1px solid var(--line);padding-bottom:14px}
.badges{display:flex;flex-wrap:wrap;gap:12px;margin:18px 0 28px}.badge{display:flex;font-size:20px}.badge .k{background:#3a3f47;padding:6px 18px}.badge .v{padding:6px 14px;color:#fff;font-weight:600}
.v.orange{background:var(--orange)}.v.green{background:var(--green)}.v.blue{background:var(--blue)}
.grid{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:28px 40px;align-items:start}
h2{font-size:22px;font-weight:500;margin:0 0 10px}
.tm{position:relative;width:100%;aspect-ratio:${TW}/${TH}}
.sys{position:absolute;border:1px solid var(--bg);overflow:hidden;background:#22272e}
.cell{position:absolute;border:1px solid rgba(13,17,23,.85)}.cell.done{background:var(--green)}.cell.wip{background:var(--amber)}.cell.todo{background:var(--gray);opacity:.55}
.lbl{position:absolute;left:0;top:0;right:0;padding:2px 6px;font-size:13px;background:rgba(13,17,23,.72);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.lbl span{color:var(--mute)}
.bar{display:grid;grid-template-columns:220px 1fr 48px;gap:14px;align-items:center;margin:6px 0}.bn{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bt{height:20px;background:var(--gray)}.bf{height:100%}.bf.amber{background:var(--amber)}.bf.green{background:var(--green)}.bc{text-align:right;color:var(--mute)}
ul{list-style:none;margin:0;padding:0}li{margin:5px 0;display:flex;gap:10px;align-items:baseline}.dot{width:12px;height:12px;border-radius:2px;background:var(--gray);flex:none;transform:translateY(1px)}
li.done .dot{background:var(--green)}li.wip .dot{background:var(--amber)}li em{color:var(--mute);font-style:normal;font-size:13px}li.open b{color:var(--amber)}li.mitigated b{color:var(--mute)}
.scs{display:grid;grid-template-columns:repeat(7,1fr);gap:6px;margin-bottom:22px}.sc{height:46px;display:flex;align-items:center;justify-content:center;font-weight:600;color:#0d1117}.sc.done{background:var(--green)}.sc.wip{background:var(--amber)}.sc.todo{background:var(--gray);color:#c9d1d9}
.metrics{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:22px}.metric{background:var(--panel);border:1px solid var(--line);padding:10px 12px}.mv{font-size:26px;font-weight:600}.mk{color:var(--mute);font-size:13px}
svg .ax{stroke:var(--line)}svg .dim{stroke-dasharray:4 4}svg .ln{fill:none;stroke:var(--green);stroke-width:2.5}svg .pt{fill:var(--green)}svg .tl{fill:var(--mute);font-size:11px;text-anchor:middle}
.foot{color:var(--mute);margin-top:22px;font-size:13px}a{color:var(--blue)}
@media (max-width:1100px){.grid{grid-template-columns:1fr}main{padding:20px 16px}.metrics{grid-template-columns:repeat(3,1fr)}.bar{grid-template-columns:150px 1fr 40px}}
</style></head><body><main>
<h1>Status</h1>
<div class="sub">ae-compose ${esc(version)} &middot; generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC from <code>status/systems.json</code></div>
<div class="badges">${badge('overall', pct.toFixed(2) + '%', pct >= 100 ? 'green' : 'orange')}${badge('tasks done', tasksDone + '/' + tasksAll, tasksDone === tasksAll ? 'green' : 'orange')}${badge('showcases', showDone + '/' + (show ? show.tasks.length : 0), showDone === (show ? show.tasks.length : 0) ? 'green' : 'orange')}${badge('definition of done', dodDone + '/' + data.definitionOfDone.length, dodDone === data.definitionOfDone.length ? 'green' : 'orange')}${badge('done in 7 days', '+' + week + ' tasks', 'blue')}</div>
<div class="grid">
<section><h2>Systems: ${pct.toFixed(2)}% (${(+done.toFixed(1))}/${total} weighted)</h2><div class="tm">${treemap}</div></section>
<section><h2>Definition of done (${dodDone}/${data.definitionOfDone.length})</h2><ul>${dodHtml}</ul><h2 style="margin-top:22px">Showcase scenes (${showDone}/${show ? show.tasks.length : 0})</h2><div class="scs">${showHtml}</div><h2>Counted from the code</h2><div class="metrics">${metricsHtml}</div></section>
<section><h2>Remaining tasks by system (${tasksAll - tasksDone})</h2>${barHtml}</section>
<section><h2>Progress by system</h2>${progBars}</section>
<section><h2>Known issues</h2><ul>${issuesHtml || '<li>none</li>'}</ul></section>
<section><h2>Progress history</h2>${histSvg}</section>
</div>
<div class="foot">Cells: one per weight unit of each task. <span style="color:var(--green)">■</span> done <span style="color:var(--amber)">■</span> in progress <span style="color:var(--gray)">■</span> to do. Edit <code>status/systems.json</code>; this page is regenerated on every release.</div>
</main></body></html>`;
fs.writeFileSync(path.join(root, 'status/index.html'), html);

// docs/ROADMAP.md (generated).
const mark = { done: '[x]', wip: '[~]', todo: '[ ]' };
let md = `# Roadmap\n\n> Generated from \`status/systems.json\` by \`status/build.mjs\`. Do not edit by hand. Dashboard: \`status/index.html\`.\n\n**${version}**: ${pct.toFixed(2)}% weighted, ${tasksDone}/${tasksAll} tasks, ${dodDone}/${data.definitionOfDone.length} definition-of-done items. Legend: [x] done · [~] in progress · [ ] to do.\n\n`;
for (const s of systems) { md += `## ${s.name} (${Math.round(s.pct * 100)}%)\n`; for (const t of s.tasks) md += `- ${mark[t.status]} ${t.name}${t.weight > 1 ? ` _(w${t.weight})_` : ''}\n`; md += '\n'; }
md += `## Definition of done\n`; for (const d of data.definitionOfDone) md += `- ${mark[d.status]} ${d.name}\n`;
fs.writeFileSync(path.join(root, 'docs/ROADMAP.md'), md);
// status/status.svg + status/status.png: the same dashboard as a static image, because GitHub's
// README can only show Markdown and images (no styled HTML). README.md embeds the PNG.
{
  const SW = 1600, F = 'Segoe UI, Helvetica, Arial, sans-serif';
  const C = { bg: '#0d1117', panel: '#161b22', line: '#30363d', text: '#e6edf3', mute: '#8b949e', gray: '#4b525a', green: '#2ea043', amber: '#d29922', blue: '#2f81f7', orange: '#f0883e' };
  const fill = { done: C.green, wip: C.amber, todo: C.gray };
  const T = (x, y, s, size = 16, color = C.text, extra = '') => `<text x="${x}" y="${y}" font-family="${F}" font-size="${size}" fill="${color}" ${extra}>${esc(s)}</text>`;
  const parts = [];
  parts.push(T(40, 62, 'Status', 40, C.text, 'font-weight="600"'));
  parts.push(T(42, 90, `ae-compose ${version} · ${new Date().toISOString().slice(0, 10)} · generated from status/systems.json`, 15, C.mute));
  parts.push(`<line x1="40" x2="${SW - 40}" y1="106" y2="106" stroke="${C.line}"/>`);
  // badges
  let bx = 40;
  const badgeSvg = (k, v, color) => { const kw = k.length * 9.6 + 28, vw = v.length * 10.4 + 24; const s = `<rect x="${bx}" y="122" width="${kw}" height="34" fill="#3a3f47"/>${T(bx + 14, 145, k, 18)}<rect x="${bx + kw}" y="122" width="${vw}" height="34" fill="${color}"/>${T(bx + kw + 12, 145, v, 18, '#fff', 'font-weight="600"')}`; bx += kw + vw + 12; return s; };
  parts.push(badgeSvg('overall', pct.toFixed(2) + '%', pct >= 100 ? C.green : C.orange));
  parts.push(badgeSvg('tasks done', `${tasksDone}/${tasksAll}`, tasksDone === tasksAll ? C.green : C.orange));
  parts.push(badgeSvg('showcases', `${showDone}/${show ? show.tasks.length : 0}`, C.orange));
  parts.push(badgeSvg('definition of done', `${dodDone}/${data.definitionOfDone.length}`, C.orange));
  parts.push(badgeSvg('done in 7 days', `+${week} tasks`, C.blue));
  // treemap
  const MX = 40, MY = 205, MW = 880, MH = 500;
  parts.push(T(MX, MY - 12, `Systems: ${pct.toFixed(2)}% (${+done.toFixed(1)}/${total} weighted)`, 22));
  for (const r of squarify(systems.map((s) => ({ ...s, value: s.total })).sort((a, b) => b.value - a.value), MX, MY, MW, MH)) {
    parts.push(`<rect x="${r.x.toFixed(1)}" y="${r.y.toFixed(1)}" width="${r.w.toFixed(1)}" height="${r.h.toFixed(1)}" fill="#22272e" stroke="${C.bg}" stroke-width="2"/>`);
    const cells = [];
    for (const t of [...r.tasks].sort((a, b) => order[a.status] - order[b.status])) for (let k = 0; k < (t.weight || 1); k++) cells.push(t);
    const ih = Math.max(r.h - 22, 8), cols = Math.max(1, Math.round(Math.sqrt((cells.length * r.w) / ih))), rows = Math.ceil(cells.length / cols);
    const cw = r.w / cols, ch = ih / rows;
    cells.forEach((t, i) => parts.push(`<rect x="${(r.x + (i % cols) * cw + 1).toFixed(1)}" y="${(r.y + 22 + Math.floor(i / cols) * ch + 1).toFixed(1)}" width="${Math.max(cw - 2, 1).toFixed(1)}" height="${Math.max(ch - 2, 1).toFixed(1)}" fill="${fill[t.status]}" ${t.status === 'todo' ? 'opacity="0.75"' : ''}/>`));
    const label = r.name.length * 7.6 > r.w - 40 ? r.name.slice(0, Math.max(3, Math.floor((r.w - 44) / 7.6))) + '…' : r.name;
    parts.push(`<rect x="${(r.x + 1).toFixed(1)}" y="${(r.y + 1).toFixed(1)}" width="${(r.w - 2).toFixed(1)}" height="20" fill="${C.bg}" opacity="0.8"/>`);
    parts.push(T((r.x + 6).toFixed(1), (r.y + 16).toFixed(1), label, 13) + T((r.x + r.w - 34).toFixed(1), (r.y + 16).toFixed(1), Math.round(r.pct * 100) + '%', 12, C.mute));
  }
  // right column: definition of done, showcases, metrics
  const RX = 970;
  parts.push(T(RX, MY - 12, `Definition of done (${dodDone}/${data.definitionOfDone.length})`, 22));
  data.definitionOfDone.forEach((d, i) => { const y = MY + 8 + i * 26; parts.push(`<rect x="${RX}" y="${y}" width="13" height="13" rx="2" fill="${fill[d.status] || C.gray}"/>` + T(RX + 22, y + 12, d.name, 15)); });
  const SY = MY + 8 + data.definitionOfDone.length * 26 + 30;
  parts.push(T(RX, SY, `Showcase scenes (${showDone}/${show ? show.tasks.length : 0})`, 22));
  (show ? show.tasks : []).forEach((t, i) => { const x = RX + (i % 7) * 86, y = SY + 14 + Math.floor(i / 7) * 48; parts.push(`<rect x="${x}" y="${y}" width="80" height="42" fill="${fill[t.status]}"/>` + T(x + 30, y + 27, t.name.slice(0, 2), 16, t.status === 'todo' ? '#c9d1d9' : C.bg, 'font-weight="600"')); });
  const MY2 = SY + 14 + 2 * 48 + 26;
  parts.push(T(RX, MY2, 'Counted from the code', 22));
  metrics.forEach(([k, v], i) => { const x = RX + i * 118, y = MY2 + 12; parts.push(`<rect x="${x}" y="${y}" width="110" height="62" fill="${C.panel}" stroke="${C.line}"/>` + T(x + 10, y + 32, v.toLocaleString('en-US'), 22, C.text, 'font-weight="600"') + T(x + 10, y + 52, k, 12, C.mute)); });
  // bottom: remaining work bars + history
  const BY = Math.max(MY + MH + 50, MY2 + 12 + 62 + 46);
  const top = bars.slice(0, 10);
  parts.push(T(MX, BY, `Remaining tasks by system (${tasksAll - tasksDone})`, 22));
  top.forEach((b, i) => { const y = BY + 16 + i * 26; parts.push(T(MX, y + 15, b.name, 15) + `<rect x="${MX + 230}" y="${y + 2}" width="560" height="18" fill="${C.gray}"/><rect x="${MX + 230}" y="${y + 2}" width="${((560 * b.remaining) / maxRem).toFixed(1)}" height="18" fill="${C.amber}"/>` + T(MX + 805, y + 16, String(b.remaining), 15, C.mute)); });
  parts.push(T(RX, BY, 'Progress history', 22));
  const hx0 = RX, hw = 590, hy0 = BY + 20, hh = 200;
  const hp = pts.map((p, i) => [hx0 + (pts.length === 1 ? hw / 2 : (i * hw) / (pts.length - 1)), hy0 + hh - (p.pct / 100) * hh]);
  parts.push(`<rect x="${hx0}" y="${hy0}" width="${hw}" height="${hh}" fill="${C.panel}" stroke="${C.line}"/>`);
  for (const g of [25, 50, 75]) parts.push(`<line x1="${hx0}" x2="${hx0 + hw}" y1="${hy0 + hh - (g / 100) * hh}" y2="${hy0 + hh - (g / 100) * hh}" stroke="${C.line}" stroke-dasharray="4 4"/>` + T(hx0 + hw + 6, hy0 + hh - (g / 100) * hh + 4, g + '%', 11, C.mute));
  parts.push(`<polyline points="${hp.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="${C.green}" stroke-width="3"/>`);
  hp.forEach(([x, y]) => parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="${C.green}"/>`));
  if (pts.length) parts.push(T(hx0 + 8, hy0 + 20, `${pts[0].version} → ${pts[pts.length - 1].version}: ${pts[pts.length - 1].pct}%`, 13, C.mute));
  const SH = BY + 16 + Math.max(top.length * 26, hh + 10) + 40;
  parts.push(`<text x="${MX}" y="${SH - 14}" font-family="${F}" font-size="13" fill="${C.mute}">Cells: one per weight unit of each task.  <tspan fill="${C.green}">■</tspan> done  <tspan fill="${C.amber}">■</tspan> in progress  <tspan fill="${C.gray}">■</tspan> to do</text>`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SW}" height="${SH}" viewBox="0 0 ${SW} ${SH}"><rect width="100%" height="100%" fill="${C.bg}"/>${parts.join('')}</svg>`;
  fs.writeFileSync(path.join(root, 'status/status.svg'), svg);
  try {
    const sharp = (await import('sharp')).default;
    await sharp(Buffer.from(svg), { density: 96 }).png({ compressionLevel: 9 }).toFile(path.join(root, 'status/status.png'));
  } catch (e) {
    console.warn('status.png not rendered (sharp unavailable):', e.message);
  }
}
console.log(`status: ${pct.toFixed(2)}% | tasks ${tasksDone}/${tasksAll} | DoD ${dodDone}/${data.definitionOfDone.length} | wrote status/index.html, status/status.{svg,png}, docs/ROADMAP.md`);
