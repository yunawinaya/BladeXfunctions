"""snap_gr.py <tenant> <gr_id> <out.json>: every row a GR completion or revert can touch, read-only (dev): the GR and its
lines, its purchase orders with their lines and on-order rows, balances / FIFO / WA / items of its materials at its plant,
the movements under its number (+ the putaway's TO - PA under it), its batches, its putaways (+ lines, records), its in-transit rows,
its V2 jobs and their step rows. Output holds dev data: write it to the session scratchpad.
snap_gr.py <tenant> po:<po_id>:<plant_id> <out.json>: the same before an Add-mode receipt exists (the GR's own tables empty)."""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from dbq import q  # noqa: E402

tenant, gr, out = sys.argv[1:4]
assert tenant.isdigit()
T = f"tenant_id = '{tenant}'"
if gr.startswith("po:"):
    po, plant = gr.split(":")[1:3]
    assert po.isdigit() and plant.isdigit()
    # item_id is varchar here: uncast, IN compares it to bigint ids as DOUBLE and matches neighbouring ids
    LINES = (f"SELECT CAST(item_id AS UNSIGNED) FROM purchase_order_2ukyuanr_sub WHERE {T} AND purchase_order_id = {po} AND is_deleted = 0 "
             f"AND item_id REGEXP '^[0-9]+$'")
    POS = po
else:
    assert gr.isdigit()
    hdr = q("--dev", f"SELECT * FROM goods_receiving WHERE {T} AND id = {gr}")
    assert len(hdr) == 1, "GR not found"
    plant, no = hdr[0]["plant_id"], hdr[0]["gr_no"]
    assert str(plant).isdigit()
    nos = str(no).replace("\\", "\\\\").replace("'", "''")
    LINES = f"SELECT item_id FROM goods_receiving_eg6l4ywi_sub WHERE {T} AND goods_receiving_id = {gr} AND is_deleted = 0 AND item_id IS NOT NULL"
    POS = (f"SELECT DISTINCT CAST(line_po_id AS UNSIGNED) FROM goods_receiving_eg6l4ywi_sub WHERE {T} AND goods_receiving_id = {gr} "
           f"AND line_po_id REGEXP '^[0-9]+$'")
POL = f"SELECT id FROM purchase_order_2ukyuanr_sub WHERE {T} AND purchase_order_id IN ({POS})"
snap = {
    "po": q("--dev", f"SELECT * FROM purchase_order WHERE {T} AND id IN ({POS}) ORDER BY id"),
    "pol": q("--dev", f"SELECT * FROM purchase_order_2ukyuanr_sub WHERE {T} AND id IN ({POL}) ORDER BY id"),
    "oo": q("--dev", f"SELECT * FROM on_order_purchase_order WHERE {T} AND po_line_id IN ({POL}) ORDER BY id"),
    "ib": q("--dev", f"SELECT * FROM item_balance WHERE {T} AND plant_id = '{plant}' AND material_id IN ({LINES}) ORDER BY id"),
    "ibb": q("--dev", f"SELECT * FROM item_batch_balance WHERE {T} AND plant_id = '{plant}' AND material_id IN ({LINES}) ORDER BY id"),
    "fifo": q("--dev", f"SELECT * FROM fifo_costing_history WHERE {T} AND plant_id = '{plant}' AND material_id IN ({LINES}) ORDER BY id"),
    "wa": q("--dev", f"SELECT * FROM wa_costing_method WHERE {T} AND plant_id = '{plant}' AND material_id IN ({LINES}) ORDER BY id"),
    "item": q("--dev", f"SELECT id, material_code, last_transaction_date FROM item WHERE id IN ({LINES}) ORDER BY id"),
}
if gr.startswith("po:"):
    snap.update({k: [] for k in ("gr", "grl", "mv", "batch", "to", "tol", "tor", "it", "job", "step")})
else:
    TOS = f"SELECT id FROM transfer_order_putaway WHERE {T} AND gr_no = '{gr}'"
    snap.update({
        "gr": hdr,
        "grl": q("--dev", f"SELECT * FROM goods_receiving_eg6l4ywi_sub WHERE {T} AND goods_receiving_id = {gr} ORDER BY id"),
        "mv": q("--dev", f"SELECT * FROM inventory_movement WHERE {T} AND (trx_no = '{nos}' OR parent_trx_no = '{nos}') ORDER BY id"),
        "batch": q("--dev", f"SELECT * FROM batch WHERE {T} AND transaction_no = '{nos}' ORDER BY id"),
        "to": q("--dev", f"SELECT * FROM transfer_order_putaway WHERE {T} AND id IN ({TOS}) ORDER BY id"),
        "tol": q("--dev", f"SELECT * FROM transfer_order_putaway_jz8m9w3h_sub WHERE {T} AND transfer_order_putaway_id IN ({TOS}) ORDER BY id"),
        "tor": q("--dev", f"SELECT * FROM transfer_order_putaway_vrqs3cmr_sub WHERE {T} AND transfer_order_putaway_id IN ({TOS}) ORDER BY id"),
        "it": q("--dev", f"SELECT * FROM in_transit_detail WHERE {T} AND doc_id = '{gr}' ORDER BY id"),
        "job": q("--dev", f"SELECT * FROM gd_async_job WHERE {T} AND correlation_id = 'GR|{gr}' ORDER BY id"),
        "step": q("--dev", f"SELECT id, job_id, step_name, step_status, attempt_count, started_at, finished_at, error_code, error_message, LENGTH(result_ref) ref_len "
                           f"FROM gd_publish_step WHERE {T} AND (job_id = 'GRC|{gr}' OR job_id IN (SELECT CAST(j.id AS CHAR) COLLATE utf8mb4_general_ci FROM gd_async_job j "
                           f"WHERE j.{T} AND j.correlation_id = 'GR|{gr}')) ORDER BY id"),
    })
json.dump(snap, open(out, "w"), default=str, ensure_ascii=False)
print(out, {k: len(v) for k, v in snap.items()})
