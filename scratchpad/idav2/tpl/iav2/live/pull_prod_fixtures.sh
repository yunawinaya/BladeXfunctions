#!/bin/bash
# Package E - read-only re-pull of every PROD capture the kit uses, into ialib.PROD_FIXTURES (outside any git repo; controller rule
# 2026-10-19: prod business data never in the repo working tree). SELECTs through .dbtools/db only; nothing else is written.
#   bash scratchpad/iav2/live/pull_prod_fixtures.sh [--until YYYY-MM-DDTHH:MM (MYT)]
# Writes <PROD_FIXTURES>/rules.json (both environments' inventory number rules), prod_ia.jsonl (the recorded classic IA_SAVE runs +
# their SUBTRACT / ADD child calls since 2026-09-26), prod_ia.db.jsonl (the rows those calls inserted), WINDOW.txt.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
PF=$(python3 -c "import sys; sys.dont_write_bytecode = True; sys.path.insert(0, sys.argv[1]); import ialib; print(ialib.PROD_FIXTURES)" "$HERE")
UNTIL=""
[ "${1:-}" = "--until" ] && UNTIL=$2
[ -n "$UNTIL" ] || UNTIL=$(python3 -c "import datetime as d; print((d.datetime.now(d.timezone(d.timedelta(hours=8))) - d.timedelta(minutes=5)).strftime('%Y-%m-%dT%H:%M'))")
mkdir -p "$PF"
case "$(cd "$PF" && pwd -P)/" in /Users/yunawinaya/Developer/*) echo "refusing: $PF is inside a working tree" >&2; exit 1 ;; esac
echo "prod fetched up to $UNTIL MYT on $(date '+%Y-%m-%d %H:%M')" > "$PF/WINDOW.txt"
python3 "$HERE/fetch_rules_ia.py" "$PF/rules.json"
python3 "$HERE/fetch_runs_ia.py" --prod "$PF/prod_ia.jsonl" --since 2026-09-26 --until "$UNTIL"
python3 "$HERE/fetch_db_rows_ia.py" --prod "$PF/prod_ia.jsonl" "$PF/prod_ia.db.jsonl"
ls -la "$PF"
