# Prior art: After Effects MCP servers and AE automation libraries

Researched 2026-11-04 for **ae-compose**. The goal was to borrow ideas, not architecture: every MCP server below exposes narrow one-property-per-call tools, and ae-compose will not.

Method: the repos were shallow-cloned and their source read at the commits listed in the appendix. Issues and PRs were read with `gh`. Line numbers refer to those commits. "Measured" means the repo's authors say they measured it on a live AE. "Verify" means nobody has shown it and ae-compose should test it in `docs/research/ae-verify`.

---

## TL;DR

1. **No AE MCP server converts a cubic-bezier or a named easing into `KeyframeEase` correctly.** Every one uses `speed = 0` (easy-ease only) or passes a raw speed and influence straight through. None uses the value change or the time between keys, so none can produce overshoot or an asymmetric curve that matches a CSS or Lottie bezier. The only correct formulas in the wild are bodymovin's AE→Lottie **exporter** (`keyframeHelper.jsx`). Its Lottie→AE **importer** gets spatial properties and zero influence wrong. §6 derives the conversion ae-compose should use.
2. **Ease-array arity is the most common bug.** Sizing the `KeyframeEase[]` by `property.value.length` (TheLlamainator, a-y-ibrahim, mikes16, IMT, tzdwindows) breaks spatial Position and Anchor Point, which need 1 ease. It also breaks colour.
   - **What to do instead:** decide by `isSpatial`, then `propertyValueType` (TwoD→2, ThreeD→3, otherwise 1), with a retry ladder as a safety net (Engine-Room).
   - **Measured:** a 2D layer's Scale takes 3 eases.
   - **Disputed:** COLOR takes 1 per Adobe's docs, but several repos use 4. Verify.
3. **Nobody harvests effect parameter metadata** (`hasMin`/`minValue`/`maxValue`, defaults, `unitsText`, popup options). The best partial attempt is VolksRat71's `effectEnums`. It applies each built-in effect to a 64×64 probe comp and steps each popup with `setValue(v)` / `valueText`, keeping a skip-list of effects that open a dialog.
4. **Bridges:**
   - **File polling** (Dakkshin and its forks): ScriptUI `app.scheduleTask`, 0.25–2 s ticks, a single command file. Slow, and it loses or replays commands.
   - **Mature CEP designs** (Engine-Room, solomon, JUNKDOGE, VolksRat71): an in-AE CEP Node HTTP or WebSocket server, a token, refusal of requests with an `Origin` header, one serialised `evalScript` chain, and explicit *not-sent / uncertain / failed* outcomes. This matches ae-compose decisions D5–D8.
   - **File-IPC done properly** (IMT): mailbox files, a cross-process lock, and dispatcher relaunch.
5. **Measured AE 26.x facts** that ae-compose must design around:
   - an undo group does not survive across `evalScript` calls;
   - `app.executeCommand()` silently no-ops through CEP (it needs focus);
   - every project write re-runs the expressions of the comp shown in the viewer, once per write;
   - `saveFrameToPng` is asynchronous;
   - gradient colour stops are `NO_VALUE` and cannot be set by script;
   - `addText()` inherits the user's Character panel;
   - shape `Contents` index 1 renders in front;
   - node references go stale when a sibling is added;
   - `TextDocument.justification` can land wrong.

---

## 1. Dakkshin/after-effects-mcp (843★, the reference implementation)

Files: `src/index.ts` (963 lines) and `src/scripts/mcp-bridge-auto.jsx` (1773 lines).

### Bridge mechanics

- **Transport:** files in `~/Documents/ae-mcp-bridge/` (`index.ts:26-34`).
  - Node writes `ae_command.json` as `{command, args, timestamp, status:"pending"}`.
  - A **ScriptUI palette** (`new Window("palette")`, `jsx:1289`) polls the file with `app.scheduleTask("checkForCommands()", 2000, true)` (`jsx:1755`).
  - The palette rewrites the file's `status` to `running` and then `completed` (`updateCommandStatus`). That is a read-modify-write race with Node.
  - It writes `ae_mcp_result.json` after trying to stamp `_responseTimestamp` and `_commandExecuted`.
