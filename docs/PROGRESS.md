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
- **Core:** ES3 runtime (build/inspect/edit/snapshot/describe/layout/ripple/preview), TS→ES3 toolchain, bridge client, dialog watchdog, auto-cancel of probe dialogs (D54), recovery, `aec` CLI (doctor passes), MCP server (18 tools).
- **DSL + compiler:**
  - layers, transforms, text documents and runs, per-unit text animators (with `anchor: 'end'` exits), shapes/pen/SVG, effects (fuzzy names, popup labels), masks (rounded rects), mattes;
  - controls (with `plus()` staggers) and EG;
  - layout containers (solved in AE);
  - 3D (renderer table, cameras, DOF, orbit rig, lights + HDRI, materials, extrusion, models, 3D layout helpers);
  - particles (9 systems + presets), motion blur modes;
  - gradients via .ffx (D47), variants + Compare (D48);
  - named Sequences → scene markers.
- **Effect catalog:** 391/397 vanilla effects harvested → `src/catalog/params.json` + `src/dsl/effects.generated.ts`.
- **Edits:**
  - property/curve/effect/text/path/layer/comp ops;
  - ripple (D50), place + key + preview_item (D52);
  - atomic batches with rollback (D53); one-step undo.
- **Verified in AE:**
  - easing 11/11;
  - live controls 0.000 px, sticky 3/3;
  - ripple: frames pixel-identical after the shift;
  - greenscreen place → key → background → animate → undo.
- **Docs:** `docs/DSL.md` (19 sections; 61 examples type-check and compile), `skills/ae-compose/SKILL.md` + `recipes.md`.
- **Tests:** 253 unit/codegen tests pass (`npm run test:unit`). The 12 bugs the test agent found are fixed and kept as regression tests.

## Next
1. Showcases 01–14 in `examples/` (01–05 written; build each, review the contact sheet, iterate). 09 = edit demo on an imported copy of `languages_proj` (never `app.open`: import the .aep).
2. Integration tests in AE: inspector round-trip, edit ops + undo on the hand-built copy, ripple (`scratch/p3/ripple-test.ts` → tests/integration), seeds.
3. Watch mode check; MCP from Claude Code (`claude -p --mcp-config .mcp.json`); a fresh session using only the skill.
4. ARCHITECTURE.md: mark unbuilt items (lint, interpolate/stagger helpers, dolly/pushIn rigs, Range Selector mode) as planned or remove them.
5. README (install, setup checklist, CLI, MCP for Claude Code/Desktop, 5-minute quickstart), REPORT.md, independent DoD review, release.

## Open issues
- AE crashes `(0 :: 42)` from shape-gradient internals: fenced (D15). One crash with no script running happened while the `Blue Dwarf V0` dev plugins were installed; they have since been removed (D18). No crashes since.
- Renderer quality settings are not scriptable (documented limitation). Model embedded-animation selection is not scriptable (open).
- Rebuilding a scene keeps layers that edits added to its comps (they're untagged). Decide whether `replace` should remove them, or keep the current behavior and document it.
- Edit `set` keys default to `easeInOutCubic`; DSL `keys()` default to `easeOutCubic` (documented; consider aligning).
