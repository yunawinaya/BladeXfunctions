"""snap_create.py <tenant> <so_id> <since_id> <out.json>: every row a GD Created V2 conversion of one SO can touch, read-only
(dev): the SO and its lines, the reservations of its lines, the GDs made from it since <since_id> with their lines, the
movements under their numbers, their Pickings, balances / FIFO / WA / items of the SO's materials at its plant, and the
CREATE_GD_FROM_FORM jobs of the SO with their steps, stock operations, effects and the locks those operations still hold."""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "pkv2tools"))
from dbq import q  # noqa: E402

tenant, so, since, out = sys.argv[1:5]
assert tenant.isdigit() and so.isdigit() and since.isdigit()
T = f"tenant_id = '{tenant}'"
hdr = q("--dev", f"SELECT * FROM sales_order WHERE {T} AND id = {so}")
assert len(hdr) == 1, "SO not found"
plant, so_no = str(hdr[0]["plant_name"]), hdr[0]["so_no"]
esc = lambda s: str(s).replace("\\", "\\\\").replace("'", "''")
sol = q("--dev", f"SELECT * FROM sales_order_axszx8cj_sub WHERE {T} AND sales_order_id = {so} ORDER BY id")
LINES = ",".join(f"'{r['id']}'" for r in sol) or "''"
MATS = ",".join(str(int(r["item_name"])) for r in sol if str(r.get("item_name") or "").isdigit()) or "0"
gd = q("--dev", f"SELECT * FROM goods_delivery WHERE {T} AND id > {since} AND (JSON_CONTAINS(so_id, JSON_QUOTE('{so}')) OR JSON_CONTAINS(so_id, '{so}')) ORDER BY id")
GDS = ",".join(str(g["id"]) for g in gd) or "0"
NOS = ",".join(f"'{esc(g['delivery_no'])}','{esc(g['delivery_no'])}-Cancelled'" for g in gd if g.get("delivery_no")) or "''"
PICKS = f"SELECT DISTINCT transfer_order_id FROM transfer_order_jz8m9w3h_sub WHERE {T} AND gd_id IN ({GDS})"
# SO_AUTO_GD's correlation carries the SO number with '-' for '/' (SOA:<org>:SO-20260910-034:...)
job = q("--dev", f"SELECT * FROM gd_async_job WHERE {T} AND id > {since} AND command = 'CREATE_GD_FROM_FORM' "
                 f"AND (gd_id IN ({GDS}) OR correlation_id LIKE '%{esc(so_no.replace('/', '-'))}%') ORDER BY id")
JOBS = ",".join(f"'{j['id']}'" for j in job) or "'none'"
op = q("--dev", f"SELECT * FROM inventory_operation WHERE {T} AND source_job_id IN ({JOBS}) ORDER BY id")
OPS = ",".join(f"'{esc(o['operation_id'])}'" for o in op) or "'none'"
snap = {
    "so": hdr,
    "sol": sol,
    "res": q("--dev", f"SELECT * FROM on_reserved_gd WHERE {T} AND parent_line_id IN ({LINES}) ORDER BY id"),
    "gd": gd,
    "gdl": q("--dev", f"SELECT * FROM goods_delivery_fwii8mvb_sub WHERE {T} AND goods_delivery_id IN ({GDS}) ORDER BY id"),
    "ib": q("--dev", f"SELECT * FROM item_balance WHERE {T} AND plant_id = '{plant}' AND material_id IN ({MATS}) ORDER BY id"),
    "ibb": q("--dev", f"SELECT * FROM item_batch_balance WHERE {T} AND plant_id = '{plant}' AND material_id IN ({MATS}) ORDER BY id"),
    "fifo": q("--dev", f"SELECT * FROM fifo_costing_history WHERE {T} AND plant_id = '{plant}' AND material_id IN ({MATS}) ORDER BY id"),
    "wa": q("--dev", f"SELECT * FROM wa_costing_method WHERE {T} AND plant_id = '{plant}' AND material_id IN ({MATS}) ORDER BY id"),
    "mv": q("--dev", f"SELECT * FROM inventory_movement WHERE id > {since} AND {T} AND trx_no IN ({NOS}) ORDER BY id"),
    "item": q("--dev", f"SELECT id, material_code, last_transaction_date, update_time FROM item WHERE id IN ({MATS}) ORDER BY id"),
    "pkh": q("--dev", f"SELECT * FROM transfer_order WHERE {T} AND id IN ({PICKS}) ORDER BY id"),
    "pkl": q("--dev", f"SELECT * FROM transfer_order_jz8m9w3h_sub WHERE {T} AND transfer_order_id IN ({PICKS}) ORDER BY id"),
    "job": job,
    "step": q("--dev", f"SELECT id, job_id, step_name, step_status, attempt_count, inventory_operation_id, started_at, finished_at, error_code, "
                       f"LEFT(error_message, 200) AS error_message, LEFT(result_ref, 200) AS result_ref FROM gd_publish_step WHERE {T} AND job_id IN ({JOBS}) ORDER BY id"),
    "op": op,
    "eff": q("--dev", f"SELECT * FROM inventory_operation_effect WHERE {T} AND operation_id IN ({OPS}) ORDER BY id"),
    "held": q("--dev", f"SELECT * FROM inventory_balance_lock WHERE {T} AND owner_operation_id IN ({OPS}) AND is_deleted = 0 ORDER BY id"),
    "gate": q("--dev", f"SELECT * FROM inventory_balance_lock WHERE {T} AND lock_key IN (SELECT CONCAT('GATE|', o.operation_id) FROM inventory_operation o "
                       f"WHERE o.{T} AND o.source_job_id IN ({JOBS})) ORDER BY id"),
}
snap["meta"] = {"tenant": tenant, "so": so, "so_no": so_no, "plant": plant, "since": since, "gds": [g["delivery_no"] for g in gd]}
json.dump(snap, open(out, "w"), default=str)
print(so_no, {k: len(v) for k, v in snap.items() if isinstance(v, list)})
