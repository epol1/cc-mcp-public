# ae-compose

**Code-first motion design for After Effects.** Claude writes Remotion-style TSX, and ae-compose compiles it into **native, fully editable After Effects comps**: real layers, eased keyframes, text animators, shape layers, effects, expression-control rigs, variants, the 3D system and particles. It also inspects and edits existing AE projects. It runs on stock After Effects 2026 with no third-party plugins. A live CEP bridge, an MCP server, a CLI (`aec`) and a Claude skill drive it.

## Status

[![ae-compose status dashboard](status/status.png)](status/index.html)

The image is regenerated on every release by `scripts/release.mjs` from [`status/systems.json`](status/systems.json). Interactive version: [`status/index.html`](status/index.html). Task list: [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Docs
- [GOAL.md](GOAL.md): the full spec and Definition of Done
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how it works (agent-first design, IR, ES3 runtime, bridge, 3D, particles)
- [docs/DECISIONS.md](docs/DECISIONS.md): every non-obvious decision, with rationale
- [docs/RESEARCH.md](docs/RESEARCH.md): verified AE 26.5 scripting facts and research summaries
- [docs/PROGRESS.md](docs/PROGRESS.md): current phase, next steps, open issues
- [docs/AGENT_GUIDE.md](docs/AGENT_GUIDE.md): rules for agents developing this repo

Install, setup checklist, CLI usage, MCP setup and a 5-minute quickstart will land here as those parts are built.
