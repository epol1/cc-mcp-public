#!/bin/bash
# Phase 6 fresh-session test (GOAL-PHASE6 §5): a headless Claude Code session with only the ae-compose skill and
# MCP tools gets a brief that needs material the repo lacks: it finds, fetches and credits it, then builds and reviews.
# Empty working folder; --strict-mcp-config with only ae-compose; tools limited to the MCP tools and reading the
# skill folder (the skill's own reference files).
set -u
REPO=${REPO:-$(cd "$(dirname "$0")/../.." && pwd)}
WIN=$(cygpath -m "$REPO")
WORK=$(mktemp -d)
OUT=${OUT:-$REPO/scratch/p6/fresh}; BRIEF_FILE=$REPO/tests/fresh-session/p6-brief.md; mkdir -p "$OUT"
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
