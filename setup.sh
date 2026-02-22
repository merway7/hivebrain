#!/bin/bash
set -e

# ─── HiveBrain Setup ───
# One command to set up HiveBrain + Claude Code MCP integration.
# Run from the hivebrain directory: ./setup.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HIVEBRAIN_DIR="$SCRIPT_DIR"
MCP_DIR="$HIVEBRAIN_DIR/mcp-server"
NODE_PATH="$(which node)"
SETTINGS_FILE="$HOME/.claude/settings.json"
PLIST_FILE="$HOME/Library/LaunchAgents/com.local.hivebrain.plist"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "${GREEN}✓${NC} $1"; }
warn()  { echo -e "${YELLOW}⚠${NC} $1"; }
err()   { echo -e "${RED}✗${NC} $1"; exit 1; }
step()  { echo -e "\n${BOLD}── $1 ──${NC}"; }

# ─── Preflight checks ───
step "Checking requirements"

command -v node >/dev/null 2>&1 || err "Node.js is required. Install: https://nodejs.org"
command -v npm >/dev/null 2>&1 || err "npm is required."

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  err "Node 18+ required (found $(node -v))"
fi

info "Node $(node -v) at $NODE_PATH"

if [ ! -f "$HIVEBRAIN_DIR/package.json" ]; then
  err "Run this script from the hivebrain directory"
fi

# ─── Step 1: Install HiveBrain deps ───
step "Installing HiveBrain dependencies"
if [ ! -d "$HIVEBRAIN_DIR/node_modules" ]; then
  (cd "$HIVEBRAIN_DIR" && npm install --silent)
  info "Installed"
else
  info "Already installed"
fi

# ─── Step 2: Build MCP server ───
step "Building MCP server"
(cd "$MCP_DIR" && npm install --silent && npm run build --silent)
info "MCP server built at $MCP_DIR/dist/index.js"

# ─── Step 3: Register MCP server in Claude Code settings ───
step "Registering MCP server in Claude Code"

mkdir -p "$HOME/.claude"

MCP_SERVER_PATH="$MCP_DIR/dist/index.js"

if [ -f "$SETTINGS_FILE" ]; then
  # Check if hivebrain MCP is already registered
  if grep -q '"hivebrain"' "$SETTINGS_FILE" 2>/dev/null; then
    info "Already registered in $SETTINGS_FILE"
  else
    # Use node to safely merge into existing JSON
    node -e "
      const fs = require('fs');
      const settings = JSON.parse(fs.readFileSync('$SETTINGS_FILE', 'utf8'));
      if (!settings.mcpServers) settings.mcpServers = {};
      settings.mcpServers.hivebrain = {
        command: 'node',
        args: ['$MCP_SERVER_PATH']
      };
      fs.writeFileSync('$SETTINGS_FILE', JSON.stringify(settings, null, 2) + '\n');
    "
    info "Added hivebrain MCP server to $SETTINGS_FILE"
  fi
else
  # Create new settings file with just the MCP server
  node -e "
    const fs = require('fs');
    const settings = {
      mcpServers: {
        hivebrain: {
          command: 'node',
          args: ['$MCP_SERVER_PATH']
        }
      }
    };
    fs.mkdirSync('$(dirname "$SETTINGS_FILE")', { recursive: true });
    fs.writeFileSync('$SETTINGS_FILE', JSON.stringify(settings, null, 2) + '\n');
  "
  info "Created $SETTINGS_FILE with hivebrain MCP server"
fi

# ─── Step 4: Auto-start with launchd (macOS only) ───
if [[ "$OSTYPE" == "darwin"* ]]; then
  step "Setting up auto-start (launchd)"

  ASTRO_BIN="$HIVEBRAIN_DIR/node_modules/.bin/astro"

  cat > "$PLIST_FILE" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.local.hivebrain</string>
    <key>ProgramArguments</key>
    <array>
        <string>$NODE_PATH</string>
        <string>$ASTRO_BIN</string>
        <string>dev</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$HIVEBRAIN_DIR</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/hivebrain.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/hivebrain.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
    </dict>
</dict>
</plist>
PLIST

  # Load (or reload) the plist
  launchctl unload "$PLIST_FILE" 2>/dev/null || true
  launchctl load "$PLIST_FILE"
  info "HiveBrain will auto-start on login (logs: /tmp/hivebrain.log)"
else
  step "Auto-start"
  warn "Skipped (launchd is macOS-only). Start manually: cd $HIVEBRAIN_DIR && npm run dev"
fi

# ─── Step 5: Verify ───
step "Verifying"

sleep 2
if curl -sf 'http://localhost:4321/api/search?q=test' --max-time 3 >/dev/null 2>&1; then
  info "HiveBrain is running at localhost:4321"
else
  warn "HiveBrain not responding yet — it may still be starting. Check: curl localhost:4321"
fi

# ─── Done ───
echo ""
echo -e "${GREEN}${BOLD}Setup complete!${NC}"
echo ""
echo "What happened:"
echo "  1. MCP server built — Claude Code now has hivebrain_search, hivebrain_submit, hivebrain_get tools"
echo "  2. Registered in ~/.claude/settings.json — tools available in every session"
echo "  3. HiveBrain auto-starts on login via launchd"
echo ""
echo -e "${BOLD}Optional: Add to your CLAUDE.md${NC}"
echo "Copy the HiveBrain section from: $HIVEBRAIN_DIR/CLAUDE_SNIPPET.md"
echo ""
echo "Start a new Claude Code session to use the tools."
