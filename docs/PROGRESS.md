# Progress

> On resume: read `GOAL.md`, then this file, then `docs/DECISIONS.md`. Continue from **Next**. Never start over.

## Current phase
**Phase 0: environment discovery and human checklist.** Waiting for the user to complete the checklist and say "done".

## Done
- Environment discovered (see `docs/ENVIRONMENT.md`): Windows 11, AE 2026 (26.5), aerender, CEP 12, Node 22, pnpm, ffmpeg, ImageMagick, RTX 3080.
- CEP bridge extension written (`packages/bridge-cep/extension`) and installed via junction into `%APPDATA%\Adobe\CEP\extensions\com.aecompose` before AE launch.
- User constraint recorded: vanilla AE only, no third-party plugins (D2, D3).
- Git initialized.

## Next
1. After "done": verify that the CEP bridge auto-starts (`GET http://127.0.0.1:47811/health`), then run a hello-world eval.
2. Test the fallback backend `AfterFX.com -r <file.jsx>` with a JSON result file. Measure latency of both backends.
3. Confirm the scripting file/network pref by an actual file write from ExtendScript.
4. Save the dev project to `scratch/aec-dev.aep`.
5. Commit Phase 0, then start Phase 1 research (parallel subagents) and AE API verification scripts.

## Open issues
- Unknown until AE launches: does AE 26.5 honor `StartOn` for the invisible `Custom` extension? Fallback: the docked panel hosts the bridge.
