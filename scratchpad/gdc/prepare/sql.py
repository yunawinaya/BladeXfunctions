"""GD_COMPLETE_PREPARE reads: one JSON_OBJECT per row (ids CAST AS CHAR, decimals stay exact JSON numbers, JSON columns
nested, datetimes formatted like the platform), filtered like the deployed get/search nodes they replace, no row limits.
Every interpolated value comes from code_node_GCentry (digits only). Cross-type id matches use CAST(x AS UNSIGNED) so the
primary key is used and nothing is compared as DOUBLE."""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
# the platform's persisted schema fields that exist physically: name -> [kind, physical kind]
COLS = json.load(open(os.path.join(HERE, "..", "lift", "fields.json")))

T = "'{{node:code_node_GCentry.data.tenantId}}'"
G = "{{node:code_node_GCentry.data.gdId}}"
O = "'{{node:code_node_GCentry.data.organizationId}}'"
# the GD's subform rows (top-level and bundle items)
LINES = f"goods_delivery_fwii8mvb_sub gl WHERE gl.tenant_id = {T} AND gl.goods_delivery_id = {G} AND gl.is_deleted = 0"
PLACEHOLDERS = {"goods_delivery": {"table_gd", "table_insufficient", "table_item_balance"}, "sales_order": {"table_so"},
                "transfer_order": {"table_picking_items", "table_picking_records"}}


def jobj(alias, table, extra=()):
    parts = []
    for c, (k, _phys) in COLS[table].items():
        if c in PLACEHOLDERS.get(table, ()):
            continue
        col = f"{alias}.`{c}`"
        # BIGINT stays a JSON number: the adapter's parse keeps 16+ digit ids exact as strings, small values stay numbers
        if k == "num":
            e = f"CAST({col} AS UNSIGNED)"
        elif k == "dt":
            e = f"DATE_FORMAT({col}, '%Y-%m-%d %H:%i:%s')"
        elif k == "dt3":
            e = f"SUBSTRING(DATE_FORMAT({col}, '%Y-%m-%d %H:%i:%s.%f'), 1, 23)"
        elif k == "date":
            e = f"DATE_FORMAT({col}, '%Y-%m-%d')"
        else:
            e = col
        parts.append(f"'{c}', {e}")
    parts.extend(extra)
    return "JSON_OBJECT(" + ", ".join(parts) + ")"


def fp_sql(tenant, gd, also=""):
    """A Force Complete's line fingerprint over what pick confirmations write onto GD lines: PREPARE takes it before its reads,
    COMMIT's C0 takes it again and compares."""
    cols = ["CAST(gl.gd_qty AS CHAR)", "CAST(gl.base_qty AS CHAR)", "gl.temp_qty_data", "gl.prev_temp_qty_data", "gl.picking_status",
            "CAST(gl.picked_qty AS CHAR)", "gl.picked_temp_qty_data"]
    joined = ", ".join("COALESCE(%s, '')" % c for c in cols)
    return (f"SELECT COUNT(*) AS n, CAST(COALESCE(SUM(CRC32(CONCAT_WS('|', gl.id, {joined}))), 0) AS CHAR) AS fp\n"
            f"  FROM goods_delivery_fwii8mvb_sub gl\n WHERE gl.tenant_id = {tenant} AND gl.goods_delivery_id = {gd} AND gl.is_deleted = 0{also}")


