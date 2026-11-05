# Progress

> On resume: read `GOAL.md`, then this file, then `docs/DECISIONS.md` and `docs/AGENT_GUIDE.md`. Continue from **Next**. Never start over.
> Roadmap and dashboard: `status/systems.json` → `status/index.html` (`node status/build.mjs`). Release: `node scripts/release.mjs "msg"`.

## Current phase
**Phase 5, the creative toolkit** (spec `docs/TOOLKIT.md`, goal `GOAL-PHASE5.md`, roadmap: the "P5 ·" groups in `status/systems.json`).

### Phase 5 so far
- **§11 verifications (D73, D74):** `footage().sourceData` libraries work on 26.5 but aren't cached (a missing file disables every expression using it) and cost ~3× per call, so the library is inlined by default. Pseudo effects generated as .ffx work, the .aep stores their definition, and a fresh `aerender` rendered a copy with our presets moved away.
- **F1 expression library** (`src/aeclib/aec-lib.js`, 49 functions: easing/physics, seeded random/noise, distributions, falloffs, timing, color, text, markers). Expressions call `L.fn(...)`; the compiler adds the functions used (inline) or binds the shared `aec-lib.jsx` item (`lib: 'footage'`). Every function checked in AE in both modes (`tests/integration/p5/aeclib.ts`).
- **F2 rig effects** (`src/compile/ffx/pseudo.ts`, `rigfx.ts`, `<RigEffect>`): grouped `control(..., { group })`, live text reveals (`live: true`), live camera moves (default). Sticky values cover every rig param.
- **Migrated** text-unit reveals, spring rigs, camera moves and marker bursts (bursts now fire on every marker with the comment). Ripple (frames identical) and live controls still pass.
- **Bug fixed (D75):** checkbox controls always read as on in expressions.
- Node-side modules from subagents, to be wired in: captions (`src/text/captions.ts`), motion analysis + speed graphs + style lint (`src/motion/`), beat detection (`src/audio/`, in progress).

**Next:** P1 cloner (master precomp + instances + overrides, distributions, data), P2 effectors, scale measurements; then wire A1/A2 into builds.

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
- **Gradient read-back (D72):** stops of every shape gradient from the saved .aep (fixture tests/fixtures/gradient-test.aep).
- **Roadmap gaps closed (D66–D70):** Range Selector text mode, text on a path, automatic per-character 3D; camera move rigs (PushIn, PullOut, Truck, Pedestal, Crane, CameraMove with shake) and ThreePointLights; multi-color Confetti; brand tokens (`brand()`, `examples/brand.ts`); SVG tree import (transforms, strokes, gradients, `<use>`) and `<Vector>` for .ai/.eps/.pdf; typed camera/light/material/geometry/particles/gradient edit ops; `recover_ae`; occlusion lint.
- **Final renders (D65):** `render` / `aec render` → `renders/` next to the project (or `~/.ae-compose/renders/`); MP4, ProRes 422/HQ/4444, PNG/TIFF sequences, AVI. A scripted render (and a full cache purge) clears AE's undo history; `undo` now knows and says so.
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
1. Motion previews the agent can judge (GIF strips or velocity graphs after builds).
2. A live crash test of `recover_ae` (the launch and force paths are only mock-tested).
3. Pixel-level lint (occlusion and overlap are judged by bounds today).
4. Bezier-aware ripple splits; `stagger()` / `interpolate()` helpers.
5. Keyframed gradient stops and `addTextAnimator` (the last planned edit ops).

Also: `undo` should detect an AE session whose undo history is not recording (D61) and say so instead of reporting success; dolly/push-in rig helpers, Range Selector text mode, text on path, multi-color confetti.

## Open issues
- AE crashes `(0 :: 42)` from shape-gradient internals: fenced (D15). One crash with no script running happened while the `Blue Dwarf V0` dev plugins were installed; they have since been removed (D18). No crashes since.
- Renderer quality settings are not scriptable (documented limitation). Model embedded-animation selection is not scriptable (open).
- Rebuilding a scene keeps layers that edits added to its comps (they're untagged; documented in DSL.md).
- The one unexplained undo miss after lint (2026-11-04) is most likely a disk-cache purge right after that build: AE clears undo history on purge (D65). The guard now purges far less often and `undo` reports a cleared history.
- AE's disk cache fills fast during snapshot-heavy sessions; the guard purges it (D62), and the user should cap Maximum Disk Cache Size in AE preferences.
- Edit `set` keys default to `easeInOutCubic`; DSL `keys()` default to `easeOutCubic` (documented; consider aligning).
