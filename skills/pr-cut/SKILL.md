---
name: pr-cut
description: Edit video in Adobe Premiere Pro with pr-cut. Claude transcribes footage with word-level times, reads interviews like a script, writes a paper edit, and builds native, editable Premiere sequences from a JSON edit plan (word-accurate rough cuts, filler and pause removal, punch-ins and B-roll over jump cuts, J/L cuts, music beds ducked and backtimed to a real ending, Lumetri grades, captions, .mogrt titles), then reviews contact sheets and cut-point strips and revises with edits that land as new versions in one undo step. Use when the user wants a rough cut, interview or testimonial edit, social clips, a montage, tightening ("cut the ums"), B-roll coverage, captions, a grade or a delivery from Premiere; when they want an existing Premiere sequence inspected or edited by notes; when they want to search their footage library by what's said or seen; or when they mention pr-cut, Premiere sequences, transcripts or the pr-cut MCP tools (build_cut, apply_cut_edits, tighten, transcribe, library_search).
---

# pr-cut: editing in Premiere Pro, from transcripts

You read footage as text (word-level transcripts), decide the story like an editor, and write an **edit plan** (JSON). `build_cut` turns it into a **new native Premiere sequence**: real clips with real in/out points, real Lumetri, transitions, levels and captions. It returns a report, edit lint, a **contact sheet** and **strips of frames around each cut**, and you must look at both before calling the cut done. Revisions go through `apply_cut_edits`, which imports the result as the next version ("Interview v002"). Each build or edit is **one undo step** in Premiere, and pr-cut never changes the user's own sequences or media.

For titles and lower thirds, pr-cut places `.mogrt`s built by ae-compose (see `skills/ae-compose/SKILL.md`, "Lower third with live controls and EG text fields", then ae-compose `export_mogrt`, which returns the field names).

## 1. The loop

