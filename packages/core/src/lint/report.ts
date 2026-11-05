// Lint report format shared by ae-compose (comp lint, style lint) and pr-cut (edit lint): one issue per finding,
// formatted one line each, errors first, for build/edit reports.

export type Severity = 'error' | 'warn' | 'info';

export interface ReportIssue<R extends string = string> {
  rule: R;
  severity: Severity;
  message: string;
  /** Time range the issue covers, seconds (comp or sequence time). */
  t?: [number, number];
}

const ORDER: Record<Severity, number> = { error: 0, warn: 1, info: 2 };
const LABEL: Record<Severity, string> = { error: 'error', warn: 'warn', info: 'note' };

/** One line per issue, errors first, then warnings, then notes (stable within a severity). */
export function formatIssues(issues: ReportIssue[]): string[] {
  return [...issues].sort((x, y) => ORDER[x.severity] - ORDER[y.severity]).map((i) => `${LABEL[i.severity]} [${i.rule}] ${i.message}`);
}

/** Counts per severity, for summaries ("lint: 1 error, 3 warnings"). */
export function summarizeIssues(issues: ReportIssue[]): string {
  const n = (s: Severity) => issues.filter((i) => i.severity === s).length;
  const parts = [[n('error'), 'error'], [n('warn'), 'warning'], [n('info'), 'note']].filter(([c]) => c) as [number, string][];
  return parts.length ? parts.map(([c, w]) => `${c} ${w}${c === 1 ? '' : 's'}`).join(', ') : 'clean';
}
