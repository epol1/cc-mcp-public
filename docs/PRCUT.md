# pr-cut: design and reference

pr-cut is the Premiere Pro counterpart of ae-compose: Claude turns raw footage into native, editable Premiere sequences. It shares one core with ae-compose (`packages/core`). This document is the design as built; `docs/PREMIERE_PLAN.md` is the original proposal and `docs/research/premiere/spike.md` the verified Premiere behaviour it rests on. The skill (how to edit with it) is `skills/pr-cut/SKILL.md`.

## 1. Layout

```
packages/
  core/            shared by ae-compose and pr-cut
    bridge/          Backend contract, token HTTP client, window/dialog watchdog (AE and Premiere)
    time/            ticks, rational rates, drop-frame timecode
    transcribe/      faster-whisper worker, transcript analysis (fillers, repeats, sentences, pauses), energy refinement, quote matching
    library/         media library: SQLite FTS5 database, indexer + worker, search
    media/           ffprobe facts
    text/ audio/ motion/ visual/ lint/ deliver/ templates/ units.ts   (moved from ae-compose: captions, beats, motion analysis, contact sheets, lint report, reframe targets, template params)
  pr-cut/          the Premiere tool
    plan/            edit plan schema (zod), media resolver, compiler (plan → Timeline)
    xml/             FCP7 writer (Premiere dialect), minimal DOM, Lumetri template
    timeline.ts      the resolved timeline model
    build.ts         build_cut: compile → lint → import → live titles/captions → sidecar → contact sheet/strips
    adopt.ts         any sequence → Timeline (from Premiere's own XML export; filters and graphics carried)
    edit.ts          apply_cut_edits: ops on the adopted timeline → next version
    tighten.ts       dry-run diff and apply
    finish.ts        loudness (audio_finish), delivery packs (deliver), shot matching (match_shots)
    frames.ts        program frames → contact sheets and cut strips
    undo.ts          batch journal and undo
    inspect.ts outline.ts project.ts lint.ts doctor.ts bridge.ts report.ts
    mcp/server.ts cli.ts library-tools.ts
  bridge-cep/      AE CEP extension (unchanged)
  bridge-cep-pr/   Premiere CEP extension: ExtendScript bridge on :47812 and hub for the UXP plugin
  bridge-uxp-pr/   Premiere UXP plugin (optional): long-polls the hub, runs `premierepro` scripts
```

ae-compose itself stays in `src/` (the root package); only shared modules moved to `packages/core`.

## 2. How a cut gets into Premiere

```
media ─► transcribe (faster-whisper, word times, fillers kept) ─► refine boundaries to audio energy ─► transcript cache (by content hash)
                                                                              │
agent: paper edit ─► edit plan (JSON) ─► validate + compile ─► Timeline (exact frames/ticks) ─► edit lint
                                                                              │
                         FCP7 XML (Premiere dialect) ─► project.importFiles ─► new sequence (ONE undo step)
                                                                              │
              live ExtendScript: .mogrt titles, caption track ─► sidecar plan ─► contact sheet + cut strips (Premiere frames)
```

- **Build path:** XML import, because it is frame exact, one undo step, never touches existing sequences and reuses the project's master clips. Live ExtendScript is used only for what XML cannot carry (mogrt field values, caption tracks) and for reads, frames, exports.
- **Edits:** a sequence is exported by Premiere as XML, adopted into a Timeline (linked picture/sound grouped, split edits kept, transitions normalised to cut points, every filter and graphic carried verbatim), edited, and imported as the next version (`Name v002`). The original is never changed.
- **Undo:** Premiere's ExtendScript has no undo groups and its undo index moves by many entries per compound action (one XML import ≈ 12). Each batch records the index before and after; `undo` steps back until the index is where the batch started, checking before every step that the batch's project is still in focus.

## 3. Feature table (Premiere Pro 26.5.2)

