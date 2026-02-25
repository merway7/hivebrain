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

# ─── Step 3: Register MCP server in Claude Code ───
# IMPORTANT: MCP servers go in ~/.claude.json (user scope), NOT ~/.claude/settings.json.
# settings.json is for hooks/permissions/plugins. MCP servers in settings.json are silently ignored.
step "Registering MCP server in Claude Code"

mkdir -p "$HOME/.claude"

MCP_SERVER_PATH="$MCP_DIR/dist/index.js"
CLAUDE_JSON="$HOME/.claude.json"

if [ -f "$CLAUDE_JSON" ] && grep -q '"hivebrain"' "$CLAUDE_JSON" 2>/dev/null; then
  info "Already registered in $CLAUDE_JSON"
else
  if [ -f "$CLAUDE_JSON" ]; then
    # Merge into existing ~/.claude.json
    node -e "
      const fs = require('fs');
      const config = JSON.parse(fs.readFileSync('$CLAUDE_JSON', 'utf8'));
      if (!config.mcpServers) config.mcpServers = {};
      config.mcpServers.hivebrain = {
        type: 'stdio',
        command: 'node',
        args: ['$MCP_SERVER_PATH'],
        env: {}
      };
      fs.writeFileSync('$CLAUDE_JSON', JSON.stringify(config, null, 2) + '\n');
    "
    info "Added hivebrain MCP server to $CLAUDE_JSON"
  else
    # Create new ~/.claude.json
    node -e "
      const fs = require('fs');
      const config = {
        mcpServers: {
          hivebrain: {
            type: 'stdio',
            command: 'node',
            args: ['$MCP_SERVER_PATH'],
            env: {}
          }
        }
      };
      fs.writeFileSync('$CLAUDE_JSON', JSON.stringify(config, null, 2) + '\n');
    "
    info "Created $CLAUDE_JSON with hivebrain MCP server"
  fi
fi

# Clean up any stale config from settings.json (old bug: MCP was registered here by mistake)
if [ -f "$SETTINGS_FILE" ] && grep -q '"hivebrain"' "$SETTINGS_FILE" 2>/dev/null; then
  node -e "
    const fs = require('fs');
    const settings = JSON.parse(fs.readFileSync('$SETTINGS_FILE', 'utf8'));
    if (settings.mcpServers && settings.mcpServers.hivebrain) {
      delete settings.mcpServers.hivebrain;
      if (Object.keys(settings.mcpServers).length === 0) delete settings.mcpServers;
      fs.writeFileSync('$SETTINGS_FILE', JSON.stringify(settings, null, 2) + '\n');
    }
  "
  warn "Removed stale hivebrain entry from settings.json (MCP servers belong in ~/.claude.json)"
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

# ─── Step 5: Add HiveBrain instructions to CLAUDE.md ───
step "Adding HiveBrain instructions to CLAUDE.md"

CLAUDE_MD="$HOME/CLAUDE.md"
SNIPPET_FILE="$HIVEBRAIN_DIR/CLAUDE_SNIPPET.md"

if [ -f "$CLAUDE_MD" ] && grep -q "HiveBrain" "$CLAUDE_MD" 2>/dev/null; then
  info "HiveBrain section already in $CLAUDE_MD"
else
  if [ -f "$CLAUDE_MD" ]; then
    # Append to existing CLAUDE.md
    echo "" >> "$CLAUDE_MD"
    cat "$SNIPPET_FILE" >> "$CLAUDE_MD"
    info "Appended HiveBrain section to $CLAUDE_MD"
  else
    # Create new CLAUDE.md
    cat "$SNIPPET_FILE" > "$CLAUDE_MD"
    info "Created $CLAUDE_MD with HiveBrain instructions"
  fi
fi

# ─── Step 6: Install hooks in Claude Code settings ───
# Hooks are the enforcement mechanism. CLAUDE.md instructions alone are not reliably followed.
step "Installing Claude Code hooks"

if [ -f "$SETTINGS_FILE" ] && grep -q 'hivebrain_search' "$SETTINGS_FILE" 2>/dev/null; then
  info "HiveBrain hooks already in $SETTINGS_FILE"
else
  node -e "
    const fs = require('fs');
    const path = '$SETTINGS_FILE';
    let settings = {};
    if (fs.existsSync(path)) {
      settings = JSON.parse(fs.readFileSync(path, 'utf8'));
    }
    if (!settings.hooks) settings.hooks = {};

    // SessionStart: check HiveBrain is online
    if (!settings.hooks.SessionStart) settings.hooks.SessionStart = [];
    settings.hooks.SessionStart.push({
      hooks: [{
        type: 'command',
        command: \"rm -f /tmp/hivebrain_searched_* 2>/dev/null; curl -sf http://localhost:4321/api/search?q=test --max-time 2 > /dev/null 2>&1 && echo 'HiveBrain is online. Remember: hivebrain_search MUST be your first tool call for any task.' || echo 'WARNING: HiveBrain is offline. Start it with: cd $HIVEBRAIN_DIR && npm run dev'\"
      }]
    });

    // UserPromptSubmit: remind to search first and submit after
    if (!settings.hooks.UserPromptSubmit) settings.hooks.UserPromptSubmit = [];
    settings.hooks.UserPromptSubmit.push({
      hooks: [{
        type: 'command',
        command: \"echo 'MANDATORY: Your first tool call MUST be hivebrain_search. Not Grep, not Read, not Bash — hivebrain_search. This applies to ALL tasks. After completing work, call hivebrain_submit if you solved something non-trivial or if your search returned no results and you provided a technical solution.'\"
      }]
    });

    // PostToolUse: warn if a tool is used before hivebrain_search
    if (!settings.hooks.PostToolUse) settings.hooks.PostToolUse = [];
    settings.hooks.PostToolUse.push({
      hooks: [{
        type: 'command',
        command: 'if [ \"\$CLAUDE_TOOL_NAME\" != \"hivebrain_search\" ] && [ \"\$CLAUDE_TOOL_NAME\" != \"mcp__hivebrain__hivebrain_search\" ] && [ ! -f /tmp/hivebrain_searched_\$CLAUDE_SESSION_ID ]; then echo \"WARNING: You used \$CLAUDE_TOOL_NAME before searching HiveBrain. Call hivebrain_search NOW.\"; elif [ \"\$CLAUDE_TOOL_NAME\" = \"hivebrain_search\" ] || [ \"\$CLAUDE_TOOL_NAME\" = \"mcp__hivebrain__hivebrain_search\" ]; then touch /tmp/hivebrain_searched_\$CLAUDE_SESSION_ID; fi'
      }]
    });

    fs.mkdirSync('$(dirname "$SETTINGS_FILE")', { recursive: true });
    fs.writeFileSync(path, JSON.stringify(settings, null, 2) + '\n');
  "
  info "Installed SessionStart, UserPromptSubmit, and PostToolUse hooks"
fi

# ─── Step 7: Verify ───
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
echo "  1. MCP server built — Claude Code now has hivebrain_search, hivebrain_submit, hivebrain_get, hivebrain_stats tools"
echo "  2. MCP registered in ~/.claude.json — tools available in every session"
echo "  3. Hooks installed in ~/.claude/settings.json — enforces search-first behavior"
echo "  4. HiveBrain instructions appended to ~/CLAUDE.md"
echo "  5. HiveBrain auto-starts on login via launchd"
echo ""
echo "Start a new Claude Code session to use the tools."
