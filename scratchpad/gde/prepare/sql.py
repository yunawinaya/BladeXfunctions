"""GD_EDIT_PREPARE (and SUBMIT) reads: one JSON_OBJECT per row (gdc's jobj: ids exact, decimals exact, JSON nested,
datetimes as the platform formats them), no row limits. Each read covers the GD as stored AND the edit: the entry node
hands the delta's own ids (materials, SO lines, SOs) as digit lists ('0' when none), so one parallel phase suffices.
Interpolated values come from code_node_GEentry (digits only). Every table is tenant-scoped: request ids never reach
another tenant's rows (test/test_sql_scope.py)."""
import importlib.util
import os

HERE = os.path.dirname(os.path.abspath(__file__))
# gdc's builder, unchanged (loaded under its own name: this module is also called sql)
_spec = importlib.util.spec_from_file_location("gdc_prepare_sql", os.path.join(HERE, "..", "..", "gdc", "prepare", "sql.py"))
_gdc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_gdc)
# the auto allocation's tables (prepare/alloc_fields.py), in the same kinds
_gdc.COLS.update(__import__("json").load(open(os.path.join(HERE, "..", "lift", "fields_alloc.json"))))
jobj = _gdc.jobj

E = "code_node_GEentry"
T = "'{{node:%s.data.tenantId}}'" % E
G = "{{node:%s.data.gdId}}" % E
O = "'{{node:%s.data.organizationId}}'" % E
DM = "{{node:%s.data.deltaMaterialIdsSql}}" % E      # 1,2,3 | 0
DSL = "{{node:%s.data.deltaSoLineIdsSql}}" % E       # 1,2,3 | 0 (bigint compare)
DSLQ = "{{node:%s.data.deltaSoLineIdsQuoted}}" % E   # '1','2' | '0' (varchar compare: on_reserved_gd.parent_line_id)
DSO = "{{node:%s.data.deltaSoIdsSql}}" % E           # 1,2,3 | 0
DU = "{{node:%s.data.deltaUomIdsSql}}" % E           # 1,2,3 | 0 (the edit's line units: SUBMIT's unit guard)
LINES = f"goods_delivery_fwii8mvb_sub gl WHERE gl.tenant_id = {T} AND gl.goods_delivery_id = {G} AND gl.is_deleted = 0"
GD_SO = f"SELECT js.s FROM goods_delivery g, JSON_TABLE(g.so_id, '$[*]' COLUMNS (s BIGINT PATH '$')) js WHERE g.tenant_id = {T} AND g.id = {G}"
PLANT = f"(SELECT g.plant_id FROM goods_delivery g WHERE g.tenant_id = {T} AND g.id = {G})"
NAMES_GD = f"(JSON_CONTAINS(t.gd_no, JSON_QUOTE('{G}')) OR JSON_CONTAINS(t.gd_no, '{G}'))"
PICKS = f"t.tenant_id = {T} AND t.organization_id = {O} AND t.movement_type = 'Picking' AND {NAMES_GD}"
DAM = "{{node:%s.data.deltaAllocMaterialIdsSql}}" % E  # 1,2,3 | 0
DAL = "{{node:%s.data.deltaAllocLineIdsSql}}" % E      # 1,2,3 | 0
# the materials of the rows that may need save-time allocation (code_node_kJx9p9Nh's): stored lines without temp_qty_data,
# lines the edit empties it on, the edit's own rows (alloc_ids.js). A superset: alloc_edit.js filters every read per call.
CAND = (f"SELECT gl.material_id FROM {LINES} AND gl.material_id IS NOT NULL\n"
        f"                  AND (gl.temp_qty_data IS NULL OR TRIM(gl.temp_qty_data) IN ('', '[]') OR gl.id IN ({DAL}))")


def incand(col):
    return f"({col} IN ({CAND}) OR {col} IN ({DAM}))"