| Feature | Route | Verified |
|---|---|---|
| New sequence with clips, exact source ranges, any rate (23.976–59.94, DF/NDF), mixed-rate sources | FCP7 XML | round trip at 6 rates, 0-frame error |
| Linked stereo audio, mono, channel choice | XML (exploded stereo pairs) | yes |
| Transitions (Cross Dissolve, Dip to Black/White, audio crossfade) | XML | yes |
| Clip gain and level keyframes (ducking) | XML Audio Levels (`<when>` = source frame) | measured: −20/−10 dB on schedule |
| Basic Motion (punch-in, centre) | XML | yes |
| Lumetri basic/creative values | XML (Premiere's own filter block, values patched) | read back exactly |
| Markers (segment ids, beats) | XML | yes |
| .mogrt titles + Essential Graphics fields | live `importMGT` + MGT params | Premiere mogrts place; AE-authored field setting pending (needs AE) |
| Caption track from SRT | live import + `createCaptionTrack` | renders; style not scriptable |
| Program frames | QE `exportFramePNG` | 0.4 s/frame |
| Export | `exportAsMediaDirect` (synchronous, .epr presets) | H.264, WAV |
| Auto Reframe 9:16 / 1:1 / 4:5 | `autoReframeSequence` | yes (keeps captions) |
| Duplicate sequence | `clone()` | keeps everything |
| Loudness to target | clone + Amplify + Hard Limiter (true peak), measured | −14.5 LUFS / −1.0 dBTP |
| Transcripts from Premiere's Speech to Text | UXP only (not ExtendScript) | pending the UXP plugin |
| Undo grouping | none in ExtendScript; XML import = one step | yes |
| Property writes (`setValue`) | not recorded in undo | hence: grades/levels go into versions |
| Master track effects | not reachable from scripts | limiter is per clip |

## 4. MCP tools

`build_cut`, `apply_cut_edits`, `tighten`, `inspect_sequence`, `inspect_project`, `transcribe`, `read_transcript`, `search_transcript`, `snapshot`, `cut_strips`, `audio_finish`, `match_shots`, `deliver`, `export`, `undo`, `doctor`, `list_dialogs`, `answer_dialog`, `run_script`, `library_add`, `library_status`, `library_search`, `library_describe`, `library_shots`, `library_annotate`. CLI: `prc doctor | transcribe | build | lint | inspect | edit | tighten | export | undo | library add/status/search`.

Every build and edit returns: the report (segments with what they say, what tightening removed, undo steps), edit lint, a contact sheet and cut strips from Premiere's own frames.

## 5. Edit plan and edit ops
See `skills/pr-cut/SKILL.md` §3–4 (the user-facing contract) and `packages/pr-cut/src/plan/schema.ts` (the schema of record).

Compiler rules worth knowing:
- Word boundaries are snapped to the audio (Whisper starts words 0.2–1 s early); every cut is quantised to a frame inside the gap between words and never past the neighbouring word.
- Tightening: fillers (`um`, `uh`, set-off `you know` / `like` / `I mean`), first copies of immediate repeats, pauses over `maxPause` shortened to `keepPause`; pieces under `minPiece` merge back, discourse-only leftovers at segment edges go.
- Jump cuts alternate a 112 % punch-in unless `jumpCuts: "none"`; B-roll `over: "seg/2"` covers the cut before a segment's 2nd piece.
- J/L cuts move the picture edge only; sound stays continuous.
- Music is backtimed so its own ending lands at the end of the cut; it ducks to `level` under the words actually spoken and opens to `open` in gaps ≥ 1.5 s.

## 6. Media library
`~/.ae-compose/library/library.db` (node:sqlite, FTS5 porter). Tables: `media` (ffprobe facts, content hash, loudness, tempo, speech ratio, role, status), `sentences` (+FTS), `shots` (time range, thumbnail, description, tags, type, quality; contentless FTS), `folders`, `sync`. Indexing runs in a detached worker (`library_status` polls), incremental by hash + mtime, only folders the user named. Shot descriptions are written by the agent (`library_shots` → `library_annotate`). Edit plans use `lib:<id>`.

## 7. Caches and files
- `~/.ae-compose/bridge-pr.json` (port, token), `logs/bridge-pr-*.log`
- `~/.ae-compose/transcripts/<hash>.json`, `~/.ae-compose/whisper-venv/` (Python 3.12, faster-whisper, CUDA wheels)
- `~/.ae-compose/library/` (db, thumbs, worker log)
- `~/.ae-compose/pr-cut/` (generated XML, adopt exports, frames, cut sidecars, journal, loudness WAVs, deliveries' native exports)

## 8. Limits
- Caption style (position, font) isn't scriptable; social versions keep Premiere's default caption placement, which sits in the platform UI zone. A caption .mogrt from ae-compose is the planned fix.
- Caption tracks don't travel through XML; versions rebuild them from the cut's words.
- Per-clip limiting: scripts can't reach the master track, so peaks are controlled per clip with a measured correction loop.
- Premiere's own transcripts and transaction-grouped undo need the UXP plugin (Developer Mode).
- Hand-cut sequences: nested sequences and multicam clips are carried as graphics-like opaque items only when Premiere's XML represents them; adopt reports anything it drops.
