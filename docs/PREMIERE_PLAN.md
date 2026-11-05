# Premiere counterpart: plan (draft)

Status: proposal, not started. The run prompt is **`GOAL-PREMIERE.md`** (Phase 7), which supersedes this draft where they differ. It adds:
- reuse of the Phase 5 toolkit: captions, beat sync, reframe/deliver, pacing previews, style lint, `plan_scene` → `plan_cut`, recipes → cut templates, and the designer panel
- the asset sources from `docs/ASSETS.md`, moved into a shared core
- a **media library**: a SQLite index of the user's footage by transcript, shot descriptions, audio facts and sync groups, which both tools search

That run turns this file into the design doc and adds the "Pr ·" roadmap groups.

## 1. Goal

An agent (Claude) working with a human editor can, inside stock Premiere Pro:

1. **Rough-cut from a transcript.** Transcribe footage with word-level times, pick the segments that tell the story, and get a real, editable sequence back.
2. **Tighten.** Remove filler words and long pauses, reorder sections, and trim by words rather than by timecode.
3. **Dress the cut.** Add titles and lower-thirds (from ae-compose `.mogrt`s), B-roll over A-roll, transitions, and music beds.
4. **Grade and balance.** Basic Lumetri correction and shot matching, plus loudness normalisation.
5. **Review it the same way as in AE.** Every build or edit returns a contact sheet, a lint report and the ids it created, with no extra calls needed.

Same principles as ae-compose (ARCHITECTURE §0): coarse declarative calls, automatic feedback, forgiving names, stable handles, one undo group per batch, and no way for the agent to wreck the user's project.

### Non-goals (for now)
- Colourist-grade looks, multicam editing, proxies/conform workflows, collaboration (Team Projects).
- Third-party plugins (same rule as D2).
- Replacing AE for motion graphics. Premiere places what ae-compose builds.

## 2. Reuse map

| Area | Reuse | Notes |
|---|---|---|
| `src/mcp`, `src/cli` scaffolding | **High** | Same server shape; new tool set. |
| `src/api` patterns (report shape, disk-cache guard, doctor) | **High** | `doctor` gets Premiere checks. |
| `src/bridge` `Backend` interface, dialog watchdog, `aewin.ps1`, recovery (`src/api/recover.ts`) | **High** | Generalise `Backend.name` and the "ES3 source" contract. The watchdog needs Premiere's window classes. |
| `src/visual/images.ts` (contact sheets, timecode labels) | **High** | Host-agnostic already. |
| `src/visual/preview.ts` | **Medium** | The ffmpeg half carries over; frame capture is comp-based and needs a Premiere source. |
| `src/shared/units.ts`, fuzzy name resolution (`src/catalog/resolve.ts`) | **High** | Times, colours and "did you mean" work as-is. |
| `src/catalog/harvest.ts` approach | **Medium** | Harvest Premiere's effect/param list the same way; new data. |
| `src/lint` pipeline | **Medium** | Same report format; new rules (§6). |
| zod IR + validate-before-touching-the-app | **High** (pattern) | New schema. |
| `src/dsl`, `src/compile`, `src/runtime`, ripple, sticky controls | **None** | AE object model and motion DSL. |
| `packages/bridge-cep` | **Low** | Premiere scripting is moving to UXP; probably a new extension (see spike). |

**Repo shape.** Proposed: same repo, split into packages so both tools share one core:

```
packages/
  core/          bridge contract, watchdog, visual, units, name resolution, lint report, MCP helpers
  ae-compose/    everything AE (today's src/)
  pr-cut/        the Premiere tool (working name)
  bridge-cep/    AE extension (existing)
  bridge-uxp-pr/ Premiere extension (new)
```

Moving `src/` into packages is a refactor of its own. Do it only once the spike says go, and as one release with the tests green.

## 3. Architecture

