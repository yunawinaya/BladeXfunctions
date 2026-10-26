"""patch_worker.py <base.json> <out.json>: PICKING_ASYNC_WORKER's poll, one exact raw-text replacement (the file's own formatting
kept). An id-less run (a Picking list open) leaves a job to its own kick for its first 10 s, and for 10 s after a retry comes
due: two runs claiming one job at once crash the loser at add_node_PWclaim (LSH 10-26 07:22 x2, 07:28), and that crash can reach
the user as an error toast. Same rule as GD_ASYNC_WORKER's pick (C) and the consumer's v14 poll skip.
create_time is the platform's MYT clock (UTC_TIMESTAMP + 8 h on any session); next_attempt_at is written from the session's
NOW(3), as the poll's other conditions already compare it."""
import json
import sys

base, out = sys.argv[1:3]
t = open(base, encoding="utf-8").read()
w = json.loads(t)


def find(o, nid):
    if isinstance(o, dict):
        if o.get("id") == nid:
            return o
        for v in o.values():
            r = find(v, nid)
            if r:
                return r
    elif isinstance(o, list):
        for v in o:
            r = find(v, nid)
            if r:
                return r


sql = find(w, "sql_node_PWpoll")["data"]["script"]["code"]
anchor = """                AND (c.id IS NULL OR c.started_at <= NOW(3) - INTERVAL 10 MINUTE)
              ORDER BY j.create_time, j.id"""
add = """                AND (c.id IS NULL OR c.started_at <= NOW(3) - INTERVAL 10 MINUTE)
                -- an id-less run leaves a job to its own kick for its first 10 s and for 10 s after it comes due (twin claims)
                AND ({{node:code_node_PWguard.data.jobId}} <> 0
                     OR (j.create_time <= DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 8 HOUR) - INTERVAL 10 SECOND
                         AND (j.next_attempt_at IS NULL OR j.next_attempt_at <= NOW(3) - INTERVAL 10 SECOND)))
              ORDER BY j.create_time, j.id"""
assert sql.count(anchor) == 1
new = sql.replace(anchor, add)
old_esc, new_esc = json.dumps(sql, ensure_ascii=False)[1:-1], json.dumps(new, ensure_ascii=False)[1:-1]
assert t.count(old_esc) == 1
t = t.replace(old_esc, new_esc)
json.loads(t)
open(out, "w", encoding="utf-8").write(t)
print("patched ->", out)
