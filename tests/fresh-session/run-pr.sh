#!/bin/bash
# pr-cut fresh-session test: a headless Claude Code session with only the pr-cut skill and MCP tools makes a
# testimonial cut from an interview, reviews it and fixes it, unaided. Empty working folder; --strict-mcp-config
# with only pr-cut; tools limited to the MCP tools and reading the skill folder.
set -u
REPO=${REPO:-/e/Projects/ae-mcp}
WIN=$(cygpath -m "$REPO")
WORK=$(mktemp -d)
OUT=${OUT:-$REPO/scratch/pr/fresh/session}; mkdir -p "$OUT"
cat > "$WORK/mcp.json" <<JSON
{ "mcpServers": { "pr-cut": { "command": "node", "args": ["$WIN/bin/prc-mcp.mjs"] } } }
JSON
BRIEF=$(cat "$REPO/tests/fresh-session/pr-brief.md")
cd "$WORK"
echo "work folder: $WORK"
claude -p "$BRIEF" \
  --strict-mcp-config --mcp-config "$WORK/mcp.json" \
  --append-system-prompt-file "$REPO/skills/pr-cut/SKILL.md" \
  --add-dir "$REPO/skills/pr-cut" \
  --allowedTools "mcp__pr-cut__*" "Read(/${REPO}/skills/pr-cut/**)" \
  --permission-mode dontAsk \
  --output-format stream-json --verbose \
  > "$OUT/session.jsonl" 2> "$OUT/session.err"
echo "exit $?"
