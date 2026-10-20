"""snap.py <tenant> <gd_id> <out.json>: every row a GD cancel can touch, read-only (dev). GD Completed V2's snapshot (scratchpad/gdc/
test/snap.py: the GD, its lines, the reservations of its SO lines, its SOs and lines, balances / FIFO / WA / items of its materials at
its plant) + the movements under its number with and without "-Cancelled", the Pickings that name it with their rows, its Packings
with their item / source / box rows, the handling units of those boxes with their items, its CANCEL_GD jobs and step rows."""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "gdc", "pkv2tools"))
from dbq import q  # noqa: E402

tenant, gd, out = sys.argv[1:4]
assert tenant.isdigit() and gd.isdigit()
T = f"tenant_id = '{tenant}'"
hdr = q("--dev", f"SELECT * FROM goods_delivery WHERE {T} AND id = {gd}")
assert len(hdr) == 1, "GD not found"
plant, org, no = hdr[0]["plant_id"], hdr[0]["organization_id"], hdr[0]["delivery_no"]
base_no = no[: -len("-Cancelled")] if no.endswith("-Cancelled") else no
esc = lambda s: s.replace("\\", "\\\\").replace("'", "''")
LINES = f"SELECT material_id FROM goods_delivery_fwii8mvb_sub WHERE {T} AND goods_delivery_id = {gd} AND is_deleted = 0 AND material_id IS NOT NULL"
SOL = f"SELECT CAST(so_line_item_id AS UNSIGNED) FROM goods_delivery_fwii8mvb_sub WHERE {T} AND goods_delivery_id = {gd} AND so_line_item_id REGEXP '^[0-9]+$'"
SOS = f"SELECT js.s FROM goods_delivery g, JSON_TABLE(g.so_id, '$[*]' COLUMNS (s BIGINT PATH '$')) js WHERE g.{T} AND g.id = {gd}"
PICKS = (f"SELECT t0.id FROM transfer_order t0 WHERE t0.{T} AND t0.is_deleted = 0 AND JSON_CONTAINS(t0.gd_no, JSON_QUOTE('{gd}')) "
         f"UNION SELECT x.transfer_order_id FROM transfer_order_jz8m9w3h_sub x WHERE x.{T} AND x.gd_id = {gd} AND x.is_deleted = 0")
PACKS = (f"SELECT p0.id FROM packing p0 WHERE p0.{T} AND p0.is_deleted = 0 AND p0.gd_id = '{gd}' "
         f"UNION SELECT l0.packing_id FROM packing_jz8m9w3h_sub l0 WHERE l0.{T} AND l0.gd_id = {gd} AND l0.is_deleted = 0")
BOXES = f"SELECT CAST(u0.handling_unit_id AS UNSIGNED) FROM packing_hr4nq20g_sub u0 WHERE u0.{T} AND u0.handling_unit_id REGEXP '^[0-9]+$' AND u0.packing_id IN ({PACKS})"
floor = str(int(gd) - (3600000 << 22))
snap = {
    "gd": hdr,
    "gdl": q("--dev", f"SELECT * FROM goods_delivery_fwii8mvb_sub WHERE {T} AND goods_delivery_id = {gd} ORDER BY id"),
    "res": q("--dev", f"SELECT * FROM on_reserved_gd WHERE {T} AND (target_gd_id = '{gd}' OR doc_id = '{gd}' OR parent_line_id IN (SELECT so_line_item_id FROM goods_delivery_fwii8mvb_sub WHERE {T} AND goods_delivery_id = {gd})) ORDER BY id"),
    "so": q("--dev", f"SELECT * FROM sales_order WHERE {T} AND id IN ({SOS}) ORDER BY id"),
    "sol": q("--dev", f"SELECT * FROM sales_order_axszx8cj_sub WHERE {T} AND (sales_order_id IN ({SOS}) OR id IN ({SOL})) ORDER BY id"),
    "ib": q("--dev", f"SELECT * FROM item_balance WHERE {T} AND plant_id = '{plant}' AND material_id IN ({LINES}) ORDER BY id"),
    "ibb": q("--dev", f"SELECT * FROM item_batch_balance WHERE {T} AND plant_id = '{plant}' AND material_id IN ({LINES}) ORDER BY id"),
    "fifo": q("--dev", f"SELECT * FROM fifo_costing_history WHERE {T} AND plant_id = '{plant}' AND material_id IN ({LINES}) ORDER BY id"),
    "wa": q("--dev", f"SELECT * FROM wa_costing_method WHERE {T} AND plant_id = '{plant}' AND material_id IN ({LINES}) ORDER BY id"),
    "mv": q("--dev", f"SELECT * FROM inventory_movement WHERE id >= {floor} AND {T} AND trx_no IN ('{esc(base_no)}', '{esc(base_no)}-Cancelled') ORDER BY id"),
    "item": q("--dev", f"SELECT id, material_code, last_transaction_date, update_time FROM item WHERE id IN ({LINES}) ORDER BY id"),
    "pkh": q("--dev", f"SELECT * FROM transfer_order WHERE {T} AND id IN ({PICKS}) ORDER BY id"),
    "pkl": q("--dev", f"SELECT * FROM transfer_order_jz8m9w3h_sub WHERE {T} AND transfer_order_id IN ({PICKS}) ORDER BY id"),
    "ph": q("--dev", f"SELECT * FROM packing WHERE {T} AND id IN ({PACKS}) ORDER BY id"),
    "pl": q("--dev", f"SELECT * FROM packing_jz8m9w3h_sub WHERE {T} AND packing_id IN ({PACKS}) ORDER BY id"),
    "ps": q("--dev", f"SELECT * FROM packing_mudjw4xk_sub WHERE {T} AND packing_id IN ({PACKS}) ORDER BY id"),
    "pu": q("--dev", f"SELECT * FROM packing_hr4nq20g_sub WHERE {T} AND packing_id IN ({PACKS}) ORDER BY id"),
    "hu": q("--dev", f"SELECT * FROM handling_unit WHERE {T} AND (id IN ({BOXES}) OR parent_hu_id IN ({BOXES.replace('SELECT CAST(u0.handling_unit_id AS UNSIGNED)', 'SELECT u0.handling_unit_id')})) ORDER BY id"),
    "hui": q("--dev", f"SELECT * FROM handling_unit_atu7sreg_sub WHERE {T} AND handling_unit_id IN ({BOXES}) ORDER BY id"),
    "job": q("--dev", f"SELECT * FROM gd_async_job WHERE {T} AND correlation_id = 'GD|{gd}' AND command = 'CANCEL_GD' ORDER BY id"),
    "step": q("--dev", f"SELECT id, job_id, step_name, step_status, attempt_count, started_at, finished_at, error_code, error_message, LENGTH(result_ref) ref_len FROM gd_publish_step "
                       f"WHERE {T} AND job_id IN (SELECT CAST(j.id AS CHAR) COLLATE utf8mb4_general_ci FROM gd_async_job j WHERE j.{T} AND j.correlation_id = 'GD|{gd}' AND j.command = 'CANCEL_GD') ORDER BY id"),
}
snap["meta"] = {"tenant": tenant, "gd": gd, "no": no, "base_no": base_no, "plant": plant, "org": org}
json.dump(snap, open(out, "w"), default=str)
print(no, {k: len(v) for k, v in snap.items() if isinstance(v, list)})
