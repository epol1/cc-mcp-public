// Text form of a build/edit report, shared by the MCP tools and the CLI.
import type { BuildReport } from './build.ts';

export function reportText(r: BuildReport): string {
  const lines = [
    `${r.sequence ? `sequence "${r.sequence.name}" (${r.sequence.id})` : 'dry run (Premiere untouched)'} — ${r.timecode} (${r.durationSeconds} s), built via ${r.path}, ${r.undoSteps} undo step${r.undoSteps === 1 ? '' : 's'} (undo reverts it in one call)`,
    `tightening: ${r.stats.sourceSeconds} s of source in ${r.stats.pieces} pieces; removed ${r.stats.removed.fillers} fillers, ${r.stats.removed.repeats} repeated words, ${r.stats.removed.pauses} pauses (${r.stats.removed.pauseSeconds} s); ${r.stats.jumpCuts} jump cuts; ${r.stats.broll} B-roll, ${r.stats.music} music, ${r.stats.titles} titles`,
    'segments:',
    ...r.segments.map((s) => `- ${s.id}${s.beat ? ` [${s.beat}]` : ''} @${s.at} ${s.seconds}s ${s.pieces} piece${s.pieces === 1 ? '' : 's'}: "${s.text}"${s.match ? ` (quote ${Math.round(s.match.score * 100)} %)` : ''}`),
    `lint: ${r.lintSummary}`, ...r.lint.map((l) => `- ${l}`),
    ...(r.warnings.length ? ['warnings:', ...r.warnings.map((w) => `- ${w}`)] : []),
    ...(r.contactSheet ? [`contact sheet: ${r.contactSheet}`] : []), ...(r.strips ? [`cut strips: ${r.strips}`] : []),
  ];
  return lines.join('\n');
}
