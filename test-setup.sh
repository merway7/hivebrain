#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RED='\033[0;31m'
GREEN='\033[0;32m'
BOLD='\033[1m'
NC='\033[0m'

echo -e "${BOLD}Building clean test container (Node + Claude Code only)...${NC}"
docker build -t hivebrain-test -f "$SCRIPT_DIR/Dockerfile.test" "$SCRIPT_DIR" 2>&1 | tail -5

echo -e "\n${BOLD}Running full test suite as fresh user...${NC}\n"

docker run --rm hivebrain-test bash -c '
RED="\033[0;31m"
GREEN="\033[0;32m"
BOLD="\033[1m"
NC="\033[0m"
FAILURES=0

pass() { echo -e "  ${GREEN}✓${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; FAILURES=$((FAILURES + 1)); }

# ── Verify starting conditions ──
echo "Test 0: Clean slate"
if [ ! -d ~/.claude ]; then
  pass "No .claude directory exists"
else
  fail "~/.claude already exists — not a clean test"
fi
if command -v claude >/dev/null 2>&1; then
  pass "Claude Code is installed ($(claude --version 2>/dev/null || echo "yes"))"
else
  fail "Claude Code not found"
fi

# ── Run setup.sh from the repo ──
echo ""
echo "Test 1: setup.sh completes on fresh machine"
cd ~/hivebrain
SETUP_OUTPUT=$(./setup.sh 2>&1)
if echo "$SETUP_OUTPUT" | grep -q "Setup complete"; then
  pass "setup.sh completed successfully"
else
  fail "setup.sh did not complete"
  echo "$SETUP_OUTPUT"
fi

# ── MCP server built ──
echo ""
echo "Test 2: MCP server compiled"
if [ -f ~/hivebrain/mcp-server/dist/index.js ]; then
  pass "dist/index.js exists"
else
  fail "MCP server not built"
fi

# ── ~/.claude/settings.json created from scratch ──
echo ""
echo "Test 3: settings.json created from nothing"
if [ -f ~/.claude/settings.json ]; then
  pass "~/.claude/settings.json created"
  SETTINGS=$(cat ~/.claude/settings.json)
  if echo "$SETTINGS" | grep -q '"hivebrain"'; then
    pass "hivebrain MCP server registered"
  else
    fail "hivebrain not in settings"
    echo "  Content: $SETTINGS"
  fi
  # Verify it is valid JSON
  if node -e "JSON.parse(require(\"fs\").readFileSync(\"$HOME/.claude/settings.json\",\"utf8\"))" 2>/dev/null; then
    pass "Valid JSON"
  else
    fail "settings.json is not valid JSON"
  fi
else
  fail "~/.claude/settings.json not created"
fi

# ── MCP server protocol handshake ──
echo ""
echo "Test 4: MCP protocol works"
MCP_OUTPUT=$(printf "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2024-11-05\",\"capabilities\":{},\"clientInfo\":{\"name\":\"test\",\"version\":\"1.0.0\"}}}\n" | timeout 5 node ~/hivebrain/mcp-server/dist/index.js 2>/dev/null)
if echo "$MCP_OUTPUT" | grep -q "\"hivebrain\""; then
  pass "Server identifies as hivebrain"
else
  fail "MCP handshake failed"
  echo "  Got: $MCP_OUTPUT"
fi

# ── All 3 tools advertised ──
echo ""
echo "Test 5: All tools registered"
TOOLS_OUTPUT=$(printf "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2024-11-05\",\"capabilities\":{},\"clientInfo\":{\"name\":\"test\",\"version\":\"1.0.0\"}}}\n{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"notifications/initialized\"}\n{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/list\"}\n" | timeout 5 node ~/hivebrain/mcp-server/dist/index.js 2>/dev/null)
for tool in hivebrain_search hivebrain_submit hivebrain_get; do
  if echo "$TOOLS_OUTPUT" | grep -q "\"$tool\""; then
    pass "$tool"
  else
    fail "$tool missing"
  fi
done

# ── Offline graceful handling (HiveBrain not running) ──
echo ""
echo "Test 6: Graceful when HiveBrain is offline"
OFFLINE=$(printf "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2024-11-05\",\"capabilities\":{},\"clientInfo\":{\"name\":\"test\",\"version\":\"1.0.0\"}}}\n{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"notifications/initialized\"}\n{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"hivebrain_search\",\"arguments\":{\"query\":\"test\"}}}\n" | timeout 10 node ~/hivebrain/mcp-server/dist/index.js 2>/dev/null)
if echo "$OFFLINE" | grep -qi "offline\|not responding\|connection failed"; then
  pass "Search returns helpful offline message"
else
  fail "No offline message"
  echo "  Got: $(echo "$OFFLINE" | tail -1)"
fi

# ── HiveBrain API starts and works ──
echo ""
echo "Test 7: HiveBrain starts and serves API"
cd ~/hivebrain
npx astro dev &>/dev/null &
SERVER_PID=$!
API_READY=false
for i in $(seq 1 25); do
  if curl -sf "http://localhost:4321/api/search?q=test" --max-time 2 >/dev/null 2>&1; then
    API_READY=true
    break
  fi
  sleep 1
done
if $API_READY; then
  pass "HiveBrain started"
  # Test search
  SEARCH=$(curl -sf "http://localhost:4321/api/search?q=test" --max-time 3 2>/dev/null)
  if echo "$SEARCH" | grep -q "\"query\""; then
    pass "GET /api/search works"
  else
    fail "Search endpoint broken"
  fi
  # Test get entry
  ENTRY=$(curl -sf "http://localhost:4321/api/entry/1" --max-time 3 2>/dev/null)
  if echo "$ENTRY" | grep -q "\"title\"\|\"error\""; then
    pass "GET /api/entry/:id works"
  else
    fail "Entry endpoint broken"
  fi
else
  fail "HiveBrain did not start within 25s"
fi

# ── MCP tools work end-to-end with live HiveBrain ──
echo ""
echo "Test 8: MCP tools work end-to-end (live server)"
if $API_READY; then
  LIVE=$(printf "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2024-11-05\",\"capabilities\":{},\"clientInfo\":{\"name\":\"test\",\"version\":\"1.0.0\"}}}\n{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"notifications/initialized\"}\n{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"hivebrain_search\",\"arguments\":{\"query\":\"react\"}}}\n" | timeout 10 node ~/hivebrain/mcp-server/dist/index.js 2>/dev/null)
  if echo "$LIVE" | grep -qi "result\|found\|no results"; then
    pass "hivebrain_search returns data from live server"
  else
    fail "hivebrain_search did not work with live server"
    echo "  Got: $(echo "$LIVE" | tail -1)"
  fi
else
  fail "Skipped — HiveBrain not running"
fi

kill $SERVER_PID 2>/dev/null || true

# ── Settings merge (simulate user who already has config) ──
echo ""
echo "Test 9: Re-running setup is safe (idempotent)"
cd ~/hivebrain
BEFORE=$(cat ~/.claude/settings.json)
./setup.sh >/dev/null 2>&1
AFTER=$(cat ~/.claude/settings.json)
# Count hivebrain occurrences — should be exactly 1
COUNT=$(echo "$AFTER" | grep -c "\"hivebrain\"")
if [ "$COUNT" -eq 1 ]; then
  pass "No duplicate registration on re-run"
else
  fail "Duplicate hivebrain entries ($COUNT)"
fi

# ── Summary ──
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ $FAILURES -eq 0 ]; then
  echo -e "${GREEN}${BOLD}All tests passed!${NC} Fresh user setup works end-to-end."
else
  echo -e "${RED}${BOLD}$FAILURES test(s) failed.${NC}"
  exit 1
fi
'
