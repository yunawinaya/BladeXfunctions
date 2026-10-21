"""GD_REVERT_PREPARE reads, all set-based, every interpolated value from the entry node (digits only) or the ids node.

Round 1 (keyed on the GD): GD Completed V2's GD header + lines (scratchpad/gdc/prepare/sql.py, loaded by path, same placeholders),
the GD's active completion snapshot, the sales orders its lines name with every line (table_so), the three reads GD_REVERT_COMPLETED /
GD_PROCESS_REVERT make with SQL (picking facts, items, delivery cost: their text, with the GD's own lines / number in place of the
parameters their code nodes computed), and the reservations pointing at the GD.
Round 2 (ids found inside the snapshot, by code_node_RPids): the pending rows, Picking records / headers and handling units the
snapshot names.

Row shapes: a search / get node hands on whole rows, so the search-shaped reads select every column (prepare/cols.json, from the dev
schema) as one JSON object per row (adapter: GD Completed V2's gcObj / gcTree). The search on current reservations has two top-level
conditions, which the platform does not AND: every recorded run returned exactly the rows pointing at the GD (target_gd_id), so
that is the read here."""
import importlib.util
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("gdc_prepare_sql", os.path.join(HERE, "..", "..", "gdc", "prepare", "sql.py"))
_gdc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_gdc)
T, G, O = _gdc.T, _gdc.G, _gdc.O
COLS = json.load(open(os.path.join(HERE, "cols.json")))
IDS = "{{node:code_node_RPids.data.%s}}"
LINES = f"goods_delivery_fwii8mvb_sub gl WHERE gl.tenant_id = {T} AND gl.goods_delivery_id = {G} AND gl.is_deleted = 0"
SO_IDS = f"SELECT CAST(gl.line_so_id AS UNSIGNED) FROM {LINES} AND gl.line_so_id REGEXP '^[0-9]{{1,20}}$'"
MAT_IDS = f"SELECT CAST(gl.material_id AS UNSIGNED) FROM {LINES} AND gl.material_id IS NOT NULL"
# the completion's movements were written after the GD was created: GD id minus 1 h (inventory_movement has only its primary key)
MOVE_FLOOR = f"{G} - 15099494400000"
# GD_PROCESS_REVERT's sql_node_inDirectOut: its movements in the day after the active snapshot (= the completion's)
SNAP_ID = f"(SELECT MAX(s.id) FROM gd_completion_snapshot s WHERE s.tenant_id = {T} AND s.gd_id = '{G}' AND s.snapshot_status = 'Active' AND s.is_deleted = 0)"
DAY = 86400000 << 22


def jobj(table, alias, only=None):
    cols = [c for c, _ in COLS[table] if only is None or c in only]
    return "JSON_OBJECT(" + ", ".join(f"'{c}', {alias}.`{c}`" for c in cols) + ")"


def rows(table, alias, where, only=None, kind=None):
    k = f"'{kind}' AS k, " if kind else ""
    return f"SELECT {k}{jobj(table, alias, only)} AS j FROM {table} {alias} WHERE {alias}.tenant_id = {T} AND {alias}.is_deleted = 0 AND {where} ORDER BY {alias}.id"


SQL = {"hdr": _gdc.SQL["hdr"], "lines": _gdc.SQL["lines"], "lock": _gdc.SQL["lock"]}
SQL["snap"] = rows("gd_completion_snapshot", "s", f"s.gd_id = '{G}' AND s.snapshot_status = 'Active'")
SQL["soh"] = rows("sales_order", "h", f"h.id IN ({SO_IDS})",
                  only={"id", "so_no", "so_status", "gd_status", "partially_delivered", "fully_delivered", "organization_id", "plant_name", "tenant_id", "is_deleted"})
SQL["sol"] = rows("sales_order_axszx8cj_sub", "l", f"l.sales_order_id IN ({SO_IDS})")
SQL["resv"] = rows("on_reserved_gd", "r", f"r.target_gd_id = '{G}'")
SQL["pick"] = f"""SELECT CAST('pick' AS CHAR) AS kind,
       CAST(pl.gd_line_id AS CHAR) AS ref_id,
       CAST(COALESCE(pl.line_status, '') AS CHAR) AS line_status,
       CAST(COALESCE(t.to_status, '') AS CHAR) AS to_status,
       0 AS n,
       NULL AS stock_control,
       NULL AS show_delivery,
       NULL AS picking_required,
       NULL AS gd_flow
FROM transfer_order_jz8m9w3h_sub pl
STRAIGHT_JOIN transfer_order t ON t.id = pl.transfer_order_id AND t.is_deleted = 0
WHERE pl.gd_id = {G}
  AND pl.is_deleted = 0
UNION ALL
SELECT CAST('rec' AS CHAR), CAST(r.gd_line_id AS CHAR), CAST('' AS CHAR), CAST('' AS CHAR), COUNT(*), NULL, NULL, NULL, NULL
FROM transfer_order_vrqs3cmr_sub r
STRAIGHT_JOIN transfer_order t ON t.id = r.transfer_order_id AND t.is_deleted = 0
WHERE r.gd_id = {G}
  AND r.is_deleted = 0
GROUP BY r.gd_line_id
UNION ALL
SELECT CAST('item' AS CHAR), CAST(i.id AS CHAR), CAST('' AS CHAR), CAST('' AS CHAR), 0, i.stock_control, i.show_delivery, NULL, NULL
FROM item i
WHERE i.id IN ({MAT_IDS}) AND i.is_deleted = 0
UNION ALL
SELECT CAST('setup' AS CHAR), CAST('' AS CHAR), CAST('' AS CHAR), CAST('' AS CHAR), 0, NULL, NULL,
       MAX(s.picking_required), MAX(s.picking_after = 'Goods Delivery')
FROM picking_setup s
WHERE s.organization_id = {O}
  AND s.is_deleted = 0"""
