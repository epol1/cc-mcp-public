# ae-compose — Report

What was built, how it was verified against the installed After Effects 2026 (26.5), and what is limited or
left. Decisions with rationale are in [DECISIONS.md](DECISIONS.md) (D1–D65); the roadmap with live status is
[`status/systems.json`](../status/systems.json) / [ROADMAP.md](ROADMAP.md).

## Definition of Done (GOAL §7)

| Item | Status | Evidence |
|---|---|---|
| `aec doctor` passes | ✅ | 14 checks green on this machine (AE 26.5, CEP 12 bridge, runtime, ffmpeg, sharp, bpc, Inter) |
| 3D fully controllable | ✅ | Showcase 10: Advanced 3D, glTF model, HDRI environment, shadows, extrusion + bevel, orbit camera, DOF. Showcase 11: Classic 3D dolly, DOF, motion blur. Showcase 13: 3D carousel. Renderer table read from AE's own strings (D36/D37). |
| Particles fully controllable | ✅ | CC Particle World presets with live controls; emitter following a layer; bursts by time or by comp marker; textured particles; Particle Playground; Star Burst; Pixel Polly (showcases 12–14; D41/D42) |
| All 14 showcases build and look professional | ✅ | `examples/01…14`, each built, its contact sheet reviewed by me and by an independent reviewer, and iterated (layout, contrast, framing, timing). The fixes that needed tool changes are D51 and D57 |
| Live controls in every showcase | ✅ | Every scene exposes controls on a Controls null and in Essential Graphics. 08: per-variant Accent Color / Headline Delay. 09: `addControls` adds Map Delay / Map Speed to a hand-built move. Verified numerically: 0.000 px between the expected curve and AE after changing controls in AE (D49) |
| Variants and compare | ✅ | Showcase 08: A/B/C sibling comps + `EndCard_v001_Compare` grid labelled with the params that differ (D48) |
| Inspector round-trip tests pass | ✅ | `tests/integration/roundtrip.ts`: a primitive matrix (every shape, paint and path operator, text animators, masks, mattes, effects, eases, camera and lights) plus showcases 01, 05, 10 and 12. 588 properties compared: 436 static values, 59 keyed properties with 440 eases, layer names, order and timing, renderer. All match |
| Edit ops on a hand-built project, each undoable in one step | ✅ | `tests/integration/edit-ops.ts`: all 26 agent ops on `assets/handmade/languages_proj` (a real client project, not made by ae-compose), each asserted through the inspector, then one undo restores the full-detail inspector JSON exactly. 26/26 pass. Showcase 09 runs a realistic batch on the same project. Batches are atomic (D53) |
| MCP usable from Claude Code; fresh session with only the skill succeeds | see §MCP | `.mcp.json` registration; headless `claude -p` run from an empty folder with only the skill + MCP tools |
| README and docs complete | ✅ | README (install, setup checklist, CLI, MCP for Claude Code/Desktop, quickstart, showcase table), DSL reference (every primitive, helper and edit op, with examples), skill + recipes, architecture (unbuilt parts marked planned), decisions, research, progress |
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
- **ES3 runtime** (`src/runtime`, built to `dist/runtime/aec-runtime.jsx`, ~139 KB): it does the following in AE:
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
- **Final renders** (D65): the `render` tool writes MP4, ProRes 422 / 422 HQ / 4444 with alpha, PNG or TIFF sequences or lossless AVI through AE's Render Queue, checks the file and returns a poster frame (`tests/integration/render.ts`: every format, the user's queue untouched, no overwrite, honest undo afterwards).
- **Lint** (D63): every build and edit returns a lint report, and `lint_comp` checks any comp. It flags text on screen too briefly to read, text cut off or outside action-safe, overlapping texts, box overflow, missing fonts, near-empty frames and linear-only moves, each with the layer and the time range.
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
- **Round-trip:** the inspector reads back what the compiler wrote: 588 properties, all matching (§DoD).
- **Edit ops:** 26/26 ops applied to a hand-built project and undone in one step each (§DoD).
- **3D renderers and seeds** (`tests/integration/renderer-seeds.ts`): switching Classic 3D → Advanced 3D → Cinema 4D → Classic keeps 3D transforms, and each switch is one undo step. Rebuilding a particle scene with the same seed gives pixel-identical frames (mean diff 0.0000); another seed gives different frames.
- **IR validation:** every compiled IR passes the zod schema and its cross-reference checks before it reaches AE, and every request is parsed as ES3 first.
- **Remotion quality bar** (`tests/quality/compare.ts`): the kinetic type spec of showcase 01 was rewritten for Remotion 4.0.540 with the same beats, springs, staggers, exits, fonts and colors, and rendered at the same times as the AE build ([docs/quality/kinetic-compare.png](quality/kinetic-compare.png)). Timing matches beat for beat. The AE frames are at least as good: same layout and type, with native motion blur and text animators that stay editable.
- **Lint on the 14 showcases:** the first run flagged 9 issues in 6 showcases. Six were real: both taglines in 01 left before they could be read, the wordmark in 10 drifted out of action-safe, the words in the opening of 11 stacked on each other, the opening of 12 was nearly empty, and the title in 14 exploded before it could be read. Three were false positives, now fixed in lint: 3D text behind the camera (two in 11), and an arrow counted as a word (04). Fixing 11 then showed its words flew past too fast to read, so it was re-staged as a stop-and-go dolly (D64). All 13 scene showcases lint clean now (09 edits a hand-built project). With lint sampling inside the undo group, the 26 edit ops still undo exactly in one step, and a linted build is one undo step.
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
  - an `interpolate`/`stagger` helper;
  - dolly/push-in rig helpers (keyed moves work);
  - Range Selector text mode, text on path, multi-color confetti preset;
  - `.aepx` gradient reads;
  - automatic crash recovery (a hung AE is reported; the user restarts it);
  - `--dry-run`, typed `setParticle`/`set3D` ops (use `set` on AE paths meanwhile).
