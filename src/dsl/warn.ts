// Warnings from DSL components (they run inside the compiler but have no context object): collected here and
// drained into the build report by the compiler after each compile.
const sink: string[] = [];

export function dslWarn(msg: string): void {
  if (!sink.includes(msg)) sink.push(msg);
}

export function drainDslWarnings(): string[] {
  return sink.splice(0, sink.length);
}
