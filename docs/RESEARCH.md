# Research (Phase 1)

Detailed reports:
- `docs/research/toolchain.md`: TS → ES3 toolchain, Bolt CEP, types-for-adobe, UXP status
- `docs/research/prior-art-mcp.md`: existing AE MCP servers and AE automation prior art
- `docs/research/remotion-lottie-easing.md`: Remotion model, spring/interpolate math, AE ease ↔ bezier, keyframe baking, Lottie data model
- `docs/research/ae-verify/*.json`: raw dumps from probe scripts run against the installed AE 26.5 (x89)

Each section ends with a **Recommendation**. "Verified" means it was run against AE 26.5 on this machine.

---

## 1. AE 26.5 scripting facts, verified on this machine

### Bridge and runtime
| Fact | Evidence |
|---|---|
| CEP 12 background extension (`Custom` type, `StartOn ApplicationActivate`) auto-starts with AE. | bridge log, 5 launches |
| `evalScript` round trip ≈ 40–70 ms; `AfterFX.com -r` ≈ 1.1 s. | measured |
| `JSON` is **undefined** in ExtendScript (engine 4.5.6). | `typeof JSON` |
| Syntax errors in `evalScript` code open a **modal alert** that blocks AE. Wrapping the code in `eval()` inside try/catch turns them into catchable errors (reported as `SyntaxError` or `ReferenceError`). | reproduced, then fixed in `server.js` |
| `comp.saveFrameToPng(t, file)` is **async**: it returns a task object with `wait()`, `onComplete`, `onError`, `_isReady`. | reflect + file timing |
| 32 bpc projects: `saveFrameToPng` writes 16-bit PNGs scaled ×0.1, exactly linear. 8/16 bpc are correct. | white/gray/color patches |
| Undo groups: `app.beginUndoGroup/endUndoGroup` usable around whole builds. | used in hello world (one-step undo is verified in Phase 3) |
| **Crash:** touching shape-gradient internals (`ADBE Vector Grad Colors`, G-Fill/G-Stroke subproperties) crashes AE `(0 :: 42)`. | 3 crashes; a step-logged run without gradients passed |

### Renderers and 3D
- `comp.renderers` = `["ADBE Advanced 3d", "ADBE Calder", "ADBE Ernst"]`. **Corrected (D36): `ADBE Advanced 3d` = Classic 3D (legacy ID, the new-comp default here), `ADBE Calder` = Advanced 3D, `ADBE Ernst` = Cinema 4D**, confirmed from AE's localized UI strings and by rendering extruded text (Classic 3D hides Geometry Options). All three are switchable via `comp.renderer`. Renderer quality, shadow and environment settings are **not** exposed to scripting; only the renderer choice is.
- **Material Options** (`ADBE Material Options Group`), with the same tree on all renderers: Casts/Accepts Shadows, Accepts Lights, Light Transmission, Shadow Color, Appears in Reflections, Ambient, Diffuse, Specular Intensity, Specular Shininess, Metal, Reflection Intensity/Sharpness/Rolloff, Transparency, Transparency Rolloff, Index of Refraction.
- **Geometry Options** (`ADBE Extrsn Options Group`) on text and shape layers: Bevel Style, Bevel Direction, Bevel Depth, Hole Bevel Depth, Extrusion Depth. Footage layers get `ADBE Plane Options Group` (Curvature, Segments).
- **Camera** (`ADBE Camera Options Group`): Zoom, Depth of Field, Focus Distance, Aperture, Blur Level, Focus Area Width, Near/Far Blur Level, Iris Shape/Rotation/Roundness/Aspect Ratio/Diffraction Fringe, Highlight Gain/Threshold/Saturation.
- **Lights**: `LightType.{PARALLEL, SPOT, POINT, AMBIENT, ENVIRONMENT}`. `ADBE Light Options Group`: Source (`ADBE Light Env Atom`), Background Visible/Opacity/Blur, Intensity, Color, Cone Angle/Feather, Falloff type/Radius/Distance, Casts Shadows, Shadow Darkness/Diffusion.
- **HDRI environment light**: import `.hdr` (2:1), add it as a layer, `light.lightType = ENVIRONMENT`, `light.lightSource = hdrLayer`. AE then sets `hdrLayer.environmentLayer = true` automatically.
- **3D models**: `.glb` and `.gltf` import as `FootageItem` (1920×1080, 30 s) → `ThreeDModelLayer` with `ADBE ModelAnimOptionsSGrp` (Animation Options), `ADBE3D Material Parade`, Compositing Options (shadows/lights/reflections), Geometry Options. The toon_dog glTF has 17 embedded clips; selecting a clip is a Phase 3 item.
- `AutoOrientType.{NO_AUTO_ORIENT, ALONG_PATH, CAMERA_OR_POINT_OF_INTEREST, CHARACTERS_TOWARD_CAMERA}`; `layer.threeDPerChar` is settable on text.
- Comp attributes: `motionBlur`, `shutterAngle`, `shutterPhase`, `motionBlurSamplesPerFrame`, `motionBlurAdaptiveSampleLimit`, `draft3d`, `renderer`, `motionGraphicsTemplateName`.