```
 media files ──► transcribe (Whisper, word times) ──► transcript store (JSON, per clip, cached by hash)
                                                           │
 agent reads transcript ──► Edit plan (zod IR: segments, tracks, titles, grades)
                                                           │ validate (media exists, ranges in bounds, ids)
                                                           ▼
                                  build path A: Premiere API via UXP bridge   (preferred, live, undoable)
                                  build path B: generate FCP XML / OTIO → import (fallback, robust)
                                                           │
 feedback: contact sheet per cut, lint, ids ◄── frame export / ffmpeg on source media
```

### 3.1 Transcripts: do not depend on Premiere's
Premiere's Speech to Text is good, but how much of it the scripting API can reach is unconfirmed (spike Q5). Plan on **our own transcription** as the source of truth:
- Local Whisper with word-level timestamps (whisperX-style alignment), run from Node and cached per media hash under `~/.pr-cut/transcripts/`.
- Output: words `{ text, start, end, confidence, speaker? }`, plus derived sentences, pauses and filler flags.
- Optional: import Premiere's transcript when the API exposes it, and offer to push ours into Premiere so the editor sees the same text in the Text panel.

### 3.2 The edit plan (IR)
Declarative, like the scene IR. A sketch:

```ts
cut({ name: 'Interview v1', fps: 23.976, size: [1920, 1080] }, [
  track('V1', [
    clip('A-cam.mov', { words: [112, 187] }),            // by word index range
    clip('A-cam.mov', { from: '00:03:12:04', to: '00:03:40:00' }),
    clip('A-cam.mov', { quote: 'and that is why we built it' }), // fuzzy-matched to transcript
  ]),
  track('V2', [ broll('city.mov', { over: 'seg2', trim: [2, 6] }) ]),
  track('V3', [ title('lower-third.mogrt', { at: 'seg1+1s', fields: { Name: 'Ana Ruiz' } }) ]),
  track('A2', [ music('bed.wav', { duck: -18 }) ]),
], { tighten: { fillers: true, maxPause: '0.6s', handles: '4f' } })
```

Segments get ids (`seg1`…) that later edits target: `move seg3 before seg1`, `trim seg2 end -6 words`, `replace quote …`.

Whether the agent writes TSX like ae-compose or plain JSON tool arguments is an open question (§8). Leaning JSON: cuts are data, not components.

### 3.3 Build paths
- **A. Live API (UXP).** Create a sequence, insert/overwrite clips, set in/out points, add `.mogrt`s, set Lumetri params, all in one undoable transaction. Needed for surgical edits on an existing timeline.
- **B. Interchange file.** Write FCP7 XML or OTIO and import it. Well documented, survives API gaps, and works across Premiere versions. Good for "build a whole new cut". It can't edit in place, and some features (Lumetri, `.mogrt` params) may not survive the round trip.

Ship B first if the spike shows API gaps; ship A for edits.

## 4. MCP tools (first cut)

| Tool | Does |
|---|---|
| `transcribe` | Media → cached word-level transcript; returns a compact readable view (sentences with ids and times). |
| `search_transcript` | Find quotes, topics or speakers across clips; returns ranges. |
| `build_cut` | Edit plan → sequence. Returns contact sheet (first frame of each segment), lint, ids, duration. |
| `inspect_sequence` | Outline of an existing sequence: tracks, clips, source ranges, text spoken per clip. |
| `apply_cut_edits` | Batch of edits by id (move, trim by words, replace, delete, add title/B-roll, grade). |
| `tighten` | Filler and pause removal on a sequence or range, with a dry-run diff. |
| `place_mogrt` | Place an ae-compose `.mogrt` with field values. |
| `grade` | Lumetri basics (exposure, WB, contrast, sat, LUT) and `match` to a reference shot; returns before/after stills. |
| `snapshot`, `preview`, `render` | Same as AE: frames, low-res preview video, final export via Media Encoder/presets. |
| `undo`, `doctor`, `recover`, `list_dialogs`, `answer_dialog` | Same as AE. |

**AE side addition:** `export_mogrt`, which exports an ae-compose comp as a `.mogrt` with chosen controls exposed as Essential Graphics fields. Spike Q7 confirms the AE scripting call.

## 5. Phases

