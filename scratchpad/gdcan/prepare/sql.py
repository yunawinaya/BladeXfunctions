"""GD_CANCEL_PREPARE / GD_CANCEL_SUBMIT reads: GD Completed V2's PREPARE reads (scratchpad/gdc/prepare/sql.py, loaded by path, same
placeholders) plus what a cancel also writes: the Pickings that reference the GD (header gd_no ids, as the GD list's bulk Cancel
finds them, or a row's gd_id) with their rows; its Packings (header gd_id or a row's gd_id) with their item, source and box rows,
and the mobile lease as Packing V2's SUBMIT reads it; the handling units of those Packings' boxes with their stored items.
Every interpolated value comes from the entry node (digits only)."""
import importlib.util
import os

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("gdc_prepare_sql", os.path.join(HERE, "..", "..", "gdc", "prepare", "sql.py"))
_gdc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_gdc)
T, G = _gdc.T, _gdc.G
MYT_NOW = "CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')"

PICK_IDS = (f"SELECT t0.id FROM transfer_order t0 WHERE t0.tenant_id = {T} AND t0.is_deleted = 0 AND JSON_CONTAINS(t0.gd_no, JSON_QUOTE('{G}'))\n"
            f"             UNION SELECT x.transfer_order_id FROM transfer_order_jz8m9w3h_sub x WHERE x.tenant_id = {T} AND x.gd_id = {G} AND x.is_deleted = 0")
PACK_IDS = (f"SELECT p0.id FROM packing p0 WHERE p0.tenant_id = {T} AND p0.is_deleted = 0 AND p0.gd_id = '{G}'\n"
            f"             UNION SELECT l0.packing_id FROM packing_jz8m9w3h_sub l0 WHERE l0.tenant_id = {T} AND l0.gd_id = {G} AND l0.is_deleted = 0")
# the boxes of those Packings: generated / locked rows with a handling unit
BOX_IDS = (f"SELECT CAST(u0.handling_unit_id AS UNSIGNED) FROM packing_hr4nq20g_sub u0 WHERE u0.tenant_id = {T} AND u0.is_deleted = 0\n"
           f"               AND u0.handling_unit_id REGEXP '^[0-9]{{1,20}}$' AND u0.packing_id IN ({PACK_IDS})")
BOX_TEXT_IDS = BOX_IDS.replace("SELECT CAST(u0.handling_unit_id AS UNSIGNED)", "SELECT u0.handling_unit_id")

