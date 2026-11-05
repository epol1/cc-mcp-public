// Execution backend contract shared by ae-compose and pr-cut. AE: CEP (HTTP) and AfterFX.com (file).
// Premiere: the pr-cut CEP bridge (ExtendScript) and the pr-cut UXP plugin behind the same hub.

export interface EvalOk { ok: true; result: string; ms: number }
export interface EvalErr {
  ok: false;
  error: string;
  /** ExtendScript error class, e.g. "SyntaxError" */
  errorName?: string;
  line?: number;
  timedOut?: boolean;
  /** Present when the watchdog found a modal dialog blocking the app. */
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
  readonly name: 'cep' | 'afterfx' | 'pr-cep' | 'pr-uxp';
  /** Evaluate a script in the app (ES3 for ExtendScript, modern JS for UXP) and return the string value of its result. */
  eval(script: string, opts?: { timeoutMs?: number }): Promise<EvalResult>;
  health(): Promise<{ ok: boolean; detail?: string }>;
}
