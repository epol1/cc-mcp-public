# ae-compose — Report

What was built, how it was verified against the installed After Effects 2026 (26.5), and what is limited or
left. Decisions with rationale are in [DECISIONS.md](DECISIONS.md) (D1–D59); the roadmap with live status is
[`status/systems.json`](../status/systems.json) / [ROADMAP.md](ROADMAP.md).

## Definition of Done (GOAL §7)

| Item | Status | Evidence |
|---|---|---|
| `aec doctor` passes | ✅ | 14 checks green on this machine (AE 26.5, CEP 12 bridge, runtime, ffmpeg, sharp, bpc, Inter) |
| 3D fully controllable | ✅ | Showcase 10: Advanced 3D, glTF model, HDRI environment, shadows, extrusion + bevel, orbit camera, DOF. Showcase 11: Classic 3D dolly, DOF, motion blur. Showcase 13: 3D carousel. Renderer table read from AE's own strings (D36/D37). |
| Particles fully controllable | ✅ | CC Particle World presets with live controls; emitter following a layer; bursts by time or by comp marker; textured particles; Particle Playground; Star Burst; Pixel Polly (showcases 12–14; D41/D42) |
| All 14 showcases build and look professional | ✅ | `examples/01…14`, each built and its contact sheet reviewed and iterated (layout, contrast, framing, timing fixes recorded in D57) |
| Live controls in every showcase | ✅ | Every scene exposes controls on a Controls null and in Essential Graphics. 08: per-variant Accent Color / Headline Delay. 09: `addControls` adds Map Delay / Map Speed to a hand-built move. Verified numerically: 0.000 px between the expected curve and AE after changing controls in AE (D49) |
| Variants and compare | ✅ | Showcase 08: A/B/C sibling comps + `EndCard_v001_Compare` grid labelled with the params that differ (D48) |
| Inspector round-trip tests pass | ✅ | `tests/integration/roundtrip.ts`: 3 scenes, 53 layers. Names, timing, key counts and key times, and expressions in AE all match the compiled IR |
| Edit ops on a hand-built project, each undoable in one step | ✅ | Showcase 09 on `assets/handmade/languages_proj` (a real client project, not made by ae-compose): re-ease, glow, ripple, live controls. One undo restores the outline exactly (`comp restored: true`). Batches are atomic (D53) |
| MCP usable from Claude Code; fresh session with only the skill succeeds | see §MCP | `.mcp.json` registration; headless `claude -p` run from an empty folder with only the skill + MCP tools |
| README and docs complete | ✅ | README (install, setup checklist, CLI, MCP for Claude Code/Desktop, quickstart, showcase table), DSL reference (61 checked examples), skill + recipes, architecture (unbuilt parts marked planned), decisions, research, progress |
| REPORT.md | ✅ | this file |

## What exists

- **DSL + compiler** (`src/dsl`, `src/compile`): Remotion-style TSX → IR. It covers:
  - layers, Sequence/Series timing, transforms with exact eases;
  - springs: Remotion-exact, fitted to keys, or a closed-form expression with live physics;
  - per-unit text animators (Expression Selector), text documents and style runs, Essential Graphics text;
  - shapes, pen paths and SVG import, .ffx gradients, masks (rounded rects), mattes;
  - effects by name, with popup labels and typed params for 391 harvested vanilla effects;
  - controls (slider/angle/checkbox/color/point/dropdown/layer, with `plus()` staggers);
  - layout containers solved in AE with real text metrics;
  - 3D (cameras, rigs, lights, HDRI, materials, extrusion, models, 3D layout helpers);
  - particles, motion blur (switch / CC Force Motion Blur / Pixel Motion Blur), variants.
- **ES3 runtime** (`src/runtime`, built to `dist/runtime/aec-runtime.jsx`, ~137 KB): it does the following in AE:
  - build: one eval, one undo group, staged passes;
  - inspect (outline/full);
  - edit (atomic batches);
  - ripple, preview/sample, snapshot, effect description.
- **Edits** (`src/edit/ops.ts`):
  - set/ease/easeKey/interpolation/retime/layerTiming;
  - effects add/set/remove/move, text, path, layer, add/remove/duplicate layer;
  - comp, precompose, duplicateComp;
  - addControls (live timing rig on hand-built keys);
  - **ripple** (insert/remove/stretch time, scenes, hold at the quietest moment; precomp-aware);
  - **place** (project media or files as layers);
  - **key** (Keylight + Advanced Spill Suppressor with an auto-sampled screen color);
  - raw.
- **Bridge** (`packages/bridge-cep`, `src/bridge`):
  - background CEP extension, HTTP on 127.0.0.1 with a token, hot-reloading server;
  - `AfterFX.com -r` fallback;
  - dialog watchdog, which lists, captures and answers AE modals, auto-answers Crash Repair, and auto-cancels dialogs opened by read-only probes.
- **Interfaces:**
  - `aec` CLI (doctor/build/watch/inspect/edit/undo/snapshot/sheet/preview/effects/import/dialogs/eval);
  - MCP server (18 tools; images come back automatically after builds and edits);
  - Claude skill (`skills/ae-compose`).
- **Visual feedback:**
  - automatic contact sheets after every build and edit, snapshots, previews (frame capture → ffmpeg);
  - 16 bpc captures; 32 bpc is compensated but not a target.

