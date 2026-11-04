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

## Built so far (Phase 3)
- ES3 runtime (build/inspect/edit/snapshot/describe/layout), TS→ES3 toolchain, bridge client + dialog watchdog + recovery, aec CLI (doctor passes), MCP server (17 tools).
- DSL + compiler: layers, transforms, text docs/runs, per-unit text animators, shapes/pen/SVG, effects (fuzzy names), masks, mattes, controls + EG, layout containers (solved in AE), 3D (renderer table, cameras, DOF, orbit rig, lights + HDRI, materials, extrusion, models), particles (9 systems + presets), motion blur modes.
- Easing verified numerically in AE (11/11). Edit ops with curve re-easing; one-step undo verified.

## Next
1. Gradients via generated .ffx presets (and .aepx gradient read).
2. Variants + Compare comp; sticky-controls and live-control verification (change a control, re-snapshot).
3. Effect catalog harvest for all vanilla effects → generated TS types.
4. 3D layout helpers (ZStack/Grid3D/Circle3D), model animation selection, camera move helpers (dolly/pushIn).
5. The 14 showcase scenes in examples/ (look at every contact sheet), plus the Remotion quality-bar comparison.
6. Skill (skills/ae-compose/SKILL.md) + docs/DSL.md + README sections; tests (codegen snapshots, round-trip, edits on assets/handmade/languages_proj copy, seeds); independent review subagent; REPORT.md.

## Open issues
- AE crashes `(0 :: 42)` from shape-gradient internals: fenced (D15). One crash with no script running happened while the `Blue Dwarf V0` dev plugins were installed; they have since been removed (D18). No crashes since.
- Renderer quality settings are not scriptable (documented limitation).