### Text (top priority)
- `TextDocument` exposes ~60 attributes: font (PostScript name, e.g. `Inter-Bold`), fontFamily/fontStyle, fontSize, fillColor/strokeColor/strokeWidth, tracking, leading, kerning, baselineShift, horizontal/verticalScale, allCaps/smallCaps, faux bold/italic, justification, box text (`boxText`, `boxTextSize`, `boxTextPos`, auto-fit and overflow policies, vertical alignment), `composedLineCount`, paragraph spacing and indents, ligatures, direction.
- **Per-character styling**: `td.characterRange(start, end)` returns a style object (fill, size, font, tracking, …) and `setValue(td)` persists it. Verified by readback.
- `composedLineRange`, `paragraphRange`, `composedLineCharacterIndexesAt`, `paragraphCharacterIndexesAt`, `resetCharStyle`, `resetParagraphStyle` exist.
- **Measurement in AE**: `layer.sourceRectAtTime(t, false)` gives exact text bounds, and `composedLineCount` gives wrapped line counts.
- **Animators** (`ADBE Text Animator`): all 20 properties added successfully: Anchor Point 3D, Position 3D, Scale 3D, Skew, Skew Axis, Rotation X/Y/Z, Opacity, Fill Color/Hue/Opacity, Stroke Color/Width, Tracking, Line Spacing, Character Offset, Blur, Line Anchor, Character Alignment.
- **Selectors**: Range (`ADBE Text Selector`: Start/End/Offset as percent or index, Advanced: Units, Based On, Mode, Amount, Shape, Smoothness, Ease High/Low, Randomize Order, Random Seed), Wiggly (`ADBE Text Wiggly Selector`), Expression (`ADBE Text Expressible Selector`).
- More Options (anchor grouping, grouping alignment, fill & stroke order, inter-character blending) and Path Options (path, reverse, perpendicular, force alignment, margins) are present.

### Shapes, paths, masks
- Pen paths: `new Shape()` with `vertices`, `inTangents`, `outTangents`, `closed`, then `setValue` / `setValueAtTime`. Round-trip readback is exact. Path keyframes work.
- Verified operators: Rect, Ellipse, Star (polystar), Fill, Stroke (with Dashes: Dash/Gap/Offset), Merge, Offset, Pucker & Bloat, Repeater, Round Corners, Trim, Twist, Wiggle Paths (`Roughen`), Wiggle Transform (`Wiggler`), Zig Zag.
- Masks: `ADBE Mask Atom` with shape, feather, opacity, expansion, offset; `MaskMode` enums.
- Gradients: crash-prone via scripting (above). Workarounds are in §1 Recommendation.