SQL = {k: v for k, v in _gdc.SQL.items() if k != "fp"}
SQL["pick"] = (
    "SELECT x.k, x.j FROM (\n"
    "SELECT 'H' AS k, t.id AS sid, JSON_OBJECT('id', CAST(t.id AS CHAR), 'to_id', t.to_id, 'to_status', t.to_status, 'delivery_no', t.delivery_no,\n"
    "       'gd_no', t.gd_no, 'is_processing', COALESCE(t.is_processing, 0),\n"
    f"       'lock_age_sec', TIMESTAMPDIFF(SECOND, t.update_time, {MYT_NOW}),\n"
    f"       'open_jobs', (SELECT COUNT(*) FROM gd_async_job j WHERE j.tenant_id = {T} AND j.command = 'CONFIRM_PICKING'\n"
    "                       AND j.job_status NOT IN ('COMPLETED', 'FAILED', 'CANCELLED') AND j.is_deleted = 0 AND CAST(j.picking_id AS UNSIGNED) = t.id)) AS j\n"
    f"  FROM transfer_order t\n WHERE t.tenant_id = {T} AND t.is_deleted = 0 AND t.id IN ({PICK_IDS})\n"
    "UNION ALL\n"
    "SELECT 'L' AS k, pl.id AS sid, JSON_OBJECT('id', CAST(pl.id AS CHAR), 'picking_id', CAST(pl.transfer_order_id AS CHAR), 'parent_id', CAST(pl.parent_id AS CHAR),\n"
    "       'gd_id', CAST(pl.gd_id AS CHAR), 'gd_no', pl.gd_no, 'line_status', pl.line_status, 'pending_process_qty', CAST(pl.pending_process_qty AS CHAR)) AS j\n"
    f"  FROM transfer_order_jz8m9w3h_sub pl\n WHERE pl.tenant_id = {T} AND pl.is_deleted = 0 AND pl.transfer_order_id IN ({PICK_IDS})\n"
    ") x ORDER BY x.k, x.sid"
)
SQL["pack"] = (
    "SELECT x.k, x.j FROM (\n"
    "SELECT 'H' AS k, p.id AS sid, JSON_OBJECT('id', CAST(p.id AS CHAR), 'packing_no', p.packing_no, 'packing_status', p.packing_status,\n"
    "       'gd_status', p.gd_status, 'gd_id', p.gd_id, 'gd_no', p.gd_no, 'lock_session', p.packing_lock_session_id, 'lock_user', p.packing_lock_user_name,\n"
    f"       'lock_live', CAST(COALESCE(p.packing_lock_expires_at > {MYT_NOW}, 0) AS CHAR)) AS j\n"
    f"  FROM packing p\n WHERE p.tenant_id = {T} AND p.is_deleted = 0 AND p.id IN ({PACK_IDS})\n"
    "UNION ALL\n"
    "SELECT 'L' AS k, l.id AS sid, JSON_OBJECT('id', CAST(l.id AS CHAR), 'packing_id', CAST(l.packing_id AS CHAR), 'gd_id', CAST(l.gd_id AS CHAR), 'gd_no', l.gd_no,\n"
    "       'line_status', l.line_status, 'remaining_qty', CAST(l.remaining_qty AS CHAR)) AS j\n"
    f"  FROM packing_jz8m9w3h_sub l\n WHERE l.tenant_id = {T} AND l.is_deleted = 0 AND l.packing_id IN ({PACK_IDS})\n"
    "UNION ALL\n"
    "SELECT 'S' AS k, sr.id AS sid, JSON_OBJECT('id', CAST(sr.id AS CHAR), 'packing_id', CAST(sr.packing_id AS CHAR), 'gd_id', CAST(sr.gd_id AS CHAR), 'gd_no', sr.gd_no,\n"
    "       'handling_unit_id', CAST(sr.handling_unit_id AS CHAR), 'hu_status', sr.hu_status, 'row_type', sr.row_type) AS j\n"
    f"  FROM packing_mudjw4xk_sub sr\n WHERE sr.tenant_id = {T} AND sr.is_deleted = 0 AND sr.packing_id IN ({PACK_IDS})\n"
    "UNION ALL\n"
    "SELECT 'U' AS k, u.id AS sid, JSON_OBJECT('id', CAST(u.id AS CHAR), 'packing_id', CAST(u.packing_id AS CHAR), 'hu_row_type', u.hu_row_type,\n"
    "       'handling_unit_id', u.handling_unit_id, 'handling_no', u.handling_no, 'hu_status', u.hu_status, 'item_count', u.item_count,\n"
    "       'total_quantity', CAST(u.total_quantity AS CHAR), 'parent_hu_id', u.parent_hu_id, 'temp_data', u.temp_data,\n"
    "       'storage_location_id', CAST(u.storage_location_id AS CHAR), 'location_id', CAST(u.location_id AS CHAR), 'hu_quantity', u.hu_quantity,\n"
    "       'hu_uom', CAST(u.hu_uom AS CHAR), 'hu_material_id', u.hu_material_id, 'hu_type', u.hu_type, 'remark', u.remark) AS j\n"
    f"  FROM packing_hr4nq20g_sub u\n WHERE u.tenant_id = {T} AND u.is_deleted = 0 AND u.packing_id IN ({PACK_IDS})\n"
    ") x ORDER BY x.k, x.sid"
)
SQL["box"] = (
    "SELECT x.k, x.j FROM (\n"
    "SELECT 'HU' AS k, h.id AS sid, JSON_OBJECT('id', CAST(h.id AS CHAR), 'handling_no', h.handling_no, 'hu_status', h.hu_status, 'packing_id', h.packing_id,\n"
    "       'parent_hu_id', h.parent_hu_id, 'total_quantity', CAST(h.total_quantity AS CHAR), 'item_count', h.item_count) AS j\n"
    f"  FROM handling_unit h\n WHERE h.tenant_id = {T} AND h.is_deleted = 0\n"
    f"   AND (h.id IN ({BOX_IDS})\n        OR h.parent_hu_id IN ({BOX_TEXT_IDS}))\n"
    "UNION ALL\n"
    "SELECT 'HI' AS k, hi.id AS sid, JSON_OBJECT('id', CAST(hi.id AS CHAR), 'handling_unit_id', CAST(hi.handling_unit_id AS CHAR), 'material_id', CAST(hi.material_id AS CHAR),\n"
    "       'balance_id', hi.balance_id, 'batch_id', CAST(hi.batch_id AS CHAR), 'quantity', CAST(hi.quantity AS CHAR), 'material_uom', CAST(hi.material_uom AS CHAR),\n"
    "       'location_id', CAST(hi.location_id AS CHAR)) AS j\n"
    f"  FROM handling_unit_atu7sreg_sub hi\n WHERE hi.tenant_id = {T} AND hi.is_deleted = 0 AND hi.handling_unit_id IN ({BOX_IDS})\n"
    ") x ORDER BY x.k, x.sid"
)

if __name__ == "__main__":
    for k, v in SQL.items():
        print(f"-- {k}: {len(v)} chars")
