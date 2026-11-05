// Warnings from DSL components (they run inside the compiler but have no context object): collected here and
// drained into the build report by the compiler after each compile.
// One sink on globalThis: bundled scenes carry their own copy of this module, so a module-level array would split.
const sink: string[] = ((globalThis as any).__AEC_DSL_WARNINGS__ ??= []);

export function dslWarn(msg: string): void {
  if (!sink.includes(msg)) sink.push(msg);
}

export function drainDslWarnings(): string[] {
  return sink.splice(0, sink.length);
}
