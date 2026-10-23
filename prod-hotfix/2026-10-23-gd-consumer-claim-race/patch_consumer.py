"""patch_consumer.py: GD_PICKING_OUTBOX_CONSUMER poll mode (no event_id) skips an event whose row changed in the last 60 s.

Prod incident 2026-10-23 (836238, JO-01122): a V2 save's targeted consumer run and the GD list page's poll-mode kick claimed
the same READY event 5 ms apart; the second claim insert hit gd_event_consumption's unique key, the run crashed and the
list showed the platform's error toast (the data was fine: the first run consumed the event). The save's targeted run
handles a fresh event within seconds, so poll mode now leaves an event alone for 60 s after its last change (READY, or a
dead claim). update_time is the platform's UTC+8 time on dev and prod; UTC_TIMESTAMP() + 8 h reads the same clock whatever
the session's time zone (dev sessions run UTC+8, prod's UTC). Were update_time ever UTC, the condition is always true:
the old behaviour.

python3 patch_consumer.py <in.json> <out.json>: one exact, counted replacement; refuses on any mismatch."""
import json
import sys

src, dst = sys.argv[1:3]
raw = open(src).read()
esc = lambda t: json.dumps(t, ensure_ascii=False)[1:-1]
old = ("            AND (o.next_attempt_at IS NULL OR o.next_attempt_at <= NOW(3))\n"
       "            AND g.gd_status IN ('Created', 'Completed', 'Cancelled')\n")
new = ("            AND (o.next_attempt_at IS NULL OR o.next_attempt_at <= NOW(3))\n"
       "            AND o.update_time <= DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 8 HOUR) - INTERVAL 60 SECOND\n"
       "            AND g.gd_status IN ('Created', 'Completed', 'Cancelled')\n")
k = raw.count(esc(old))
assert k == 1, "%d matches (want 1)" % k
raw = raw.replace(esc(old), esc(new))
json.loads(raw)
open(dst, "w").write(raw)
print("patched ->", dst)