### Effects
- 575 effects installed: **446 vanilla** (incl. CycoreFX `CC`/`CS`, `APC`, `VISINF`, Keylight, Mocha AE, Cineware, ProEXR, Adobe pseudo-effects) and **129 Red Giant** (excluded).
- Particle systems (vanilla) and their parameter counts: CC Particle World (105), CC Particle Systems II (32), Particle Playground `ADBE Playgnd` (127), CC Star Burst (9), CC Rainfall `CSRainfall` (25), CC Snowfall `CSSnowfall` (34), CC Pixel Polly (11), Shatter `APC Shatter` (81), Card Dance `APC CardDanceCam` (81). Full trees are in `ae-verify/effects/`.
- **Layer-reference params** have `propertyValueType = LAYER_INDEX` and are set with `setValue(layer.index)` (verified on CC Particle World Texture Layer). Particle Playground has 9, Shatter 5, Card Dance 3.
- **Seeds**: Random Seed exists on Particle World, Particle Systems II, Rainfall and Snowfall. Pixel Polly, Star Burst, Shatter and Playground have no seed parameter; determinism there comes from the layer and its parameters only.
- **Camera**: Shatter and Card Dance have a `Camera System` dropdown (includes Comp Camera). CC Particle World has an `Effect Camera` group (to be mapped in Phase 3).
- Effect param groups are **flat** in scripting: "topic" headers are `NO_VALUE` siblings, not parents.

### Controls and Essential Graphics
- Expression controls: Slider, Color, Checkbox, Point, 3D Point, Angle, Layer, Dropdown. The Dropdown matchName shows up as `Pseudo/@@…` after adding; add it as `ADBE Dropdown Control`.
- `dropdown.property(1).setPropertyParameters([...])` sets items and returns a new property reference. No getter exists.
- Effects can be renamed (`fx.name = "Title Delay"`), and expressions referencing them work.
- Essential Graphics: `comp.motionGraphicsTemplateName = …`, `prop.addToMotionGraphicsTemplateAs(comp, name)` → `motionGraphicsTemplateControllerCount`.

### Menu command IDs (`app.findMenuCommandId`, AE 26.5)
Convert Expression to Keyframes **2639**, Create Shapes from Vector Layer **3973**, Pre-compose **2071**, Easy Ease **2509** (In 2510, Out 2511), Sequence Layers **4217**, Convert to Editable Text **3799**, Center Anchor Point in Layer Content **10312**, Toggle Hold Keyframe **2226**, Keyframe Velocity **2228**, Fit to Comp **2156**, Create Masks from Text **2933**, Create Shapes from Text **3781**, Auto-trace **3044**, Time-Reverse Keyframes **3693**, Save Animation Preset **3075**, Separate Dimensions **3764**, Add Keyframe **2518**, Convert Audio to Keyframes **4218**, Track Camera **3983**.

### Dialogs (Windows)
- Modal AE dialogs are `#32770` windows. Most are owned by `AE_CApplication_26.5` with the owner disabled. Startup dialogs (Crash Repair) are **owner-less**.
- AE draws dialog contents itself, so UI Automation sees no buttons or text. A DPI-aware `PrintWindow` capture of just the dialog is the reliable readout, and Enter/Escape/WM_CLOSE answer it.
- Standard Windows dialogs (e.g. Save Copy) expose some UIA buttons.

### Recommendation (AE side)
- Primary backend: the CEP bridge with eval-wrapping. Fallback: `AfterFX.com -r`. Add the dialog watchdog plus the crash-recovery routine.
- Shape gradients: write via generated `.ffx` presets (`layer.applyPreset`), read by parsing a saved `.aepx` copy. Never touch the gradient properties directly.
- Measure text in AE (`sourceRectAtTime`) through a measurement round-trip before layout, falling back to Node estimates when AE is unavailable.
- 3D defaults: Advanced 3D (`ADBE Calder`) for models, environment/HDRI lighting, shadows and extrusion. Cinema 4D (`ADBE Ernst`) as an alternative extrusion renderer. Classic 3D (`ADBE Advanced 3d`) only for legacy work or speed (no extrusion). After `threeDLayer = true`, re-assign `comp.renderer` before writing Geometry Options, or AE reports them as hidden.

---

## 2. Toolchain, prior art, Remotion/Lottie
Summaries are added below once each report is complete.