ANY_CAND = f"EXISTS (SELECT 1 FROM item i WHERE i.tenant_id = {T} AND {incand('i.id')})"
RES = f"r.tenant_id = {T} AND r.is_deleted = 0 AND r.plant_id = {PLANT} AND {incand('r.material_id')}"
HU_CAND = f"SELECT hc.handling_unit_id FROM handling_unit_atu7sreg_sub hc WHERE hc.tenant_id = {T} AND hc.is_deleted = 0 AND {incand('hc.material_id')}"

SQL = {
    "hdr": f"SELECT {jobj('g', 'goods_delivery')} AS j\n  FROM goods_delivery g\n WHERE g.tenant_id = {T} AND g.id = {G} AND g.is_deleted = 0",
    # the GD header table's custom-field definitions { cf_defs: { id: name } } (code/commit/cf.js): a header custom_fields
    # value compares as names (LSH 128671 has header definitions; a raw read sees their ids)
    "cfh": f"SELECT JSON_OBJECT('cf_defs', COALESCE((SELECT JSON_OBJECTAGG(CAST(d.id AS CHAR), d.field_name) FROM su_code_custom_field d"
           f"\n WHERE d.tenant_id = {T} AND d.is_deleted = 0 AND d.table_id = '1902054888473481218' AND IFNULL(d.sub_table_key, '') = ''),"
           f" JSON_OBJECT())) AS j",
    "lines": f"SELECT {jobj('gl', 'goods_delivery_fwii8mvb_sub')} AS j\n  FROM {LINES}\n ORDER BY gl.id",
    "setup": (
        "SELECT x.k, x.j FROM (\n"
        f"SELECT 'PICK' AS k, s.id AS sid, {jobj('s', 'picking_setup')} AS j FROM picking_setup s WHERE s.tenant_id = {T} AND s.organization_id = {O} AND s.is_deleted = 0\n"
        "UNION ALL\n"
        f"SELECT 'PACK' AS k, p.id AS sid, {jobj('p', 'packing_setup')} AS j FROM packing_setup p WHERE p.tenant_id = {T} AND p.organization_id = {O} AND p.packing_required = 1 AND p.is_deleted = 0\n"
        ") x ORDER BY x.k, x.sid"
    ),
    # code_gr_soids: SOs of the lines and the header, stored and edited (a superset: any link = not eligible)
    "link": (
        f"SELECT {jobj('d', 'document_linkage')} AS j\n  FROM document_linkage d\n"
        f" WHERE d.tenant_id = {T} AND d.is_deleted = 0 AND d.target_doc_type = 'Sales Order' AND d.link_status = 'Linked'\n"
        f"   AND (d.target_doc_id IN (SELECT gl.line_so_id FROM {LINES} AND gl.material_id IS NOT NULL AND gl.line_so_id IS NOT NULL)\n"
        f"        OR d.target_doc_id IN (SELECT CAST(js.s AS CHAR) COLLATE utf8mb4_general_ci FROM goods_delivery g, JSON_TABLE(g.so_id, '$[*]' COLUMNS (s BIGINT PATH '$')) js\n"
        f"                                WHERE g.tenant_id = {T} AND g.id = {G})\n"
        f"        OR CAST(d.target_doc_id AS UNSIGNED) IN ({DSO}))\n ORDER BY d.id"
    ),
    "items": (
        "SELECT JSON_OBJECT('id', CAST(i.id AS CHAR), 'organization_id', i.organization_id, 'material_code', i.material_code,\n"
        "       'material_name', i.material_name, 'material_desc', i.material_desc, 'item_batch_management', i.item_batch_management,\n"
        "       'stock_control', i.stock_control, 'show_delivery', i.show_delivery, 'based_uom', CAST(i.based_uom AS CHAR),\n"
        "       'material_costing_method', i.material_costing_method, 'purchase_unit_price', i.purchase_unit_price, 'serial_number_management', i.serial_number_management,\n"
        "       'uom_flags', CAST(COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('alt_uom_id', CAST(u.alt_uom_id AS CHAR), 'over_delivery_tolerance', u.over_delivery_tolerance))\n"
        "                                    FROM item_mji552rc_sub u WHERE u.Item_id = i.id AND u.is_deleted = 0), JSON_ARRAY()) AS CHAR),\n"
        "       'uom_datas', CAST(COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('alt_uom_id', CAST(u.alt_uom_id AS CHAR), 'base_qty', u.base_qty))\n"
        "                                    FROM item_mji552rc_sub u WHERE u.Item_id = i.id AND u.is_deleted = 0), JSON_ARRAY()) AS CHAR)) AS j\n"
        f"  FROM item i\n WHERE i.tenant_id = {T} AND (i.id IN (SELECT gl.material_id FROM {LINES} AND gl.material_id IS NOT NULL) OR i.id IN ({DM}))\n   AND i.is_deleted = 0\n ORDER BY i.id"
    ),
    # SO lines: every line of the GD's SOs (stored + edited) and any line a GD line points at (stored + edited); projected to
    # the columns the SO nodes read; the chain filters the searches by the ids the deployed nodes search on
    # the unit names of its lines (stored + edited) for GOODS_DELIVERY v246's unit guard message (sql_node_GdUomGuard's UNIT rows)
    "uoms": (
        "SELECT JSON_OBJECT('id', CAST(u.id AS CHAR), 'uom_name', u.uom_name) AS j\n"
        "  FROM unit_of_measurement u\n"
        f" WHERE u.tenant_id = {T} AND u.is_deleted = 0\n"
        f"   AND (u.id IN (SELECT gl.gd_order_uom_id FROM {LINES} AND gl.gd_order_uom_id IS NOT NULL)\n"
        f"        OR u.id IN (SELECT gl.good_delivery_uom_id FROM {LINES} AND gl.good_delivery_uom_id IS NOT NULL)\n"
        f"        OR u.id IN ({DU}))\n ORDER BY u.id"
    ),
    "sohl": (
        "SELECT JSON_OBJECT('id', CAST(sl.id AS CHAR), 'sales_order_id', CAST(sl.sales_order_id AS CHAR), 'parent_id', CAST(sl.parent_id AS CHAR),\n"
        "       'item_bundle_id', CAST(sl.item_bundle_id AS CHAR), 'item_name', sl.item_name, 'so_quantity', sl.so_quantity,\n"
        "       'delivered_qty', sl.delivered_qty, 'planned_qty', sl.planned_qty, 'outstanding_quantity', sl.outstanding_quantity,\n"
        "       'line_status', sl.line_status) AS j\n"
        "  FROM sales_order_axszx8cj_sub sl\n"
        f" WHERE sl.tenant_id = {T} AND sl.is_deleted = 0\n"
        f"   AND (sl.sales_order_id IN ({GD_SO}) OR sl.sales_order_id IN ({DSO})\n"
        f"        OR sl.id IN (SELECT CAST(gl.so_line_item_id AS UNSIGNED) FROM {LINES} AND gl.so_line_item_id REGEXP '^[0-9]{{1,20}}$')\n"
        f"        OR sl.id IN ({DSL}))\n"
        " ORDER BY sl.id"
    ),
    "soh": (
        "SELECT JSON_OBJECT('id', CAST(so.id AS CHAR), 'so_status', so.so_status, 'gd_status', so.gd_status,\n"
        "       'partially_delivered', so.partially_delivered, 'fully_delivered', so.fully_delivered) AS j\n"
        "  FROM sales_order so\n"
        f" WHERE so.tenant_id = {T} AND (so.id IN ({GD_SO}) OR so.id IN ({DSO})\n"
        f"        OR so.id IN (SELECT CAST(gl.line_so_id AS UNSIGNED) FROM {LINES} AND gl.line_so_id REGEXP '^[0-9]{{1,20}}$'))\n"
        "   AND so.is_deleted = 0\n ORDER BY so.id"
    ),
    "alloc": (
        f"SELECT {jobj('r', 'on_reserved_gd')} AS j\n  FROM on_reserved_gd r\n"
        f" WHERE r.tenant_id = {T} AND r.is_deleted = 0 AND r.target_gd_id = '{G}' AND r.organization_id = {O}\n"
        f"   AND r.plant_id = {PLANT} AND r.status = 'Allocated'\n ORDER BY r.id"
    ),
    "pend": (
        f"SELECT {jobj('r', 'on_reserved_gd')} AS j\n  FROM on_reserved_gd r\n"
        f" WHERE r.tenant_id = {T} AND r.is_deleted = 0 AND r.organization_id = {O} AND r.status = 'Pending'\n"
        f"   AND r.plant_id = {PLANT}\n"
        "   AND r.doc_type <> 'Good Delivery' AND r.doc_type <> 'Picking Plan'\n"
        f"   AND (r.material_id IN (SELECT gl.material_id FROM {LINES} AND gl.material_id IS NOT NULL) OR r.material_id IN ({DM}))\n"
        f"   AND (r.parent_line_id IN (SELECT gl.so_line_item_id FROM {LINES} AND gl.material_id IS NOT NULL) OR r.parent_line_id IN ({DSLQ}))\n ORDER BY r.id"
    ),
    # GLOBAL_ALLOCATION's sql_node_ItemAlloc for every candidate at once (an sql-node row: its JSON columns stay text)
    "aitem": (
        "SELECT JSON_OBJECT('id', CAST(i.id AS CHAR), 'material_code', i.material_code, 'item_batch_management', i.item_batch_management,\n"
        "       'stock_control', i.stock_control,\n"
        "       'uom_conversion_json', CAST(COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('alt_uom_id', CAST(u.alt_uom_id AS CHAR), 'base_qty', u.base_qty))\n"
        "                                             FROM item_mji552rc_sub u WHERE u.Item_id = i.id AND u.is_deleted = 0), '[]') AS CHAR),\n"
        "       'default_bin_json', CAST(COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('plant_id', CAST(b.plant_id AS CHAR), 'bin_location', CAST(b.bin_location AS CHAR)))\n"
        "                                          FROM item_wu520fpw_sub b WHERE b.Item_id = i.id AND b.is_deleted = 0), '[]') AS CHAR)) AS j\n"
        f"  FROM item i\n WHERE i.tenant_id = {T} AND {incand('i.id')} AND i.is_deleted = 0\n ORDER BY i.id"
    ),
    # GLOBAL_ALLOCATION's balance searches (search_node_mb8Vv8fZ / search_node_ARAmvXyd: material, organization, plant)
    "abal": (
        "SELECT x.k, x.j FROM (\n"
        f"SELECT 'IB' AS k, b.id AS sid, {jobj('b', 'item_balance')} AS j FROM item_balance b\n"
        f" WHERE b.tenant_id = {T} AND b.is_deleted = 0 AND b.organization_id = {O} AND b.plant_id = {PLANT} AND {incand('b.material_id')}\n"
        "UNION ALL\n"
        f"SELECT 'IBB' AS k, bb.id AS sid, {jobj('bb', 'item_batch_balance')} AS j FROM item_batch_balance bb\n"
        f" WHERE bb.tenant_id = {T} AND bb.is_deleted = 0 AND bb.organization_id = {O} AND bb.plant_id = {PLANT} AND {incand('bb.material_id')}\n"
        ") x ORDER BY x.k, x.sid"
    ),
    # GLOBAL_ALLOCATION's reservation searches. P: search_node_BOywHct7 (an SO line's Pending). H: search_node_WGl1NGSu (Allocated,
    # handling_unit_id isNotNull = SQL IS NOT NULL; its '' rows are skipped by Execute Allocation's HU map, so not read). O:
    # search_node_OwnReserved01 (this GD's Allocated, handling_unit_id isNull = SQL IS NULL: '' rows are not its). The row
    # shape drops '' keys, so these two filters can only live here.
    "ares": (
        "SELECT x.k, x.j FROM (\n"
        f"SELECT 'P' AS k, r.id AS sid, {jobj('r', 'on_reserved_gd')} AS j FROM on_reserved_gd r\n"
        f" WHERE {RES} AND r.status = 'Pending'\n"
        f"   AND (r.parent_line_id IN (SELECT gl.so_line_item_id FROM {LINES} AND gl.material_id IS NOT NULL) OR r.parent_line_id IN ({DSLQ}))\n"
        "UNION ALL\n"
        f"SELECT 'H' AS k, r.id AS sid, {jobj('r', 'on_reserved_gd')} AS j FROM on_reserved_gd r\n"
        f" WHERE {RES} AND r.status = 'Allocated' AND r.handling_unit_id IS NOT NULL AND r.handling_unit_id <> ''\n"
        "UNION ALL\n"
        f"SELECT 'O' AS k, r.id AS sid, {jobj('r', 'on_reserved_gd')} AS j FROM on_reserved_gd r\n"
        f" WHERE {RES} AND r.status = 'Allocated' AND r.target_gd_id = '{G}' AND r.handling_unit_id IS NULL\n"
        ") x ORDER BY x.k, x.sid"
    ),
    # the classic loop's searches, only when a row may need allocation: U search_node_pltmkkw3 (the tenant's UOMs, a superset of
    # the ids it asks), B search_node_nbpWEAFx (the plant's bins), HI every item of the HUs holding a candidate material (the loop
    # keeps the candidates' for search_node_D8ZGHKZI; each HU of H search_node_l8oiJ60B carries all of its as table_hu_items), BT
    # search_node_xc9mUWL8 (numbers of the batches the stock and reservations name)
    "aref": (
        "SELECT x.k, x.j FROM (\n"
        f"SELECT 'U' AS k, u.id AS sid, {jobj('u', 'unit_of_measurement')} AS j FROM unit_of_measurement u WHERE u.tenant_id = {T} AND u.is_deleted = 0 AND {ANY_CAND}\n"
        "UNION ALL\n"
        f"SELECT 'B' AS k, b.id AS sid, {jobj('b', 'bin_location')} AS j FROM bin_location b\n"
        f" WHERE b.tenant_id = {T} AND b.is_deleted = 0 AND b.organization_id = {O} AND b.plant_id = {PLANT} AND {ANY_CAND}\n"
        "UNION ALL\n"
        f"SELECT 'HI' AS k, hi.id AS sid, {jobj('hi', 'handling_unit_atu7sreg_sub')} AS j FROM handling_unit_atu7sreg_sub hi\n"
        f" WHERE hi.tenant_id = {T} AND hi.is_deleted = 0 AND hi.handling_unit_id IN ({HU_CAND})\n"
        "UNION ALL\n"
        f"SELECT 'H' AS k, h.id AS sid, {jobj('h', 'handling_unit')} AS j FROM handling_unit h\n"
        f" WHERE h.tenant_id = {T} AND h.is_deleted = 0 AND h.organization_id = {O} AND h.plant_id = {PLANT}\n"
        f"   AND h.id IN ({HU_CAND})\n"
        "UNION ALL\n"
        "SELECT 'BT' AS k, bt.id AS sid, JSON_OBJECT('id', CAST(bt.id AS CHAR), 'batch_number', bt.batch_number) AS j FROM batch bt\n"
        f" WHERE bt.tenant_id = {T} AND bt.is_deleted = 0\n"
        f"   AND (bt.id IN (SELECT bb.batch_id FROM item_batch_balance bb WHERE bb.tenant_id = {T} AND bb.is_deleted = 0 AND bb.plant_id = {PLANT} AND {incand('bb.material_id')})\n"
        f"        OR bt.id IN (SELECT r.batch_id FROM on_reserved_gd r WHERE {RES} AND r.status IN ('Pending', 'Allocated')))\n"
        ") x ORDER BY x.k, x.sid"
    ),
    # every Picking naming the GD (any status: the adapter keeps the live ones), its item rows and its records
    "pick":f"SELECT {jobj('t', 'transfer_order')} AS j\n  FROM transfer_order t\n WHERE {PICKS}\n ORDER BY t.id",
    "picki": (
        f"SELECT {jobj('pi', 'transfer_order_jz8m9w3h_sub')} AS j\n  FROM transfer_order_jz8m9w3h_sub pi\n"
        f" WHERE pi.is_deleted = 0 AND pi.transfer_order_id IN (SELECT t.id FROM transfer_order t WHERE {PICKS})\n ORDER BY pi.id"
    ),
    "pickr": (
        f"SELECT {jobj('pr', 'transfer_order_vrqs3cmr_sub')} AS j\n  FROM transfer_order_vrqs3cmr_sub pr\n"
        f" WHERE pr.is_deleted = 0 AND pr.transfer_order_id IN (SELECT t.id FROM transfer_order t WHERE {PICKS})\n ORDER BY pr.id"
    ),
    # search_bin_names: the bins a reversal message names (records' source and staging bins)
    "bins": (
        "SELECT JSON_OBJECT('id', CAST(b.id AS CHAR), 'bin_name', b.bin_name, 'bin_location_combine', b.bin_location_combine) AS j\n"
        "  FROM bin_location b\n"
        f" WHERE b.tenant_id = {T} AND b.is_deleted = 0\n"
        "   AND (b.id IN (SELECT CAST(pr.source_bin AS UNSIGNED) FROM transfer_order_vrqs3cmr_sub pr\n"
        f"                  WHERE pr.is_deleted = 0 AND pr.source_bin REGEXP '^[0-9]{{1,20}}$' AND pr.transfer_order_id IN (SELECT t.id FROM transfer_order t WHERE {PICKS}))\n"
        "        OR b.id IN (SELECT CAST(pr.target_location AS UNSIGNED) FROM transfer_order_vrqs3cmr_sub pr\n"
        f"                  WHERE pr.is_deleted = 0 AND pr.target_location REGEXP '^[0-9]{{1,20}}$' AND pr.transfer_order_id IN (SELECT t.id FROM transfer_order t WHERE {PICKS})))\n"
        " ORDER BY b.id"
    ),
    # get_node_zna6o03F: the Picking serial rule of the organization (business_type Picking, department = organization)
    "pfmt": (
        "SELECT JSON_OBJECT('id', CAST(rl.id AS CHAR), 'rule_name', rl.rule_name, 'business_type', rl.business_type, 'is_default', rl.is_default,\n"
        "       'is_draft', rl.is_draft, 'department_id', CAST(rl.department_id AS CHAR)) AS j\n"
        "  FROM su_code_serial_no_rule rl\n"
        f" WHERE rl.tenant_id = {T} AND rl.is_deleted = 0 AND rl.business_type = 'Picking' AND rl.department_id = {{{{node:{E}.data.organizationId}}}}\n ORDER BY rl.id"
    ),
    # the GD's latest lock (shared namespace with GD Completed V2: GDC|<gd> / LOCK|<n>); its result_ref = the owning job's key
    "lock": (
        "SELECT p.step_name, p.result_ref\n  FROM gd_publish_step p\n"
        f" WHERE p.tenant_id = {T} AND p.job_id = CONCAT('GDC|', '{G}') AND p.step_name LIKE 'LOCK|%' AND p.is_deleted = 0\n"
        " ORDER BY p.id DESC\n LIMIT 1"
    ),
}

if __name__ == "__main__":
    for k, v in SQL.items():
        print(f"-- {k}: {len(v)} chars")
