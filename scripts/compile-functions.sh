#!/bin/sh
# Compile each Edge Function bundle (npm run functions:bundle) into one JS file for
# deploy_edge_function. The 24-file bundles are about 140 KB each, too large to send inline in
# one MCP call; this is the same code with comments and whitespace gone, supabase-js left as an
# import. deploy_edge_function takes supabase/.bundle-min/<fn>/index.js as the entrypoint and
# its deno.json as the import map, verify_jwt false (docs/DEPLOY.md).
set -e
cd "$(dirname "$0")/.."
# Every function the bundler wrote, so a new one is never left out.
for B in "$PWD"/supabase/.bundle/*/; do
  B="${B%/}"
  fn="$(basename "$B")"
  O="supabase/.bundle-min/$fn"
  mkdir -p "$O"
  npx -y esbuild "$B/index.ts" --bundle --format=esm --platform=neutral --target=esnext \
    --minify-whitespace --minify-syntax --external:@supabase/supabase-js --external:@anthropic-ai/sdk \
    "--alias:@rosterbots/core=$B/_shared/core/index.ts" \
    "--alias:@rosterbots/connectors=$B/_shared/connectors/index.ts" \
    "--alias:@rosterbots/football-data=$B/_shared/football-data/index.ts" \
    "--alias:@rosterbots/service=$B/_shared/service/index.ts" \
    "--alias:@rosterbots/ai=$B/_shared/ai/index.ts" \
    --outfile="$O/index.js" --log-level=warning
  printf '{\n  "imports": { "@supabase/supabase-js": "npm:@supabase/supabase-js@2", "@anthropic-ai/sdk": "npm:@anthropic-ai/sdk@1.3.0" },\n  "lock": false\n}\n' > "$O/deno.json"
  printf '%-17s %6s bytes\n' "$fn" "$(wc -c < "$O/index.js")"
done
