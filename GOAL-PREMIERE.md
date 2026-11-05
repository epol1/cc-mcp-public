# GOAL (Phase 7): "pr-cut", an agent-first editing bridge for Adobe Premiere Pro

> **How to run this:** open Claude Code in `E:\Projects\ae-mcp` with Premiere Pro 2026 (26.5.2) running, and say: *"Read GOAL-PREMIERE.md and execute it end to end."* Opus 5.5 recommended. After Effects 2026 should be installed too (the title and mogrt work uses it), but it doesn't need to be open until Phase 4.
>
> `pr-cut` is a working name. Pick a better one in Phase 2 if you like, and record it in DECISIONS.

---

## 0. Who you're building for and why

I'm Evan, a professional marketer who edits in Premiere and animates in After Effects. ae-compose (this repo, v0.01.000+) lets Claude build and edit native AE comps with excellent results. I want the same for **editing**:

- **Rough cuts from transcripts.** I hand over 40 minutes of interview footage. Claude transcribes it with word-level times, reads it like a script, picks the story, and gives me a real, editable Premiere sequence I'd keep as a starting point.
- **Tightening by words, not timecode.** "Cut the ums, tighten pauses, swap the second answer for the shorter take, end on the line about the launch."
- **Dressing the cut.** B-roll over jump cuts (from my footage or free stock), titles and lower-thirds that ae-compose builds in AE and Premiere places as `.mogrt`s, captions, music cut to the beat and ducked under dialogue.
- **Grade and sound.** Basic Lumetri correction and shot matching, loudness to delivery spec.
- **Deliver.** 16:9 master plus 9:16 / 1:1 / 4:5 social versions with captions, in one call.
- **A media library.** One searchable database of my footage: what's *said* in each clip (transcripts) and what's *seen* (shot descriptions). Every new project starts by searching what I already have.

**The output is always a native, editable Premiere project**: real sequences, real clips with real in/out points, real Lumetri, real captions tracks and Essential Graphics. It must never be a render made elsewhere and imported.

The principles are the same as ae-compose (`docs/ARCHITECTURE.md` §0, "agent-first"):
- coarse declarative calls
- feedback that comes back automatically (contact sheet, lint, ids)
- forgiving names
- stable handles
- one undo per batch
- no way for the agent to wreck my project

This is a personal tool. Use whatever library or approach is technically best.

---

## 1. Read first (resume rules)

1. `docs/AGENT_GUIDE.md` (session start, house rules, release flow, AE safety rules), then `docs/PROGRESS.md` and `docs/DECISIONS.md`. Continue numbering from the last D-number.
2. `docs/PREMIERE_PLAN.md`: the design draft for this phase. This goal supersedes it where they differ. Update it into the real design doc as you go, the way `docs/TOOLKIT.md` served Phase 5.
3. `docs/ASSETS.md`: the asset-sources design (D90). It is part of this phase (§6).
4. `docs/ARCHITECTURE.md`, `docs/TOOLKIT.md` and `skills/ae-compose/SKILL.md`, to know exactly what already exists and can be shared (§5).
5. If this run is interrupted, resume from `docs/PROGRESS.md`. Never start over.

---

## 2. Operating rules

- **Work autonomously through every phase.** Don't stop for approval between phases. Make decisions and record them in `docs/DECISIONS.md` with a one-line rationale.
- **Ask me only when a human must physically act.** Batch everything into **one up-front checklist** (Phase 0).
- **Roadmap is living data.** Add a "Pr ·" set of groups to `status/systems.json` (and an "Assets ·" group already exists) before you start building, mark tasks wip/done as you go, and keep `docs/PROGRESS.md` current.
- **Release often** with `node scripts/release.mjs "short description"` (`--minor` at phase milestones). Typecheck and unit tests are gates. Straight to `main`.
- **Use parallel subagents** for independent research, adapters, kits and verification. Before calling the phase done, have a separate subagent that didn't write the code review it against §10.
- **Verify, don't assume.** Premiere's scripting surface (UXP, and whatever ExtendScript is left in 26.5) is young and has undocumented behaviour. Every API you rely on must be confirmed by running it against my installed Premiere, one feature per probe, in a throwaway project.
- **Look at your output.** Every build or edit gets a contact sheet that you actually view. Where pacing matters, render a low-res preview and watch the cuts (frame strips across each cut point).

