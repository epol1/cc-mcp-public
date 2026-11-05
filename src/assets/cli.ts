// Child-process entry for `asset:` refs resolved at compile time (resolve.ts): `cache <id> [variant]` downloads
// into the cache and prints one JSON line { main, files, id, variant }. Errors go to stderr with exit code 1.
import { toCache } from './fetch.ts';

const [cmd, id, variant] = process.argv.slice(2);
if (cmd !== 'cache' || !id) { console.error('usage: cli.ts cache <id> [variant]'); process.exit(2); }
toCache(id, { variant: variant || undefined }).then(
  (c) => { process.stdout.write(JSON.stringify({ id: c.hit.id, variant: c.variant.label, main: c.main, files: c.files }) + '\n'); },
  (e) => { process.stderr.write(String(e?.message ?? e) + '\n'); process.exit(1); },
);
