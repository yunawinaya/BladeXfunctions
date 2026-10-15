"""For each recorded run, read (read-only) the rows it INSERTED that its trace does not record: the inventory_movement row
(SUBTRACT's add-node is never traced), the FIFO layer and a new WA row (ADD). Rows are found by snowflake id inside the
run's own time window (PK range only) plus tenant + material. Output: one line per run {id, movements, fifo, wa} for
replay_old.js --db.

usage: python3 fetch_db_rows.py <--prod|--dev> <fixture.jsonl> <out.jsonl>
"""
import json, os, sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "gdc", "pkv2tools"))
from dbq import q  # noqa: E402

EPOCH = 1288834974657
SLACK_MS = 500
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
           "CAST(wa_cost_price AS CHAR) wa_cost_price, CAST(wa_quantity AS CHAR) wa_quantity, created_at, is_deleted, "
           "DATE_FORMAT(create_time, '%Y-%m-%d %H:%i:%s.%f') create_time, DATE_FORMAT(update_time, '%Y-%m-%d %H:%i:%s.%f') update_time")


def digits(v):
    v = "" if v is None else str(v)
    if not v or not set(v) <= DIG:
        raise ValueError("not an id: " + v)
    return v


def main():
    env, src, dst = sys.argv[1], sys.argv[2], sys.argv[3]
    runs = [json.loads(l) for l in open(src)]
    runs = [r for r in runs if r["status"] == "Complete" and r["params"].get("material_id")]
    found = {r["id"]: {"id": r["id"], "movements": [], "fifo": [], "wa": []} for r in runs}
    for i in range(0, len(runs), 40):
        part = runs[i:i + 40]
        conds = {}
        for r in part:
            lo = (int(r["t0"]) - SLACK_MS - EPOCH) << 22
            hi = (int(r["t1"]) + SLACK_MS - EPOCH) << 22
            conds[r["id"]] = (lo, hi, digits(r["tenant"]), digits(r["params"]["material_id"]))
        for table, cols, mat in (("inventory_movement", MV_COLS, "item_id"), ("fifo_costing_history", FIFO_COLS, "material_id"), ("wa_costing_method", WA_COLS, "material_id")):
            where = " OR ".join(f"(id BETWEEN {lo} AND {hi} AND tenant_id='{t}' AND {mat}={m})" for lo, hi, t, m in conds.values())
            rows = q(env, f"SELECT {cols}, CAST(tenant_id AS CHAR) tenant_id FROM {table} WHERE {where}")
            key = "movements" if table == "inventory_movement" else "fifo" if table == "fifo_costing_history" else "wa"
            for row in rows:
                for rid, (lo, hi, t, m) in conds.items():
                    if lo <= int(row["id"]) <= hi and row["tenant_id"] == t and row.get(mat) == m:
                        found[rid][key].append({k: (str(v) if k == "created_at" and v is not None else v) for k, v in row.items()})
    with open(dst, "w") as fh:
        for r in runs:
            fh.write(json.dumps(found[r["id"]], ensure_ascii=False) + "\n")
    print(f"{len(runs)} runs -> {dst}: " + ", ".join(f"{k} {sum(len(x[k]) for x in found.values())}" for k in ("movements", "fifo", "wa")))


if __name__ == "__main__":
    main()
