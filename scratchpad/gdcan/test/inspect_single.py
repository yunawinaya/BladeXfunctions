"""inspect_single.py <before.json> <after.json>: one GD's cancel (snap.py before / after) table by table: each changed column as
before -> after with a row count (quantities summed as deltas), new rows and removed rows, so a single V2 run can be read against what
the cancel should do without a twin."""
import json
import sys
from collections import Counter
from decimal import Decimal

B, A = [json.load(open(p)) for p in sys.argv[1:3]]
SKIP = {"update_time", "update_user", "create_time", "create_user", "create_dept"}
QTY = {"balance_quantity", "reserved_qty", "unrestricted_qty", "block_qty", "qualityinsp_qty", "intransit_qty", "fifo_available_quantity",
       "wa_quantity", "delivered_qty", "planned_qty", "outstanding_quantity", "open_qty", "pending_process_qty", "remaining_qty",
       "total_quantity", "item_count", "quantity"}
SHOW_NEW = {"res": ["doc_type", "status", "open_qty", "reserved_qty", "parent_line_id", "target_gd_id", "source_reserved_id"],
            "mv": ["transaction_type", "movement", "inventory_category", "quantity", "base_qty", "trx_no", "bin_location_id", "handling_unit_id"]}


def num(v):
    try:
        return Decimal(str(v)).normalize()
    except Exception:
        return None


def short(v):
    s = "" if v is None else str(v)
    return s if len(s) <= 60 else s[:57] + "..."


tables = [t for t in B if isinstance(B[t], list) and t not in ("job", "step")]
for t in tables:
    bi = {r["id"]: r for r in B.get(t, [])}
    ai = {r["id"]: r for r in A.get(t, [])}
    changes, sums = Counter(), {}
    for i in bi.keys() & ai.keys():
        for k in set(bi[i]) | set(ai[i]):
            if k in SKIP:
                continue
            x, y = bi[i].get(k), ai[i].get(k)
            if x in (None, "") and y in (None, ""):
                continue
            nx, ny = num(x), num(y)
            if nx is not None and ny is not None:
                if nx == ny:
                    continue
                if k in QTY:
                    sums.setdefault(k, [Decimal(0), 0])
                    sums[k][0] += ny - nx
                    sums[k][1] += 1
                    continue
            elif x == y:
                continue
            changes[(k, short(x), short(y))] += 1
    new = [ai[i] for i in ai if i not in bi]
    gone = [bi[i] for i in bi if i not in ai]
    if not changes and not sums and not new and not gone:
        print(f"{t:5s} {len(bi)} rows, unchanged")
        continue
    print(f"{t:5s} {len(bi)} -> {len(ai)} rows")
    for k, (d, n) in sorted(sums.items()):
        print(f"      {k}: {n} row(s), sum delta {d.normalize()}")
    for (k, x, y), n in sorted(changes.items(), key=lambda e: (e[0][0], -e[1])):
        if k in ("delivery_no",) or t in ("gd", "res", "pkh", "ph", "so") or n > 0:
            print(f"      {k}: {x!r} -> {y!r}  x{n}")
    for r in new:
        cols = SHOW_NEW.get(t)
        print("      + new", {c: r.get(c) for c in cols} if cols else short(json.dumps({k: v for k, v in r.items() if v not in (None, "") and k not in SKIP}, default=str)))
    for r in gone:
        print("      - gone", r["id"])
job = A.get("job", [])
for j in job:
    print("job", j["id"], j.get("job_status"), j.get("error_code") or "", short(j.get("progress_message")))
print("steps", ", ".join(s["step_name"] + ("" if s["step_status"] == "DONE" else "(" + s["step_status"] + ")") for s in A.get("step", [])))