- **Platform:** Windows only so far (CEP bridge install, dialog watchdog). The runtime and DSL are platform-neutral.
- **Bit depth:** 8 and 16 bpc are the target (D29). 32 bpc captures are compensated but untested beyond that.

## Incidents during the build (for the record)

- **Shape-gradient crashes:** early probes of shape-gradient internals crashed AE three times. That led to the D15 fence and the .ffx approach, with no gradient crashes since.
- **Blue Dwarf plugin:** a third-party dev plugin (Blue Dwarf V0) caused a crash with no script running. It was moved out of AE's plug-ins folder.
- **Effect harvest dialogs:** the harvest opened "Select a LUT" and "Numbers" dialogs on screen. Probes now auto-cancel any dialog they open, and LUT menus are never probed (D54).
- **AE unresponsive:** a full inspect of a large comp made AE stop responding. AE was restarted (force-quit, at the user's request), and the cause was fixed (D55). That restart lost the unsaved dev project; everything in it is rebuildable from code.
- **Bridge stuck "Starting…":** after the restart the bridge stayed on "Starting…" because of the repo's ES-module setting. It was fixed with a CommonJS pin in the extension folder (D59).
- **Undo stopped recording:** once, an AE session stuck at "Can't Undo" and ignored quit requests. With the user's go-ahead the project was closed without saving and AE restarted; undo worked again. The trigger is unknown (D61).
- **C: drive full, twice:** snapshots and contact sheets filled AE's disk cache (67–69 GB in about 40 minutes) with a high Maximum Disk Cache Size. ae-compose now purges the cache when it passes 10 GB or the drive gets low, and `doctor` reports it (D62). A 30000 px floor solid in showcase 10 also caused memory-error modals; it is now 4000 px scaled, and the compiler rejects such solids.

## What to try first

1. **Check the setup:** `node bin/aec.mjs doctor` with AE open (all checks should be green). Then lower **Edit > Preferences > Media & Disk Cache > Maximum Disk Cache Size** to about 20 GB; ae-compose purges the cache on its own too.
2. **Build a showcase and play with its controls:** `node bin/aec.mjs build examples/01-kinetic-type/scene.tsx`, open `KineticType_v001`, select the Controls layer (or the Essential Graphics panel) and drag Word Stagger, Title Delay or Accent Color. The animation updates without a rebuild.
3. **Ask Claude Code for a scene in words:** with the MCP server registered (`claude mcp add`, README), ask for something like "a 6-second lower third for 'Maya Chen, Head of Product', with a delay control". Claude reads the skill, builds, checks its own contact sheet and iterates.
4. **Edit an existing project:** open one of your own comps and ask "make the title ease in with more overshoot" or "make the scene at 0:04 a second slower so the text reads". The ripple op shifts everything after it, and one Ctrl+Z undoes the whole edit.
5. **Try the greenscreen flow:** "add `<your clip>` to this comp, key it, put `<background>` behind it and push in slowly". Claude finds the media, previews it, places it, keys it with an auto-sampled screen color and animates it, in one undo step.

## Next 5 improvements, ranked by impact

Lint (D63) and final renders (D65), the top items on earlier versions of this list, are built. The list now:

1. **Motion previews the agent can judge.** Contact sheets show layout, not feel. Sending a short low-res GIF strip or a per-layer velocity graph after builds would let the agent check easing, springs and pacing, the parts motion design is judged on.
2. **Gradient read-back and editing** (`.aepx` parse plus a `setGradient` op). Gradients are common in client projects, and today the inspector reports them as opaque, so an agent can't edit what it can't see.
3. **Automatic recovery from hangs and crashes.** Detect a hung AE, save a copy, relaunch, answer Crash Repair and reconnect the bridge. Three restarts in this build needed a person; a long autonomous session needs this.
4. **Occlusion-aware lint.** Lint can't see footage or shapes covering a word (showcase 11 needed a visual check for that).
5. **Bezier-aware ripple and a stagger helper.** Ripple stretches bezier segments that span an insert point instead of splitting them, and `stagger()` / `interpolate()` would remove hand-written timing arithmetic from scenes.
