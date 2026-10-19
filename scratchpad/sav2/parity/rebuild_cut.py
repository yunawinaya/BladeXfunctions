"""Refill the FIFO / WA search reads that a child call's trace cut (response_is_writer_file: an empty list under the real
total) from the database, read-only, and write a copy of the SA fixture with every run (cut costing reads refilled where
possible). Copied from scratchpad/sav2/tpl/smv2/parity/rebuild_cut.py; SA change: walks the nested fixture (calls inside
each SA run) and also refills the ADD's FIFO / WA reads.

usage: python3 rebuild_cut.py <--prod|--dev> <in.jsonl> <out.jsonl>
A row counts as read by the call when it was created before the call started (snowflake id < call start) and is not
deleted now; the rebuild is kept only when that count equals the total the call recorded (else the call stays cut and
replay_sa.js skips it). fifo_sequence / batch_id / fifo_cost_price never change after insert; fifo_available_quantity and
wa_quantity are TODAY's values (not what the call saw), so a rebuilt read is good for the FIFO sequence and the WA row
choice, not for a FIFO consumption or a WA quantity - replay_sa.js flags every case that ran on a rebuilt read.
The prod / dev SA fixtures of 2026-10-16 hold no cut read (0 of 369 calls).
"""
import json, os, sys

sys.dont_write_bytecode = True  # no __pycache__ in the repo folder
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dbq import q  # noqa: E402

EPOCH = 1288834974657
FIFO_ALL = {"search_node_tu6khdXJ", "search_node_L50IlXls", "search_node_p2K6C5AB"}  # material + plant + org, every batch
FIFO_BATCH = {"search_node_iUYUmyOO", "search_node_7tT1rozD"}
WA_ALL = {"search_node_sE4TyFdE", "search_node_FGjULf7c", "search_node_7YQdabsq"}
WA_BATCH = {"search_node_IXHaVq9k"}
DIG = set("0123456789")


def digits(v):
    v = "" if v is None else str(v)
    if not v or not set(v) <= DIG:
        raise ValueError("not an id: " + v)
    return v


def rebuild_call(env, rec):
    """refill rec's cut costing reads in place; True when every cut read was rebuilt"""
    cut = [nid for nid, n in rec["nodes"].items() if n.get("cut") and nid in FIFO_ALL | FIFO_BATCH | WA_ALL | WA_BATCH]
    p = rec["params"]
    ok = True
    for nid in cut:
        n = rec["nodes"][nid]
        total = int((((n.get("resp") or {}).get("data") or {}).get("total")) or 0)
        bound = (int(rec["t0"]) - EPOCH) << 22
        if nid in FIFO_ALL | FIFO_BATCH:
            table, cols = "fifo_costing_history", ("CAST(id AS CHAR) id, CAST(batch_id AS CHAR) batch_id, fifo_sequence, CAST(fifo_cost_price AS CHAR) fifo_cost_price, "
                                                  "CAST(fifo_initial_quantity AS CHAR) fifo_initial_quantity, CAST(fifo_available_quantity AS CHAR) fifo_available_quantity")
        else:
            table, cols = "wa_costing_method", "CAST(id AS CHAR) id, CAST(batch_id AS CHAR) batch_id, CAST(wa_cost_price AS CHAR) wa_cost_price, CAST(wa_quantity AS CHAR) wa_quantity, created_at"
        where = (f"tenant_id='{digits(rec['tenant'])}' AND is_deleted=0 AND id < {bound} AND material_id={digits(p.get('material_id'))} "
                 f"AND plant_id={digits(p.get('plant_id'))} AND organization_id='{digits(p.get('organization_id'))}'")
        if nid in FIFO_BATCH | WA_BATCH:
            batch = p.get("batch_id") or (((rec["nodes"].get("code_node_GMSJTmJr") or {}).get("resp") or {}).get("data") or {}).get("batchId")
            where += f" AND batch_id={digits(batch)}"
        rows = q(env, f"SELECT {cols} FROM {table} WHERE {where} ORDER BY id")
        for r in rows:
            for k in list(r):
                if r[k] is None:
                    del r[k]  # the trace drops null keys
                elif k in ("fifo_cost_price", "fifo_initial_quantity", "fifo_available_quantity", "wa_cost_price", "wa_quantity"):
                    r[k] = float(r[k])
                elif k == "created_at":
                    r[k] = str(r[k])
        if len(rows) != total:
            ok = False
            print(f"{rec['id']} {nid}: rebuilt {len(rows)} rows, the call read {total} - left cut")
            continue
        n["resp"]["data"]["data"] = rows
        n["cut"] = False
        n["rebuilt"] = True
    return ok if cut else None


def main():
    env, src, dst = sys.argv[1], sys.argv[2], sys.argv[3]
    runs = cut_calls = rebuilt = failed = 0
    with open(dst, "w") as fh:
        for line in open(src):
            run = json.loads(line)
            for rec in run["calls"]:
                got = rebuild_call(env, rec)
                if got is None:
                    continue
                cut_calls += 1
                rebuilt += got
                failed += not got
            fh.write(json.dumps(run, ensure_ascii=False) + "\n")
            runs += 1
    print(f"{runs} SA runs, {cut_calls} calls with a cut costing read: {rebuilt} rebuilt, {failed} left cut -> {dst}")


if __name__ == "__main__":
    main()
