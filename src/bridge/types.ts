// Execution backend contract. CEP (HTTP) and AfterFX.com (file) implement it; UXP can later.

export interface EvalOk { ok: true; result: string; ms: number }
export interface EvalErr {
  ok: false;
  error: string;
  /** ExtendScript error class, e.g. "SyntaxError" */
  errorName?: string;
  line?: number;
  timedOut?: boolean;
  /** Present when the watchdog found a modal dialog blocking AE. */
  dialogs?: DialogInfo[];
  ms?: number;
}
export type EvalResult = EvalOk | EvalErr;

export interface DialogInfo {
  hwnd: number;
  title: string;
  cls: string;
  owned: boolean;
  /** Path of a PNG capture of just the dialog window (AE draws its own controls, so images are the reliable readout). */
  capture?: string;
  /** Button labels when UI Automation can read them (standard Windows dialogs only). */
  buttons?: string[];
  texts?: string[];
}

export interface Backend {
  readonly name: 'cep' | 'afterfx';
  /** Evaluate ES3 source in AE and return the string value of its last expression. */
  eval(script: string, opts?: { timeoutMs?: number }): Promise<EvalResult>;
  health(): Promise<{ ok: boolean; detail?: string }>;
}
