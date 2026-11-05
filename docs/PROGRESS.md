# Progress

> On resume: read `GOAL.md`, then this file, then `docs/DECISIONS.md` and `docs/AGENT_GUIDE.md`. Continue from **Next**. Never start over.
> Roadmap and dashboard: `status/systems.json` → `status/index.html` (`node status/build.mjs`). Release: `node scripts/release.mjs "msg"`.

## Current phase
**Phase 3 complete: the GOAL §7 Definition of Done is met** (evidence in `docs/REPORT.md`). Work now is the planned features below and whatever the user asks for next.

## Done
- **Phase 0**: environment discovered (`docs/ENVIRONMENT.md`). CEP bridge installed and verified (~50 ms eval). `AfterFX.com -r` fallback verified (~1.1 s). Assets gathered from the user's own projects (`assets/SOURCES.md`). Hand-built fixture: `assets/handmade/languages_proj/`.
- **Phase 1**: research reports in `docs/research/` (toolchain, prior art, Remotion/Lottie/easing) and the AE 26.5 API verification summary in `docs/RESEARCH.md` §1 (raw dumps in `docs/research/ae-verify/`).
- **Phase 2**: `docs/ARCHITECTURE.md`, with agent-first as principle zero; decisions D21–D28.
- Dialog watchdog prototype (`scratch/p1/aewin.ps1`) verified on the full crash → relaunch → Crash Repair flow.
- Status dashboard and release flow (`status/`, `scripts/release.mjs`). Private GitHub repo `epol1/ae-compose`.

## Built so far (Phase 3)
- **Core:** ES3 runtime (build/inspect/edit/snapshot/describe/layout/ripple/preview), TS→ES3 toolchain, bridge client, dialog watchdog, auto-cancel of probe dialogs (D54), zod IR validation before AE (`src/ir/schema.ts`), AE disk-cache guard (D62), `aec` CLI (doctor passes), MCP server (18 tools).
- **DSL + compiler:**
  - layers, transforms, text documents and runs, per-unit text animators (with `anchor: 'end'` exits), shapes/pen/SVG, effects (fuzzy names, popup labels), masks (rounded rects), mattes;
  - controls (with `plus()` staggers) and EG;
  - layout containers (solved in AE);
  - 3D (renderer table, cameras, DOF, orbit rig, lights + HDRI, materials, extrusion, models, 3D layout helpers);
  - particles (9 systems + presets), motion blur modes;
  - gradients via .ffx (D47), variants + Compare (D48);
  - named Sequences → scene markers.
- **Effect catalog:** 391/397 vanilla effects harvested → `src/catalog/params.json` + `src/dsl/effects.generated.ts`.
- **Lint (D63):** every build and edit returns a lint report (reading time, frame edges, action/title safe, text overlap, box overflow, missing fonts, near-empty frames, linear-only moves); `lint_comp` / `aec lint` for any comp. All 13 scene showcases lint clean after re-staging 01, 10, 11, 12 and 14 (D64).
- **Skill:** SKILL.md §2 "Direct it like a motion designer" (story beats, intention, transitions from scene elements, arrive → hold → leave).
- **Edits:**
  - property/curve/effect/text/path/layer/comp ops;
  - ripple (D50), place + key + preview_item (D52);
  - atomic batches with rollback (D53); one-step undo.
- **Verified in AE:**
  - round-trip: 588 properties (matrix + showcases 01/05/10/12) match the IR;
  - edit ops: 26/26 on the hand-built project, each undone exactly in one step;
  - renderer switching and seed determinism: pass;
  - easing 11/11; live controls 0.000 px, sticky 3/3;
  - ripple: frames pixel-identical after the shift;
  - greenscreen place → key → background → animate → undo;
  - Remotion side by side (kinetic type): timing matches, AE at least as good (`docs/quality/kinetic-compare.png`).
- **Docs:** `docs/DSL.md` (copied to `skills/ae-compose/reference/DSL.md` on release), `skills/ae-compose/SKILL.md` + `recipes.md`, README, ARCHITECTURE (unbuilt parts marked planned), REPORT (what to try first, next 5 improvements).
- **Tests:** unit/codegen tests pass (`pnpm test:unit`, including 21 IR-schema tests). Bugs found by the test agent and the independent reviewer are fixed and kept as regression tests. AE integration checks in `tests/integration/` pass: round-trip, edit ops, renderer + seeds, ripple, live controls, ease. Watch mode works.
- **Showcases:** all 14 built, reviewed from contact sheets and iterated.
- **MCP:** a fresh headless Claude Code session using only the skill and the MCP tools built, reviewed, fixed and ripple-edited a title card unaided (REPORT.md).

## Next
The ranked list is in `docs/REPORT.md` ("Next 5 improvements"):
1. Final renders: a `render` tool (Render Queue, output module and path, report the file). The user asked where finished renders go; today there are only review frames and previews in `~/.ae-compose/out/`.
2. Motion previews the agent can judge (GIF strips or velocity graphs after builds).
3. Gradient read-back (`.aepx`) and a `setGradient` op.
4. Automatic recovery from AE hangs and crashes.
5. Occlusion-aware lint (footage or shapes covering text); bezier-aware ripple splits; `stagger()` / `interpolate()` helpers.

Also: `undo` should detect an AE session whose undo history is not recording (D61) and say so instead of reporting success; dolly/push-in rig helpers, Range Selector text mode, text on path, multi-color confetti.

## Open issues
- AE crashes `(0 :: 42)` from shape-gradient internals: fenced (D15). One crash with no script running happened while the `Blue Dwarf V0` dev plugins were installed; they have since been removed (D18). No crashes since.
- Renderer quality settings are not scriptable (documented limitation). Model embedded-animation selection is not scriptable (open).
- Rebuilding a scene keeps layers that edits added to its comps (they're untagged; documented in DSL.md).
- Seen once (2026-11-04, not reproduced in 4 reruns): right after a standalone lint, one undo did not remove a linted test build. All undo suites pass; watch for it (possibly D61's undo-history problem).
- AE's disk cache fills fast during snapshot-heavy sessions; the guard purges it (D62), and the user should cap Maximum Disk Cache Size in AE preferences.
- Edit `set` keys default to `easeInOutCubic`; DSL `keys()` default to `easeOutCubic` (documented; consider aligning).
