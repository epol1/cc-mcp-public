# Decisions log

One line of rationale per decision. Newest at the bottom.

| # | Phase | Decision | Rationale |
|---|---|---|---|
| D1 | 0 | Copied `ae-compose-goal-prompt.md` to `GOAL.md` and treat `GOAL.md` as the spec. | The spec refers to itself as `GOAL.md`. |
| D2 | 0 | Target **vanilla After Effects 2026 (26.5)** only. No shipped feature, preset, showcase or test depends on third-party plugins. | User instruction: "mcp should work with vanilla/default AE, no plugins extra"; Red Giant licenses are expired. |
| D3 | 0 | Effect discovery excludes third-party effects by default and never *applies* them to read their property trees. A generic `<Effect matchName>` path still exists for any effect the user chooses. | Unlicensed plugins can open modal dialogs that block ExtendScript; D2. |
| D4 | 0 | Install the CEP bridge **before** the first AE launch via a directory junction at `%APPDATA%\Adobe\CEP\extensions\com.aecompose` → `packages/bridge-cep/extension`. | CEP scans extensions only at launch, so installing early avoids an AE restart later. A junction needs no admin rights. |
| D5 | 0 | Bridge = stable `manifest.xml` + tiny `loader.js` that polls and hot-swaps `server.js`. | All bridge development happens without restarting AE; only manifest edits need a restart. |
| D6 | 0 | Two extensions in one bundle: an invisible background extension (`Custom`, StartOn ApplicationActivate) and a visible status panel that also hosts the server if the background one is not running. | Background start avoids depending on a docked panel; the panel is a fallback plus a status view. |
| D7 | 0 | Bridge listens on `127.0.0.1:47811`. A token stored in `~/.ae-compose/bridge.json` is required, and any request with an `Origin` header is refused. | Prevents web pages (CSRF to localhost) or other users from running ExtendScript, which has full file-system access. |
| D8 | 0 | Requests are serialized through one queue with per-request timeouts. A timeout reports "AE busy or modal dialog open" and is never retried automatically. | AE's scripting engine is single-threaded; blind retries could double-apply builds. |
| D9 | 0 | Default showcase typeface: Inter (installed). Montserrat, Poppins, Oswald and Bebas Neue are alternates. | Installed system-wide, so no font downloads are needed. |
| D10 | 0 | Primary backend: the CEP bridge (~40–60 ms per eval). Fallback: `AfterFX.com -r file.jsx` with a JSON result file (~1.1 s, verified). | Both were measured on this machine; the fallback works even if CEP fails to load. |
| D11 | 0 | The runtime ships its own JSON implementation. | `typeof JSON === "undefined"` in AE 26.5 ExtendScript (engine 4.5.6), verified. |
| D12 | 0 | `comp.saveFrameToPng()` is async in AE 26.5: it returns a task object with `wait()`, `onComplete`, `onError` and `_isReady`. Snapshot code calls `.wait()`. | Verified: without `wait()` the file does not exist yet when the script returns. |
| D13 | 0 | In 32 bpc projects, `saveFrameToPng` writes 16-bit PNGs scaled by exactly ×0.1 (white → 0.1, 0.5 → 0.05). The snapshot tool compensates (×10 in post) instead of changing the project's bit depth. | Measured as exactly linear at 8/16/32 bpc. Compensation is non-destructive and keeps the user's undo history clean. |
| D14 | 0 | Showcase assets come from the user's own projects (copied into `assets/`, git-ignored): Custom Controllerz footage, stills and logo; controller GLB; animated toon_dog glTF; Poly Haven HDRIs found locally. See `assets/SOURCES.md`. | User instruction: find materials locally rather than downloading. |
