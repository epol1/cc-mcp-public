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
See `docs/ARCHITECTURE.md` §1. In short:
- `src/shared` holds pure TS that runs in **both** Node and the ES3 runtime. It must follow the ES3 rules in `docs/research/toolchain.md` §6.8: no getters/setters, no async, no generators, no `JSON`/`Map`/`Set`/`Object.keys`/`[].map` (use the helpers).
- `src/runtime` is ES3-only code compiled by Babel + Rollup. `src/**` outside those two is Node 22 TS.
- Keep modules small and single-purpose, with explicit types at boundaries and a short header comment saying what the module is for.
- Tests are specs: `tests/unit` (no AE), `tests/integration` (needs AE + bridge, tagged), `tests/codegen` (snapshots).

## Verifying in AE
- The bridge health check is `GET http://127.0.0.1:47811/health`. The token is in `~/.ae-compose/bridge.json`.
- Look at the output: every scene change gets a contact sheet that you actually view before calling it done.
