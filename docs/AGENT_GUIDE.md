# Agent guide: developing ae-compose

This is for AI agents (and humans) working **on** this repository. To *use* ae-compose for motion design, read `skills/ae-compose/SKILL.md` instead.

## Start of every session
1. Read `GOAL.md` (the spec), then `docs/PROGRESS.md` (where we are), then `docs/DECISIONS.md` (why things are the way they are).
2. Check the roadmap in `status/systems.json`. The dashboard is `status/index.html` (`node status/build.mjs` regenerates it).
3. Continue from PROGRESS "Next". Never start over.

## House rules
- **Roadmap is living data.** When you discover work that isn't listed, add a task to `status/systems.json` (id, name, status `todo|wip|done`, weight 1–5) in the right system, or add a system. Mark tasks `wip` when you start and `done` when they're verified.
- **Releases** go through `node scripts/release.mjs "short description"`. It bumps `VERSION` (`vX.XX.XXX`; `--minor` for phase milestones), runs unit tests, regenerates the dashboard with a history point, commits `vX.XX.XXX short description` and pushes `main` to `origin` (private `epol1/ae-compose`). Release at natural checkpoints. No feature branches or worktrees unless a task truly needs isolation.
- **Decisions**: append a row to `docs/DECISIONS.md` for any non-obvious choice, with a one-line rationale.
- **Progress**: keep `docs/PROGRESS.md` current (phase, done, next, open issues).

## AE safety (non-negotiable)
- Never read or write shape-gradient internals (`ADBE Vector Grad Colors`, G-Fill/G-Stroke subproperties). It crashes AE 26.5 (D15). Use the `.ffx`/`.aepx` paths.
- Never read or write `.value` on `CUSTOM_VALUE` properties.
- Probe unknown AE APIs one feature per eval, with step logging (D16), in a throwaway comp/project.
- Every mutating request runs in **one eval** inside **one undo group**.
- Vanilla AE only: never apply Red Giant or other third-party effects (D2, D19).
- Never take full-desktop screenshots; capture only AE's windows (`src/bridge/dialogs`).
- If AE shows a dialog or crashes, use the watchdog/recovery tools rather than asking the user, unless a human decision is genuinely needed.

## Code layout and conventions
See `docs/ARCHITECTURE.md` §1 and `docs/PRCUT.md` §1. In short:
- Workspace packages: `packages/core` (`@ae-mcp/core`: code both tools share: bridge contract, watchdog, visual, captions, beats, motion, lint report, assets, transcription, media library, timecode) and `packages/pr-cut` (`@ae-mcp/pr-cut`: the Premiere tool). ae-compose itself is the root package in `src/`. Import shared code as `@ae-mcp/core/<path>.ts`; scenes bundle it through an esbuild alias (`src/scene/load.ts`).
- `src/shared` holds pure TS that runs in **both** Node and the ES3 runtime. It must follow the ES3 rules in `docs/research/toolchain.md` §6.8: no getters/setters, no async, no generators, no `JSON`/`Map`/`Set`/`Object.keys`/`[].map` (use the helpers).
- `src/runtime` is ES3-only code compiled by Babel + Rollup. `src/**` outside those two is Node 22 TS.
- Keep modules small and single-purpose, with explicit types at boundaries and a short header comment saying what the module is for.
- Tests are specs: `tests/unit` (no AE), `tests/integration` (needs AE + bridge, tagged), `tests/codegen` (snapshots). Phase 5 AE checks live in `tests/integration/p5/*.ts` (PASS/FAIL lines; `harness.ts` gives build → check → one-undo-restores-exactly → lint) and run under `pnpm test:ae`.
- Premiere checks live in `tests/premiere/*.ts` (PASS/FAIL lines, a throwaway test project `scratch/pr/tests/pr-cut-tests.prproj`) and run under `pnpm test:pr`, so `pnpm test:ae` never needs Premiere.
- After changing `src/runtime/*`, run `pnpm build:runtime`: AE loads `dist/runtime/aec-runtime.jsx`, not the sources.
- Hand-written ExtendScript (probes, the designer panel): parenthesize nested `?:` (ExtendScript's conditional is left-associative, D82) and avoid empty undo groups before an Edit > Undo (the undo then reverts the previous real step).
- DSL components run bundled from a temp folder: to reach repo files they use `globalThis.__AEC_ROOT__` (set by `src/scene/load.ts`), and they report warnings with `dslWarn()`.

## Premiere safety (non-negotiable)
- Never modify the user's sequences or media: builds create new sequences, edits create versions (`Name v002`). Never relink media without asking.
- Probe unknown Premiere APIs one feature per eval in a throwaway project; pass native paths (`File.fsName`) to file APIs; never import a file that doesn't exist (it opens a modal dialog).
- Never address sequences by index (`app.project.sequences` re-sorts); use `sequenceID`. Before any QE call on "the active sequence", check `qe.project.getActiveSequence().guid` is the intended one.
- Undo by the journal (`undo` steps back to the batch's starting index); never by counting undo steps.
- Vanilla Premiere only (Colorista and other third-party effects are installed; never use them).

## Verifying in AE
- The bridge health check is `GET http://127.0.0.1:47811/health`. The token is in `~/.ae-compose/bridge.json`.
- Look at the output: every scene change gets a contact sheet that you actually view before calling it done.
