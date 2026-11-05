#!/bin/bash
# Phase 5 fresh-session test (TOOLKIT §10 item 6): a headless Claude Code session with only the ae-compose skill and
# MCP tools builds an original piece with the cloner, a UI sequence and a beat-synced cut, and reviews it unaided.
# Empty working folder; --strict-mcp-config with only ae-compose; tools limited to the MCP tools and reading the
# skill folder (the skill's own reference files).
set -u
REPO=${REPO:-$(cd "$(dirname "$0")/../.." && pwd)}
WIN=$(cygpath -m "$REPO")
WORK=$(mktemp -d)
OUT=${OUT:-$REPO/scratch/p5/fresh}; BRIEF_FILE=$REPO/tests/fresh-session/p5-brief.md; mkdir -p "$OUT"
cat > "$WORK/mcp.json" <<JSON
{ "mcpServers": { "ae-compose": { "command": "node", "args": ["$WIN/bin/aec-mcp.mjs"] } } }
JSON
BRIEF=$(sed "s#E:/Projects/ae-mcp/#$WIN/#g" "$BRIEF_FILE")
cd "$WORK"
echo "work folder: $WORK"
claude -p "$BRIEF" \
  --strict-mcp-config --mcp-config "$WORK/mcp.json" \
  --append-system-prompt-file "$REPO/skills/ae-compose/SKILL.md" \
  --add-dir "$REPO/skills/ae-compose" \
  --allowedTools "mcp__ae-compose__*" "Read(/${REPO}/skills/ae-compose/**)" \
  --permission-mode dontAsk \
  --output-format stream-json --verbose \
  > "$OUT/session.jsonl" 2> "$OUT/session.err"
echo "exit $?"
