# Environment (Phase 0 discovery, 2026-11-04)

| Item | Value |
|---|---|
| OS | Windows 11 Pro 10.0.26300 |
| CPU / RAM | AMD Ryzen 7 3700X, 64 GB |
| GPU | NVIDIA GeForce RTX 3080 (driver 32.0.16.1088) |
| After Effects | **2026, version 26.5**: `C:\Program Files\Adobe\Adobe After Effects 2026\Support Files\AfterFX.exe` |
| Console launcher | `...\Support Files\AfterFX.com` (present) |
| aerender | `...\Support Files\aerender.exe` (present) |
| CEP runtime | CEPHtmlEngine 12.0.1 → registry key `HKCU\Software\Adobe\CSXS.12` |
| UXP | `...\Support Files\UXP` present (status researched in Phase 1) |
| Prefs folder | `%APPDATA%\Adobe\After Effects\26.5\` |
| Scripting pref | `Pref_SCRIPTING_FILE_NETWORK_SECURITY = "1"` (Allow Scripts to Write Files and Access Network appears ON) |
| JS debugger pref | `Pref_JAVASCRIPT_DEBUGGER = "0"` (off, good: uncaught errors won't break into the debugger) |
| Node.js | v22.20.0 |
| Package managers | npm 10.9.3, pnpm 11.9.0 (no yarn, no bun) |
| Other tools | git 2.51, Python 3.14, ffmpeg 8.0, ImageMagick 7.1.2 |
| Claude Code CLI | `C:\Users\evanp\.local\bin\claude.exe` |

## Bundled (vanilla) AE capabilities relevant to the goal
- **CycoreFX HD** (`Plug-ins\Effects\CycoreFXHD`): CC Particle World, CC Particle Systems II, CC Star Burst, CC Rainfall, CC Snowfall, CC Pixel Polly, and more.
- Built-in: Particle Playground, Shatter, Card Dance, Card Wipe.
- **Cineware by Maxon** (bundled with AE).
- Importers: SVG (`SVGImporter.aex`), OpenEXR, Radiance HDR (`Radiance.8BI`), PNG, JPEG, Animate, Photoshop/Premiere.

## Third-party plugins present but **excluded** (user instruction: vanilla AE only; Red Giant licenses expired)
Red Giant Trapcode (3D Stroke, Shine, Starglow, …), Red Giant Universe, Red Giant VFX, Magic Bullet suite, Maxon Studio.
These are never applied during effect discovery: an unlicensed plugin can open a modal dialog that blocks the scripting engine.

## Fonts of note (installed system-wide)
Inter (Thin…Black), Montserrat, Poppins, Oswald, Bebas Neue, Archivo Narrow (931 fonts total).