SQL = {
    "fp": fp_sql(T, G),
    "hdr": f"SELECT {jobj('g', 'goods_delivery')} AS j\n  FROM goods_delivery g\n WHERE g.tenant_id = {T} AND g.id = {G} AND g.is_deleted = 0",
    "lines": f"SELECT {jobj('gl', 'goods_delivery_fwii8mvb_sub')} AS j\n  FROM {LINES}\n ORDER BY gl.id",
    "setup": (
        f"SELECT x.k, x.j FROM (\n"
        f"SELECT 'PICK' AS k, s.id AS sid, {jobj('s', 'picking_setup')} AS j FROM picking_setup s WHERE s.tenant_id = {T} AND s.organization_id = {O} AND s.is_deleted = 0\n"
        f"UNION ALL\n"
        f"SELECT 'PACK' AS k, p.id AS sid, {jobj('p', 'packing_setup')} AS j FROM packing_setup p WHERE p.tenant_id = {T} AND p.organization_id = {O} AND p.packing_required = 1 AND p.is_deleted = 0\n"
        f") x ORDER BY x.k, x.sid"
    ),
    # code_gr_soids: line_so_id of material rows, header so_id when a row has none (superset: any link = not eligible)
    "link": (
        f"SELECT {jobj('d', 'document_linkage')} AS j\n  FROM document_linkage d\n"
        f" WHERE d.tenant_id = {T} AND d.is_deleted = 0 AND d.target_doc_type = 'Sales Order' AND d.link_status = 'Linked'\n"
        f"   AND d.target_doc_id IN (SELECT gl.line_so_id FROM {LINES} AND gl.material_id IS NOT NULL AND gl.line_so_id IS NOT NULL\n"
        f"                           UNION SELECT CAST(js.s AS CHAR) COLLATE utf8mb4_general_ci FROM goods_delivery g, JSON_TABLE(g.so_id, '$[*]' COLUMNS (s BIGINT PATH '$')) js\n"
        f"                            WHERE g.tenant_id = {T} AND g.id = {G})\n ORDER BY d.id"
    ),
    # sql_node_ItemFlags + sql_node_ItemDatas in one read (both shapes rebuilt by the adapter)
    "items": (
        "SELECT JSON_OBJECT('id', CAST(i.id AS CHAR), 'organization_id', i.organization_id, 'material_code', i.material_code,\n"
        "       'material_name', i.material_name, 'material_desc', i.material_desc, 'item_batch_management', i.item_batch_management,\n"
        "       'stock_control', i.stock_control, 'show_delivery', i.show_delivery, 'based_uom', CAST(i.based_uom AS CHAR),\n"
        "       'material_costing_method', i.material_costing_method, 'purchase_unit_price', i.purchase_unit_price, 'serial_number_management', i.serial_number_management,\n"
        "       'uom_flags', CAST(COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('alt_uom_id', CAST(u.alt_uom_id AS CHAR), 'over_delivery_tolerance', u.over_delivery_tolerance))\n"
        "                                    FROM item_mji552rc_sub u WHERE u.Item_id = i.id AND u.is_deleted = 0), JSON_ARRAY()) AS CHAR),\n"
        "       'uom_datas', CAST(COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('alt_uom_id', CAST(u.alt_uom_id AS CHAR), 'base_qty', u.base_qty))\n"
        "                                    FROM item_mji552rc_sub u WHERE u.Item_id = i.id AND u.is_deleted = 0), JSON_ARRAY()) AS CHAR)) AS j\n"
        f"  FROM item i\n WHERE i.id IN (SELECT gl.material_id FROM {LINES} AND gl.material_id IS NOT NULL)\n   AND i.is_deleted = 0\n ORDER BY i.id"
    ),
    # SO lines, read once (the GD's SOs + any line a GD line points at) and only in the columns code_node_QtyCheckBatch,
    # code_node_UMQapdjk and code_node_lwB2FVe0 read; the adapter builds both the search shape and table_so from it
    "sohl": (
        "SELECT JSON_OBJECT('id', CAST(sl.id AS CHAR), 'sales_order_id', CAST(sl.sales_order_id AS CHAR), 'parent_id', CAST(sl.parent_id AS CHAR),\n"
        "       'item_bundle_id', CAST(sl.item_bundle_id AS CHAR), 'item_name', sl.item_name, 'so_quantity', sl.so_quantity,\n"
        "       'delivered_qty', sl.delivered_qty, 'planned_qty', sl.planned_qty, 'outstanding_quantity', sl.outstanding_quantity,\n"
        "       'line_status', sl.line_status) AS j\n"
        "  FROM sales_order_axszx8cj_sub sl\n"
        f" WHERE sl.is_deleted = 0\n"
        f"   AND (sl.sales_order_id IN (SELECT js.s FROM goods_delivery g, JSON_TABLE(g.so_id, '$[*]' COLUMNS (s BIGINT PATH '$')) js WHERE g.tenant_id = {T} AND g.id = {G})\n"
        f"        OR sl.id IN (SELECT CAST(gl.so_line_item_id AS UNSIGNED) FROM {LINES} AND gl.so_line_item_id REGEXP '^[0-9]{{1,20}}$'))\n"
        f" ORDER BY sl.id"
    ),
    "soh": (
        "SELECT JSON_OBJECT('id', CAST(so.id AS CHAR), 'so_status', so.so_status, 'gd_status', so.gd_status,\n"
        "       'partially_delivered', so.partially_delivered, 'fully_delivered', so.fully_delivered) AS j\n"
        "  FROM sales_order so\n"
        f" WHERE so.id IN (SELECT js.s FROM goods_delivery g, JSON_TABLE(g.so_id, '$[*]' COLUMNS (s BIGINT PATH '$')) js WHERE g.tenant_id = {T} AND g.id = {G})\n"
        f"   AND so.is_deleted = 0\n ORDER BY so.id"
    ),
    # search_node_r3NiR6B7: target_gd_id = GD, org, plant (numberEqual), Allocated
    "alloc": (
        f"SELECT {jobj('r', 'on_reserved_gd')} AS j\n  FROM on_reserved_gd r\n"
        f" WHERE r.tenant_id = {T} AND r.is_deleted = 0 AND r.target_gd_id = '{G}' AND r.organization_id = {O}\n"
        f"   AND r.plant_id = (SELECT g.plant_id FROM goods_delivery g WHERE g.tenant_id = {T} AND g.id = {G}) AND r.status = 'Allocated'\n ORDER BY r.id"
    ),
    # search_node_QdY1FLLA: plant, org, Pending, doc_type not GD/PP, material in the lines', parent_line_id in their SO lines
    "pend": (
        f"SELECT {jobj('r', 'on_reserved_gd')} AS j\n  FROM on_reserved_gd r\n"
        f" WHERE r.tenant_id = {T} AND r.is_deleted = 0 AND r.organization_id = {O} AND r.status = 'Pending'\n"
        f"   AND r.plant_id = (SELECT g.plant_id FROM goods_delivery g WHERE g.tenant_id = {T} AND g.id = {G})\n"
        f"   AND r.doc_type <> 'Good Delivery' AND r.doc_type <> 'Picking Plan'\n"
        f"   AND r.material_id IN (SELECT gl.material_id FROM {LINES} AND gl.material_id IS NOT NULL)\n"
        f"   AND r.parent_line_id IN (SELECT gl.so_line_item_id FROM {LINES} AND gl.material_id IS NOT NULL)\n ORDER BY r.id"
    ),
    # search_node_68C0TVzK: the Pickings of the material rows' line_to_id, with their records
    "top": (
        f"SELECT {jobj('t', 'transfer_order')} AS j\n  FROM transfer_order t\n"
        f" WHERE t.id IN (SELECT gl.line_to_id FROM {LINES} AND gl.material_id IS NOT NULL AND gl.line_to_id IS NOT NULL)\n"
        f"   AND t.is_deleted = 0\n ORDER BY t.id"
    ),
    "topr": (
        f"SELECT {jobj('tr', 'transfer_order_vrqs3cmr_sub')} AS j\n  FROM transfer_order_vrqs3cmr_sub tr\n"
        f" WHERE tr.transfer_order_id IN (SELECT gl.line_to_id FROM {LINES} AND gl.material_id IS NOT NULL AND gl.line_to_id IS NOT NULL)\n"
        f"   AND tr.is_deleted = 0\n ORDER BY tr.id"
    ),
    # the GD's latest completion lock (GD_COMPLETE_SUBMIT): its result_ref is the owning job's idempotency_key
    "lock": (
        f"SELECT p.step_name, p.result_ref\n  FROM gd_publish_step p\n"
        f" WHERE p.tenant_id = {T} AND p.job_id = CONCAT('GDC|', '{G}') AND p.step_name LIKE 'LOCK|%' AND p.is_deleted = 0\n"
        f" ORDER BY p.id DESC\n LIMIT 1"
    ),
}

if __name__ == "__main__":
    for k, v in SQL.items():
        print(f"-- {k}: {len(v)} chars")
