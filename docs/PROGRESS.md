# Progress

> On resume: read `GOAL.md`, then this file, then `docs/DECISIONS.md` and `docs/AGENT_GUIDE.md`. Continue from **Next**. Never start over.
> Roadmap and dashboard: `status/systems.json` → `status/index.html` (`node status/build.mjs`). Release: `node scripts/release.mjs "msg"`.

## Current phase
**Phase 3: Build.** Phases 0–2 are done (environment, research, architecture).

## Done
- **Phase 0**: environment discovered (`docs/ENVIRONMENT.md`). CEP bridge installed and verified (~50 ms eval). `AfterFX.com -r` fallback verified (~1.1 s). Assets gathered from the user's own projects (`assets/SOURCES.md`). Hand-built fixture: `assets/handmade/languages_proj/`.
- **Phase 1**: research reports in `docs/research/` (toolchain, prior art, Remotion/Lottie/easing) and the AE 26.5 API verification summary in `docs/RESEARCH.md` §1 (raw dumps in `docs/research/ae-verify/`).
- **Phase 2**: `docs/ARCHITECTURE.md`, with agent-first as principle zero; decisions D21–D28.
- Dialog watchdog prototype (`scratch/p1/aewin.ps1`) verified on the full crash → relaunch → Crash Repair flow.
- Status dashboard and release flow (`status/`, `scripts/release.mjs`). Private GitHub repo `epol1/ae-compose`.

## Next (Phase 3 build order, GOAL §5)
1. Package scaffold: `package.json`, pnpm, TS config, vitest, Babel/Rollup ES3 runtime build + post-pass.
2. Bridge client in TS (CEP + AfterFX backends, dialog watchdog module, recovery), then `aec doctor` and hello world through the real pipeline.
3. IR schema, then runtime core (`ensure`, `json`, undo wrapper, safety fence), then codegen skeleton.
4. Core layers and transforms, keys and **eases verified numerically with `valueAtTime`**.
5. Text (incl. animators/selectors), shapes (pen, ops, gradients via `.ffx`), footage.
6. Effects catalog + generated types. Then controls, variants, layout, 3D, particles, inspector, edits, visual, CLI/MCP/skill, watch.

## Open issues
- AE crashes `(0 :: 42)` from shape-gradient internals: fenced (D15). One crash with no script running happened while the `Blue Dwarf V0` dev plugins were installed; they have since been removed (D18). No crashes since.
- Renderer quality settings are not scriptable (documented limitation).
