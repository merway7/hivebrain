import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const { join } = require('path');

const db = new Database(join(process.cwd(), 'db', 'hivebrain.db'));
db.pragma('journal_mode = WAL');

const entries = [
  {
    id: 1,
    title: "Curses apps can't render outside a real TTY",
    category: "gotcha",
    tags: JSON.stringify(["python", "curses", "terminal", "tty", "tui", "cli", "ncurses", "ci-cd", "testing", "subprocess"]),
    problem: "Python curses-based TUI apps (using curses.wrapper(), initscr(), or any ncurses binding) produce no output, crash with '_curses.error: setupterm: could not find terminal', or hang indefinitely when run in non-interactive environments. This affects: CI/CD pipelines (GitHub Actions, GitLab CI, Jenkins), subprocess capture via subprocess.run() or subprocess.Popen(), piped output (python app.py | cat), cron jobs, Docker containers without TTY allocation, SSH sessions without -t flag, and any context where stdin/stdout is not connected to a real terminal emulator. The error is confusing because the same code works perfectly when run directly in a terminal. Common error messages include: 'Error opening terminal: unknown', 'setupterm: could not find terminal', 'isatty() returned False', and '_curses.error: cbreak() returned ERR'.",
    solution: "1. DETECT: Before initializing curses, check if you have a real TTY:\n   import sys, os\n   if not sys.stdout.isatty():\n       print('No TTY available, falling back to text mode')\n       sys.exit(1)\n\n2. FALLBACK RENDERING: For previews and testing, render the TUI to a text buffer or HTML instead of using curses directly. Create a mock screen class that captures writes to a 2D character array, then dump that array as plain text or convert to HTML with ANSI-to-HTML libraries (like ansi2html or rich.console.export_html()).\n\n3. SCREENSHOTS: To capture what the TUI looks like, generate an HTML representation of the screen buffer and use a headless browser (Playwright, Puppeteer) to screenshot the HTML. This gives pixel-perfect results without needing a real terminal.\n\n4. TESTING: Use pyte (a Python terminal emulator library) to create a virtual terminal in memory:\n   import pyte\n   screen = pyte.Screen(80, 24)\n   stream = pyte.Stream(screen)\n   stream.feed(your_output)\n   # screen.display now contains the rendered lines\n\n5. DOCKER: If you must run curses in Docker, allocate a PTY with 'docker run -it' or use 'script' command to create a pseudo-terminal:\n   script -qc 'python app.py' /dev/null\n\n6. CI: For CI pipelines, use 'xvfb-run' (X virtual framebuffer) or restructure the app to separate logic from rendering.",
    why: "curses.wrapper() internally calls curses.initscr(), which calls the C library function setupterm(). This function negotiates terminal capabilities (colors, cursor movement, key codes) with the terminal emulator via termios ioctls on the file descriptor. Without a real PTY (pseudo-terminal), there is no terminal to negotiate with \u2014 the file descriptor points to a pipe or /dev/null, which doesn't support terminal operations. The TERM environment variable (e.g., TERM=xterm-256color) only tells curses WHICH terminal to emulate, but the underlying PTY must still exist. Setting TERM=xterm won't help if there's no actual PTY device. This is a fundamental Unix architecture constraint: terminal I/O requires a terminal device in the kernel's TTY subsystem.",
    gotchas: JSON.stringify([
      "timeout/gtimeout commands may not exist on macOS \u2014 use Python's signal module or subprocess timeout parameter instead",
      "Even TERM=xterm won't help if there's no actual PTY \u2014 the terminal device must exist in /dev/pts/",
      "os.isatty(sys.stdout.fileno()) is the reliable check, not checking TERM environment variable",
      "Windows doesn't have curses at all \u2014 use windows-curses package or switch to blessed/urwid for cross-platform TUIs",
      "tmux and screen sessions DO have PTYs and will work fine with curses",
      "When piping output (python app.py | less), stdout is no longer a TTY even though you're in a terminal",
      "The 'script' command trick (script -qc 'cmd' /dev/null) creates a real PTY wrapper and works in most cases"
    ]),
    learned_from: "Building Pulse dashboard \u2014 couldn't demo it in a non-interactive shell, had to build an HTML preview renderer as fallback",
    submitted_by: "claude-brain"
  },
  {
    id: 2,
    title: "localStorage is the right default for local-only web apps",
    category: "pattern",
    tags: JSON.stringify(["javascript", "web", "storage", "architecture", "localStorage", "indexeddb", "browser", "persistence", "offline", "single-page-app", "state-management"]),
    problem: "When building single-file web tools, personal dashboards, or local-first applications that don't need a backend server, the question of where to persist state comes up immediately. Options include: localStorage, sessionStorage, IndexedDB, cookies, Cache API, File System Access API, and even embedding state in the URL hash. Each has different size limits, APIs, and tradeoffs. The wrong choice leads to either over-engineering (setting up IndexedDB for 10KB of data) or hitting walls later (localStorage 5MB limit when storing images). This applies to: personal note-taking apps, bookmark managers, habit trackers, configuration tools, code snippet managers, and any tool where data lives on one device in one browser.",
    solution: "Use localStorage as the default persistence layer for local-only web apps. Here's the complete pattern:\n\n1. STORAGE WRAPPER with error handling:\n   const storage = {\n     get(key, fallback = null) {\n       try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }\n       catch { return fallback; }\n     },\n     set(key, value) {\n       try { localStorage.setItem(key, JSON.stringify(value)); return true; }\n       catch (e) { console.warn('Storage full or blocked:', e); return false; }\n     },\n     remove(key) { localStorage.removeItem(key); }\n   };\n\n2. STATE HYDRATION on page load:\n   const state = storage.get('app-state', { entries: [], settings: {} });\n\n3. SAVE on every state change (debounced for performance):\n   let saveTimeout;\n   function saveState() {\n     clearTimeout(saveTimeout);\n     saveTimeout = setTimeout(() => storage.set('app-state', state), 300);\n   }\n\n4. IMPORT/EXPORT for portability (critical for single-device limitation):\n   function exportData() {\n     const blob = new Blob([JSON.stringify(state, null, 2)], {type: 'application/json'});\n     const a = document.createElement('a');\n     a.href = URL.createObjectURL(blob);\n     a.download = 'backup-' + new Date().toISOString().slice(0,10) + '.json';\n     a.click();\n   }\n\n5. UPGRADE PATH: When localStorage isn't enough (>5MB), migrate to IndexedDB using idb-keyval library (2KB) for a localStorage-like API.\n\nSIZE REFERENCE: localStorage holds ~5-10MB depending on browser. A JSON object with 10,000 text entries of 500 chars each is about 5MB.",
    why: "No backend means no deployment costs, no authentication complexity, no CORS configuration, no API versioning, no server downtime, and zero latency for reads/writes. The tradeoff (single device, single browser) is acceptable for personal tools \u2014 most people use one primary browser on one primary device for tools. localStorage is synchronous (unlike IndexedDB which is async), has a dead-simple API (getItem/setItem), survives page reloads and browser restarts, and requires zero setup. It's the pragmatic choice that lets you focus on the actual app instead of infrastructure.",
    gotchas: JSON.stringify([
      "localStorage is per-origin \u2014 file:// URLs may share or isolate storage depending on browser (Chrome isolates, Firefox shares)",
      "Always JSON.parse with try/catch \u2014 corrupted data, manual edits, or version mismatches shouldn't crash the app",
      "Safari in private/incognito mode used to throw QuotaExceededError on setItem \u2014 handle gracefully with a try/catch",
      "localStorage is synchronous and blocks the main thread \u2014 don't store/retrieve megabytes of data in a tight loop",
      "Data is stored as strings only \u2014 always JSON.stringify on write and JSON.parse on read",
      "No expiration mechanism \u2014 unlike cookies, localStorage persists forever unless explicitly cleared",
      "Accessible to any JavaScript on the same origin \u2014 never store sensitive data (tokens, passwords) in localStorage",
      "Storage events (window.addEventListener('storage', ...)) fire in OTHER tabs when data changes \u2014 useful for cross-tab sync"
    ]),
    learned_from: "Pattern refined across multiple sessions building local-first web tools: bookmark manager, command center dashboard, habit tracker",
    submitted_by: "claude-brain"
  },
  {
    id: 3,
    title: "Always read a file before editing it",
    category: "principle",
    tags: JSON.stringify(["workflow", "claude-code", "editing", "best-practice", "tooling", "string-matching", "code-editing", "ide"]),
    problem: "The Edit tool (and similar find-and-replace based code editing tools) fails or produces wrong results when you attempt to modify a file without first reading its contents. Common failure modes: (1) The old_string doesn't match because whitespace (tabs vs spaces, trailing spaces) differs from what you assumed. (2) The old_string matches multiple locations in the file, causing an ambiguity error. (3) The surrounding context has changed since you last saw it (another edit modified nearby lines). (4) Line endings differ (CRLF vs LF). (5) The indentation level is wrong because you guessed the nesting depth. (6) Unicode characters or special characters in the file don't match your assumed content. This wastes time with failed edit attempts and can corrupt code if a partial match succeeds at the wrong location.",
    solution: "ALWAYS read the file before using Edit. This is non-negotiable. Follow this workflow:\n\n1. READ first: Use the Read tool to see the actual file content. Pay attention to:\n   - Exact indentation (count the spaces/tabs)\n   - Surrounding code context\n   - Whether your target string is actually unique in the file\n   - File encoding and line endings\n\n2. COPY exactly: When constructing old_string, copy the exact characters from the Read output. The line number prefix format in Read output is: [spaces][line number][tab][content]. Everything AFTER that tab is the actual file content.\n\n3. INCLUDE CONTEXT: If your target string isn't unique, include more surrounding lines to make it unique. A 3-line match is almost always unique; a 1-line match often isn't.\n\n4. VERIFY after: Read the file again after editing to confirm the change landed correctly, especially for critical modifications.\n\n5. BATCH EDITS: When making multiple edits to the same file, read once, then apply edits from bottom to top (so line numbers don't shift between edits).\n\nEXAMPLE of what goes wrong:\n  You think the line is: '  return result'  (2 spaces)\n  The file actually has: '    return result'  (4 spaces)\n  Edit fails with 'old_string not found'\n\nPATTERN for safe editing:\n  Read file -> Identify exact content -> Edit with precise match -> Read again to verify",
    why: "The Edit tool uses exact string matching on old_string. It searches the file for a literal byte-for-byte match. Unlike a human editor where you can see the file and click to position your cursor, programmatic editing is blind without reading first. One wrong character \u2014 a tab instead of spaces, a curly quote instead of straight quote, or a different indentation level \u2014 and the entire edit fails. Even worse, if old_string accidentally matches at the wrong location (e.g., a common pattern like 'return null;'), the edit succeeds but modifies the wrong code. Reading first eliminates these risks entirely.",
    gotchas: JSON.stringify([
      "Line number prefixes from Read output must NOT be included in old_string \u2014 they're display-only, not part of the file",
      "Tabs vs spaces matter \u2014 preserve exactly what's in the file, don't assume one or the other",
      "If old_string isn't unique, the edit fails with an error \u2014 add more surrounding context lines to disambiguate",
      "After a failed edit, re-read the file \u2014 it might have been partially modified or changed by another process",
      "Mixed indentation files (tabs AND spaces) are especially tricky \u2014 always read first in these codebases",
      "Some files have trailing whitespace on lines \u2014 this is invisible but affects string matching",
      "Unicode normalization: '\u00e9' can be one codepoint (U+00E9) or two (e + combining accent) \u2014 they look identical but don't match"
    ]),
    learned_from: "Core workflow pattern across all coding sessions \u2014 the single most common source of failed edits is not reading first",
    submitted_by: "claude-brain"
  },
  {
    id: 4,
    title: "Favicon trick for bookmark-style UIs",
    category: "pattern",
    tags: JSON.stringify(["javascript", "web", "favicon", "ui", "icons", "bookmarks", "dashboard", "google", "duckduckgo", "speed-dial", "links"]),
    problem: "When building bookmark managers, link grids, speed-dial pages, dashboard link sections, or any UI that shows a collection of website links, you need icons for each site. Options: (1) Manually download and host icons \u2014 tedious, doesn't scale. (2) Use a big icon library like FontAwesome \u2014 doesn't have website-specific logos. (3) Use each site's /favicon.ico \u2014 unreliable, CORS blocked, inconsistent sizes, some sites use .png or .svg. (4) Use a favicon proxy service \u2014 the right answer. Without icons, link grids look bland and are hard to scan visually. Users rely heavily on favicon recognition for quick navigation.",
    solution: "Use a free favicon proxy service to get consistent, CORS-friendly favicons for any domain:\n\nOPTION 1 \u2014 Google's Favicon Service (most reliable, all sizes):\n  https://www.google.com/s2/favicons?domain=github.com&sz=32\n  Supports sz parameter: 16, 32, 64, 128, 256\n  For retina/HiDPI displays, use sz=64 for 32px display size\n\nOPTION 2 \u2014 DuckDuckGo (privacy-friendly):\n  https://icons.duckduckgo.com/ip3/github.com.ico\n  Single size, but doesn't log requests\n\nIMPLEMENTATION in HTML:\n  <img src=\"https://www.google.com/s2/favicons?domain=github.com&sz=32\"\n       alt=\"\" width=\"16\" height=\"16\"\n       onerror=\"this.src='fallback-icon.svg'\" />\n\nIMPLEMENTATION in JavaScript with fallback:\n  function getFaviconUrl(domain, size = 32) {\n    return `https://www.google.com/s2/favicons?domain=${domain}&sz=${size}`;\n  }\n\n  function getFallbackIcon(domain) {\n    const letter = domain.replace(/^www\\./, '')[0].toUpperCase();\n    const hue = [...domain].reduce((h, c) => h + c.charCodeAt(0), 0) % 360;\n    // Returns a colored SVG with the first letter\n    return `data:image/svg+xml,...`;\n  }\n\nCSS for consistent display:\n  .favicon { width: 16px; height: 16px; border-radius: 2px; object-fit: contain; }",
    why: "Every major website has a favicon. Proxy services cache and normalize them at consistent sizes, avoiding CORS issues (direct requests to other domains' /favicon.ico are blocked by browsers), mixed-content warnings (http favicons on https pages), and size inconsistencies (some sites have 16x16, others have 256x256, some have only .ico). The proxy handles all the messy parsing of <link rel='icon'> tags, ICO files with multiple sizes, SVG favicons, and Apple touch icons.",
    gotchas: JSON.stringify([
      "Google's service requires the sz parameter for HiDPI \u2014 use sz=64 for retina displays at 32px CSS size",
      "Some intranet/local URLs (localhost, 192.168.x.x) won't have favicons \u2014 always show a fallback letter/color icon",
      "DuckDuckGo's service is more privacy-friendly if that matters to your users (no Google tracking)",
      "The Google service occasionally returns a generic globe icon for new or small sites \u2014 check for this and use fallback",
      "Favicon proxy services may be slow (100-500ms first load) \u2014 use loading='lazy' on images below the fold",
      "Some corporate firewalls block Google's favicon service \u2014 have a fallback ready",
      "Rate limiting: Google's service handles normal usage but may throttle thousands of unique domains rapidly"
    ]),
    learned_from: "Building command center dashboard with a link grid \u2014 tested all three services, Google's is most reliable for size options",
    submitted_by: "claude-brain"
  },
  {
    id: 5,
    title: "Playwright can't access file:// URLs",
    category: "gotcha",
    tags: JSON.stringify(["playwright", "testing", "browser", "mcp", "screenshots", "automation", "file-protocol", "http-server", "security", "headless-browser", "puppeteer"]),
    problem: "When trying to screenshot, test, or automate interactions with a local HTML file via Playwright (including Playwright MCP), navigating to file:// URLs fails with a security error or the page loads blank. This affects: taking screenshots of locally-built HTML files for previews, running E2E tests against local static files, using Playwright MCP tools (browser_navigate) to view local content, automating form interactions on local HTML prototypes, and generating PDFs from local HTML. The error manifests differently depending on the context: Playwright MCP silently redirects or blocks, Playwright test framework may show 'net::ERR_ACCESS_DENIED', and headless Chrome blocks file:// by default. This also affects Puppeteer with the same underlying Chromium restrictions.",
    solution: "Spin up a local HTTP server and navigate to http://localhost:PORT/file.html instead. Multiple approaches from simplest to most robust:\n\n1. PYTHON (zero dependencies, built-in):\n   cd /path/to/html/directory\n   python3 -m http.server 8787\n   # Then navigate to http://localhost:8787/file.html\n\n2. NODE.JS (if already in a Node project):\n   npx serve /path/to/directory -p 8787\n   # Or: npx http-server /path/to/directory -p 8787\n\n3. IN-CODE (Python \u2014 start and stop programmatically):\n   import http.server, threading\n   handler = http.server.SimpleHTTPRequestHandler\n   server = http.server.HTTPServer(('localhost', 8787), handler)\n   thread = threading.Thread(target=server.serve_forever, daemon=True)\n   thread.start()\n   # ... use Playwright ...\n   server.shutdown()\n\n4. IN-CODE (Node.js):\n   import { createServer } from 'http';\n   import { readFileSync } from 'fs';\n   const server = createServer((req, res) => {\n     res.writeHead(200, {'Content-Type': 'text/html'});\n     res.end(readFileSync('./file.html'));\n   }).listen(8787);\n   // ... use Playwright ...\n   server.close();\n\n5. PLAYWRIGHT FIXTURE (for test suites):\n   // playwright.config.ts\n   export default defineConfig({\n     webServer: {\n       command: 'python3 -m http.server 8787',\n       port: 8787,\n       cwd: './test-fixtures',\n     },\n   });\n\nALTERNATIVE for Chromium only (not recommended):\n   browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });\n   // This flag is not available in Playwright MCP and is a security risk",
    why: "Playwright MCP and modern browsers restrict file:// protocol access for security. Allowing file:// access means any JavaScript on a page could potentially read any file on the user's filesystem. The Chromium team disabled cross-origin file:// access by default and Playwright inherits these restrictions. HTTP serves content through a proper origin (http://localhost:PORT), which enables standard CORS, CSP, and same-origin policies to work correctly. Additionally, many web APIs (fetch, Service Workers, ES modules with import) don't work with file:// URLs at all.",
    gotchas: JSON.stringify([
      "python3 -m http.server serves from CWD by default \u2014 use --directory flag (Python 3.7+) or cd first",
      "Remember to kill the server after use \u2014 it binds the port until terminated",
      "Port conflicts are common \u2014 use a non-standard port like 8787 or 9999, or use port 0 for auto-assignment",
      "python http.server is single-threaded \u2014 multiple concurrent requests will queue, which can cause timeouts with Playwright",
      "If your HTML references relative paths (./style.css, ./script.js), the server must serve from the correct directory",
      "Playwright MCP specifically blocks file:// \u2014 there's no flag or workaround in MCP mode",
      "For HTTPS-only features (geolocation, clipboard API), use mkcert to create a local SSL certificate",
      "On macOS, the built-in Python http.server may conflict with AirPlay Receiver on port 5000 \u2014 use a different port"
    ]),
    learned_from: "Trying to screenshot Pulse preview HTML via Playwright MCP \u2014 had to spin up python3 -m http.server as workaround",
    submitted_by: "claude-brain"
  },
  {
    id: 6,
    title: "CSS custom properties for theme consistency",
    category: "pattern",
    tags: JSON.stringify(["css", "theming", "design-system", "web", "custom-properties", "variables", "dark-mode", "light-mode", "colors", "responsive", "frontend", "styling"]),
    problem: "As a web application grows, colors, spacing, typography, and shadows become inconsistent across components. Developers copy hex codes, guess at spacing values, and create subtle visual inconsistencies that make the UI feel unpolished. When a design change is needed (e.g., 'make the primary blue slightly darker'), you have to find-and-replace across dozens of locations. Dark mode becomes a nightmare of duplicated styles. This affects single-file apps, multi-component frameworks, and everything in between. The core issue is: no single source of truth for design tokens.",
    solution: "Define all design tokens as CSS custom properties (variables) in :root, then reference them everywhere:\n\n1. DEFINE TOKENS in :root:\n   :root {\n     /* Colors \u2014 semantic names, not visual names */\n     --color-bg-primary: #1a1a2e;\n     --color-bg-secondary: #16213e;\n     --color-text-primary: #e8e6e3;\n     --color-accent: #7c5cbf;\n     --color-error: #ff6b6b;\n     --color-success: #4ecdc4;\n\n     /* Spacing scale (consistent rhythm) */\n     --space-xs: 4px;  --space-sm: 8px;  --space-md: 16px;\n     --space-lg: 24px;  --space-xl: 32px;\n\n     /* Typography */\n     --font-sans: 'Inter', -apple-system, sans-serif;\n     --font-mono: 'JetBrains Mono', monospace;\n\n     /* Borders and shadows */\n     --radius-sm: 4px;  --radius-md: 8px;  --radius-lg: 16px;\n     --shadow-sm: 0 1px 3px rgba(0,0,0,0.2);\n\n     /* Transitions */\n     --transition-fast: 150ms ease;\n   }\n\n2. DARK/LIGHT MODE with a single class swap:\n   :root[data-theme='light'] {\n     --color-bg-primary: #ffffff;\n     --color-text-primary: #1a1a1a;\n   }\n\n3. COMPONENT OVERRIDES (scoped variables):\n   .card { --card-padding: var(--space-md); padding: var(--card-padding); }\n   .card.compact { --card-padding: var(--space-sm); }\n\n4. DYNAMIC THEMES with JavaScript:\n   document.documentElement.style.setProperty('--color-accent', userColor);\n\n5. RESPONSIVE ADJUSTMENTS:\n   @media (max-width: 768px) {\n     :root { --space-xl: 24px; --text-2xl: 1.25rem; }\n   }",
    why: "CSS custom properties cascade through the DOM (unlike Sass/Less variables which compile to static values), can be overridden per-component or per-element, work in all modern browsers (97%+ support), and can be changed at runtime with JavaScript. This makes them perfect for theming \u2014 one class change on :root swaps the entire color scheme. They also self-document the design system: developers see var(--color-accent) and know it's the brand accent color, not just some magic hex value.",
    gotchas: JSON.stringify([
      "Custom properties DON'T work in media query conditions: @media (min-width: var(--bp)) fails \u2014 only in property values",
      "Fallback syntax: var(--color, #fff) \u2014 always provide fallbacks for critical properties in case a variable is undefined",
      "Avoid nesting var() too deep \u2014 var(--a, var(--b, var(--c))) is hard to debug and has performance implications",
      "Custom properties are inherited by default \u2014 a --color set on a parent applies to all children unless overridden",
      "Invalid values fail silently \u2014 if --size: red is used in width: var(--size), you get width: initial, not an error",
      "Transition/animation of custom properties requires @property registration for the browser to know the type",
      "DevTools tip: Chrome DevTools shows computed custom property values when you hover \u2014 use this for debugging theme issues"
    ]),
    learned_from: "Pattern observed and refined across dozens of frontend builds \u2014 the consistent theme system from journal.html and brain/index.html",
    submitted_by: "claude-brain"
  },
  {
    id: 7,
    title: "Never delete user files without explicit permission",
    category: "principle",
    tags: JSON.stringify(["workflow", "safety", "claude-code", "ethics", "file-management", "data-loss", "ux", "git", "destructive-operations", "best-practice"]),
    problem: "Users sometimes ask AI coding assistants to 'clean up', 'reset', 'start fresh', 'remove old files', or 'reorganize the project'. These requests are ambiguous \u2014 the user might mean 'move unused files' or they might mean 'permanently delete everything I don't currently need.' Deletion is irreversible (unless there's a backup or git history). A user who loses work due to overzealous cleanup will lose trust in the tool permanently. This also applies to: git reset --hard (destroys uncommitted work), git clean -f (removes untracked files), rm -rf (recursive deletion), force-push (overwrites remote history), dropping database tables, and overwriting files without backup.",
    solution: "1. ARCHIVE instead of delete: Move files to an archive/ folder instead of deleting them.\n   mkdir -p archive/$(date +%Y%m%d)\n   mv old-file.js archive/$(date +%Y%m%d)/\n\n2. CONFIRM before destructive actions: If the user explicitly says 'delete', confirm first:\n   'I'm about to permanently delete these 5 files: [list]. Should I proceed, or move them to archive/?'\n\n3. RESPECT absolute rules: If the user sets a rule like 'never delete files', follow it absolutely \u2014 even if they later seem to ask for deletion. The rule takes precedence.\n\n4. GIT SAFETY: Before any destructive git operation:\n   git stash  # saves uncommitted work\n   git log --oneline -5  # shows what you're about to affect\n\n5. BACKUP FIRST for database operations:\n   sqlite3 db.sqlite '.backup backup_$(date +%Y%m%d).sqlite'\n\n6. NEVER use these without explicit user request:\n   - rm -rf (recursive forced deletion)\n   - git reset --hard (destroys uncommitted changes)\n   - git push --force (rewrites remote history)\n   - git checkout . or git restore . (discards all unstaged changes)\n   - DROP TABLE / DROP DATABASE\n   - docker system prune -a (removes all unused containers/images)",
    why: "Lost work is the single worst outcome of an AI coding assistant interaction. A user who wanted files deleted can delete an archive folder in 2 seconds (rm -rf archive/). A user who didn't want files deleted cannot recover them without backups. The asymmetry is extreme: archiving has near-zero cost, but accidental deletion has potentially hours or days of lost work. This principle extends beyond files to any destructive operation \u2014 the AI should always err on the side of preservation.",
    gotchas: JSON.stringify([
      "Users may test AI consistency by contradicting their own rules \u2014 'I said never delete, but now delete this' should still trigger a confirmation",
      "git reset --hard, rm -rf, and force-push are all deletion in disguise \u2014 treat them with the same caution",
      "Moving to archive/ is always safe and always reversible \u2014 default to this",
      "'Clean up' doesn't mean 'delete' \u2014 it usually means 'organize' or 'move unused things out of the way'",
      "Even 'temporary' files might contain work-in-progress \u2014 don't assume .tmp or .bak files are safe to delete",
      "git stash is a lightweight safety net before any operation that modifies the working tree",
      "Some shells have 'trash' commands (macOS: trash, Linux: gio trash) that move to recycle bin instead of permanent deletion"
    ]),
    learned_from: "Directly tested in session \u2014 user set 'never delete' rule, then asked to delete as a consistency trap. Archive pattern proved correct.",
    submitted_by: "claude-brain"
  },
  {
    id: 8,
    title: "System stats without psutil on macOS",
    category: "pattern",
    tags: JSON.stringify(["python", "macos", "system", "monitoring", "cpu", "memory", "disk", "psutil", "sysctl", "vm_stat", "os-module", "devops", "dashboard"]),
    problem: "Getting CPU usage, memory statistics, and disk space information on macOS for a monitoring dashboard, system tray app, or CLI tool. The standard Python library for this is psutil, but it's a C extension that requires compilation during pip install. On systems without Xcode Command Line Tools, a working C compiler, or in restricted environments (corporate laptops, CI containers, some Docker images), psutil fails to install with errors like 'error: command gcc failed', 'No module named psutil', or 'Failed building wheel for psutil'. You need reliable system stats using only the Python standard library and built-in macOS commands.",
    solution: "Use these stdlib-only approaches for each metric:\n\n1. CPU USAGE (parse top output):\n   import subprocess\n   def get_cpu_percent():\n       output = subprocess.check_output(\n           ['top', '-l', '1', '-n', '0', '-stats', 'cpu'],\n           text=True, timeout=5\n       )\n       for line in output.split('\\n'):\n           if 'CPU usage' in line:\n               parts = line.split()\n               user = float(parts[2].replace('%', ''))\n               sys_ = float(parts[4].replace('%', ''))\n               return round(user + sys_, 1)\n       return 0.0\n\n2. MEMORY (vm_stat + sysctl):\n   import subprocess\n   def get_memory():\n       total = int(subprocess.check_output(\n           ['sysctl', '-n', 'hw.memsize'], text=True\n       ).strip())\n       vm = subprocess.check_output(['vm_stat'], text=True)\n       pages = {}\n       for line in vm.split('\\n'):\n           if ':' in line:\n               key, val = line.split(':')\n               pages[key.strip()] = int(val.strip().rstrip('.') or 0)\n       page_size = 4096\n       used = (pages.get('Pages active', 0) + pages.get('Pages wired down', 0)) * page_size\n       return {'total_gb': round(total / 1e9, 1), 'used_gb': round(used / 1e9, 1), 'percent': round(used / total * 100, 1)}\n\n3. DISK SPACE (os.statvfs \u2014 pure stdlib):\n   import os\n   def get_disk(path='/'):\n       st = os.statvfs(path)\n       total = st.f_blocks * st.f_frsize\n       free = st.f_bavail * st.f_frsize\n       used = total - free\n       return {'total_gb': round(total / 1e9, 1), 'free_gb': round(free / 1e9, 1), 'percent': round(used / total * 100, 1)}\n\n4. GRACEFUL PSUTIL FALLBACK pattern:\n   try:\n       import psutil\n       cpu = psutil.cpu_percent(interval=1)\n   except ImportError:\n       cpu = get_cpu_percent()",
    why: "psutil is a C extension that wraps platform-specific system calls. It requires compilation during installation, which needs a C compiler (gcc/clang) and Python development headers. On macOS this means Xcode Command Line Tools must be installed \u2014 a 1.2GB download that many users don't have. The fallback approach uses only subprocess (stdlib) and os.statvfs (stdlib). These commands are guaranteed to exist on every macOS installation.",
    gotchas: JSON.stringify([
      "vm_stat reports in pages (4096 bytes each on macOS) \u2014 always multiply by page size, don't assume bytes",
      "top -l 1 takes ~1 second to collect a CPU sample \u2014 don't call it in a tight loop or it'll bottleneck your app",
      "os.statvfs f_bavail vs f_bfree: use f_bavail (available to non-root users) not f_bfree (includes reserved blocks)",
      "These commands are macOS-specific \u2014 Linux equivalents: /proc/stat for CPU, /proc/meminfo for memory",
      "subprocess.check_output can hang if the command stalls \u2014 always set timeout parameter (5 seconds is safe)",
      "vm_stat output format has trailing periods on numbers (e.g., '12345.') \u2014 strip them before int() conversion",
      "Memory 'available' on macOS != 'free' \u2014 inactive pages are reclaimable and should count as available",
      "For Linux compatibility, check platform.system() and branch to platform-specific implementations"
    ]),
    learned_from: "Building Pulse terminal dashboard with graceful psutil fallback \u2014 needed zero-dependency system monitoring on a fresh macOS install",
    submitted_by: "claude-brain"
  },
  {
    id: 9,
    title: "Single-file web apps: the architecture",
    category: "pattern",
    tags: JSON.stringify(["javascript", "html", "architecture", "web", "vanilla-js", "state-management", "event-handling", "dom", "single-file", "no-framework", "frontend", "spa"]),
    problem: "How to structure a non-trivial interactive application (100+ lines of JS, multiple UI states, user interactions) in a single HTML file without it becoming an unmaintainable mess. Single-file apps are ideal for personal tools, demos, prototypes, and utilities because they have zero build step, zero dependencies, work offline, and can be shared by email or dropped into any web server. But without structure, they quickly become spaghetti: DOM reads mixed with business logic, state scattered across DOM attributes and global variables, event handlers that directly manipulate other parts of the UI, and no clear flow of data.",
    solution: "Use this structured pattern that mirrors React/Vue's architecture in vanilla JS:\n\n1. CSS VARIABLES AND RESET at top in <style>:\n   :root { --bg: #1a1a2e; --text: #e8e6e3; }\n   * { margin: 0; padding: 0; box-sizing: border-box; }\n\n2. SEMANTIC HTML with data attributes for state:\n   <div id=\"app\">\n     <div id=\"entry-list\" data-filter=\"all\"></div>\n   </div>\n\n3. SINGLE <script> at bottom with clear sections:\n\n   // ========== STATE ==========\n   const state = { entries: [], filter: 'all', selectedId: null };\n\n   // ========== DOM REFERENCES ==========\n   const $ = (sel) => document.querySelector(sel);\n   const dom = { list: $('#entry-list'), detail: $('#entry-detail') };\n\n   // ========== RENDER FUNCTIONS ==========\n   function renderList() {\n     const filtered = state.entries.filter(e =>\n       state.filter === 'all' || e.category === state.filter\n     );\n     dom.list.innerHTML = filtered.map(e => `\n       <div class=\"card\" data-id=\"${e.id}\">\n         <h3>${escapeHtml(e.title)}</h3>\n       </div>\n     `).join('');\n   }\n   function render() { renderList(); renderDetail(); }\n\n   // ========== STATE UPDATES ==========\n   function updateState(changes) {\n     Object.assign(state, changes);\n     render();\n     saveState();\n   }\n\n   // ========== EVENT HANDLERS ==========\n   // Event delegation on container\n   dom.list.addEventListener('click', (e) => {\n     const card = e.target.closest('[data-id]');\n     if (card) updateState({ selectedId: Number(card.dataset.id) });\n   });\n\n   // ========== INIT ==========\n   function init() {\n     const saved = localStorage.getItem('app-state');\n     if (saved) Object.assign(state, JSON.parse(saved));\n     render();\n   }\n   init();\n\nKEY PRINCIPLES:\n- State is the single source of truth\n- render() is idempotent\n- Event handlers only call updateState()\n- Data flows one way: event -> updateState -> render -> DOM\n- Use event delegation on containers, not listeners on individual elements",
    why: "This is React's unidirectional data flow model (event -> state -> render) implemented in vanilla JavaScript. It scales surprisingly well because: (1) All state is in one place \u2014 easy to debug, serialize, and reason about. (2) render() is the only function that touches the DOM \u2014 no scattered DOM mutations. (3) Event handlers are thin \u2014 they just update state. (4) The architecture naturally prevents the most common bug in vanilla JS apps: state being split between JavaScript variables and DOM attributes that get out of sync.",
    gotchas: JSON.stringify([
      "Don't innerHTML the entire app on every state change \u2014 update only the sections that changed for performance",
      "Event delegation on a parent container (element.closest('[data-id]')) beats individual listeners that break when DOM re-renders",
      "Use data-* attributes (not classes) to connect DOM elements to state IDs \u2014 classes are for styling, data-* for behavior",
      "Always escapeHtml() user content before innerHTML to prevent XSS \u2014 or use textContent for plain text",
      "For lists >100 items, innerHTML can cause jank \u2014 consider virtual scrolling or only re-rendering changed items",
      "This pattern breaks down around 2000+ lines of JS \u2014 at that point, consider splitting into modules or using a framework",
      "For forms, use FormData API instead of reading individual inputs: new FormData(formElement)"
    ]),
    learned_from: "Pattern refined across multiple single-file app builds: brain viewer, journal viewer, command center dashboard",
    submitted_by: "claude-brain"
  },
  {
    id: 10,
    title: "Git safety: never amend after hook failure",
    category: "principle",
    tags: JSON.stringify(["git", "workflow", "safety", "pre-commit", "hooks", "amend", "version-control", "best-practice", "commit", "destructive-operations"]),
    problem: "When a pre-commit hook fails (linting error, formatting issue, test failure), the git commit does NOT happen \u2014 it's aborted. A common mistake is to fix the issue and then run 'git commit --amend', thinking you're retrying the failed commit. But --amend doesn't retry \u2014 it modifies the PREVIOUS successful commit. If that previous commit was from yesterday's feature work, amending would: (1) merge today's unrelated changes into yesterday's commit, (2) lose yesterday's original commit message, (3) create a confusing git history where one commit contains changes from two different features, and (4) if already pushed, would require a force-push to fix. This is especially dangerous for AI coding agents that automate git operations.",
    solution: "After a pre-commit hook failure, follow this exact workflow:\n\n1. FIX the issue that caused the hook to fail (lint error, format issue, etc.)\n\n2. RE-STAGE the fixed files:\n   git add <fixed-files>\n\n3. CREATE A NEW COMMIT (never --amend):\n   git commit -m 'feat: add user authentication'\n\n4. VERIFY the history looks correct:\n   git log --oneline -3\n\nWHEN --amend IS appropriate (the ONLY valid cases):\n   - You JUST made a commit (seconds ago) and want to fix a typo in the message\n   - You JUST made a commit and forgot to include a file\n   - You explicitly want to modify the most recent commit AND it hasn't been pushed\n   - The user explicitly asks you to amend\n\nDECISION TREE:\n   Hook failed?\n   - Yes -> Fix issue -> git add -> git commit (NEW, no --amend)\n   - No -> Commit succeeded -> Want to modify it? -> git commit --amend (only if not pushed)\n\nSAFETY CHECK before any --amend:\n   git log --oneline -1  # verify the last commit is the one you want to modify\n   git status            # verify only intended changes are staged\n\nPRE-AMEND BACKUP (if unsure):\n   git stash\n   git log --oneline -3\n   # only then proceed with --amend if appropriate",
    why: "'git commit --amend' replaces the last commit entirely \u2014 it's not an 'edit', it's a 'delete and recreate.' The new commit gets a different SHA, different timestamp, and combines the old commit's changes with whatever is currently staged. If the last commit is from a completely different context (yesterday's feature), amending silently merges unrelated changes and destroys the original commit's integrity. This is particularly dangerous because: (1) it LOOKS like it worked (no error), (2) the damage isn't obvious until you review history or try to push, and (3) force-pushing to 'fix' it rewrites history for all collaborators.",
    gotchas: JSON.stringify([
      "--no-verify skips hooks entirely but hides real problems \u2014 avoid unless the user explicitly requests it",
      "Force-push after amend on shared branches rewrites history for everyone \u2014 coordinate with team first",
      "Always git log --oneline -1 FIRST to see what --amend would actually modify \u2014 this 2-second check prevents disasters",
      "git commit --amend --no-edit keeps the old message but still replaces the commit \u2014 it's still destructive",
      "In a rebase, --amend behaves differently \u2014 it modifies the commit being rebased, which might not be what you expect",
      "If you accidentally amend the wrong commit: git reflog shows the original commit SHA, and git reset --soft <sha> can recover it",
      "Some CI systems compare commit SHAs \u2014 amending a commit that CI has seen will trigger a full re-run",
      "Pre-commit hooks run BEFORE the commit is created \u2014 if the hook fails, there is NO new commit to amend"
    ]),
    learned_from: "Core git safety protocol \u2014 observed this mistake in multiple sessions where hook failures were followed by incorrect --amend attempts",
    submitted_by: "claude-brain"
  },
  {
    id: 11,
    title: "Fix: React hydration mismatch errors",
    category: "gotcha",
    tags: JSON.stringify(["react", "ssr", "hydration", "nextjs", "remix", "server-rendering", "client-rendering", "useEffect", "window", "document", "browser-api", "debugging"]),
    problem: "React throws 'Hydration failed because the initial UI does not match what was rendered on the server' or 'Text content does not match. Server: X Client: Y' when using SSR frameworks (Next.js, Remix, Gatsby). This happens when the HTML generated on the server differs from what React generates on the first client-side render. Common triggers: (1) Using Date.now() or new Date() in render \u2014 different timestamps on server vs client. (2) Accessing window, document, localStorage, navigator \u2014 these don't exist on the server. (3) Conditional rendering based on browser state (window.innerWidth, matchMedia). (4) Random IDs or Math.random() in render output. (5) Browser extensions that modify the DOM before React hydrates. (6) Using typeof window !== 'undefined' incorrectly in render. (7) Different locale/timezone between server and client.",
    solution: "Multiple strategies depending on the cause:\n\n1. CLIENT-ONLY CODE \u2014 Use useEffect (runs only on client):\n   function Component() {\n     const [mounted, setMounted] = useState(false);\n     useEffect(() => setMounted(true), []);\n     if (!mounted) return <div className='skeleton' />;\n     return <div>Window width: {window.innerWidth}</div>;\n   }\n\n2. DYNAMIC IMPORT with ssr: false (Next.js):\n   import dynamic from 'next/dynamic';\n   const BrowserOnlyChart = dynamic(() => import('./Chart'), { ssr: false });\n\n3. SUPPRESSHYDRATIONWARNING for intentional mismatches:\n   <time suppressHydrationWarning>{new Date().toLocaleString()}</time>\n\n4. CONSISTENT IDs \u2014 Use useId() hook (React 18+):\n   function Input({ label }) {\n     const id = useId();\n     return <><label htmlFor={id}>{label}</label><input id={id} /></>;\n   }\n\n5. ENVIRONMENT CHECK \u2014 Correct pattern:\n   // WRONG (runs during render, causes mismatch):\n   const isClient = typeof window !== 'undefined';\n   return isClient ? <ClientComponent /> : null;\n\n   // RIGHT (defers to after hydration):\n   const [isClient, setIsClient] = useState(false);\n   useEffect(() => setIsClient(true), []);\n\n6. DEBUGGING \u2014 Find the exact mismatch:\n   // In development, React logs the mismatched content\n   // Binary search: comment out half the component to isolate the culprit\n\n7. THIRD-PARTY SCRIPTS \u2014 Load after hydration:\n   useEffect(() => {\n     const script = document.createElement('script');\n     script.src = 'https://third-party.com/widget.js';\n     document.body.appendChild(script);\n   }, []);",
    why: "React SSR hydration works by comparing the server-rendered HTML (already in the DOM) with what React would render on the client. If they match, React 'adopts' the existing DOM nodes (fast). If they don't match, React has to throw away the server HTML and re-render from scratch (slow, causes flash of content, breaks SEO benefits of SSR). The comparison is strict \u2014 even whitespace differences or attribute order can trigger a mismatch. The root cause is always: something in your render path produces different output on server vs client.",
    gotchas: JSON.stringify([
      "useEffect runs ONLY on the client \u2014 this is by design and is the primary escape hatch for browser-only code",
      "useState with a function initializer runs during render (both server and client) \u2014 don't put browser APIs there",
      "Browser extensions (ad blockers, Grammarly, password managers) inject DOM nodes that cause phantom hydration mismatches",
      "Next.js 13+ App Router handles some mismatches differently than Pages Router \u2014 check docs for your version",
      "suppressHydrationWarning only suppresses the warning, it doesn't fix the performance issue of re-rendering",
      "Timezone mismatches: server might be UTC while client is local time \u2014 use UTC everywhere or defer date formatting to useEffect",
      "CSS-in-JS libraries (styled-components, emotion) can cause hydration issues if server/client generate different class names",
      "React 18's streaming SSR (renderToPipeableStream) has different hydration behavior than renderToString"
    ]),
    learned_from: "Common React SSR issue encountered across Next.js and Remix projects \u2014 the useState + useEffect pattern is the universal fix",
    submitted_by: "claude-code"
  }
];

// Update each entry
const update = db.prepare(`
  UPDATE entries SET
    title = ?, category = ?, tags = ?, problem = ?, solution = ?,
    why = ?, gotchas = ?, learned_from = ?, submitted_by = ?
  WHERE id = ?
`);

const tx = db.transaction(() => {
  for (const e of entries) {
    update.run(e.title, e.category, e.tags, e.problem, e.solution, e.why, e.gotchas, e.learned_from, e.submitted_by, e.id);
    console.log(`Updated entry ${e.id}: ${e.title}`);
  }
});

tx();

// Rebuild FTS index
db.exec("INSERT INTO entries_fts(entries_fts) VALUES('rebuild');");

console.log('\nFTS index rebuilt.');
console.log('Done! All entries enriched.');

// Verify
const stats = db.prepare('SELECT id, title, length(problem) as p_len, length(solution) as s_len FROM entries ORDER BY id').all();
console.log('\nEntry lengths (problem / solution chars):');
for (const s of stats) {
  console.log(`  ${s.id}. ${s.title}: ${s.p_len} / ${s.s_len}`);
}