- **Two-step protocol:** most tools return "queued, call get-results in a few seconds" (`index.ts:213-221`). The agent must poll with a second tool. Only a few tools await `waitForBridgeResult(cmd, 5000–6000ms, poll 250ms)`, which matches on `_commandExecuted`.
- **Correlation was broken:**
  - ExtendScript is ES3. `new Date().toISOString()` throws, the `try/catch` swallows it, and the correlation fields are never written. So `waitForBridgeResult` always times out (PR #33, #38, measured on AE 2024 and 2026).
  - `get-results` flags results older than 30 s as "stale" (`index.ts:56`).
  - Freshness is judged by file mtime, which fails across WSL clock skew.
- **JSON:** an `eval`-based `JSON.parse` polyfill (`jsx:1238-1281`). Issue #4: `JSON is undefined` on users' AE. ae-compose D11 measured `typeof JSON === "undefined"` in 26.5 as well.
- **Latency:** at least 2 s per command, plus the agent's polling round trip.
- **AE 2025+ docking:**
  - The palette is always a floating `Window`, and a docked panel renders blank (issue #7).
  - The fix from the issue thread: `var panel = (this instanceof Panel) ? this : new Window("palette", ...)`, and `panel.update()` only when `panel instanceof Window`.
- **No undo groups and no `beginSuppressDialogs`** anywhere.

### Identification

- Everything is addressed by 1-based `compIndex`/`layerIndex`.
- `app.project.items[compIndex]` is the project-item index, which includes folders and footage, so "comp 2" is often not a comp.
- Some functions use `.items[i]`, others `.item(i)`.
- Issue #31 asks for the active comp instead.

### Effects

- `applyEffect` takes a matchName, a display name or a `.ffx` path.
- `applyEffectSettings` sets parameters by **display name**, so it only works in English AE, and silently skips misses (`jsx:965-1003`).
- There is no enumeration of `app.effects` and no tree reading.
- **Wrong matchNames** in the templates and help text, fixed in PR #38:

  | Effect | Used | Correct |
  |---|---|---|
  | Glow | `"ADBE Glow"` | `"ADBE Glo2"` |
  | Directional Blur | `"ADBE Directional Blur"` | `"ADBE Motion Blur"` |

- PR #44 says `layer.Effects` silently no-ops at 8 sites. Unverified.

### Easing

None. `setLayerKeyframe` (`jsx:753-801`) is only:

```js
if (property.numKeys === 0 && !property.isTimeVarying) {
     property.setValueAtTime(comp.time, property.value); // Set initial keyframe if none exist
}
property.setValueAtTime(timeInSeconds, value);
```

- **Side-effect key:** it creates a key at the current comp time as a side effect.
- **Array values arrive as strings:** `value` is `z.unknown()`, so MCP clients send `"[100,200]"` as a string and `setValueAtTime` throws "Value is not an array" (PR #35, #38). Lesson: give every value a concrete JSON-schema type.
- **Keyframes deleted:** `setLayerProperties` / `batchSetLayerProperties` clear existing keyframes as a side effect (PR #44).

### Text, shape, 3D

- Text: `createTextLayer` sets basic text properties.
- Shapes: rect, ellipse and star, each built as a `Contents → Vector Group → shape + Fill + Stroke` chain.
- 3D: a camera only.
- Masks: `setLayerMask`.

### Known issues

- #43: `presetPath` can name any local file, and the tool reports whether it exists.
- PR #40: OneDrive Known Folder Move makes Node and AE poll **different** `Documents` paths. Fix: use `%LOCALAPPDATA%` or an `AE_MCP_BRIDGE_DIR` override.
- PR #40: polling collides with "cannot run a script while a modal dialog is open". The fix is a slower, self-rescheduling one-shot `scheduleTask`.
- PR #44: the installer used `Start-Process -Verb RunAs` without `-Wait` and reported success even when nothing was copied.

---

## 2. TheLlamainator/after-effects-mcp (24★; a copy, not a GitHub fork)

GitHub reports `parent: null`. The README calls it a fork of Dakkshin. It has the same bridge, `index.ts` 1865 lines and `mcp-bridge-auto.jsx` 2626 lines. Issues are disabled.

It adds:

- effect keyframe and graph controls;
- `.ffx` preset list, search and apply;
- installed-effect discovery;
- markers;
- WAV waveform analysis to markers. The WAV is parsed in Node.

### Bridge

- Identical file pair. `checkInterval = 2000` (`jsx:2194`).
- More tools await `waitForBridgeResult(cmd, 7000–10000)`. They still depend on `_commandExecuted`, and that is still stamped after `new Date().toISOString()` (`jsx:2464`) with no polyfill.
- So on an ES3 engine **every awaited call times out after 7 s, even though AE applied it.** The agent sees an error for work that happened.

### Effect discovery

Located at `jsx:849-937`. Enumeration of `app.effects`, defensive across API shapes:

```js
var effectsCollection = app.effects;
if (effectsCollection.length !== undefined ...) collectionCount = Number(effectsCollection.length);
else if (effectsCollection.numEffects !== undefined ...) collectionCount = Number(effectsCollection.numEffects);
for (var i = 0; i < collectionCount; i++) {
    try { effectObj = effectsCollection[i]; } catch (e1) {}
    if (!effectObj && effectsCollection.effect) { try { effectObj = effectsCollection.effect(i + 1); } catch (e2) {} }
    try { name = effectObj.displayName || effectObj.name || ""; } catch (e3) {}
    try { matchName = effectObj.matchName || ""; } catch (e4) {}
    try { category = effectObj.category || ""; } catch (e5) {}
    try { isObsolete = !!effectObj.isObsolete; } catch (e6) {}
```

- It filters obsolete effects and substring-matches name, matchName and category.
- It does **not** apply effects to read their trees.
- Trees are only read for effects already on a layer, by `serializeEffectProperty` (`jsx:719-745`). That records name, matchName, index, canSetExpression, canVaryOverTime, numKeys and isGroup, plus the value if asked. It does not record min/max, value type or defaults.
- Property paths can be names, matchNames or indices, e.g. `['Compositing Options','Effect Opacity']` or `[3,1]` (`resolvePropertyPath`, `jsx:670-694`). That is a good idea.

### Easing

Located at `jsx:958-1138`:

```js
function getPropertyDimensionCount(property) {
    var value = property.value;
    if (value instanceof Array) return value.length;   // BUG: Position [x,y,z] → 3, needs 1; Color → 4, needs 1
    return 1;
}
function buildEaseArray(dimensionCount, speed, influence) {
    var resolvedSpeed = (speed !== undefined && speed !== null) ? Number(speed) : 0;
    var resolvedInfluence = (influence !== undefined && influence !== null) ? Number(influence) : 33.333;
    for (var i = 0; i < dimensionCount; i++) easeArray.push(new KeyframeEase(resolvedSpeed, resolvedInfluence));
```

Bugs:

- Arity comes from `value.length`.
- `easyEase` is always speed 0 with influence 33.333.
- Custom `easeIn`/`easeOut` pass raw speed and influence through. There is no conversion from bezier or named easings, and no use of the value delta or duration.
- Influence is only bounded by the Zod schema (`.min(0.1).max(100)`). There is no clamp on the AE side.
- Eases are set **before** the interpolation type, and AE resets eases when the type changes.
- Spatial tangents are passed through raw inside a `try` that swallows errors.
- All the graph options apply only to **effect** properties (`setEffectProperty`). The layer-transform `setLayerKeyframe` still has no easing.
- `findKeyIndexAtTime` uses a 1e-4 epsilon.

### Presets

`collectPresetFiles` (`index.ts:188-262`) walks `Program Files/Adobe/Adobe After Effects 202x/Support Files/Presets` and user folders for `.ffx` files. That is fine for discovery.

---

## 3. Other AE MCP servers (2025–2026)

Ranked by usefulness to ae-compose. Two audit passes covered these repos; their key quotes were spot-checked against the source.

### 3.1 Engine-Room-Games/after-effects-mcp (43★) — the most rigorous; read its docs

These docs are the best catalogue of AE 26.3/26.5 behaviour anywhere:

- `docs/fragile-areas-ae.md`
- `docs/fragile-areas-bridge.md`
- `packages/mcp-server/src/guides/extendscript-gotchas.md`

#### Bridge

- An invisible CEP extension auto-starts and serves HTTP and WebSocket on 7777. It uses a port file, walks to the next port if taken, and keeps a per-port token file with mode 0600.
- `evalScript` calls go through a promise-chain mutex. A call the server already abandoned is **dropped before it runs** (the `gone` flag, `packages/ae-panel/client/main.js:162-221`).
- Every op is one line, `__AEMCP.call(literal)`. The bundle publishes **one global**, because the ExtendScript engine is shared with every other script, panel and `DoScript` (issue #185).
- It escapes U+2028 and U+2029, which break ES3 string literals (`main.js:245-255`).
- JSON: it self-tests the engine's JSON and falls back to a private polyfill (`packages/jsx/core.jsx:11-35`).
  - Its comment says "AE 2026 has JSON natively". ae-compose D11 measured `undefined`.
  - Likely explanation: inside the CEP engine some other extension had already defined JSON. **So ship a private JSON either way.**
- Five distinct error classes. A *timeout* means do not resend, because the call may still land. *Refused* means rediscover the port.
- After a timeout, the next call is refused unsent while AE is still busy.
- `dispatch()` wraps every op in `beginSuppressDialogs` and sets an `app.onError` collector. WARNING-level messages, such as an undo-group mismatch, come back to the agent as `aeWarnings`.

#### Measured undo facts

- An undo group does **not** survive across `evalScript` calls. A 600-op batch produced about 600 undo steps (#69).
- `copyToComp` fails while an undo group is open (#30).
- A script's own `begin/endUndoGroup` interact badly with the wrapper's group. A begin with no end empties the undo history (#221).

#### Easing arity

The arity ladder (`packages/jsx/keyframes.jsx:17-62`):

```js
// a 2D layer Scale wants 3, a shape Ellipse Size wants 2 while its value reads [w,h], Opacity and a
// slider want 1, and a spatial Position wants 1 whether the layer is 2D or 3D because the ease runs
// along the motion path. Get it wrong and AE throws "parameter 2" and says nothing else.
var __EASE_ARITIES = [1, 2, 3, 4];
function __easePropertyArity(prop) {
  if (prop.isSpatial) return 1;
  ... if (vt === PropertyValueType.TwoD) return 2; if (vt === PropertyValueType.ThreeD) return 3;
      if (vt === PropertyValueType.COLOR) return 4;   // contradicts Adobe docs (1); the ladder recovers
```

- The arity AE accepted is reported back as `easeDimensions`.
- The side the caller did not pass is preserved (#153).
- `setTemporalEaseAtKey` turns both sides bezier, so the kept side's interpolation is restored afterwards.
- A per-dimension ease on a spatial property is refused, with advice to separate dimensions.
- There is no bezier→speed conversion. `style/motion.ts` analyses existing eases and overshoot, read-only.

#### Effects

- `app.effects` is slow, about 250 entries, and timed out the bridge (#26). It is cached per session.
- Parameter dumps are capped: Trapcode Particular has 7,401 parameters, about 1 MB (#115).
- MatchNames only, because display names are localised (#121).

#### Other measured gotchas worth knowing

- **Expressions:**
  - **Every project write re-runs the pixel-affecting expressions of the comp in the viewer, once per write.** 20 writes with a heavy comp in view took 74 s, and `app.disableRendering` did not help (#266).
  - `Property.expression = "garbage"` succeeds. `expressionError` is the only signal (#97).
  - Removing the last Time Remap key hides the property, and later writes throw "property or a parent property is hidden" (#86).
- **Script engine:**
  - `app.executeCommand(2080)` silently no-ops through CEP, because it needs focus and a selection (#47).
  - `$.evalFile` evaluates into the caller's scope, not global scope.
  - Chained ternaries `a?x:b?y:z` parse left-associatively in ExtendScript, giving the wrong answer silently.
  - `Error.start`/`end` are 0 on every error in AE 2026.
- **Properties:** `Property.canSetValue` is `undefined` in 26.5. A hidden property (camera Scale, point light Orientation) shows up as `canSetExpression === false`.
- **Shapes:**
  - **Contents index 1 renders in front, and `addProperty` appends**, so build front-to-back or reorder.
  - Shape node references go stale (`Object is invalid`) once a sibling is added. Add every node first, then re-fetch.
  - `ADBE Vector Grad Colors` is `NO_VALUE`, so gradient stops cannot be set by script (#181).
  - The Repeater's Composite stores 1 = Below and 2 = Above.
  - Every vector group carries a 48-property `ADBE Vector Materials Group` that is about 75 % of a shape dump. Skip it when serialising.
- **Text:**
  - `addText()` inherits the user's Character panel, e.g. tracking −20. Always set every TextDocument field.
  - `TextDocument.justification = CENTER_JUSTIFY` landed as RIGHT (7414) on 26.3.
  - A TextDocument round trip can drop justification. Read it back.
- **Templates and comps:**
  - `exportAsMotionGraphicsTemplate` invalidates **every** held reference, including `app.project`.
  - `CompItem.duplicate()` is shallow.
- **Transforms and identity:**
  - The scripting DOM has no `toComp`/`toWorld`.
  - (compId, layer.id) is the canonical identity. `itemByID` on a missing id throws "internal verification failure".
- **Screenshots and rendering:**
  - Screenshots go through a **temporary wrapper comp** at the requested `resolutionFactor`, removed in a `finally`, so the user's comp is never touched (#282).
  - `saveFrameToPng` output is premultiplied colour written into a straight-alpha PNG, so the server un-premultiplies it (#130). 16-bit PNGs are converted to 8-bit.
  - Renders go through `aerender` spawned by the server, because `renderQueue.render()` holds AE for the whole render.

### 3.2 Immersive-Media-Technologies/aftereffects-mcp-imt (3★)

A fork of `kumoproductions/mcp-aftereffects` (see `NOTICE`). It is the most robust file-IPC design.

#### Transport (`src/transport/FileIpcTransport.ts`, `jsx/dispatcher.jsx`)

- **Requests:**
  - One mailbox file per call, `request-<uuid>.json`, written as tmp + rename.
  - Node polls every 80 ms with a 60 s default.
  - Calls within one process are serialised by a promise chain.
- **Cross-process lock:** a `fs.open(BUSY_LOCK_PATH, "wx")` lock, refreshed every 15 s and stale after 90 s. Its stated reason: "AE refuses a script delivered while another script runs — with a modal warning that halts all scripting."
- **Dispatcher relaunch and reclaim:**
  - If a request is still unconsumed after 2.5 s × attempt, the dispatcher is relaunched, up to 3 times.
  - On timeout, an **unconsumed request is deleted** so it cannot apply minutes later. A consumed one keeps the lock.
- **Dispatcher behaviour:**
  - Consume-on-read: the oldest request is deleted when read, and its id comes from the filename.
  - An engine canary `(new Function("return 1"))()` detects a broken engine and reports "restart AE".
- **Modal dialogs:** detected **out of process**. On Windows a `#32770` scan through PowerShell and C# reads the dialog text and can post Escape. On macOS it uses JXA. See `src/transport/dialogs.ts`.
- **Launcher:** "AfterFX.exe cuts that path at the first SPACE, quotes or not." It writes a bootstrap into a space-free path, falling back to the 8.3 short name.
- **Script execution:** code runs as `new Function("app","log","payload", code)`. Bulk data travels as `payload` and is never inlined into the source.
- **Private JSON:** its own JSON is swapped into `$.global.JSON` for the duration of a call, because another panel (`com.fossa.tether`) replaces `JSON.parse` with a broken one.
- **Error handling:**
  - `describeError` avoids `"x"+e`, which itself throws and pops a modal.
  - Errors are classified by `e.number`, which is locale-independent.
  - Line numbers are corrected for the `new Function` header.
  - If serialisation fails, a hand-built ASCII response is written instead.

#### Locale independence

- `tests/locale-independence.test.ts` fails the build on `.property("Contents"|"Transform"|...)` by English name. It allows only Adobe's list of English-safe names.
- Menu command IDs come from AE's string tables (`src/operations/command.ts:62-121`): 3973 Create Shapes from Vector Layer, 3799 Convert to Editable Text, 2767 New Null, 10312 Center Anchor Point, 3983 Track Camera, 16 Undo, 2035 Redo.
- Render and output-module template names are resolved with `localize()` on ZString keys, plus alias tables for 10 languages.

#### Easing

- `src/operations/keyframe.ts:107-152` sizes the array by `keyValue().length` when the property is not spatial, so COLOR gets 4.
- Presets use speed 0 (e.g. `(0,75)`). There is no conversion and no clamp.
- **Retime bug:** `keyframe.shift` with `scale` reapplies the old `KeyframeEase` objects. Speed is in units per second, so it must be divided by the scale (`jsx/helpers.jsx:745-760`).
- JSON export/import restores interpolation types and drops the eases (`jsx/import.jsx:492-496`).

#### Verification

- `comp.snapshot` / `comp.diff` keep per-layer fingerprints keyed by layer id (`src/operations/safety.ts:226-285`).
- `expression.validate` force-evaluates every expression at the first, middle and last frame.
- **Atomic batch** (`src/operations/batch.ts:144-176`): it creates a **marker folder inside the undo group**, runs `executeCommand(16)` on failure, and then **checks that the marker is gone**. So Undo is verified, never assumed.
- `ae_render_frame` waits for a stable file size. For colour-managed projects it adds a transient OCIO Display Transform adjustment layer, so the PNG matches the viewer.
- A `dryRun` mode returns the generated JSX without contacting AE.
- An ES3 lint runs over the generated code in tests (`tests/helpers/lint-jsx.ts`).

### 3.3 solomondivyananth/aftereffects-mcp (81★) — CEP Node HTTP, about 50 tools

#### Bridge

- The CEP panel runs `http.createServer` on `127.0.0.1:7788`.
- **Security:** a 32-byte token compared in constant time. Requests carrying `Origin` or `Referer` are refused, and `Content-Type: application/json` is required (`panel/js/main.js:449-470`).
- Calls take the form `__aeBridge(fnName, JSON.stringify(JSON.stringify(args)))`, so the arguments are double-encoded and arrive as a string literal.
- Timeouts per function: 90 s by default, 600 s for raw JSX and batches, 3600 s for renders.
- **Results over 100 KB are spilled to a temp file** and the path is returned instead, because "big payloads choke evalScript's return channel" (`panel/jsx/bridge.jsx:167-180`).
- Each write runs in one undo group with dialogs suppressed.
- A sandbox guard refuses writes unless the open `.aep` is the chosen sandbox file.

#### Catalog and properties

- `ae_catalog` enumerates `app.effects`, presets, `app.fonts.allFonts` (AE 24+) and render templates.
- **Dialog-effect blocklist:** `ADBE Apply Color LUT2` opens a file dialog and freezes AE (`bridge.jsx:1518-1525`).
- The `_walk` tree reader flattens `elided` groups. Skipping them is how a text animator ends up read as "not animated".

#### Easing

Located at `bridge.jsx:1363-1385`. This repo has correct arity and clamping:

```js
function _dims(p){ if (t===TwoD) return 2; if (t===ThreeD) return 3; /* Spatial properties and colours carry one ease */ return 1; }
inI = e.inI === null ? curIn[d].influence : Math.max(0.1, Math.min(100, e.inI));
```

Speed is still 0 unless given, with no conversion.

#### Tricks

- `set_expression` reads `expressionError` and **restores the previous expression** if AE rejected the new one.
- `findMenuCommandId` refuses menu items ending in "…", because those open dialogs.
- `mcp/proof.js` is a **motion linter with about 30 checks**: overlap, jitter, off-grid keys, speed breaks, long-way rotation, and more. Good inspiration for a lint pass on ae-compose's IR.
- Privacy note: `mcp/jev.js` posts motion descriptions to an external API when `TYPESAFE_API_KEY` is set.

### 3.4 JUNKDOGE-JOE/after-effects-mcp (92★) — MCP inside CEP Node, plus a native AEGP plugin

#### Bridge

- The MCP server runs **inside** the CEP Node host, as streamable HTTP at `127.0.0.1:11488/mcp`. A stdio shim serves stdio clients.
- **Engine-drain gate** (`jsx-bridge.js:143-245`):
  - A timeout is reported as `disposition: 'uncertain'`.
  - Later calls stay queued until the sentinel `csInterface.evalScript('1+1')` calls back, which proves the engine has drained.
  - Queued calls past their deadline are rejected as `not_dispatched`.
- `undoSourceConflict` statically scans user JSX for nested or unmatched undo groups, `render()`, `$.evalFile` and `app.open` (`server.js:485-525`).
- Issue #397: `renderQueue.render()` inside an undo group produced a mismatch modal. After that AE could not render 3D comps until restart.
- Safe `JSON.parse` uses json2's regex check before `eval`.

#### Native AEGP plugin

- Talks over an authenticated named pipe or Unix socket, with 4-byte length-prefixed JSON.
- Calls are dispatched on AE's main thread from an IdleHook.
- Arity is authoritative, from `AEGP_GetStreamTemporalDimensionality`.
- Its note: "AE only retains per-keyframe temporal ease when both sides use bezier." So the key is promoted to bezier before the ease is set.
- This is out of scope for vanilla ae-compose (no C++), but it confirms the ordering rule.

#### Easing problems

- **Wrong arity in JSX:** the helper uses `if (prop.isSpatial) dims = 1; else dims = v.length;`, which is wrong for colour.
- **Wrong curve table:** the bundled skill's CSS cubic-bezier → AE table maps `easeOutBack (0.34,1.56,0.64,1)` to "0 / 100". Speed 0 cannot overshoot. **Don't copy the hand-made tables.**

#### Other ideas

- Checkpoints use `.aep` copies.
- Read-only worker AEs are launched with `AfterFX -m -noui -r` and render previews from checkpoint copies.
- `ae_validateExpressions` samples `valueAtTime` at several times.
- A/B diff heatmaps.
- `propByMatchPath("ADBE Effect Parade#2/...")` uses **ordinals** for duplicate matchNames.

### 3.5 ishu86/after-effects-mcp (46★) — CEP panel plus a file queue, about 102 tools

#### Bridge

- The CEP panel calls `evalScript('processCommands()')` every 100 ms.
- There is one file per command, `{clientPid_ts}_{cmdId}.json`. The reply is written as `.json.response` and the command is renamed `.processed`.
- Files are written non-atomically, so a partial read produces "Invalid JSON".
- The payload is TypeScript-generated ES3 that the host `eval`s, inside `beginSuppressDialogs` plus an undo group.
- PR #4 fixed **doubly nested undo groups**. They caused "undo groups do not match" and silently rolled back work that had already been saved.

#### Easing

- Arity is correct: TwoD→2, ThreeD→3, otherwise 1.
- Every dimension gets the same ease. No clamp, no conversion.
- `EasingType 'easeInOutCubic'` is declared in the types but never implemented.

#### 3D

`threeDGenerators.ts:37-49,185-207`:

- **Renderer matchNames:** `'ADBE Advanced 3d'` = **Classic 3D** (counter-intuitively), `'ADBE Calder'` = Advanced 3D, `'ADBE Ernst'` = Cinema 4D.
- A per-renderer table of which properties each renderer exposes, e.g. `'ADBE Extrsn Depth': ['advanced','cinema4d']`. Iris and camera blur exist only under Classic.
- Hidden properties resolve but throw when written, so they are set one by one and failures are reported.

#### Particles

- `canAddProperty("CC Particle Systems II")` before adding it.
- Parameters are addressed by indexed matchName, e.g. `"CC Particle Systems II-0004"`.

#### Vision

- `saveFrameToPng` returns before the file exists. They wait for the file, then for its size to stay stable over 3 checks.
- `get_comp_report` reads `sourceRectAtTime`, `expressionError`, keys and markers.

### 3.6 a-y-ibrahim/after-effects-mcp (29★) — a hardened Dakkshin descendant

- **Bridge fixes:**
  - a unique `commandId`, echoed back;
  - atomic writes;
  - a Node mutex around the clear → write → wait cycle;
  - `scheduleTask(…, 250, true)` with the task id kept in `$.global`, so a reopened panel cancels the stale task;
  - on startup, the dedup key is seeded from the existing command file, so an **old destructive command is not replayed**;
  - `%LOCALAPPDATA%` instead of `Documents` on Windows, because of OneDrive;
  - a `BRIDGE_VERSION` handshake that catches a stale panel.
- **`NO_UNDO_GROUP_COMMANDS`** for render and `saveFrameToPng` (`jsx:4083-4106`). Their reason: "RenderQueue.render() and CompItem.saveFrameToPng() open/close their own internal undo transactions … AE 2026 pop 'Undo group mismatch'".
- **Frame capture:**
  - PR #14: in a 16-frame batch, only 7 PNGs were on disk when the script returned. The fix checks for the PNG signature and the **IEND trailer** (`src/lib/see-frame.ts:83-90`).
  - PR #31: a downscale wrapper with Collapse Transformations renders effects at full pixel values, so a 40 px blur looks like 160 px at quarter size.
- **Easing:** the same `value.length` arity bug as TheLlamainator. No conversion.

### 3.7 VolksRat71/after-effects-mcp-vision (9★) — CEP Node HTTP, AE and Illustrator

#### Transport

- A headless CEP extension starts on `ApplicationActivate` with `--enable-nodejs --mixed-context`.
- It serves loopback port 8791 with a bearer token, created with `flag:'wx'` and mode 0600. It pins the `Host` header against DNS rebinding.
- Each call is a real round trip with no polling:

  ```js
  let script = `__mcp_exec(${JSON.stringify(request)})`;
  const raced = await Promise.race([rawEval(script), timeout]);   // default 30 s
  if (raced === 'EvalScript error.') ...                          // CEP collapses every failure to this literal
  ```

- A timeout does not cancel the work, and the late result is discarded.
- PR #4: CEP's own page sends `Origin: null`, so a blanket Origin refusal also blocked the panel from reaching its own server. **ae-compose D7 must allow the panel's own `null` origin, or route it differently.**
- The host wraps the parse, the op **and the serialisation** in `beginSuppressDialogs`. Its comment: an error thrown outside the try escapes suppression and hangs AE on a modal.

#### Popup option harvesting

`cep/host/ae/ops-diagnostics.jsx:14-82` covers the case where AE has no API listing a popup's options:

```js
var SKIP = { "ADBE Apply Color LUT2": "opens a LUT file picker", "ADBE Apply Color LUT": ...,
             "ADBE 3D Tracker": ..., "ADBE SubspaceStabilizer": ..., "ADBE Samurai": "Roto Brush session" };
for (var v = 1; v <= 64; v++) { p.setValue(v); if (p.value !== v) break; opts.push(String(p.valueText)); }
```

- It runs in a 64×64 `__mcp_enum_probe` comp, restores each value, then removes the effect and the comp.
- `scripts/gen-effect-enums.mjs` generates the table in resumable batches and keys it by **parameter matchName**, giving `cep/host/ae/effect-enums.jsx` (3796 lines).
- The labels are English, because `valueText` is localised.
- Dropdown Menu Control is read via `isDropdownEffect` and `propertyParameters`.

#### Easing

- Arity: spatial→1, TwoD/ThreeD→2/3, COLOR→4. Speed is always 0. Influence is range-checked. `docs/CAPABILITIES.md` admits "no overshoot primitive".

#### Measuring and capture

- **Bounds:** `sourceRectAtTime(layer.sourceTime(t))`, with Scale and Anchor applied in its own code. It flags 0×0 on a freshly created shape layer.
- **Frame time:** capture time is clamped to `duration − frameDuration`, because a frame at exactly `duration` is empty.
- **Solo isolation:** `captureIsolated` solos one layer and restores the solo states afterwards.
- **Fonts:** `__mcp_resolveFont` resolves a PostScript name, then a family, then "Family Style" through `app.fonts`.
- **Render hygiene:** other queue items are disabled and restored in a `finally`, and its own items are tagged.

**Bug:** effect paths are `["ADBE Effect Parade", matchName]`, so two of the same effect on one layer resolve to the first. Paths need an ordinal or index.

### 3.8 Smaller and derivative repos (one line each)

- **HeroicSwan/after-effects-mcp (46★):**
  - A Startup script that is deliberately inert, because doing work at startup triggers "modal dialog waiting".
  - A one-shot `scheduleTask` at 1500 ms that re-arms itself and backs off to 5 s.
  - `~/.ae-mcp/instances/default/command.json` with a `requestId`, and a Node FIFO broker.
  - **Bug:** the APPDATA version folders are hard-coded `25.5…22.6`, so it fails on AE 26.
  - No easing.
- **23d1/after-effects-mcp:**
  - No panel. Each call writes a uuid `.jsx` and runs `AfterFX.exe -r` or `osascript DoScriptFile`, then waits on `result.json`.
  - **`-r` returned after 376 ms for a script that took 1952 ms**, so `-r` is not synchronous.
  - Non-ASCII is escaped as `\u` because AE reads a BOM-less `.jsx` as Latin-1.
  - `Object.prototype` carries operator hooks, so `MAP['-']` is a Function. It guards with an `own()` helper.
  - **Key-index bug:** keys added out of time order get the wrong ease, because the code holds `nearestKeyIndex` results across insertions.
- **ku1x/after-effects-mcp-enhanced:**
  - `src/` is byte-identical to Dakkshin. The new `enhanced/` folder adds a **durable request queue**:
    - folders `pending/`, `running/`, `results/`;
    - ids `${Date.now()}-${uuid}`, written with `wx` to tmp and then renamed;
    - after 10 s, `wait()` returns "Still queued or executing … do not resubmit."
  - The runtime is launched once with `AfterFX -r` and ticks with `scheduleTask(…, 250, true)`.
  - No undo groups and no dialog suppression.
- **tzdwindows/after-effects-mcp:**
  - Single-slot files, an 80 ms Node poll, a 400 ms panel tick, `eval(cmd.script)` inside an undo group.
  - A heartbeat file. When the panel is dead, Node kills AE's crash processor and relaunches AE.
  - It saves before every command, or snapshots the `.aep` and removes it from the recent-files list.
  - A probe applies about 36 matchNames to `__Probe_Comp__` (top-level properties only).
  - It inserts `ADBE Grow Bounds` before Glow so the glow is not clipped.
- **mikes16/ae-mcp-pro:**
  - A Dakkshin clone with a `toISOString` polyfill and `_responseTimestamp >= startIso` freshness.
  - **Bug:** `setTemporalEaseAtKey(i, easeInArr)` with only the in-ease also overwrites the out-ease, as documented.
  - `doUndo` runs `executeCommand(16)` inside an open undo group.
- **oneprism-io/After-Effects-MCP:** no source; a hosted CEP + WebSocket service. The only takeaway is "3 router tools in front of 300+ operations", the same coarse-tool direction as ae-compose.
- **Not reviewed:**
  - kumoproductions/mcp-aftereffects (upstream of IMT)
  - SUBSAHARXN/after-effects-mcp ("dotLottie compilation, expression auto-baking" — possibly relevant)
  - Anant-404, karly-herrera, ionutsss1, Dsrupt, BhupendraSharma, dogauto, teamturmericmedia, malkawi06, ZURAVFX, okaybhargav, brandkickagency
  - `dcc-mcp-aftereffects` on PyPI (CEP + localhost)

---

## 4. AE scripting libraries and exporters (non-MCP prior art)

### 4.1 bodymovin exporter — AE KeyframeEase → cubic-bezier (the reference math)

The source is [`bundle/jsx/utils/keyframeHelper.jsx`][bm-kh]. It converts each segment A→B from duration `T` and per-dimension value change `Δ`.

**Non-spatial (OneD, TwoD, ThreeD, COLOR), per dimension k:**

```js
bezierIn.x[k]  = 1 - key.easeIn[k].influence / 100;
bezierOut.x[k] = lastKey.easeOut[k].influence / 100;
yNormal = (key.value[k] - lastKey.value[k]);          // COLOR: 255 * Δ
if (Math.abs(yNormal) < 0.0000001) yNormal = 1;
var bezierY   = (lastKey.easeOut[k].speed * lastKey.easeOut[k].influence / 100);
var bezierInY = (key.easeIn[k].speed * key.easeIn[k].influence / 100);
bezierIn.y[k]  = 1 - (bezierInY * duration) / yNormal;
bezierOut.y[k] = (bezierY * duration) / yNormal;
```

**Spatial (TwoD_SPATIAL, ThreeD_SPATIAL)** uses one ease. The speed is along the motion path, and the arc length comes from 200-sample flattening of the spatial bezier `(vA, vA+outTangent, vB+inTangent, vB)`:

```js
var curveLength = getCurveLength(lastKey.value, key.value, lastKey.to, key.ti);
averageSpeed = curveLength / duration;
infOut = Math.min(100 * curveLength / (lastKey.easeOut.speed * duration), lastKey.easeOut.influence);
infIn  = Math.min(100 * curveLength / (key.easeIn.speed * duration), key.easeIn.influence);
bezierIn.x = 1 - infIn / 100;  bezierOut.x = infOut / 100;
bezierIn.y = 1 - (key.easeIn.speed / averageSpeed) * (infIn / 100);
bezierOut.y = (lastKey.easeOut.speed / averageSpeed) * (infOut / 100);
```

**The `min()` clamp** ensures `y ≤ 1` on spatial properties. That is, bodymovin assumes AE cannot overshoot *along a motion path*, and that AE clips the influence instead. **Verify.**

If that holds, ae-compose cannot express `easeOutBack` on an un-separated Position with one segment. It must:

- separate dimensions (Position only; Anchor Point cannot be separated),
- add an extra key, or
- use an expression.

**COLOR:**

- The value change is multiplied by **255**. This implies AE expresses colour ease speed in 8-bit units per second. **Verify.**
- The loop runs over `key.easeIn.length`. If colour has 1 ease, the curve's `y` comes from the red channel's change alone.

**SHAPE and NO_VALUE:** `averageSpeed = 1`, so path keyframes ease in normalised "percent of morph" units.

### 4.2 bodymovin Lottie importer — cubic-bezier → AE (the inverse; has bugs)

Sources: [`src/helpers/importers/lottie/property.js`][bm-imp] with [`bundle/jsx/importers/lottieImporter.jsx`][bm-imp-jsx]. This is the only open-source code found that turns a bezier into `KeyframeEase`:

```js
var keyInInfluence = (inXDimension - 1) * -100;          // (1 - x2) * 100
var lastKeyOutInfluence = (outXDimension) * 100;         // x1 * 100
var duration = (nextKeyframe.t - keyframe.t) / getFrameRate();
var yNormal = nextValue[dimension] - keyframe.s[dimension];
var bezierInY = -(inYDimension - 1) * yNormal / duration;
var bezierY = outYDimension * yNormal / duration;
var lastKeyOutSpeed = bezierY / lastKeyOutInfluence * 100;   // (y1/x1) * Δ/T
var keyInSpeed = bezierInY / keyInInfluence * 100;           // ((1-y2)/(1-x2)) * Δ/T
```

The formula is right for OneD, TwoD and ThreeD. The bugs:

- **Spatial speed uses only component 0's change.** A Lottie spatial key has scalar `i.x`, so `totalDimensions = 1` and `yNormal = Δx`. A vertical move then gets speed 0, and any diagonal move is mis-scaled. It should use the arc length.
- **No influence clamp.** `x1 = 0` or `x2 = 1` gives influence 0 and speed `Infinity`/`NaN`, which AE rejects (influence must be in [0.1, 100]).
- **COLOR misses the exporter's ×255**, so the two directions are inconsistent.
- The first key's in-ease and the last key's out-ease are filled with `KeyframeEase(1, 1)`, which is arbitrary.
- The JSX side sets `setTemporalEaseAtKey` and **then** `setInterpolationTypeAtKey(index, BEZIER, type)`. It always forces the in-side to BEZIER (`lottieImporter.jsx:118-122`).

### 4.3 Experience-Monks ae-to-json (2016) and ae-temporal-to-cubic-ease (2016)

**ae-to-json:**

- It walks every property with a reflective `for (var i in item)` copy of all scalar attributes (`src/util/getNonObjectValues.js`). So it picks up `hasMin`, `minValue`, `propertyValueType` and others by accident.
- Note the workaround there: `typeof` "was failing in AE", so it detects types via `toString()` regexes. Every access is wrapped in `try`, because some getters throw, e.g. "Unable to access lightType because layer is not a LightLayer".
- It runs through the npm `after-effects` module (§4.6).

**ae-temporal-to-cubic-ease** is a port of the bodymovin math, with bugs worth knowing so they aren't copied:

- `getCurveLength` loops `for (i < 2)`, so it measures the **chord**, not the arc.
- The zero-length branch assigns ease *objects* to the influence variables.
- The SHAPE branch references the undefined `infOut`/`infIn`.
- The spatial in-influence reads `easeCurrent.easeIn` instead of `easeNext.easeIn`.

### 4.4 aequery (docsforadobe/aequery, Battle Axe lineage; jQuery-style AE DOM)

- **Ease arity** is set by `propertyValueType` (TwoD→2, ThreeD→3, otherwise 1). That matches Adobe's docs, so spatial and colour get 1 ([`lib/objects/key.js:228-250`][aeq-key]).
- **Stable key handles:** `aeq.Key` stores `originalTime`. Every method calls `checkKey()`, which re-resolves the index with `nearestKeyIndex(originalTime)` and throws if the key moved. **Key indices shift on every insertion**, so this pattern, or "insert everything, then ease by time", is required.
- `pasteKey` uses `addKey(time)`, which returns the index. Then it sets the value, then the ease, then the interpolation type.

### 4.5 AEUX (google/AEUX) — Sketch/Figma → AE shape layers

Source: [`Ae/AEUX/src/host/AEFT/host.jsx`][aeux].

**Gradient workaround:**

- Shape gradient colours are not scriptable (`NO_VALUE`). AEUX embeds binary **`.ffx` preset templates for 2–8 stops** as `RIFX…` string literals.
- `createFile()` rewrites lines containing `points` with `<float>` stop values, writes the file as `BINARY` and then:

  ```js
  fill = thisComp.selectedProperties[0]; fill.selected = true; layer.applyPreset(tempFile);
  ```

- This is the only known way to set gradient stops from script. It depends on property selection and on the comp being active, which ae-compose should verify inside its own bridge.

**Other notes:**

- **Build-time viewer trick:** during a build it creates and `openInViewer()`s a 500×500 `LOADING...` temp comp, and removes it at the end (`host.jsx:123-137`). Combined with Engine-Room's #266 finding (every write re-runs the viewer comp's expressions), **showing a trivial comp during builds is a likely big speed-up.** Verify.
- **Undo:** the build runs inside a single `beginUndoGroup`. It then runs `app.executeCommand(2771)` twice; the purpose of id 2771 is undocumented.
- **Bounds:** text and mask bounds come from `sourceRectAtTime(0,false)` round trips. Drop shadows are added by indexed matchName (`"ADBE Drop Shadow-0001"`…).
- **Write-permission check:** `isAllowWriteFiles()`, with `executeCommand(2359)` to open Preferences if it is off.
- `json2.jsx` is bundled.

### 4.6 npm `after-effects` (BenGaumond, 2019)

- Transpiles a JS function with **Babel to ES3** (`preset-es2015` plus the es3 member-expression and property-literal plugins).
- Wraps it so it writes `$.result` to `Folder.temp/<result_file>`.
- Runs `afterfx.exe -r script.jsx` on Windows, or AppleScript `DoScript` on macOS. In its own words, on Windows "executing a child process always throws an error … we just ignore errors".
- This is the historical root of the "compile modern JS to ES3" idea that ae-compose's runtime relies on.

### 4.7 Closed-source tools (behaviour only)

- **Overlord (Battle Axe):**
  - Panels in both Illustrator and AE push or pull vector selections as AE shape layers.
  - It keeps parametric rectangles and ellipses parametric, rebuilds group hierarchy as parenting plus empty group layers, and turns clipping masks into track mattes.
  - v2 added gradient transfer and text on a path.
  - The transport is not public. The lesson for ae-compose's SVG/shape importer is to **emit parametric primitives when possible** rather than baking every path.
  - Docs: <https://help.battleaxe.co/overlord/workflow>.
- **Explode Shape Layers** (and Battle Axe's similar tools): closed source. Their known behaviour is to duplicate the layer once per root `Vector Group` and delete the other groups from each copy. It confirms that "one group per layer" is a cheap transform; ae-compose can just emit separate layers.

### 4.8 Adobe UXP for After Effects (status, November 2026)

- **Status:** UXP plugin support is in the **AE 27.0 beta**, which started as a private beta, with a public beta announced for MAX 2026.
- **API surface:** the [developer.adobe.com/after-effects/uxp](https://developer.adobe.com/after-effects/uxp/) reference lists application, project item, layer, property, file, font, import-option and settings APIs, plus UXP networking.
- **Not in 26.x:** there is no UXP in AE 26.x, the ae-compose target. There is no UXP *scripting* yet (an October 2026 feature request asks for it), and no announced end of life for ExtendScript or CEP.
- **Conclusion:** CEP + ExtendScript remains the right backend for 26.5. Keep the runtime layer swappable, since a UXP backend becomes plausible in 27.x.

---

## 5. Cross-cutting comparison

### Bridge transports

| Repo | Transport | Latency / tick | Correlation | Notes |
|---|---|---|---|---|
| Dakkshin, TheLlamainator, mikes16, ku1x `src/` | ScriptUI palette + single command/result file | 1–2 s poll | name + timestamp (broken on ES3) | two-step queue/get-results; races; no undo |
| a-y-ibrahim | same, hardened | 250 ms | `commandId` | mutex, atomic writes, replay guard, version handshake |
| HeroicSwan, tzdwindows | Startup or panel + `scheduleTask` one-shot | 400–1500 ms | `requestId` | heartbeat; auto-relaunch (tzdwindows) |
| ku1x `enhanced/` | `-r`-launched runtime + pending/running/results dirs | 250 ms | uuid filename | "do not resubmit" on wait timeout |
| IMT (kumoproductions) | mailbox per request + cross-process `wx` lock + dispatcher | 80 ms Node poll | uuid filename | relaunch, reclaim, out-of-process dialog scan |
| 23d1 | `AfterFX -r` per call | ~0.4 s+ (async return!) | per-call file | Latin-1 `.jsx`; queue per turn |
| ishu86 | CEP `evalScript` loop + file queue | 100 ms | per-file id | non-atomic writes |
| solomon | CEP Node HTTP | one evalScript (~ms) | HTTP | token, Origin refusal, spill >100 KB to file |
| VolksRat71 | CEP Node HTTP | one evalScript | HTTP | Host pinning; `Origin: null` gotcha |
| Engine-Room | CEP Node HTTP + WS | one evalScript | WS id | mutex, `gone` flag, 5 error classes |
| JUNKDOGE | MCP inside CEP Node; AEGP pipe | one evalScript | MCP | drain sentinel; uncertain/not_dispatched |

### Ease arity per property type

| Rule used | Repos | Spatial (Position) | Scale on a 2D layer | COLOR |
|---|---|---|---|---|
| `value.length` | TheLlamainator, a-y-ibrahim, mikes16 | ✗ (2–3) | ✓ 3 | ✗ 4 |
| `isSpatial ? 1 : value.length` | JUNKDOGE (JSX), IMT, tzdwindows | ✓ | ✓ | ✗? 4 |
| `propertyValueType` (TwoD 2 / ThreeD 3 / else 1) | aequery, ishu86, solomon, Adobe docs | ✓ | ✓ (ThreeD) | ✓ per docs (1) |
| type first + retry ladder 1..4 | Engine-Room | ✓ | ✓ | recovers |
| `AEGP_GetStreamTemporalDimensionality` | JUNKDOGE native | authoritative | authoritative | authoritative |

Adobe's scripting guide (`docs/property/property.md` for `setTemporalEaseAtKey`) says: TwoD → 2 objects, ThreeD → 3, "all other value types" → 1. It also says that if `outTemporalEase` is omitted, **the out-ease is set to the in-ease**. Influence must be in `[0.1..100.0]`. Speed units "depend on the type of keyframe".

### Effect discovery

| | `app.effects` enumerated | trees read on a probe layer | min/max/defaults | popup labels | blocklist |
|---|---|---|---|---|---|
| TheLlamainator, a-y-ibrahim | ✓ (name/matchName/category/obsolete) | ✗ | ✗ | ✗ | ✗ |
| solomon | ✓ (+fonts, presets, templates) | ✗ | ✗ | ✗ | Apply Color LUT |
| Engine-Room | ✓ cached | ✗ (dumps capped) | ✗ | ✗ | — |
| VolksRat71 | ✓ | ✓ 64×64 probe comp | ✗ | ✓ `valueText` stepping | LUT, 3D Tracker, Warp Stabilizer, Roto Brush |
| tzdwindows | ✗ | ✓ ~36 hard-coded, top level | ✗ | ✗ | — |
| ae-to-json | — | — | incidental (reflection) | — | — |

---

## 6. Easing: the conversion ae-compose should implement

None of the prior art does this end to end. It is derived by inverting bodymovin's exporter (§4.1), with the importer's bugs (§4.2) fixed.

**Definitions.** A segment runs from key A `(tA, vA)` to key B `(tB, vB)`, with `T = tB − tA`. The eased channel's average rate is `avg`. The CSS-style curve is `cubic-bezier(x1, y1, x2, y2)`.

**Formulas:**

- **A.out:** influence = `x1·100`, speed = `(y1/x1)·avg`
- **B.in:** influence = `(1−x2)·100`, speed = `((1−y2)/(1−x2))·avg`

**Computing `avg` per value type:**

| Value type | `avg` | Eases per key |
|---|---|---|
| OneD (Opacity, Rotation, sliders, separated X/Y/Z Position) | `(vB − vA)/T`, signed | 1 |
| TwoD / ThreeD non-spatial (Scale, Ellipse Size…) | `(vB[k] − vA[k])/T` per dimension. Influence is the same for all dimensions; **speed differs per dimension.** | 2 or 3 |
| TwoD_SPATIAL / ThreeD_SPATIAL (Position, Anchor Point, Point Controls) | `arcLength(vA, vA+outTan, vB+inTan, vB)/T`, ≥ 0. For a straight path, `‖vB − vA‖/T`. | 1 |
| COLOR | **verify:** per-channel `255·Δ/T` (bodymovin exporter) vs `Δ/T`; arity 1 (docs) vs 4 (several repos) | verify |
| SHAPE (path) / NO_VALUE | `1/T` (normalised morph progress) | 1 |

**Sketch** (TypeScript, compiled into the emitted JSX):

```ts
const clampInf = (p: number) => Math.min(100, Math.max(0.1, p));
function segmentEase([x1, y1, x2, y2]: [number, number, number, number], avg: number) {
  const xo = Math.max(x1, 0.001), xi = Math.max(1 - x2, 0.001);   // matches the 0.1 % influence floor
  return {
    out: { influence: clampInf(x1 * 100),       speed: (y1 / xo) * avg },
    in:  { influence: clampInf((1 - x2) * 100), speed: ((1 - y2) / xi) * avg },
  };
}
```

**Rules learned from the bugs above:**

1. **Arity comes from the property, not the value.** Use `isSpatial` → 1, then `propertyValueType` TwoD→2 / ThreeD→3 / otherwise 1. Settle COLOR by a live probe, keep a retry ladder, and record the arity AE accepted (Engine-Room).
2. **Always pass both `inTemporalEase` and `outTemporalEase`.** Omitting the out-ease copies the in-ease (mikes16 bug).
3. **Per-key order: interpolation first, then ease, then re-assert.**
   1. `setInterpolationTypeAtKey(i, BEZIER, BEZIER)`.
   2. `setTemporalContinuousAtKey(i, false)` and `setTemporalAutoBezierAtKey(i, false)`, so AE does not force in-speed = out-speed.
   3. `setTemporalEaseAtKey(i, in[], out[])`.
   4. Re-assert LINEAR or HOLD on any side that needs it.
   5. Read `keyIn/OutTemporalEase(i)` back and report any clamp or difference. AE silently alters values: the influence floor, and the spatial clamp in rule 5.
4. **Insert all keys first, then ease by time.** Use `setValuesAtTimes(times, values)`, which is bulk and used by IMT, ishu86 and VolksRat71. Then re-resolve each index with `nearestKeyIndex(t)` (aequery's `checkKey`), because indices shift on every insertion (23d1 bug).
5. **Overshoot (`y1 > 1` or `y2 < 0`)** is representable on OneD and non-spatial multi-D properties. It is **not** representable on un-separated spatial properties if bodymovin's clamp reflects AE. For those, the compiler should:
   - separate dimensions (`dimensionsSeparated = true`, Position only), or
   - insert an intermediate key, or
   - fall back to an expression.
   Report which one it chose.
6. **Δ = 0 segments** get speed 0. The curve shape is meaningless there, so skip it, as bodymovin does with `yNormal = 1`.
7. **Retiming keys rescales speed by `1/scale`** (IMT bug).
8. **Spatial tangents:**
   - Set them explicitly with `setSpatialTangentsAtKey`, and set `setSpatialAutoBezierAtKey(false)` / `setSpatialContinuousAtKey` as needed.
   - New keys otherwise pick up the user's "Default Spatial Interpolation to Linear" preference.
   - A 2D layer's Position tangents are 3-element arrays (aequery's `pasteKey` trims 3 to 2 when copying to a 2D property).
9. **Named easings → cubic-bezier.**
   - Use the standard Penner / easings.net constants, e.g. `easeInOutCubic = (0.65,0,0.35,1)` and `easeOutBack = (0.34,1.56,0.64,1)`.
   - Elastic, bounce and spring are not single cubics. Bake them into several keys (fit per segment) or emit an expression. ishu86's damped-oscillator expression (`presets/animations/springPresets.ts:82-135`) is one model.
   - **Never use hand-made "speed/influence" tables** (the JUNKDOGE skill).

---

## Worth borrowing

Concrete code and approaches, each with its source.

**Bridge (complements D5–D8):**

1. **One serialised `evalScript` chain that drops abandoned calls.**
   - Engine-Room's `gone` flag ([main.js#L162-L221][er-main]).
   - JUNKDOGE's **drain sentinel**: after a timeout, hold the queue until `evalScript('1+1')` returns, and mark the timed-out call `uncertain`, never failed. Reject queued calls past their deadline as `not_dispatched`.
   - The three-way outcome *not sent / uncertain / failed* maps directly onto D8 ("never auto-retry").
2. **Spill large results to a temp file** and return the path when they exceed about 100 KB (solomon, [bridge.jsx#L167-L180][sol-bridge]). `build_scene` and `inspect_comp` payloads will exceed that.
3. **One global namespace** (`__AECOMPOSE`), **a private JSON** that never trusts `$.global.JSON` (IMT [json2.jsx][imt-json], Engine-Room [core.jsx#L11-L35][er-core]), and **escaping U+2028/U+2029** in every literal you send.
4. **Out-of-process modal-dialog detection** on timeout. IMT ([dialogs.ts][imt-dialogs]) scans Win32 `#32770` windows and reads their text, so "AE busy" becomes "a dialog titled X is open".
5. **Engine canary** `(new Function("return 1"))()` before each build (IMT dispatcher). **Version handshake** between Node and the runtime (a-y-ibrahim `BRIDGE_VERSION`).
6. **Execution wrapper:**
   - `beginSuppressDialogs()` around the op **and** the serialisation;
   - an `app.onError` collector that returns WARNINGs as `aeWarnings` (Engine-Room);
   - `endSuppressDialogs(false)`;
   - `describeError` that never does `"" + e` (IMT);
   - line numbers corrected for the wrapper header.

**Build and undo:**

7. **One undo group per `build_scene`, opened and closed inside a single `evalScript`.** Count it, and report the number of undo steps.
   - Never open a group around `renderQueue.render()`, `saveFrameToPng`, `copyToComp`, `app.open` or `app.newProject` (a-y-ibrahim `NO_UNDO_GROUP_COMMANDS`, IMT, JUNKDOGE #397).
8. **Verified rollback** (IMT [batch.ts#L144-L176][imt-batch]): create a marker item inside the group; on failure call `executeCommand(16)` and **check that the marker is gone**. If it is not, fall back to an `.aep` checkpoint copy (JUNKDOGE, IMT `project.checkpoint`).
9. **Show a trivial comp in the viewer during builds**, as AEUX's `LOADING...` comp does ([host.jsx#L123-L137][aeux]). This avoids Engine-Room #266, where each write re-runs the viewer comp's expressions. Restore the user's viewer afterwards. Verify the speed-up.

**Identity, locale and read-back:**

10. **Identity:**
    - `comp.id` + `layer.id`, with `app.project.layerByID` (AE 22+).
    - Property paths as **matchName plus ordinal**, e.g. `ADBE Effect Parade#2` (JUNKDOGE), because duplicate effects and shape groups share matchNames (VolksRat71 bug).
    - Re-fetch references after `addProperty`, `setPropertyParameters` or MOGRT export (Engine-Room, IMT, VolksRat71).
    - Wrap `itemByID` in try/catch.
11. **Locale independence:**
    - matchNames everywhere, enforced by a test that greps the emitted JSX for `.property("<English name>")` (IMT [locale-independence.test.ts][imt-locale]);
    - menu command **ids**, never labels (IMT table: 3973, 3799, 2767, 10312, 3983, 16, 2035), remembering that `executeCommand` may no-op through CEP;
    - `localize()` for render and output-module templates.
12. **Read back every write that AE can silently alter:**
    - `expressionError` after every expression, reverting or reporting (solomon);
    - eases after clamping;
    - `TextDocument.justification`;
    - the ease arity AE accepted (Engine-Room `easeDimensions`);
    - `sourceRectAtTime(layer.sourceTime(t), false)` for bounds (VolksRat71).

**Effects:**

13. **Effect schema harvesting.** VolksRat71's probe ([ops-diagnostics.jsx#L14-L82][vr-enum]) is the template:
    - temp 64×64 comp, built-in effects only (D3), skip-list `ADBE Apply Color LUT(2)`, `ADBE 3D Tracker`, `ADBE SubspaceStabilizer`, `ADBE Samurai`;
    - remove everything in a `finally`;
    - resumable batches, keyed by parameter matchName.
    Extend it to capture, per parameter:
    - `propertyValueType`, `isSpatial`
    - `hasMin`/`minValue`/`hasMax`/`maxValue`
    - the default value at t=0
    - `unitsText`
    - `canVaryOverTime`, `canSetExpression` (false means hidden)
    - `isDropdownEffect` / `propertyParameters`
    - popup labels from `valueText` stepping
    Cache the table to disk per AE build. `app.effects` itself is slow (Engine-Room #26). Cap dump size (Particular has 7,401 parameters).

**Shapes, text and 3D:**

14. **Gradient stops via a generated `.ffx`** (AEUX `applyGradientFfx` / `createFile`, [host.jsx#L1039-L1230][aeux]). It is the only known scriptable route to `ADBE Vector Grad Colors`. ae-compose can generate the RIFX preset from TypeScript rather than embedding templates.
15. **Text hygiene:**
    - set every TextDocument field explicitly, because `addText()` inherits the Character panel;
    - resolve fonts through `app.fonts` from PostScript name to family to "Family Style" (VolksRat71 `__mcp_resolveFont`);
    - per-character styling via `characterRange` needs AE 24.3+ (solomon).
16. **3D tables:**
    - renderer matchNames `ADBE Advanced 3d` (Classic), `ADBE Calder` (Advanced 3D), `ADBE Ernst` (Cinema 4D);
    - per-renderer property availability, set one by one with failures reported (ishu86 [threeDGenerators.ts#L37-L49][ishu-3d]).

**Snapshots and linting:**

17. **`snapshot` pipeline:**
    - a temporary wrapper comp at the requested `resolutionFactor`, removed in a `finally` (Engine-Room #282);
    - clamp time to `duration − frameDuration` (VolksRat71);
    - `saveFrameToPng(...).wait()` (D12), plus an IEND check as belt and braces (a-y-ibrahim [see-frame.ts#L83-L90][ayi-png]);
    - un-premultiply (Engine-Room #130), 16→8-bit;
    - an OCIO Display Transform layer for colour-managed projects (IMT);
    - contact sheets and A/B diffs (JUNKDOGE, a-y-ibrahim);
    - `aerender` for real renders, judging success by the output file, not the exit code (a-y-ibrahim PR #32).
18. **Motion lint** over the compiled IR: overlapping keys, jitter, off-grid keys, speed breaks, long-way rotation (solomon `mcp/proof.js`). Add **`comp.snapshot`/`diff` fingerprints keyed by layer id** (IMT [safety.ts#L226-L285][imt-safety]) for `apply_edits` verification.
19. **Easing math:** bodymovin's exporter formulas ([keyframeHelper.jsx#L180-L290][bm-kh]) and arc-length flattening (`getCurveLength`, 200 segments) as the reference and as the oracle for round-trip tests: compile a bezier to AE, read the key back, convert with the bodymovin math, and assert that the bezier matches.
20. **Typed MCP inputs.** `z.unknown()` values arrive as strings (Dakkshin PR #35/#38), so every value field needs a concrete JSON schema. Also add a `dryRun` that returns the generated JSX without touching AE (IMT).

## Pitfalls to avoid

**Bridge and transport:**

- **File-poll bridges with a single command slot.** Concurrent calls overwrite each other. The panel's read-modify-write of `status` races Node. Stale results get returned as fresh. An old destructive command can replay on panel restart (Dakkshin family; fixed piecemeal by a-y-ibrahim).
- **Two-step "queued, call get-results" tools.** The agent cannot tell success from silence.
- **`new Date().toISOString()`, native `JSON`, `Array.prototype.map` and similar in ES3.** Each throws or is missing (D11). A swallowed throw silently drops correlation fields, and every await then times out on work that was applied (Dakkshin and TheLlamainator).
- **`eval`-based JSON parsing** of files any process can write (Dakkshin #44, tzdwindows). Its `stringify` also emits bare `NaN`/`Infinity`, which is invalid JSON, and that looks like a half-written file and burns the whole timeout.
- **`AfterFX.exe -r`:**
  - it returns before the script finishes (23d1: 376 ms vs 1952 ms);
  - it cuts the path at the first space (IMT);
  - it shows an "Executing script…" popup (HeroicSwan);
  - it reads BOM-less files as Latin-1 (23d1).
  As a fallback (D10) it needs a result-file wait, a space-free path and `\u` escaping.
- **`Documents` as the shared folder** (OneDrive KFM gives Node and AE different paths, Dakkshin PR #40). **Hard-coded AE version folders** (HeroicSwan, `25.5…22.6`, broken on 26).
- **A blanket `Origin` refusal that also blocks the CEP panel's own `Origin: null`** (VolksRat71 PR #4). Decide how D7 treats the status panel.

**Undo, menus and the viewer:**

- **Nested or cross-call undo groups.**
  - Nesting with the host's group produced "undo groups do not match" and rolled back saved work (ishu86 PR #4).
  - A group opened in one `evalScript` and closed in another is discarded (Engine-Room #69).
  - A group around render or `saveFrameToPng` gives an "Undo group mismatch" modal, and possibly a broken 3D renderer until restart (JUNKDOGE #397).
- **`app.executeCommand(id)` through CEP** can silently no-op (Engine-Room #47). Never treat its return as proof. Never use English menu labels (23d1 `ae_undo`), and never use guessed ids (tzdwindows' 3736 vs IMT's 3973).
- **Heavy comps open in the viewer during builds.** Every write re-evaluates their expressions (Engine-Room #266).

**Easing:**

- **Sizing ease arrays from `value.length`.**
- **Speed 0 for everything** (no asymmetric curves, no overshoot).
- **The same speed for every dimension** when the per-dimension deltas differ.
- **Omitting `outTemporalEase`.**
- **Setting eases before interpolation types**, or then changing the types and losing the eases.
- **Holding key indices across insertions.**
- **Reapplying eases unchanged after a retime.**
- **Influence of 0** (division by zero; AE needs ≥ 0.1).
- **Spatial speed from component 0's change** instead of the arc length (bodymovin importer).
- **Chord length mistaken for arc length** (ae-temporal-to-cubic-ease).

**Effects and properties:**

- **Addressing properties by display name.** Breaks in non-English AE (Dakkshin `applyEffectSettings`, mikes16).
- **Silently skipping missing properties.**
- **Wrong hard-coded matchNames** (`ADBE Glow` → `ADBE Glo2`, `ADBE Directional Blur` → `ADBE Motion Blur`).
- **Substring fallbacks** in effect resolution (23d1).
- **`["ADBE Effect Parade", matchName]` paths** that collapse duplicate effects (VolksRat71).
- **Applying effects that open dialogs or start analysis:** Apply Color LUT, 3D Camera Tracker, Warp Stabilizer, Roto Brush. Also never apply unlicensed third-party effects (D3).
- **Dumping full property trees.** Shape Materials groups are about 75 % of the bytes; Particular has 7,401 parameters. Cap and prune.

**Text, shapes and layout:**

- **Trusting `addText()` defaults or a TextDocument round trip.** Tracking is inherited and justification gets mangled (Engine-Room #24, #93, #94).
- **Building shape `Contents` back-to-front.** Index 1 is in front, and `addProperty` appends. **Holding shape node references across sibling inserts** (`Object is invalid`).
- **Computing text alignment** by writing a `sourceRectAtTime` offset into Anchor Point. It is wrong from the first edit; use paragraph justification (Engine-Room).

**Frames and rendering:**

- **Reading `saveFrameToPng` output immediately.** It is asynchronous (D12, ishu86, a-y-ibrahim). Capturing at exactly `comp.duration` gives an empty frame. 32-bpc projects give 16-bit or near-black PNGs (D13, JUNKDOGE cookbook).
- **Downscaling a wrapper with Collapse Transformations.** Effects render at full-resolution pixel values, so blurs look 4× larger (a-y-ibrahim PR #31).
- **`renderQueue.render()` from the bridge.** It blocks AE for the whole render. Use `aerender` and check the output file. Never leave queue items or render-queue templates behind (mikes16 leaves its PNG-sequence item queued).

**Safety:**

- **Unrestricted file paths** in tools such as `presetPath` (Dakkshin #43).
- **An `eval`/raw-JSX tool enabled by default.** Prefer IMT's `AE_MCP_ENABLE_EVAL=1` gate plus read-only and lock modes.
- **Telemetry or remote calls hidden in an "MCP"** (solomon `jev.js` posts to an external API when a key is set). Audit dependencies.

---

## Appendix — commits reviewed

| Repo | Commit | Date |
|---|---|---|
| [Dakkshin/after-effects-mcp](https://github.com/Dakkshin/after-effects-mcp) | `88d5fbf08b7a` | 2026-04-01 |
| [TheLlamainator/after-effects-mcp](https://github.com/TheLlamainator/after-effects-mcp) | `e4a462098d28` | 2026-03-15 |
| [Engine-Room-Games/after-effects-mcp](https://github.com/Engine-Room-Games/after-effects-mcp) | `4eab3aa095e3` | 2026-11-01 |
| [Immersive-Media-Technologies/aftereffects-mcp-imt](https://github.com/Immersive-Media-Technologies/aftereffects-mcp-imt) (fork of [kumoproductions/mcp-aftereffects](https://github.com/kumoproductions/mcp-aftereffects)) | `0703118c942d` | 2026-10-28 |
| [solomondivyananth/aftereffects-mcp](https://github.com/solomondivyananth/aftereffects-mcp) | `2ed42650a435` | 2026-10-05 |
| [JUNKDOGE-JOE/after-effects-mcp](https://github.com/JUNKDOGE-JOE/after-effects-mcp) | `10b0154ca64f` | 2026-10-22 |
| [ishu86/after-effects-mcp](https://github.com/ishu86/after-effects-mcp) | `5223c17a8e8c` | 2026-10-08 |
| [a-y-ibrahim/after-effects-mcp](https://github.com/a-y-ibrahim/after-effects-mcp) | `e9ffbed9f675` | 2026-08-16 |
| [VolksRat71/after-effects-mcp-vision](https://github.com/VolksRat71/after-effects-mcp-vision) | `d2c95489ff04` | 2026-10-15 |
| [HeroicSwan/after-effects-mcp](https://github.com/HeroicSwan/after-effects-mcp) | `e38b2609cde2` | 2026-07-19 |
| [23d1/after-effects-mcp](https://github.com/23d1/after-effects-mcp) | `be7717314439` | 2026-09-15 |
| [ku1x/after-effects-mcp-enhanced](https://github.com/ku1x/after-effects-mcp-enhanced) | `b10c1552acf7` | 2026-09-08 |
| [tzdwindows/after-effects-mcp](https://github.com/tzdwindows/after-effects-mcp) | `89009507c5f5` | 2026-10-23 |
| [mikes16/ae-mcp-pro](https://github.com/mikes16/ae-mcp-pro) | `507b085c46b5` | 2026-05-11 |
| [oneprism-io/After-Effects-MCP](https://github.com/oneprism-io/After-Effects-MCP) | `14460e5f79` (README only) | 2026-08-11 |
| [bodymovin/bodymovin-extension](https://github.com/bodymovin/bodymovin-extension) | `a400a2551d75` | 2024-06-25 |
| [docsforadobe/aequery](https://github.com/docsforadobe/aequery) | `346ddcf3695b` | 2025-06-06 |
| [google/AEUX](https://github.com/google/AEUX) | `573d07d63b13` | 2024-03-02 |
| [Experience-Monks/ae-to-json](https://github.com/Experience-Monks/ae-to-json) | `9c7cf53287` | 2016-05-24 |
| [Experience-Monks/ae-temporal-to-cubic-ease](https://github.com/Experience-Monks/ae-temporal-to-cubic-ease) | `73e9f386bb3f` | 2016-06-17 |
| [BenGaumond/after-effects](https://github.com/BenGaumond/after-effects) (npm `after-effects`) | `316c063987` | 2019-10-01 |
| [docsforadobe/after-effects-scripting-guide](https://github.com/docsforadobe/after-effects-scripting-guide) | `7137a990db` | 2026-09-10 |

[bm-kh]: https://github.com/bodymovin/bodymovin-extension/blob/a400a2551d7564691400b1ceef43fe9bab16900a/bundle/jsx/utils/keyframeHelper.jsx#L180-L290
[bm-imp]: https://github.com/bodymovin/bodymovin-extension/blob/a400a2551d7564691400b1ceef43fe9bab16900a/src/helpers/importers/lottie/property.js#L13-L80
[bm-imp-jsx]: https://github.com/bodymovin/bodymovin-extension/blob/a400a2551d7564691400b1ceef43fe9bab16900a/bundle/jsx/importers/lottieImporter.jsx#L93-L134
[aeq-key]: https://github.com/docsforadobe/aequery/blob/346ddcf3695b133ebba192519507664726df2e64/lib/objects/key.js#L39-L57
[aeux]: https://github.com/google/AEUX/blob/573d07d63b13059c6ebeb02561c89b39bb829180/Ae/AEUX/src/host/AEFT/host.jsx
[er-main]: https://github.com/Engine-Room-Games/after-effects-mcp/blob/4eab3aa095e33de1b5a208c43bc4fa8945d06932/packages/ae-panel/client/main.js#L162-L221
[er-core]: https://github.com/Engine-Room-Games/after-effects-mcp/blob/4eab3aa095e33de1b5a208c43bc4fa8945d06932/packages/jsx/core.jsx#L11-L35
[sol-bridge]: https://github.com/solomondivyananth/aftereffects-mcp/blob/2ed42650a435f7401bce25e69df6880894d68bcb/panel/jsx/bridge.jsx#L167-L180
[imt-json]: https://github.com/Immersive-Media-Technologies/aftereffects-mcp-imt/blob/0703118c942db6d2eec13ab63d38d8a05c6d8c54/jsx/json2.jsx
[imt-dialogs]: https://github.com/Immersive-Media-Technologies/aftereffects-mcp-imt/blob/0703118c942db6d2eec13ab63d38d8a05c6d8c54/src/transport/dialogs.ts
[imt-batch]: https://github.com/Immersive-Media-Technologies/aftereffects-mcp-imt/blob/0703118c942db6d2eec13ab63d38d8a05c6d8c54/src/operations/batch.ts#L144-L176
[imt-locale]: https://github.com/Immersive-Media-Technologies/aftereffects-mcp-imt/blob/0703118c942db6d2eec13ab63d38d8a05c6d8c54/tests/locale-independence.test.ts#L53-L76
[imt-safety]: https://github.com/Immersive-Media-Technologies/aftereffects-mcp-imt/blob/0703118c942db6d2eec13ab63d38d8a05c6d8c54/src/operations/safety.ts#L226-L285
[vr-enum]: https://github.com/VolksRat71/after-effects-mcp-vision/blob/d2c95489ff0481169bb6c693fc60527b315f88ce/cep/host/ae/ops-diagnostics.jsx#L14-L82
[ishu-3d]: https://github.com/ishu86/after-effects-mcp/blob/5223c17a8e8c1273b25c6a9d306839259ad35143/src/ae-integration/generators/threeDGenerators.ts#L37-L49
[ayi-png]: https://github.com/a-y-ibrahim/after-effects-mcp/blob/e9ffbed9f675a3ac31a4295c83abfd1fb4a7b3f5/src/lib/see-frame.ts#L83-L90

Other sources:

- Adobe UXP for After Effects: <https://developer.adobe.com/after-effects/uxp/>
- UXP vs CEP forum discussion: <https://forums.creativeclouddeveloper.com/t/uxp-vs-cep-for-premiere-pro-after-effects-which-should-i-use/10364>
- Overlord workflow: <https://help.battleaxe.co/overlord/workflow>
- kumoproductions/mcp-aftereffects: <https://github.com/kumoproductions/mcp-aftereffects>