| Phase | Deliverable | Exit criterion |
|---|---|---|
| **P0 Spike** (few sessions) | Throwaway UXP plugin + probe scripts answering §7. | Written go/no-go and build-path choice in DECISIONS. |
| **P1 Transcript → rough cut** | `transcribe`, `search_transcript`, `build_cut` (V1/A1 only), contact sheet, bridge + watchdog. | From a 20-minute interview, Claude produces a 2-minute cut the user would keep as a starting point. |
| **P2 Edit + tighten** | `inspect_sequence`, `apply_cut_edits`, `tighten`, word-level trims, undo. | Ten consecutive edits land correctly; one-step undo each. |
| **P3 Dress** | B-roll tracks, transitions, music with ducking, `export_mogrt` (AE) + `place_mogrt` (Pr). | Branded lower-thirds from ae-compose appear with correct names. |
| **P4 Grade + audio** | `grade`, shot match, loudness normalise (-14/-16 LUFS presets). | Mismatched two-camera interview visibly matched; within 1 LU of target. |
| **P5 Skill + polish** | `skills/pr-cut/SKILL.md` (editing guidance: story structure, pacing, J/L cuts), showcases, fresh-session test like v0.00.012. | Fresh Claude session builds and revises a cut unaided. |

The package refactor (§2) happens between P0 and P1.

## 6. Lint rules (Premiere)
- Flash frames (clips shorter than N frames), gaps on V1, unintended black.
- Cut mid-word or mid-breath (check against word times), audio pop risk without a crossfade.
- Jump cut on the same angle without cover (suggest B-roll or a punch-in).
- Loudness out of range, clipping peaks, music louder than dialogue.
- Title on screen too briefly to read (reuse the AE rule), title outside the safe area.
- Missing or offline media, mixed frame rates without a conform decision.

## 7. Spike questions (P0)
Probe one feature at a time in a throwaway project, same discipline as D16.

1. Is UXP the current scripting route in the installed Premiere, and can a UXP plugin run a local HTTP/WebSocket bridge like our CEP one (or reach out to our Node server)?
2. Create a sequence with set fps/size; insert clips with source in/out points on chosen tracks; all inside one undo transaction?
3. Read an existing sequence: tracks, clips, source in/out, and which media each clip uses.
4. Export a still frame at a sequence time (for contact sheets) without a modal dialog.
5. Read Premiere's transcript for a clip, and write one back. Nice to have, not required.
6. Read and write Lumetri parameters; apply a LUT.
7. AE: export a comp as `.mogrt` from script with chosen Essential Graphics properties. Premiere: place a `.mogrt` and set its fields from script.
8. FCP XML / OTIO import from script: does it land as a sequence with correct ranges, and what is lost?
9. Media Encoder / export presets from script.
10. Which modal dialogs show up (missing media, conform, audio-preview build), and do their window classes work with our watchdog?

## 8. Open decisions
- **Name:** `pr-cut` is a placeholder.
- **Authoring format:** TSX (consistent with ae-compose) or JSON edit plans (simpler; cuts are data). Leaning JSON.
- **Transcription engine:** local Whisper (private, free, needs a GPU for speed) vs. a cloud API. Leaning local, with the engine behind an interface.
- **Repo:** monorepo packages (proposed) vs. a separate repo depending on a published `core`.
- **Minimum Premiere version:** whatever the spike shows UXP needs.

## 9. Risks
- **Premiere's API is young.** UXP for Premiere is newer than AE's ExtendScript, so expect gaps and changes between versions. Mitigation: build path B, and keep a feature table like the renderer table in ae-compose.
- **Premiere is more crash-prone with large projects.** Mitigation: same watchdog/recovery as AE, autosave before big batches, and never touch the user's sequences without a copy (build new sequences; edits on existing ones duplicate first unless told otherwise).
- **Transcription speed and accuracy** on long footage. Mitigation: cache by hash, transcribe in the background, confidence flags on low-quality words.
- **Taste.** A technically correct cut can still be boring. That is the skill doc's job (P5) and the human's call; the tool's job is to make revising cheap.