1. **Pin the brief** in one line: length (2 min, 45 s…), platform (16:9 web, 9:16 Reels/Shorts/TikTok, 1:1 feed), audience, the one thing the viewer should take away. Ask only if something critical is missing; otherwise pick defaults and say what you picked.
2. **Find the material.** `library_search` (what's said and seen across the user's indexed footage) or `transcribe` the files you were given. Long interviews: `read_transcript` in 5-minute chunks. Note sentence ids (`s41`), word ranges (`w812–840`) and times. Fix misheard names and numbers with `correct_transcript` before building: captions and quotes use the transcript text.
3. **Paper edit first, always.** Before any JSON, write the story as beats with the exact quotes you'll use and why (hook, problem, turn, proof, close). Mark where you need B-roll and why. Show it to the user when the brief is subjective.
4. **Write the plan** (§3) and run `build_cut` with `dryRun: true` once: it validates quotes, word ranges and lint without touching Premiere.
5. **Build**, then **look**: the contact sheet (one frame per segment, with what's being said) and the cut strips (frames −6, −1 | cut, +6 around each cut). Check that every cut lands on a thought, no word is clipped, framing changes at jump cuts, and B-roll covers what it should.
6. **Revise** with `apply_cut_edits` (trim by words, move, replace a quote, add B-roll, grade, levels…). Each batch is a new version, so offer 2–3 alternatives for subjective calls (a different opening, a 60 s and a 90 s cut).
7. `export` when approved. `undo` reverts your last batch in one call (it refuses if the editor worked in between).

## 2. Edit like an editor

Work the way a good editor does: know all the material, find the story in it, and use every tool the footage gives you (B-roll, other angles, J and L cuts, the room's reactions) so the shorter piece plays as one coherent thing, not a string of soundbites.

### 2.0 Know the material first
- **Log everything before choosing.** Read the whole transcript (in 5-minute chunks), not just the start. Note the strong moments by theme: the stories, the lines that land, the reactions, the numbers, the callbacks.
- **Inventory what you have to cut with:** the A-roll (who talks), **B-roll** (`library_search` with the nouns and actions people mention; shot descriptions say what's seen), **other angles of the same event** (a second camera, a wide; see §2.7), a separate **sound recorder** (usually the best sound), music. Say what you found; if there's no B-roll or second angle, say so and plan around it.

### 2.1 Story first
- **Find the through-line**: what is this piece about, in one sentence? Pick a spine (a question and its answer, a problem and how it was solved, a setup and its payoff, a change someone went through) and keep only what serves it. Tangents go, however good.
- **Make it coherent**: each segment leads into the next (cause → effect, question → answer, setup → payoff, a callback to something earlier). Read your segment list as a script before building: would someone who never saw the footage follow it? Never cut a line so it means something the speaker didn't mean.
- A testimonial or interview cut is an argument: **hook** (the most surprising true line, ≤ 2 s into a social cut), **problem** (stakes), **turn** (what changed), **proof** (a concrete detail, number or moment), **close** (a line that lands; often the emotional one). Not every cut needs all five; every cut needs a hook and a close.
- Pick lines for meaning, then for delivery: prefer the take with energy, a clean start and a falling ending ("…and that's why we built it." beats a trailing "so, yeah").
- Reorder freely: interviews are answered in the wrong order. A line from minute 28 is often the best opening.
- One idea per segment. If a segment needs two ideas, it's two segments.

### 2.2 Cut on thoughts
- Cut points live in the **gaps between words**. pr-cut snaps every cut to the audio's own word onsets/offsets (Whisper's raw times start words early) and never cuts inside a word; lint flags `mid-word` if it ever happens.
- Prefer segment ends on a full stop and starts on a fresh breath. Use `sentences: ["s12","s14"]` when the speaker's sentences are clean; `words: [a, b]` when you need a partial sentence; `quote` when you know the words (it must match ≥ 70 %, and you'll be warned when it's ambiguous).
- Remove `So,`/`And,` at the start of a segment only if it doesn't change the meaning (`tighten.cut: [wordIdx]`).

### 2.3 Tighten, but keep the breath
- Tightening is on by default: fillers (`um`, `uh`, set-off `you know`/`like`), immediate repeats ("the second thing, the second thing"), pauses over 0.6 s shortened to 0.25 s. For a reflective, emotional answer raise `maxPause` (1.0–1.5 s) or set `tighten: false` on that segment: silence can be the point.
- Tightening never removes a word your range keeps: a "repeat" is only cut when its second copy is in the segment too, and only filler-like words (`so`, `and`, `well`, `um`…) left alone at a segment edge by a filler cut go (the report says so). Explicit `cut` words always go, however short the leftover.
- Every removal on a single camera creates a **jump cut**. In order of preference, cover it with: **B-roll** that shows what's being said (`{ "src": "...", "over": "seg3/2" }` puts a shot across the cut before seg3's second piece); **another angle** (multicam, §2.7: pr-cut changes angle at every cut by itself); a **punch-in** (alternating 112 %, the fallback for a single camera). Lint warns about every jump cut left uncovered.
- **A show master** (a podcast or live show already switched between cameras): `jumpCuts: "auto"` (the default) notices and never leaves a cut on one camera: it keeps a pause rather than cut on the same camera, and covers a same-camera join between segments with a cutaway from another camera of the show.

### 2.4 J and L cuts
- Use them at most joins where the picture changes: they are what makes an edit flow instead of click. `j: "8f"` on a segment: its sound starts before its picture (we hear the next line while still on the previous shot). `l: "10f"`: the outgoing sound runs under the next picture (a reaction, a wide, B-roll). 6–12 frames reads naturally; longer for a reflective beat.
- **Only where the picture changes to something without the speaker's visible lips** (B-roll, another angle, a wide, a reaction). On a single talking head they put the speaker out of sync; lint flags `lip-sync`.

### 2.5 B-roll and music
- **Use B-roll wherever there is any.** Search for it per segment (`library_search` with what's named or done in the line) and place it over jump cuts, over the person, place or thing being described, and to compress time. B-roll illustrates the words, it doesn't decorate: a product line gets the product, a "the team" line gets the team. Hold B-roll 2–4 s; cut it on action or a beat, not on a word; let the dialogue run under it.
- Music serves the dialogue: under speech it sits about −20 dB (`level`) and opens to about −12 dB in gaps (`open`), ducking automatically. Let it **end on its real ending**: the default `ending: "backtime"` picks the in point so the track's own last bar lands at the end of the cut. Don't fade a phrase out in the middle.
- Talking head for more than ~20 s without a cutaway reads as a lecture (lint note `talking-head`).

### 2.6 Pace for the platform
- Social (9:16): hook in the first 2 s, segments 3–8 s, tight pauses, captions on. Long-form (16:9): let answers breathe, 8–20 s segments, B-roll every 10–15 s.
- Vary shot lengths; a cut where every shot is the same length feels mechanical (lint note `monotone`).
- Comedy, live shows, banter: laughs are pauses in the transcript, and cutting them kills the timing. Keep them with `tighten: { maxPause: 1.6, keepPause: 0.7 }` and keep repeats that are the joke (`"no, no, no, no"`: `tighten: { repeats: false }` on that segment). The `long-pause` notes are then expected.

### 2.7 Multicam: several cameras of one event
- Group the cameras (and a sound recorder) of one event and cut from the group: `multicam: { "show": { "audio": "mic", "angles": { "wide": "camA", "close": ["camB_01.MOV", "camB_02.MOV"] } } }`. A camera that records in chunks is one angle with its files in order. pr-cut syncs every file to `audio` by their sound (a file that doesn't sync clearly is left out, with a warning), takes the words and sound from `audio` (use the best microphone) and the picture from the angles.
- Segments then use `"src": "show"`. pr-cut changes angle at every jump cut and segment join (so cuts read as camera changes, never jumps); set `angle` on a segment to choose: the **wide** to orient and to land a physical moment, the **close** for the emotional line or the punchline, the other person for a **reaction**. Lip sync holds across angles, so J and L cuts work at angle changes.
- Camcorder files with Dolby (AC-3) sound: Premiere can't decode it, so pr-cut extracts the sound to a WAV once and uses that (the report says so).

### 2.8 Before you call it done
Look at the contact sheet and the strips (every cut should change something: framing, angle, or a B-roll cover); read the lint; play the story in your head from the segment list in the report (it prints what each segment says) and check it's coherent from start to end. Then tell the user the length, the story in one line per beat, what you removed, what B-roll and angles you used (or why there were none), and what you'd try next.

## 3. The edit plan

```json
{
  "name": "Ana testimonial v1",
  "media": { "ana": "D:/Shoot/A-cam/ana_interview.mp4", "desk": "lib:41", "music": "D:/Music/bed_118bpm.wav" },
  "segments": [
    { "id": "hook",  "src": "ana", "quote": "we were losing a customer every single day", "beat": "hook" },
    { "id": "turn",  "src": "ana", "sentences": ["s41", "s43"], "beat": "turn" },
    { "id": "proof", "src": "ana", "words": [2210, 2264], "beat": "proof", "tighten": { "maxPause": "1s" } },
    { "id": "close", "src": "ana", "sentences": "s88", "beat": "close", "transition": "dissolve" }
  ],
  "broll": [
    { "src": "desk", "over": "turn/2" },
    { "src": "D:/Shoot/B/team_wide.mp4", "over": "proof", "offset": "1s", "duration": "3s" }
  ],
  "music": [ { "src": "music" } ],
  "grade": { "*": { "contrast": 8, "saturation": 104 }, "ana": { "temperature": 6 } },
  "captions": true
}
```

- `src`: an alias from `media`, a file path, or a library id `lib:41` (from `library_search`).
- Segment range: exactly one of `words: [from, to]` (inclusive word indices from the transcript view), `sentences: "s12" | ["s12","s14"]`, `quote: "…"`, or `from`/`to` (source time).
- Segment options: `beat`, `tighten` (object or `false`), `j`, `l`, `transition` (`cut`, `dissolve`, `dip-black`), `transitionFrames`, `punchIn` (scale %), `grade`, `level` (dB), `channels: [1]` (use one mic channel).
- `tighten` (plan-wide default, segment overrides): `fillers`, `repeats`, `maxPause` (0.6 s), `keepPause` (0.25 s), `handles` (0.06 s), `minPiece` (0.5 s), `cut: [wordIdx | [a, b]]` (extra words to remove: false starts).
- `broll`: `over` a segment, a range `["seg2","seg3"]`, or a jump cut `"seg2/3"`; or `at` (sequence time). `offset`, `duration`, `in` (source in), `audio` (nat sound dB), `scale`, `grade`, `transition`, `snap: "beat" | "bar"` (start and end on the music's beats or bars).
- `music`: `at`, `until`, `level`, `open`, `duck`, `ending` (`backtime` / `fade` / `cut`), `in`, `fadeIn`, `fadeOut`.
- `titles`: `{ "mogrt": "path.mogrt", "at": { "seg": "turn", "offset": "0.5s" }, "duration": "4s", "fields": { "Name": "Ana Ruiz", "Title": "Founder" } }`. Field names are the template's Essential Graphics property names. Titles go on their own track above the picture and B-roll (V3 by default; `track` to choose); a color field reads back as a packed number in Premiere, so set colors in the template.
- **Montage** (instead of `segments`): `"montage": { "music": "…", "clips": ["lib:3", "lib:7", …], "cut": "bar" | "beat" | 2, "length": "30s", "level": 0 }` cuts the picture on the track's bars or beats, cycling the clips (each shot takes the next stretch of its source), and ends on the track's own ending. Give the clips in story order; check the strips for shots that start on a bad frame.
- Plan-wide: `fps`, `size` (`[w,h]` or `"9:16"`), `jumpCuts` (`"auto"` default: camera-aware for show masters, punch-ins for a single camera; `"camera"`, `"punch-in"`, `"none"`), `multicam` (§2.7; segments then use the group as `src` and may set `angle`), `grade` (per alias or `"*"`), `markers` (segment markers with beat and quote, default on), `captions`.
- `captions: true` makes a Premiere caption track (editable in the Text panel). For styled or **karaoke** captions (each word lights up as it's said), build a caption template in ae-compose (`<Captions style="karaoke" template cues={[…one placeholder cue…]} />`, a comp of 8–10 s at the sequence size, then `export_mogrt`) and pass `captions: { "mogrt": "path.mogrt" }`: pr-cut places one per caption on its own top track with its text and word times filled in.
- Times anywhere: `3.5`, `"3.5s"`, `"250ms"`, `"12f"`, `"1:02.5"`, `"00:01:02:12"`.

## 4. Editing an existing sequence (yours or the user's)

1. `inspect_sequence` prints every clip with its path id (`V1/3`), sequence and source times, **the words spoken in it**, grade, scale, levels, graphics, transitions and markers. (Transcribe its media first to see the words.)
2. `apply_cut_edits` with a batch of ops. The result is a **new version** with everything Premiere's own XML keeps (Lumetri, levels, motion, effects, graphics); the original sequence is untouched. Targets: `"V1/3"`, a pr-cut segment or piece id (`"proof"`, `"proof.2"`), or `{ "quote": "…" }`.

```json
[
  { "op": "tighten", "target": "*", "maxPause": "0.5s" },
  { "op": "replace", "target": "V1/2", "quote": "the shorter take of the second answer" },
  { "op": "trim", "target": { "quote": "and that's why we built it" }, "end": "+2w" },
  { "op": "move", "target": "V1/5", "before": "V1/1" },
  { "op": "grade", "target": "*", "temperature": 10 },
  { "op": "level", "target": "music", "delta": -3 },
  { "op": "broll", "src": "lib:52", "over": "V1/4", "duration": "3s" }
]
```

Ops: `delete`, `trim` (`start`/`end`: `"+3w"`, `"-2w"`, `"12f"`, `"-0.5s"`), `move` (`before`/`after`), `replace`, `insert`, `cut-words`, `tighten`, `grade`, `level` (`db` or `delta`; targets `music`, `dialogue`, `all` or a clip; `delta` keeps keyframes such as ducking), `broll`, `transition`, `punch-in`, `remove` (a non-dialogue clip), `title` (`mogrt`, `at`: time or `{ target, offset }`, `duration`, `fields`), `rename`, `captions`.

- Clips on V2+ (B-roll, graphics) stay attached to the moment of dialogue they sat on, so they move with ripple edits; a clip whose moment was cut is dropped and reported. Music beds are re-ducked to the new speech and, when they ended on the track's own ending, keep it (their in point moves).
- Jump cuts an edit creates (tighten, cut-words) get the alternating punch-in, as in a build.
- Dialogue audio that isn't linked to its picture doesn't follow word edits: link it in Premiere first (the report warns).
- `tighten` alone (`dryRun` default) lists every proposed cut with its words and seconds saved: show it before applying.
- Hand cuts come in many layouts: pr-cut finds the speaker (V1 if it has picture with sound, else the lowest video track that does) and treats picture and sound placed in sync as one clip even from two files (a keyed presenter over slides, dual-system sound). Check `inspect_sequence` and the `tighten` dry run before editing: if it finds nothing, the speaker wasn't found.
- Caption templates lift themselves while a title is on screen and never run across a cut between segments.
- Captions don't travel through versions; pr-cut rebuilds them (track or templates) from the new cut's words when the cut was built with captions (or ask with `{ "op": "captions" }`, `mogrt` to switch to templates).

## 5. The media library

- `library_add` a folder the user named (never scan drives on your own). Indexing runs in the background (`library_status`): technical facts, loudness, transcripts, shots with thumbnails, tempo for music, and a role (`interview`, `talking`, `broll`, `music`).
- `library_search` finds by what's said (transcripts) and what's seen (shot descriptions, tags, file names) with filters (`role`, `kind`, `orientation`, `minDuration`, tempo). Hits come with `lib:<id>` and time ranges: use them directly as `src` / `in`.
- **Describe shots** so "what's seen" works: `library_shots` shows a numbered grid of a clip's shots; look at it and store one line per shot with `library_annotate` (subject, action, setting, camera move; type `wide/medium/close/insert/aerial`; quality flags like `soft`, `shaky`, `overexposed`). Do this for B-roll you consider using.

## 6. Finish and deliver
- `audio_finish` measures the mix (EBU R128) and brings it to `-14` (web/social, default), `-16` (podcast) or `-23` (broadcast) LUFS with peaks under −1 dBTP, as a new version; it reports the measured result. When peaks would pass the ceiling it adds Premiere's Amplify + Hard Limiter to every audio clip of the version.
- `match_shots` matches clips to a reference clip (exposure, temperature, tint, saturation) as a new version; use `dryRun` first.
- `deliver` exports the master and 9:16 / 1:1 / 4:5 versions (editable Auto Reframe sequences named "<name> 9x16") into one folder, with CREDITS.md when the project has asset credits. Look at the 9:16 sequence before delivering: Auto Reframe follows the subject, but check that titles and faces sit inside the frame.

## 7. Review checklist (lint and your eyes)

| Rule | Means | Fix |
|---|---|---|
| `mid-word` (error) | a cut is inside a word | widen to the word gap (use `words`/`sentences`) |
| `flash-frame` (error) | a clip under ¼ s | merge or remove it |
| `jump-cut` | same framing across a cut | B-roll `over: "seg/n"`, or a punch-in |
| `lip-sync` | J/L cut on the same camera | drop `j`/`l` or cover with B-roll |
| `music-loud` | music above −14 dB under speech | `level` −20 |
| `title-short` | a title can't be read in time | longer `duration` or fewer words |
| `mixed-rate`, `vfr` | footage doesn't match the sequence | decide: conform, or transcode VFR phone footage |
| `talking-head`, `monotone`, `long-pause` | pacing notes | B-roll, vary segment lengths, tighten |

## 8. Rules
- Never edit the user's original sequences or media: build new sequences; edits create versions. Never relink, move or delete media.
- A build or edit is one Ctrl+Z in Premiere for the cut itself (titles and captions add a few live steps); `undo` reverts the whole batch in one call and refuses when you've worked in Premiere since (so it never undoes your own edits). A batch longer than Premiere's undo history (a cut with many caption templates) is undone by removing the sequence it created. `audio_finish` with limiting adds effects per clip: use `undo`, not Ctrl+Z, to revert it.
- Vanilla Premiere only: no third-party effects or transitions.
- If Premiere shows a dialog, `list_dialogs` shows it as an image and `answer_dialog` presses a button. Informational dialogs (the FCP translation report) are answered automatically.
- Missing media would open a modal dialog in Premiere, so pr-cut refuses to build with files that don't exist: fix the path.

## 9. Troubleshooting
- "bridge info missing" / not reachable: Premiere isn't running or the pr-cut extension isn't installed (`node scripts/install-cep.mjs --pr`, restart Premiere). `doctor` checks everything.
- "quote not found": read the transcript around it (`read_transcript`) and use `words`.
- A segment came out with many short pieces: the speaker was hesitant there; raise `minPiece`, `maxPause`, or set `tighten: false` for that segment.
- Frames look wrong in the contact sheet: `snapshot` at specific times; `cut_strips` for any cuts.
