// APIs present in AE 26.5 but missing or mistyped in types-for-adobe 7.2.6 (verified on this machine).
interface ArrayLike<T> { readonly length: number; readonly [n: number]: T }
/** CompItem.saveFrameToPng returns this task object in AE 26.5 (D12). */
interface AeFrameTask { wait(): void; onComplete: (() => void) | null; onError: ((e: unknown) => void) | null; readonly _isReady: boolean }
interface Application { restart(): void }
declare var $: Helper & { global: any; hiresTimer: number; fileName: string; evalFile(file: File | string, timeout?: number): any };
