# GOAL (Phase 5): the ae-compose creative toolkit

> **How to run this:** open Claude Code in `E:\Projects\ae-mcp` with After Effects 2026 running, and say: *"Read GOAL-PHASE5.md and execute it end to end."*

## 0. Why

ae-compose is built and verified. Phases 0–4 of GOAL.md are done: the compiler, bridge, inspector, edits, ripple, lint, renders, 14 showcases, and a 100 % roadmap at v0.00.017. Now I want to make more ambitious, more creative work with less effort, for example:

- **Procedural arrays:** 100 cards with subtle variations swiping across the screen, or a MASH-style cloner of anything.
- **Product UI sequences:** buttons, cursors, scrolling feeds, device frames.
- **Data stories, captions and music-synced promos.**

All of it must stay native, editable, and tweakable by me in AE.

The full design is in **`docs/TOOLKIT.md`**. Read it first: it is the spec for this phase. The roadmap is the "P5 ·" groups in `status/systems.json` (36 tasks).

## 1. Read first (resume rules)

1. `docs/AGENT_GUIDE.md` (session start, AE safety rules, release flow), then `docs/PROGRESS.md`, `docs/DECISIONS.md` (D1–D72) and `docs/TOOLKIT.md`.
2. `skills/ae-compose/SKILL.md`, especially §2 "Direct it like a motion designer". Every tool you build must make that direction easier to follow, not harder.
3. Resume from `docs/PROGRESS.md`. Never start over. Keep it current as you go.

## 2. Operating rules (carry over, non-negotiable)

- **Vanilla AE only.** No Red Giant or any third-party plugin, and no compiled plugins of our own (TOOLKIT §8). Projects must open and render on any stock AE 2026.
- **Verify everything in the installed AE** and look at the output. Contact sheets for every build, and render previews where motion feel matters. Lint must be clean, or each warning explained.
- **Work autonomously.** Record decisions with their rationale in `docs/DECISIONS.md` (continue from D73). Add newly discovered tasks to the roadmap.
- **Use parallel subagents** for independent research or verification, plus an independent reviewer before the phase is called done.
- **Release often** with `node scripts/release.mjs "short description"`. The version format is vX.XX.XXX, committed straight to `main`, with typecheck and unit tests as gates.
- **AE safety:**
  - Never read or write shape-gradient Colors by script; use .ffx presets and the saved-file reader (D15, D72).
  - Probe unknown APIs one feature per eval.
  - Never call `renderQueue.render()` inside an undo group (D65).
  - A scripted render and a full cache purge clear AE's undo history; the runtime tracks this.
  - Never force-kill or restart AE without asking me.
  - Never modify my original projects: work on copies or imports.
  - Never switch a project's bit depth.
  - Tell me before deleting anything to free disk space.
- **Craft rules for every showcase:**
  - Story beats first.
  - Every element has a reason to be on screen.
  - Transitions grow out of the scene and don't repeat.
  - Real holds after things land: arrive → hold → leave.
  - No slide furniture (persistent titles, corner labels, category numbers) unless the brief asks for it.

## 3. Scope and order (TOOLKIT §9)

1. **Foundations:** F1 expression library `aec-lib.jsx` and F2 rig presets with one effect per rig, then migrate the existing rigs. Do the two verifications first: `footage().sourceData` function libraries on 26.5, and pseudo effects in presets opening without our presets installed. If either fails, choose the fallback in TOOLKIT and log the decision.
2. **Procedural:** P1 cloner (master precomp + instances + Essential Properties overrides; verified possible on 2026-11-04) with all distributions, data-driven instances, then P2 effectors and the large-count fallback. Measure build and render times at 100 and 300 instances.
3. **Agent quality:** A1 motion previews (GIF strips + speed graphs) and A2 style lint, then A3 storyboard scaffolding.
4. **Delivery:** A4 responsive reframe (16:9 → 9:16 / 1:1) and delivery packs through the render tool.
5. **Kits:** K1 UI kit (components, cursor and states, ScrollView, frames), K2 data viz, K3 typography (SRT/VTT captions with word timing, emphasis, decode, variable fonts, auto-fit), K4 transitions library.
6. **Sync and reuse:** A5 beat sync, A6 recipe library.
7. **Optional:** P3 path tools, P4 procedural backgrounds and the designer panel, if the showcases haven't already pulled them in.

## 4. Showcases (new, original, professional)

Build each one with the toolkit, review it from contact sheets and motion previews, and keep it lint and style-lint clean:

- **15:** 100 cards with subtle variations sweep across the screen, built from one cloner component, then resolve into a clear message. The card master, speed and seed are live in AE.
- **16:** a product UI demo: a cursor drives button states, a scrolling feed from data, a device frame, and a payoff.
- **17:** a data story: a chart builds, the key number lands and holds, and an annotation explains it.
- **18:** a music-synced promo: cuts and accents on beats, transitions from scene elements, an end card that holds.

## 5. Testing (every tool)

- **Unit tests:** compile output and pure helpers.
- **An AE integration test per tool:**
  - it builds or edits;
  - the inspector confirms the result;
  - one undo restores the comp exactly;
  - lint runs.
- **Earlier suites stay green:** round-trip, edit ops, edit-3d, render, renderer/seeds, ripple, live controls, gradient edit, quality compare.
- **A fresh session** using only the skill + MCP builds an original piece with the cloner, a UI sequence and a beat-synced cut, and reviews it unaided.

## 6. Definition of done

TOOLKIT §10, all of it:

1. Foundations built and migrated.
2. The cloner with distributions and effectors, live-controlled.
3. The UI, data viz and typography kits, and the transitions library.
4. Motion previews and style lint on every build and edit, reframe, delivery packs, beat sync and recipes.
5. Showcases 15–18 done.
6. Every tool documented in `docs/DSL.md` and the skill.
7. Tests green, the fresh-session test passed, and REPORT.md updated with what was built, its limits, and the next improvements ranked.

The P5 roadmap groups at 100 % on the dashboard.
