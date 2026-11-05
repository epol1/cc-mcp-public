// Text documents. addText() inherits the user's Character panel, so every field is reset and set explicitly.
import type { Ctx } from './ctx';
import { fail, warn } from './ctx';
import { has } from './util';

export interface TextDocSpec {
  text: string;
  font?: string; // PostScript name, e.g. "Inter-Bold"
  size?: number;
  fill?: number[] | null; // null → no fill
  stroke?: number[] | null;
  strokeWidth?: number;
  strokeOverFill?: boolean;
  tracking?: number;
  leading?: number | 'auto';
  justify?: 'left' | 'center' | 'right' | 'justifyLeft' | 'justifyCenter' | 'justifyRight' | 'justifyAll';
  caps?: 'normal' | 'all' | 'small';
  fauxBold?: boolean;
  fauxItalic?: boolean;
  baselineShift?: number;
  hScale?: number; // percent
  vScale?: number;
  tsume?: number;
  ligature?: boolean;
  kerning?: 'metrics' | 'optical' | 'none';
  box?: { w: number; h: number };
  /** Shrink the font (to at most 60 %) until the text is no wider than this, in layer pixels (reframe, auto-fit). */
  fitWidth?: number;
  runs?: { start: number; end: number; font?: string; size?: number; fill?: number[]; stroke?: number[]; tracking?: number; baselineShift?: number; fauxBold?: boolean }[];
}

const JUST: { [k: string]: string } = {
  left: 'LEFT_JUSTIFY', center: 'CENTER_JUSTIFY', right: 'RIGHT_JUSTIFY',
  justifyLeft: 'FULL_JUSTIFY_LASTLINE_LEFT', justifyCenter: 'FULL_JUSTIFY_LASTLINE_CENTER',
  justifyRight: 'FULL_JUSTIFY_LASTLINE_RIGHT', justifyAll: 'FULL_JUSTIFY_LASTLINE_FULL',
};

function rgb(c: number[]): number[] {
  return [c[0], c[1], c[2]];
}

export function makeTextDocument(ctx: Ctx, base: TextDocument, s: TextDocSpec): TextDocument {
  const td: any = base;
  td.text = s.text;
  try { td.resetCharStyle(); } catch (e) { /* older AE */ }
  try { td.resetParagraphStyle(); } catch (e) { /* older AE */ }
  if (s.font) td.font = s.font;
  td.fontSize = s.size !== undefined ? s.size : 72;
  if (s.fill === null) td.applyFill = false;
  else { td.applyFill = true; td.fillColor = rgb(s.fill || [1, 1, 1]); }
  if (s.stroke) {
    td.applyStroke = true;
    td.strokeColor = rgb(s.stroke);
    td.strokeWidth = s.strokeWidth !== undefined ? s.strokeWidth : 2;
    td.strokeOverFill = s.strokeOverFill === true;
  } else td.applyStroke = false;
  td.tracking = s.tracking || 0;
  if (s.leading === undefined || s.leading === 'auto') td.autoLeading = true;
  else { td.autoLeading = false; td.leading = s.leading; }
  const j = JUST[s.justify || 'left'];
  if (!j) fail(ctx, 'unknown justification ' + s.justify);
  td.justification = (ParagraphJustification as any)[j];
  // allCaps/smallCaps/superscript/subscript are read-only in AE 26.5; the *Option enums are the writable API (verified).
  td.fontCapsOption = s.caps === 'all' ? FontCapsOption.FONT_ALL_CAPS : s.caps === 'small' ? FontCapsOption.FONT_SMALL_CAPS : FontCapsOption.FONT_NORMAL_CAPS;
  td.fontBaselineOption = FontBaselineOption.FONT_NORMAL_BASELINE;
  td.fauxBold = s.fauxBold === true;
  td.fauxItalic = s.fauxItalic === true;
  td.baselineShift = s.baselineShift || 0;
  // Scripting uses multipliers (1 = 100%), unlike the Character panel's percents (verified: 100 → 100× text).
  td.horizontalScale = (s.hScale !== undefined ? s.hScale : 100) / 100;
  td.verticalScale = (s.vScale !== undefined ? s.vScale : 100) / 100;
  td.tsume = s.tsume || 0;
  if (s.ligature !== undefined) td.ligature = s.ligature;
  if (s.box && td.boxText) { td.boxTextSize = [s.box.w, s.box.h]; }
  if (s.runs) {
    for (let i = 0; i < s.runs.length; i++) {
      const r = s.runs[i];
      const cr: any = td.characterRange(r.start, r.end);
      if (r.font) cr.font = r.font;
      if (r.size !== undefined) cr.fontSize = r.size;
      if (r.fill) { cr.applyFill = true; cr.fillColor = rgb(r.fill); }
      if (r.stroke) { cr.applyStroke = true; cr.strokeColor = rgb(r.stroke); }
      if (r.tracking !== undefined) cr.tracking = r.tracking;
      if (r.baselineShift !== undefined) cr.baselineShift = r.baselineShift;
      if (r.fauxBold !== undefined) cr.fauxBold = r.fauxBold;
    }
  }
  return td;
}

export function setTextDocument(ctx: Ctx, layer: TextLayer, s: TextDocSpec): void {
  const sp = layer.property('ADBE Text Properties').property('ADBE Text Document') as Property;
  const td = makeTextDocument(ctx, sp.value as TextDocument, s);
  sp.setValue(td);
  if (s.fitWidth && !s.box) {
    // Measured before any animator exists, at the layer's own time 0 equivalent.
    const r = layer.sourceRectAtTime(layer.inPoint, false);
    if (r.width > s.fitWidth) {
      const k = Math.max(0.6, s.fitWidth / r.width), d = sp.value as TextDocument;
      d.fontSize = d.fontSize * k;
      sp.setValue(d);
    }
  }
  if (s.font) {
    const got = (sp.value as TextDocument).font;
    if (got !== s.font) warn(ctx, 'font "' + s.font + '" not available; AE used "' + got + '"');
  }
}

export function hasRuns(s: TextDocSpec): boolean {
  return has(s, 'runs') && !!s.runs && s.runs.length > 0;
}
