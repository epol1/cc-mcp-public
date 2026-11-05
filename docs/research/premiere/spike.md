# Premiere Pro 26.5.2 scripting spike (2026-11-05)

Every row below was run against the user's Premiere Pro 26.5.2 (build 5) in a throwaway project
(`scratch/pr/spike/spike01.prproj`), one feature per eval, through the pr-cut CEP bridge
(`packages/bridge-cep-pr`, port 47812). Probe scripts: `scratch/pr/p*.jsx`.

## Bridge
- **CEP still loads in 26.5.2**, including an invisible background extension started by
  `ApplicationActivate` (`StartOn`), with Node (`--enable-nodejs --mixed-context`). PlayerDebugMode was
  already on for CSXS.12. ExtendScript `evalScript` round trip works; the AE bridge pattern (token, eval wrapper,
  hot-reloaded `server.js`) carries over unchanged.
- **UXP:** Premiere ships UXP plugins (`UXP/plugins`), and Adobe's own panels use the `premierepro` DOM plus
  private modules (`dvatranscription`, `dvascripting`). A third-party plugin needs the UXP Developer Tool and
  Developer Mode (user checklist). UXP plugins cannot listen on a socket, so the CEP bridge is also the hub:
  the plugin long-polls `/uxp/next` and posts `/uxp/result`.
- **Premiere ships an agent tool layer** (`AgenticSkills/*/SKILL.md`: getSequenceStructure, insertClipsToSequence,
  renderFrame, createTranscript, getTranscript, universalSearch, …) used by its built-in Assistant. The tool
  names are not in any readable file of the install, so they are not reachable from our scripts (yet).
- **Watchdog:** Premiere's main window class is `Premiere Pro`; panels and most dialogs are owned
  `DroverLord - Window Class` windows, so a dialog is "owned DroverLord window while the main window is
  disabled", or a standard `#32770` (seen: "File Import Failure"). PrintWindow captures read fine; UIA sees no
  buttons, so `press` falls back to Enter/Escape (worked on the import failure dialog).

## Feature table (ExtendScript in 26.5.2)

| Feature | Works | Undo steps | Notes |
|---|---|---|---|
| New project `app.newProject(path)` | yes | – | No dialog. |
| Import media `project.importFiles(paths, true, bin)` | yes | 1 per call | **A missing file raises a modal "File Import Failure" even with suppressUI**: check existence first. |
| Create bin `rootItem.createBin` | yes | 2 | |
| New sequence `qe.project.newSequence(name, sqpreset)` | yes | 1 | **Needs a native path** (`File.fsName`); forward slashes return false. 428 presets ship in `Settings/SequencePresets`. |
| Ticks | – | – | 254 016 000 000 ticks/s; 23.976 frame = 10 594 584 000. `Time.ticks` is a string. |
| Place clip with source range: `item.setInPoint/OutPoint(ticks, 4)` + `track.overwriteClip(item, Time)` | yes, frame exact | 1 each (+2 for clearing marks) | Out is exclusive. Changes the master clip's marks (cleared after). |
| QE undo stack `qe.project.undo()/redo()/undoStackIndex()` | yes | – | Undoing N steps restores exactly; our `undo` tool can roll a batch back. |
| **Property writes** `component.properties[i].setValue(v, true)` (Lumetri, Motion) | yes | **0** | Not recorded in the undo history at all: Ctrl+Z will not revert them. |
| Export FCP7 XML `sequence.exportAsFinalCutProXML(fsName, 1)` | yes | 0 | Premiere's dialect: `xmeml v4`, `pproTicksIn/Out`, Lumetri as `<filter><effectid>Lumetri` with every parameter, graphics as `GraphicAndType` (Source Text is a binary blob). |
| **Import FCP7 XML** `project.importFiles([xml])` | yes, frame exact | **1** | Lands as a new sequence; **reuses existing master clips** (same file path) instead of duplicating media. |
| Duplicate sequence `sequence.clone()` | yes | 1 | Keeps clips, mogrts, Lumetri. Returns true, not the copy: diff `sequenceID`s. **`app.project.sequences` re-sorts after changes: never address by index.** |
| Still frame `qeSeq.exportFramePNG(tc, fsNameWithoutExt)` | yes, ~0.4 s at 1080p | 0 | Composited program frame (grade, graphics, captions). Appends `.png`. Needs the sequence active (`project.openSequence(id)`). |
| Place .mogrt `sequence.importMGT(path, ticks, vOff, aOff)` | yes | 1 | Premiere-native graphics expose Text components (blob values; never write). AE-authored mogrts expose `getMGTComponent()` params: to verify with an ae-compose mogrt. |
| Lumetri `qeItem.addVideoEffect(qe.project.getVideoEffectByName("Lumetri Color"))` | yes | 1 | QE track items include `Empty` gaps: pick `type === "Clip"`. 130 params harvested (`scratch/pr/lumetri-params.txt`): Exposure 19, Contrast 20, Temperature 14, Tint 15, Saturation 16, Highlights 21, Shadows 22, Whites 23, Blacks 24, Look/Intensity, Faded Film, Vibrance. LUT and look assets are blobs. |
| Auto Reframe `sequence.autoReframeSequence(9, 16, "default", name, false)` | yes | 2 | New sequence (607×1080 from a 1080p source) with an Auto Reframe effect per clip. |
| Captions `importFiles([srt])` + `sequence.createCaptionTrack(item, 0, Sequence.CAPTION_FORMAT_SUBTITLE)` | yes | 1 + 1 | Renders in exported frames (default monospace style). |
| Direct export `sequence.exportAsMediaDirect(out, epr, ENCODE_ENTIRE)` | yes, synchronous | 0 | 2.2 s for a 6 s 1080p H.264 (`MediaIO/systempresets/4E49434B_48323634/*.epr`). |
| Transition `qeItem.addTransition(qe.project.getVideoTransitionByName("Cross Dissolve"), true, "12", "0", 0.5, false, true)` | yes | 1 | Centered on the cut, 12 frames. |
| Razor `qeSeq.razor(tc)` | yes | 1 | All unlocked tracks. |
| Ripple delete `trackItem.remove(true, true)` | partial | 1 | Removes only that item; the ripple is blocked when sync-locked tracks have material in the range (left a gap). |
| Transcripts | no | – | No ExtendScript API. UXP / Premiere's own Speech to Text: pending Developer Mode. |

## Consequences for pr-cut
1. **Build path B first.** A whole cut (clips, tracks, transitions, levels, Lumetri, markers) is generated as
   Premiere-dialect FCP7 XML and imported: frame exact, one undo step, never touches existing sequences.
2. **Edits = new versions.** An edit batch on a sequence reads it, applies the edits to the plan, and imports the
   result as the next version (`Interview v002`). One undo step, the original untouched (the user's rule).
3. **Live ops** (frame export, mogrt fields, captions, Auto Reframe, export) run in ExtendScript after the import;
   the report says how many undo steps they added, and `undo` rolls the whole batch back with the QE stack.
4. **Ids** are not stored on track items (no per-item metadata in the DOM): segment ids come from the plan stored
   in the sequence's project-item metadata, matched to clips by track + source range.