## Verified in After Effects (not just in Node)

- **Easing:** 11/11 eased curves match `valueAtTime` within tolerance. Color speed is calibrated in 0–255 units (D31). Springs follow Remotion's curve to the last key (a former end drift is fixed).
- **Live controls and sticky controls:**
  - changing controls in AE moves the animation with 0.000 px error, with no rebuild;
  - a rebuild keeps AE-side tweaks, while untouched controls take new code defaults (D56).
- **Ripple:**
  - frames after an insert or stretch are pixel-identical to the originals shifted by Δ;
  - removal works, precomps ripple inside, and each ripple undoes in one step;
  - on the hand-built project it moved 32 keys and 4 markers and held time-remapped precomps.
- **Greenscreen workflow:** import → `list_project_items` → `preview_item` → place → key → background below → animate, all in one undoable batch. Key Cleaner is opt-in because it degrades solid mattes (D52).
- **Round-trip:** the inspector reads back what the compiler wrote (§DoD).
- **Effect catalog:** 391/397 vanilla effects harvested from the installed AE. The 6 skipped open dialogs when applied.
- **Performance:**
  - a scene build takes 1–10 s (Advanced 3D: about 3.5 s per snapshot frame, D40);
  - a full inspect of a 35-layer comp takes 4.4 s (it took over 5 minutes before D55).

## MCP from Claude Code

`.mcp.json` registers the stdio server for Claude Code in this repo; README shows `claude mcp add` and the
Claude Desktop config. A fresh headless session (`claude -p`, empty working folder, `--strict-mcp-config`, only
`mcp__ae-compose__*` tools allowed, the skill appended as the only guidance) was given a brief to build a
title card with live controls, review its own contact sheet, and ripple-edit it:

**Result: ✅ succeeded unaided (2026-11-04).** The session built `EmberRoast_Title_v001` (1920×1080, 30 fps):
- a per-word spring reveal of the brand name;
- a line draw-on;
- a tagline fade;
- live **Accent Color** and **Reveal Delay** controls on the Controls layer and in Essential Graphics.

After reading its own contact sheet it fixed two real problems:
- a visible glow edge (an ellipse smaller than the frame);
- tight spacing (gaps 36 → 52 px, line 600 → 680 px).

It then ripple-inserted 1 s at 1.37 s, the quiet moment between the line finishing and the tagline starting:
- the comp went 4 → 5 s;
- the tagline moved from 1.4–1.9 s to 2.4–2.9 s;
- one expression was warped, there were no expression errors, and the controls stayed wired.

It reported the comp, its fixes, the ripple result and the final contact sheet, which looks clean on review.

## Limitations and things AE does not allow

- **Scripting limits in AE 26.5:**
  - shape gradient colors can't be read or written by scripts safely: touching `ADBE Vector Grad Colors` crashes AE 26.5. Gradients go through generated .ffx presets, and the inspector reports stops only for gradients ae-compose made (D15/D47);
  - renderer quality settings and a glTF model's embedded-animation selection are not scriptable;
  - the Numbers effect, OCIO/LUT pickers and some analysis effects open modal dialogs when applied from a script. The compiler rejects Numbers and points to sourceText counters (D54);
  - protected-region markers on time-stretched layers are repositioned by AE. Ripple lands their start exactly, but their length can drift and is reported (D58).
- **Behavior trade-offs:**
  - ripple leaves non-ae-compose expressions that use `time` unchanged and warns about them;
  - a bezier segment that spans an insert point is stretched rather than split (linear segments are split exactly);
  - rebuilding a scene keeps layers that edits added to its comps (they are untagged; documented).
- **Planned, not built** (marked in ARCHITECTURE.md):
  - lint (overflow, safe areas, reading time) — today the agent reviews the automatic contact sheet;
  - an `interpolate`/`stagger` helper;
  - dolly/push-in rig helpers (keyed moves work);
  - Range Selector text mode, text on path, multi-color confetti preset;
  - `.aepx` gradient reads;
  - seed-determinism and Remotion side-by-side tests.
- **Platform:** Windows only so far (CEP bridge install, dialog watchdog). The runtime and DSL are platform-neutral.
- **Bit depth:** 8 and 16 bpc are the target (D29). 32 bpc captures are compensated but untested beyond that.

## Incidents during the build (for the record)

- **Shape-gradient crashes:** early probes of shape-gradient internals crashed AE three times. That led to the D15 fence and the .ffx approach, with no gradient crashes since.
- **Blue Dwarf plugin:** a third-party dev plugin (Blue Dwarf V0) caused a crash with no script running. It was moved out of AE's plug-ins folder.
- **Effect harvest dialogs:** the harvest opened "Select a LUT" and "Numbers" dialogs on screen. Probes now auto-cancel any dialog they open, and LUT menus are never probed (D54).
- **AE unresponsive:** a full inspect of a large comp made AE stop responding. AE was restarted (force-quit, at the user's request), and the cause was fixed (D55). That restart lost the unsaved dev project; everything in it is rebuildable from code.
- **Bridge stuck "Starting…":** after the restart the bridge stayed on "Starting…" because of the repo's ES-module setting. It was fixed with a CommonJS pin in the extension folder (D59).