SQL["items"] = f"""SELECT CAST(i.id AS CHAR) AS id,
       i.material_code,
       i.material_name,
       i.material_desc,
       CAST(i.based_uom AS CHAR) AS based_uom,
       i.stock_control,
       i.item_batch_management,
       i.material_costing_method,
       CAST(i.purchase_unit_price AS CHAR) AS purchase_unit_price,
       COALESCE((
           SELECT JSON_ARRAYAGG(JSON_OBJECT(
                      'alt_uom_id', CAST(u.alt_uom_id AS CHAR),
                      'base_qty', u.base_qty))
           FROM item_mji552rc_sub u
           WHERE u.Item_id = i.id
             AND u.is_deleted = 0
       ), '[]') AS uom_conversion_json,
       i.serial_number_management
FROM item i
WHERE i.id IN ({MAT_IDS})
  AND i.is_deleted = 0"""
SQL["cost"] = f"""SELECT x.item, x.b, x.bin, x.hu,
       CAST(IFNULL(SUM(x.total_price), 0) AS CHAR) AS tp,
       CAST(IFNULL(SUM(x.bq), 0) AS CHAR) AS bq
FROM (
  SELECT CAST(o.item_id AS CHAR) AS item,
         IFNULL(NULLIF(CAST(o.batch_number_id AS CHAR), ''), '0') AS b,
         IFNULL(CAST(o.bin_location_id AS CHAR), '') AS bin,
         IFNULL(NULLIF(CAST(o.handling_unit_id AS CHAR), ''), '0') AS hu,
         o.id, o.transaction_type, o.movement, o.inventory_category, o.total_price,
         COALESCE(o.base_qty, o.quantity) AS bq,
         MAX(CASE WHEN o.transaction_type = 'GDL-R' THEN o.id END) OVER () AS last_r
  FROM inventory_movement o
  WHERE o.id >= {MOVE_FLOOR}
    AND o.organization_id = {O}
    AND o.trx_no = (SELECT g.delivery_no FROM goods_delivery g WHERE g.tenant_id = {T} AND g.id = {G})
    AND o.transaction_type IN ('GDL', 'GDL-R')
    AND o.is_deleted = 0
) x
WHERE x.transaction_type = 'GDL'
  AND x.movement = 'OUT'
  AND x.inventory_category = 'Reserved'
  AND x.id > IFNULL(x.last_r, 0)
GROUP BY x.item, x.b, x.bin, x.hu"""
SQL["dout"] = f"""SELECT CAST(o.item_id AS CHAR) AS item,
       IFNULL(NULLIF(CAST(o.batch_number_id AS CHAR), ''), '0') AS b,
       IFNULL(CAST(o.bin_location_id AS CHAR), '') AS bin,
       IFNULL(NULLIF(CAST(o.handling_unit_id AS CHAR), ''), '0') AS hu,
       CAST(IFNULL(SUM(CASE WHEN UPPER(o.movement) = 'OUT' THEN 1 ELSE -1 END * COALESCE(o.base_qty, o.quantity)), 0) AS CHAR) AS net_bq,
       CAST(IFNULL(SUM(CASE WHEN UPPER(o.movement) = 'OUT' AND o.inventory_category = 'Unrestricted' THEN o.total_price END), 0) AS CHAR) AS u_tp,
       CAST(IFNULL(SUM(CASE WHEN UPPER(o.movement) = 'OUT' AND o.inventory_category = 'Unrestricted' THEN COALESCE(o.base_qty, o.quantity) END), 0) AS CHAR) AS u_bq,
       MAX(o.parent_trx_no) AS parent_no
FROM inventory_movement o
WHERE o.id > {SNAP_ID}
  AND o.id < {SNAP_ID} + {DAY}
  AND o.organization_id = {O}
  AND o.trx_no = (SELECT g.delivery_no FROM goods_delivery g WHERE g.tenant_id = {T} AND g.id = {G})
  AND o.transaction_type = 'GDL'
  AND o.is_deleted = 0
GROUP BY 1, 2, 3, 4"""
# round 2: the ids the snapshot names (code_node_RPids, digits only, "0" when none)
SQL["pend"] = rows("on_reserved_gd", "r", "r.id IN (" + IDS % "pendingIdsSql" + ")")
SQL["prec"] = rows("transfer_order_vrqs3cmr_sub", "r", "r.id IN (" + IDS % "pickingRecordIdsSql" + ")")
SQL["phdr"] = rows("transfer_order", "t", "t.id IN (" + IDS % "ppHeaderIdsSql" + ")")
SQL["hu"] = rows("handling_unit", "h", "h.id IN (" + IDS % "huIdsSql" + ")")
SQL["hul"] = rows("handling_unit_atu7sreg_sub", "h", "h.id IN (" + IDS % "huLineIdsSql" + ")")
ROUND1 = ["hdr", "lines", "lock", "snap", "soh", "sol", "resv", "pick", "items", "cost", "dout"]
ROUND2 = ["pend", "prec", "phdr", "hu", "hul"]

if __name__ == "__main__":
    for k, v in SQL.items():
        print(f"-- {k}: {len(v)} chars")