### Premiere safety (non-negotiable)
- **Never modify my original projects or sequences.** Build new sequences. To edit an existing one, duplicate it first unless I explicitly say to edit in place.
- **Never move, rename, transcode-in-place or delete my media.** Caches, proxies and transcripts go under `~/.pr-cut/` (or a shared `~/.ae-compose/` cache: decide and record).
- **Never relink media** in my projects without asking.
- **One undo per mutating request.** Each request runs in one script call inside one undoable transaction (or the UXP equivalent). Verify that a single Ctrl+Z reverts a whole batch, as ae-compose does.
- **Vanilla Premiere only.** No Red Giant (Colorista is installed; don't use it) or any other third-party effect. Projects must open on any stock Premiere 2026.
- **Never force-kill or restart Premiere or AE without asking me.** Use the watchdog/recovery path for dialogs.
- **Never take full-desktop screenshots.** Capture only Premiere's or AE's windows.
- **Tell me before deleting anything to free disk space.** Transcription and proxy caches grow fast.
- **All the AE safety rules in `docs/AGENT_GUIDE.md` still apply** whenever you touch AE (mogrt export, title builds, shared-core refactor tests).

### Craft rules for every showcase cut
- **Story first.** Write a paper edit (beats → quotes) before building anything.
- **Every cut has a reason.** Cut on a thought, not mid-word or mid-breath. Use J/L cuts where dialogue overlaps a picture change.
- **Cover jump cuts** with B-roll, a punch-in or a cutaway. Never leave an unmotivated jump on a single angle.
- **Pace for the platform.** Social clips hook in the first 2 seconds. Long-form can breathe.
- **Music serves the dialogue.** Duck it, cut on the beat where picture allows, and end the music on a real ending, not a fade at a random point.
- **No slide furniture.** No persistent labels or corner titles unless the brief asks for them (same rule as SKILL.md).

---

## 3. Phase 0: Environment discovery and human checklist (do first)

Already known (2026-11-05):
- Windows 11, Premiere Pro **26.5.2** (has a `UXP` folder and `PProHeadless.exe`), Media Encoder 2026 and After Effects 2026 installed.
- ffmpeg on PATH (chocolatey), Node 22.20, Python 3.14 (check ML wheel support, see §4), RTX 3080 10 GB.

Do:
1. Confirm the above and find how to **run code inside a running Premiere and get a result back**. Candidates:
   - a UXP plugin with a network bridge
   - a CEP panel, if CEP still loads in 26.5
   - remaining ExtendScript entry points
   - `PProHeadless.exe`, for what it can do
2. Confirm Media Encoder scripting/presets for renders.
3. Produce **one checklist for me**. It will likely include:
   - installing the UXP Developer Tool and enabling developer mode (for loading an unsigned UXP plugin)
   - any Premiere preferences the bridge needs
   - **sample footage**, in a folder I name: at least one 20–40 min interview (ideally two camera angles with separate audio), 20+ B-roll clips, two music tracks with clear beats, and one hand-edited sequence of mine for the edit demo
   - which folders the media library may index (§6). Default is only folders I name. The standing rule for `E:\Projects` and `\\goblin\depot` is quick sampling, not full scans.
   - API keys for Pexels and Pixabay (optional; keyless sources work without them)

   Present it once, wait for my "done", then don't interrupt again unless something genuinely new needs a human.

---

## 4. Phase 1: Research and spike (parallel subagents)

Write findings to `docs/research/premiere/` and a summary in `docs/RESEARCH.md` (new section). Each question below is confirmed **by running it** in my Premiere, not by reading docs alone.

**Bridge and scripting surface**
1. UXP for Premiere 26.5: what the DOM covers. Can a UXP plugin reach a local Node process (WebSocket/HTTP client, or a server via a helper)? Latency, payload size limits, and is it alive when the panel is hidden?
2. Is ExtendScript/CEP still available in 26.5, and is it worth keeping as a fallback for gaps (like `AfterFX.com` was for AE)?
3. Transactions and undo: can one request be one undo step?
4. Which modal dialogs appear (missing media, conform, render, audio-preview build, crash recovery), and do their window classes work with `src/bridge/aewin.ps1`'s watchdog?

**Timeline**

5. Create sequences from settings or presets (fps incl. 23.976 and 29.97 DF, size, audio channels).
6. Insert and overwrite clips with source in/out on chosen tracks, ripple delete, split, linked A/V, track targeting, nested sequences.
7. Read a sequence completely: tracks, clips, source ranges, media paths, effects, markers, captions. Learn Premiere's tick time base and build the conversions in `src/shared/units.ts`.
8. Transitions (Cross Dissolve, Constant Power, Dip to Black, Morph Cut), speed/time remapping, keyframes on Motion/Opacity/Volume.

**Interchange (build path B)**

9. FCP7 XML and OTIO import from script. Does it land as a sequence with correct ranges? What is lost (effects, mogrt params, captions, Lumetri)? Is it undoable?

**Speech and captions**

10. Premiere's own transcript and Text-Based Editing: can scripts read it, write it, or trigger transcription? Is it word-level?
11. Captions: create a caption track from SRT/VTT by script, style it, and burn it in at export.
12. **Local transcription** that we control (the plan of record, see §6.2). Compare whisper.cpp (CUDA build, no Python) with faster-whisper/whisperX (needs Python; 3.14 may lack wheels, so use a pinned 3.12 venv via `uv` if chosen). Measure speed and word-timing accuracy on the RTX 3080, and add speaker diarization. Pick one, wrap it behind an interface, and record the decision.

**Color and audio**

13. Lumetri: harvest the full parameter tree (like `src/catalog/harvest.ts` did for AE effects), set basic and creative params, apply a `.cube` LUT, and read values back.
14. Audio: clip/track gain, Essential Sound roles (Dialogue/Music/SFX), auto-ducking, Enhance Speech, loudness normalisation. Which of these are scriptable, and what's the fallback (ffmpeg `loudnorm` analysis + gain keyframes)?

**Graphics and AE**

15. Place a `.mogrt` and set its Essential Graphics fields by script.
16. AE side: export an ae-compose comp as `.mogrt` (`CompItem.exportAsMotionGraphicsTemplate` or the 26.5 equivalent) with chosen controls exposed. ae-compose already builds EG properties (`control(..., { eg })`). Can Dynamic Link comps be placed by script, and is that better for some cases?
17. Auto Reframe, Scene Edit Detection and Remix: scriptable or not?

**Output**

18. Export a single frame at a sequence time without a dialog (for contact sheets). If it isn't possible, render frames via ffmpeg from the source media using the cut list, and document the trade-off.
19. Media Encoder and direct export: presets, queueing, progress, H.264/HEVC/ProRes, captions burn-in, and exporting multiple aspect sequences in one batch.

Record a **feature table** like the AE renderer table: what is available by live API, by interchange file, by ffmpeg, or not at all. Choose build paths from it.

---

## 5. Phase 2: Architecture (write before coding)

Update `docs/PREMIERE_PLAN.md` into the design doc and update `docs/ARCHITECTURE.md` for the shared layout. Strong preferences below; deviate only with a recorded reason.

### 5.1 One repo, shared core, two tools
Move to workspace packages so both tools share one core:

```
packages/
  core/          bridge contract + watchdog + recovery, visual (contact sheets, strips, previews), units/timecode,
                 fuzzy names, lint report format, MCP helpers, release/dashboard glue,
                 audio (beats), text (captions, line breaking), motion/pacing analysis,
                 assets (adapters, cache, licenses, credits) and the media library (§6)
  ae-compose/    everything AE (today's src/)
  pr-cut/        the Premiere tool
  bridge-cep/    AE extension (existing)
  bridge-uxp-pr/ Premiere plugin (new)
```

- **The refactor is its own release**, done before any Premiere feature.
- **Gate:** every AE unit test and every AE integration suite (round-trip, edit-ops, edit-3d, renderer-seeds, gradient-edit, ease, ripple, live controls, p5/*) must still pass afterwards.
- `aec` and the ae-compose MCP server must keep working unchanged for me.
- Two MCP servers (`ae-compose`, `pr-cut`) keep each tool list focused. They share the core and the media library. Decide whether one process can serve both; record it.

### 5.2 What carries over from ae-compose (use it, don't rebuild it)

| ae-compose piece | Premiere use |
|---|---|
| `Backend` interface, CEP HTTP pattern, token, dialog watchdog, `recover_ae` | Same contract for the UXP bridge; `recover_pr`. Generalise `Backend.name` and the "ES3 source" contract. |
| zod IR + validate-before-touching-the-app, stable ids, `src` locations | Edit-plan IR (§5.3); ids in clip/marker metadata. |
| Contact sheets, frame strips, previews (`src/visual`, `src/motion/strip.ts`) | Contact sheet per cut, strips across every cut point. |
| Lint pipeline + style lint (`src/lint`, `src/motion/style.ts`) | Edit lint (§7.3), same report format, on every build/edit. |
| Motion analysis + speed graphs (`src/motion`) | Pacing graphs: shot-length timeline, speech rate, pause map. |
| Captions (`src/text/captions.ts`, formats, timing, line breaking) | Captions from our transcripts; SRT/VTT out; caption tracks; burned-in karaoke via AE mogrt. |
| Beat sync (`src/audio`, `analyze_beats`, `snap: 'beats'`, off-beat lint) | Cut to music, snap cuts to beats/bars, off-beat lint. |
| `reframe` + `deliver` | Social versions (Auto Reframe if scriptable, else keyframed Motion with subject tracking from the media library) and delivery packs via AME. |
| `plan_scene` (beat sheet → scaffold) | `plan_cut`: brief → paper edit (beats, chosen quotes, B-roll needs) → build. |
| Recipe library (`src/recipes`) | Cut templates: "60 s testimonial", "3 podcast clips 9:16", "event recap to music". |
| Brand tokens (`brand()`, `examples/brand.ts`) | Caption and title styles, look references for grading. |
| Essential Graphics controls | `.mogrt` titles/lower-thirds/captions from ae-compose scenes (§7.4). |
| Designer panel (`designer.js`, `designer_inbox`) | Premiere panel: transcript with selections, lint list, ask Claude. |
| `undo`, `doctor`, `render`, disk-cache guard | Same tools for Premiere; doctor checks both apps. |
| Effect catalog harvest + fuzzy resolve | Premiere effect and Lumetri catalogs, typed params, "did you mean". |

### 5.3 The edit plan (IR)
Declarative JSON. Cuts are data, not components, so lean JSON over TSX. Record the decision either way.

- **Segments** address source by **word range**, **quote** (fuzzy-matched to the transcript), **timecode** or **media-library shot id**.
- **Tracks** carry dialogue, B-roll, titles (`.mogrt` + fields), music (with duck), SFX and captions.
- **Options:** `tighten` (fillers, max pause, handles), J/L offsets, transitions, grade per segment or per camera, and loudness target.
- **Ids:** every segment gets an id (`seg3`) stored in Premiere (clip/marker metadata), so later edits target ids. Inspecting a sequence I cut by hand assigns path-style ids, like ae-compose does.
- **Validate before Premiere is touched:** media exists, ranges in bounds, quotes matched (with confidence), ids unique, fps conform decided.

### 5.4 Build paths
- **A. Live API** (UXP) for everything the spike shows works. Required for edits on existing sequences.
- **B. Interchange file** (FCP XML / OTIO) for whole new cuts if A is slow or has gaps. Then apply what interchange loses (Lumetri, mogrt fields, captions) live.
- The compiler picks per feature from the feature table and says which it used.

---

## 6. The media library and assets (shared with ae-compose)

This is the "asset database". Build it in `packages/core` so **both tools use it**: ae-compose's `find_assets` searches it too.

### 6.1 Free asset sources (`docs/ASSETS.md`)
Phase 6 (`GOAL-PHASE6.md`) builds these for ae-compose. If it is done when this run starts, move it into `packages/core` and reuse it. Its small local-folder index (names, types, sizes) becomes the first layer of the media library in §6.2. If it isn't done, build the whole group as designed, in core:
- adapters: Iconify, Poly Haven, ambientCG, local folders, then Pexels, Pixabay, Openverse, Fontsource
- `find_assets` (thumbnail grid) and `fetch_asset`
- cache, keys, license allowlist, `CREDITS.md`
- the `asset:` src scheme in the ae-compose DSL

**Premiere additions:**
- **Video B-roll** from Pexels/Pixabay video, filtered by orientation, duration, resolution and fps compatible with the sequence.
- **Music and SFX** from Openverse audio (commercial-OK licenses only).
- `fetch_asset` imports into a Premiere bin (`pr-cut/Assets/<source>`) and appends the credit, and `deliver` ships `CREDITS.md` with the renders.

### 6.2 Media library (my own footage)
An index that makes my footage searchable by **what's said** and **what's seen**.

**Per media file:**
- Technical facts via ffprobe: codec, fps, size, duration, timecode, audio channels, VFR flag, color space.
- Content hash for identity. Paths can change; the hash finds it again.

**Per clip:**
- **Transcript**: words `{ text, start, end, confidence, speaker }`, plus sentences, pauses and filler flags. Uses the local engine from spike Q12, cached by hash.
- **Shots**: boundaries (ffmpeg scene detection or equivalent) with a thumbnail and a short contact strip per shot.
- **Visual description per shot**: Claude reads the strip and writes shot type (wide/medium/close/insert), subject, action, setting, camera move, and quality flags (soft focus, over/under exposed, shaky, blown audio). Store the model's text and the tags.
- **Audio facts**: loudness (LUFS), speech vs music vs silence, beats/tempo for music (`src/audio`).
- **Sync groups**: angles of the same event, found by audio cross-correlation, so multi-camera interviews line up automatically.

**Storage and search:**
- SQLite with FTS5 for transcripts and descriptions, plus tag/facet filters (kind, shot type, speaker, project, date, duration, orientation).
- Use `node:sqlite` if stable on Node 22.20, else `better-sqlite3`; record which.
- Embeddings for semantic search are optional, later. Start with FTS + tags and measure whether it's enough.

**Indexing rules:**
- Only folders I name.
- Incremental by hash + mtime.
- Runs in the background with progress the agent can poll (`library_status`).
- Resumable, and never touches the media itself.
- Thumbnails and transcripts live in the cache.
- `doctor` reports index size and cache size.

**Tools:**
- `library_add`, `library_status`, `library_search` (text query + filters; returns hits with transcript snippets, shot thumbnails as one grid image, and ids usable directly in edit plans)
- `library_describe` (full record for one clip)
- `transcribe` (one file, without adding it to the library)

**AE crossover:** ae-compose's local-folder adapter is the media library, so "use the shot of the product on the desk" works in AE scenes too.

---

## 7. Phase 3: Build (in this order, each end to end in real Premiere before widening)

1. **Shared-core refactor** (§5.1) with the AE regression gate. Release.
2. **Bridge:** UXP plugin + Node client + watchdog + `recover_pr` + `doctor`. Hello world: create a sequence, place one clip, read it back, undo in one step.
3. **Timecode and units:** ticks, 23.976/29.97 DF/NDF, 25, 59.94, mixed-rate sources. Unit-test heavily: off-by-one-frame bugs are the main risk in editing tools.
4. **Transcription + media library** (§6.2) and `transcribe` / `library_*` tools.
5. **Edit plan IR + validation**, then `build_cut` (path A and/or B per the feature table), contact sheet, ids.
6. **Inspector:** `inspect_sequence`, an outline that includes the words spoken in each clip.
7. **Edit ops:** `apply_cut_edits` (move, trim by words, replace quote, delete, insert, split, J/L, transitions, speed, add B-roll/title/music) as atomic batches with rollback and one-step undo. Edits on hand-cut sequences work on a duplicate by default.
8. **`tighten`:** fillers, pauses, repeated starts ("we, we built"), with a dry-run diff the agent shows before applying.
9. **Edit lint** (§7.3) on every build/edit, plus `lint_sequence`.
10. **Assets** (§6.1): core and keyless adapters first, then key-based ones, `find_assets` / `fetch_asset` in both tools.
11. **Titles and captions** (§7.4): `export_mogrt` in ae-compose, `place_mogrt`, `captions` (tracks from our transcripts, styles, burn-in, karaoke mogrt).
12. **Music:** `analyze_beats` reuse, cut/snap to beats, duck under dialogue, music edits that end on a real ending (cut to the track's last bar or a built ending).
13. **Color:** `grade` (basic correction, LUT, look from brand tokens) and `match` (shot-to-shot or camera-to-camera), with before/after stills.
14. **Audio finishing:** roles, loudness normalise (−14 LUFS web, −16 podcast, −23/−24 broadcast presets), Enhance Speech if scriptable.
15. **Multi-camera from sync groups:** cut between synced angles by speaker (diarization) with a minimum shot length and reaction cutaways. True Premiere multicam sequences only if the spike shows they're scriptable; otherwise stacked synced tracks.
16. **Reframe + deliver:** social versions (subject-aware framing from the library's shot data), captions per version, delivery packs via AME, `CREDITS.md` alongside.
17. **Agent tools:** `plan_cut` (brief + library → paper edit → build), cut templates (recipes), pacing previews.
18. **Interfaces:** `prc` CLI (`build`, `inspect`, `lint`, `library`, `transcribe`, `render`, `doctor`), MCP server, `skills/pr-cut/SKILL.md` + reference, and the optional Premiere panel.

### 7.1 MCP tools (minimum)
- `build_cut`, `inspect_project`, `inspect_sequence`, `apply_cut_edits`, `tighten`, `lint_sequence`
- `transcribe`, `search_transcript`, `library_add`, `library_status`, `library_search`, `library_describe`
- `find_assets`, `fetch_asset` (shared), `place_mogrt`, `captions`
- `grade`, `match_shots`, `audio_finish`, `analyze_beats` (shared)
- `plan_cut`, `cut_templates`
- `contact_sheet`, `snapshot`, `render_preview`, `render`, `deliver`
- `undo`, `doctor`, `recover_pr`, `list_dialogs`, `answer_dialog`, `run_script` (raw escape hatch, logged)

Every mutating tool returns: contact sheet, cut-point strip when cuts changed, lint report, ids, duration, and what build path was used.

### 7.2 The skill (`skills/pr-cut/SKILL.md`)
Teach a future Claude session to edit like an editor:
- story structure for interviews and testimonials (hook, problem, turn, proof, close)
- choosing takes, cutting on thoughts, J/L cuts, covering jump cuts, pacing per platform
- music editing, when to grade and when not
- always paper-edit first, always review strips at cut points, always offer 2–3 alternative cuts for subjective choices (different openings or lengths)

Mirror the structure of `skills/ae-compose/SKILL.md`, and cross-link the two for the mogrt/title workflow.

### 7.3 Edit lint rules
- **Errors:** flash frames, gaps on V1 / unintended black, cut mid-word or mid-breath (against word times), audio pop risk (no crossfade at a hard audio cut), offline or missing media.
- **Warnings:**
  - jump cut on the same angle without cover
  - mixed frame rates without a conform decision
  - loudness out of target, clipping peaks, music louder than dialogue
  - titles/captions too briefly on screen to read (reuse the AE rule), outside the safe area, or overlapping captions
- **Style:** monotone shot lengths, talking head over N seconds without a cutaway, the same B-roll shot used twice, off-beat cuts in music-driven sections, an ending on a fade-out of an unfinished music phrase.

### 7.4 Titles and captions via AE
- ae-compose builds the title, lower-third or caption style as a comp with controls exposed as Essential Graphics. `export_mogrt` writes the `.mogrt`, and `place_mogrt` places it in Premiere with fields filled from the edit plan (names from the brief, captions from the transcript).
- **Karaoke captions:** per-word highlight driven by word times. Decide between a mogrt fed with timing and Premiere captions with styling, by what the spike shows.
- Keep a small kit of brand-styled mogrts in the repo (lower-third, title card, caption style, end card) built from `examples/brand.ts`.

---

## 8. Phase 4: Showcases (original, professional, from my footage plus free stock)

Build each one with the tools, review it from contact sheets, cut-point strips and a low-res preview, and keep it lint clean (or explain each warning):

1. **Interview rough cut:** 20–40 min of interview → a 2 min story cut, paper edit first. Exit criterion: I'd keep it as a starting point.
2. **Tightened and covered:** cut 1 with fillers and pauses removed, J/L cuts, and every jump cut covered by B-roll from the media library (or stock when the library has nothing fitting).
3. **Two-camera interview:** angles synced by audio, cut by speaker with reaction cutaways, the cameras colour-matched.
4. **Social clips:** three 9:16 clips (≤45 s) from the same interview, each with a 2 s hook, karaoke captions from an ae-compose mogrt, framed on the speaker.
5. **Music-driven montage:** 30–60 s of B-roll cut to a track's beats and bars, with a real musical ending.
6. **Product promo:** my footage + ae-compose titles via mogrt + brand grade + ducked music + delivery pack (16:9, 9:16, 1:1) + `CREDITS.md`.
7. **Edit demo:** take one of my hand-cut sequences, inspect it, and apply notes in plain language ("tighten the intro, swap the second quote for a shorter take, warmer grade, music down 3 dB"), each batch undoable in one step.
8. **Library demo:** from a one-line brief and only the media library + free stock, `plan_cut` produces a paper edit and a cut, and the library search results are shown along the way.

---

## 9. Phase 5: Testing

- **Unit:**
  - edit-plan IR schema, word-range ↔ time math, timecode across every rate (DF/NDF), tick conversions
  - quote matching, filler/pause detection
  - FCP XML/OTIO generation snapshots
  - library indexing and FTS queries on fixtures
  - asset adapters on recorded API responses, license allowlist
  - lint rules
- **Transcription accuracy:** a fixture clip with a hand-checked transcript. Word-start error under 100 ms median; record WER.
- **Integration (real Premiere):**
  - **Round-trip:** `build_cut` then `inspect_sequence` matches the plan within one frame on every clip edge, for every supported fps.
  - **Edit ops:** each op on a fixture sequence, inspected and asserted, with one undo verified to revert the whole batch.
  - Interchange path (if used): imported sequence matches the plan.
  - `place_mogrt` fields, captions track contents, Lumetri values read back.
  - Exports: delivery pack files exist, durations and sizes are right, loudness is within ±1 LU of target (measured with ffmpeg).
- **AE regression:** every AE suite after the core refactor, and again at the end.
- **Crossover:**
  - `export_mogrt` from AE → `place_mogrt` in Premiere round-trip
  - ae-compose `find_assets` finds media-library clips
  - the `asset:` scheme builds in AE
- **Visual:** contact sheets and cut-point strips for every showcase, reviewed by you and by a separate reviewer subagent.
- **Fresh-session test:** a headless Claude Code session with only `skills/pr-cut/SKILL.md` and the MCP tools makes a good rough cut from a brief unaided, as v0.00.012 did for AE. Record it in REPORT.md.
- **Independent review:** a subagent that didn't write the code reviews it and the docs against §10. Fix every finding with a regression test.

---

## 10. Definition of done

- [ ] Shared-core refactor shipped; every AE test and integration suite still passes; `aec` and the ae-compose MCP unchanged for me.
- [ ] `prc doctor` passes on my machine and reports both apps, the bridge, transcription engine, library and asset sources.
- [ ] A 20–40 min interview becomes a story cut I'd keep, from transcript to native Premiere sequence, with a paper edit first.
- [ ] Word-level trims, tighten, J/L cuts, B-roll cover, transitions and music edits all work as edit ops on generated and hand-cut sequences, each undoable in one step.
- [ ] Media library indexes my named folders with transcripts, shot descriptions, audio facts and sync groups, and search by what's said and what's seen works from both tools.
- [ ] Asset sources (ASSETS.md) built: all adapters, `find_assets` / `fetch_asset` in both tools, credits shipped with deliveries.
- [ ] Titles, lower-thirds and karaoke captions go from ae-compose to Premiere as `.mogrt` with fields filled.
- [ ] Grading (correct, LUT, look, shot match) and audio finishing (roles, ducking, loudness targets) work and are verified by readback/measurement.
- [ ] Delivery packs (16:9, 9:16, 1:1, 4:5) render with captions and credits in one call.
- [ ] All eight showcases built, lint clean, reviewed from contact sheets, strips and previews.
- [ ] Round-trip integration tests pass at every supported frame rate.
- [ ] MCP server registered in Claude Code; fresh-session test passed.
- [ ] `README.md` covers both tools; `docs/` updated (ARCHITECTURE, DECISIONS, PREMIERE_PLAN as the design doc, a pr-cut reference); `status/systems.json` "Pr ·" groups at 100 %.
- [ ] `docs/REPORT.md` Phase 7 section: what was built, limits (with the feature table), what I should try first, and the next 5 improvements ranked by impact.

Begin with Phase 0 now.
