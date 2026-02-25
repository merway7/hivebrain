#!/bin/bash
# Kill ALL stale hivebrain astro dev servers (any port)
pkill -f "hivebrain.*astro dev" 2>/dev/null
# Also kill anything specifically on port 4321
/usr/sbin/lsof -ti:4321 | xargs kill -9 2>/dev/null
sleep 1
cd /Users/merwanito/local_AI/hivebrain
exec /usr/local/bin/node node_modules/.bin/astro dev --port 4321
