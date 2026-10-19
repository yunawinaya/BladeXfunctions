"""For each recorded classic child call of an SA run, read (read-only) the rows it INSERTED that its trace does not record:
the inventory_movement row (SUBTRACT's add_node_y4X550kY is never traced; ADD's add_node_3wRWQCyv is), the FIFO layer
(ADD add_node_EhU9u6SS) and a new WA row (ADD add_node_8hvXwe5E batch / add_node_LXpxWdyr). Rows are found by snowflake id
inside the call's own window (PK range only) plus tenant + material. Output: one line per call {id, movements, fifo, wa}
for replay_sa.js --db.
Copied from scratchpad/sav2/tpl/smv2/parity/fetch_db_rows.py; SA changes: reads the nested SA fixture (calls inside each
run), a 100 ms slack (consecutive calls of one run are ~50 ms apart; replay_sa.js still matches by key + quantity),
wa_costing_method.created_at as text, and each item's CURRENT base UOM (item_now: tells a movement row restated after a
later base-UOM change of the item master from an engine difference).

usage: python3 fetch_db_rows.py <--prod|--dev> <sa_fixture.jsonl> <out.jsonl>
"""
import json, os, sys

sys.dont_write_bytecode = True  # no __pycache__ in the repo folder
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dbq import q  # noqa: E402

EPOCH = 1288834974657
SLACK_MS = 100
DIG = set("0123456789")
MV_COLS = ("CAST(id AS CHAR) id, movement, transaction_type, trx_no, parent_trx_no, inventory_category, CAST(plant_id AS CHAR) plant_id, organization_id, "
           "CAST(unit_price AS CHAR) unit_price, CAST(total_price AS CHAR) total_price, CAST(quantity AS CHAR) quantity, CAST(base_qty AS CHAR) base_qty, "
           "CAST(uom_id AS CHAR) uom_id, CAST(base_uom_id AS CHAR) base_uom_id, CAST(item_id AS CHAR) item_id, CAST(bin_location_id AS CHAR) bin_location_id, "
           "CAST(batch_number_id AS CHAR) batch_number_id, costing_method_id, DATE_FORMAT(manufacturing_date, '%Y-%m-%d %H:%i:%s') manufacturing_date, "
           "DATE_FORMAT(expired_date, '%Y-%m-%d %H:%i:%s') expired_date, DATE_FORMAT(doc_date, '%Y-%m-%d %H:%i:%s') doc_date, CAST(actual_qty AS CHAR) actual_qty, "
           "CAST(actual_base_qty AS CHAR) actual_base_qty, CAST(handling_unit_id AS CHAR) handling_unit_id, is_deleted, "
           "DATE_FORMAT(create_time, '%Y-%m-%d %H:%i:%s.%f') create_time, DATE_FORMAT(update_time, '%Y-%m-%d %H:%i:%s.%f') update_time")
FIFO_COLS = ("CAST(id AS CHAR) id, CAST(material_id AS CHAR) material_id, CAST(plant_id AS CHAR) plant_id, CAST(batch_id AS CHAR) batch_id, fifo_sequence, "
             "CAST(fifo_cost_price AS CHAR) fifo_cost_price, CAST(fifo_initial_quantity AS CHAR) fifo_initial_quantity, is_deleted")
WA_COLS = ("CAST(id AS CHAR) id, CAST(material_id AS CHAR) material_id, CAST(plant_id AS CHAR) plant_id, CAST(batch_id AS CHAR) batch_id, "
           "CAST(wa_cost_price AS CHAR) wa_cost_price, CAST(wa_quantity AS CHAR) wa_quantity, CAST(created_at AS CHAR) created_at, is_deleted, "
           "DATE_FORMAT(create_time, '%Y-%m-%d %H:%i:%s.%f') create_time, DATE_FORMAT(update_time, '%Y-%m-%d %H:%i:%s.%f') update_time")


def digits(v):
    v = "" if v is None else str(v)
    if not v or not set(v) <= DIG:
        raise ValueError("not an id: " + v)
    return v


def main():
    env, src, dst = sys.argv[1], sys.argv[2], sys.argv[3]
    calls = []
    for line in open(src):
        run = json.loads(line)
        calls += [c for c in run["calls"] if c["status"] == "Complete" and c["params"].get("material_id")]
    found = {c["id"]: {"id": c["id"], "movements": [], "fifo": [], "wa": []} for c in calls}
    for i in range(0, len(calls), 40):
        part = calls[i:i + 40]
        conds = {}
        for c in part:
            lo = (int(c["t0"]) - SLACK_MS - EPOCH) << 22
            hi = (int(c["t1"]) + SLACK_MS - EPOCH) << 22
            conds[c["id"]] = (lo, hi, digits(c["tenant"]), digits(c["params"]["material_id"]))
        for table, cols, mat in (("inventory_movement", MV_COLS, "item_id"), ("fifo_costing_history", FIFO_COLS, "material_id"), ("wa_costing_method", WA_COLS, "material_id")):
            where = " OR ".join(f"(id BETWEEN {lo} AND {hi} AND tenant_id='{t}' AND {mat}={m})" for lo, hi, t, m in conds.values())
            rows = q(env, f"SELECT {cols}, CAST(tenant_id AS CHAR) tenant_id FROM {table} WHERE {where}")
            key = "movements" if table == "inventory_movement" else "fifo" if table == "fifo_costing_history" else "wa"
            for row in rows:
                for cid, (lo, hi, t, m) in conds.items():
                    if lo <= int(row["id"]) <= hi and row["tenant_id"] == t and row.get(mat) == m:
                        found[cid][key].append(row)
    mats = sorted({(digits(c["tenant"]), digits(c["params"]["material_id"])) for c in calls})
    now = {}
    for i in range(0, len(mats), 200):
        part = mats[i:i + 200]
        for row in q(env, "SELECT CAST(id AS CHAR) id, tenant_id, CAST(based_uom AS CHAR) based_uom, material_costing_method FROM item WHERE "
                          + " OR ".join(f"(id={m} AND tenant_id='{t}')" for t, m in part)):
            now[(row["tenant_id"], row["id"])] = {"based_uom": row["based_uom"], "material_costing_method": row["material_costing_method"]}
    for c in calls:
        found[c["id"]]["item_now"] = now.get((c["tenant"], str(c["params"]["material_id"])))
    with open(dst, "w") as fh:
        for c in calls:
            fh.write(json.dumps(found[c["id"]], ensure_ascii=False) + "\n")
    print(f"{len(calls)} calls -> {dst}: " + ", ".join(f"{k} {sum(len(x[k]) for x in found.values())}" for k in ("movements", "fifo", "wa")))


if __name__ == "__main__":
    main()
