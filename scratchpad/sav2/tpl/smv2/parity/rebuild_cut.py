"""Refill FIFO / WA search reads that the trace cut (response_is_writer_file: an empty list under the real total) from the
database, read-only, and write a copy of the fixture file with every run (cut costing reads refilled where possible).

usage: python3 rebuild_cut.py <--prod|--dev> <in.jsonl> <out.jsonl>
A row counts as read by the run when it was created before the run started (snowflake id < run start) and is not deleted
now; the rebuild is kept only when that count equals the total the run recorded (else the run stays cut).
fifo_sequence / batch_id / fifo_cost_price never change after insert; fifo_available_quantity is today's value (not what
the run saw), so a rebuilt read is good for the FIFO sequence and the WA row choice, not for a FIFO consumption price.
"""
import json, os, sys

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


def main():
    env, src, dst = sys.argv[1], sys.argv[2], sys.argv[3]
    kept = rebuilt = failed = 0
    with open(dst, "w") as fh:
        for line in open(src):
            rec = json.loads(line)
            cut = [nid for nid, n in rec["nodes"].items() if n.get("cut") and nid in FIFO_ALL | FIFO_BATCH | WA_ALL | WA_BATCH]
            if not cut:
                fh.write(line if line.endswith("\n") else line + "\n")
                continue
            p = rec["params"]
            ok = True
            for nid in cut:
                n = rec["nodes"][nid]
                total = int(((n.get("resp") or {}).get("data") or {}).get("total") or 0)
                bound = (int(rec["t0"]) - EPOCH) << 22
                table, cols = ("fifo_costing_history", "CAST(id AS CHAR) id, CAST(batch_id AS CHAR) batch_id, fifo_sequence, CAST(fifo_cost_price AS CHAR) fifo_cost_price, "
                               "CAST(fifo_initial_quantity AS CHAR) fifo_initial_quantity, CAST(fifo_available_quantity AS CHAR) fifo_available_quantity") if nid in FIFO_ALL | FIFO_BATCH else \
                              ("wa_costing_method", "CAST(id AS CHAR) id, CAST(batch_id AS CHAR) batch_id, CAST(wa_cost_price AS CHAR) wa_cost_price, CAST(wa_quantity AS CHAR) wa_quantity, created_at")
                where = f"tenant_id='{digits(rec['tenant'])}' AND is_deleted=0 AND id < {bound} AND material_id={digits(p.get('material_id'))} AND plant_id={digits(p.get('plant_id'))} AND organization_id='{digits(p.get('organization_id'))}'"
                if nid in FIFO_BATCH | WA_BATCH:
                    where += f" AND batch_id={digits(p.get('batch_id') or (rec['nodes'].get('code_node_GMSJTmJr', {}).get('resp') or {}).get('data', {}).get('batchId'))}"
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
                    print(f"{rec['id']} {nid}: rebuilt {len(rows)} rows, the run read {total} - left cut")
                    continue
                n["resp"]["data"]["data"] = rows
                n["cut"] = False
                n["rebuilt"] = True
            rebuilt += ok
            failed += not ok
            fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
            kept += 1
    print(f"{kept} runs with a cut costing read: {rebuilt} rebuilt, {failed} left cut; every run -> {dst}")


if __name__ == "__main__":
    main()
