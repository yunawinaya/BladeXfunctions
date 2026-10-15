"""GR_COMPLETE_PREPARE reads: one JSON_OBJECT per row (`j`), no row limits, run in parallel (condition-all-node).

Every interpolated value comes from code_node_RPentry (digits only, checked there):
  tenantId        the session tenant ('{{system:tenantId}}', quoted: tenant_id is varchar)
  grId            the Goods Receiving id (bare: every column it meets is a bigint id)
  organizationId  the job's organization (quoted against the varchar organization_id columns; bare against the bigint
                  su_code_serial_no_rule.department_id)
The GR's plant comes from the GR header inside each statement.

Shapes (code/prepare/adapter.js turns them into what the classic's nodes handed on):
- hdr / lines: every physical column of the two tables (lift/fields.json); bigint columns as JSON numbers - MySQL keeps
  them exact, the adapter reads 16+ digits as digit strings and leaves short values (gr_no_type -9999) numbers, as the
  platform's serializer does. JSON columns nested, decimals as JSON numbers, datetimes formatted like the platform.
- the projected reads: ids CAST AS CHAR, only the columns the lifted bodies and the plan read.
Bigint ids are never compared with quoted values (that goes through DOUBLE); every id match is bigint = bigint.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
COLS = json.load(open(os.path.join(HERE, "..", "lift", "fields.json")))

E = "code_node_RPentry"
T = "'{{node:%s.data.tenantId}}'" % E
G = "{{node:%s.data.grId}}" % E
O = "'{{node:%s.data.organizationId}}'" % E
ON = "{{node:%s.data.organizationId}}" % E

LINES = f"goods_receiving_eg6l4ywi_sub l WHERE l.tenant_id = {T} AND l.goods_receiving_id = {G} AND l.is_deleted = 0"
PLANT = f"(SELECT g.plant_id FROM goods_receiving g WHERE g.tenant_id = {T} AND g.id = {G})"


def jobj(alias, table):
    parts = []
    for c, k in COLS[table].items():
        col = f"{alias}.`{c}`"
        if k == "dt":
            e = f"DATE_FORMAT({col}, '%Y-%m-%d %H:%i:%s')"
        elif k == "dt3":
            e = f"SUBSTRING(DATE_FORMAT({col}, '%Y-%m-%d %H:%i:%s.%f'), 1, 23)"
        elif k == "date":
            e = f"DATE_FORMAT({col}, '%Y-%m-%d')"
        else:
            e = col
        parts.append(f"'{c}', {e}")
    return "JSON_OBJECT(" + ", ".join(parts) + ")"


def jcols(alias, spec):
    """spec: [(column, how)] - how: 'id' -> CAST AS CHAR, 'raw' -> as is, 'dt' / 'dt3' -> formatted"""
    parts = []
    for c, how in spec:
        col = f"{alias}.`{c}`"
        if how == "id":
            e = f"CAST({col} AS CHAR)"
        elif how == "dt":
            e = f"DATE_FORMAT({col}, '%Y-%m-%d %H:%i:%s')"
        elif how == "dt3":
            e = f"SUBSTRING(DATE_FORMAT({col}, '%Y-%m-%d %H:%i:%s.%f'), 1, 23)"
        else:
            e = col
        parts.append(f"'{c}', {e}")
    return "JSON_OBJECT(" + ", ".join(parts) + ")"


# PO lines: what code_node_e9pINRwN, code_node_H4Eg0oEI (get_node_T0BtCHSS) and code_node_KAeXsqwm read
POL = [("id", "id"), ("purchase_order_id", "id"), ("parent_id", "id"), ("item_id", "raw"), ("item_bundle_id", "id"),
       ("item_name", "raw"), ("quantity", "raw"), ("quantity_uom", "id"), ("po_amount", "raw"), ("received_qty", "raw"),
       ("created_received_qty", "raw"), ("outstanding_quantity", "raw"), ("line_status", "raw"), ("line_index", "raw")]
# PO headers: get_node_SnZKYhVp (exchange_rate) and search_node_nkWkBdXY / XqqoMDRs (status columns)
POH = [("id", "id"), ("purchase_order_no", "raw"), ("po_status", "raw"), ("gr_status", "raw"), ("partially_received", "raw"),
       ("fully_received", "raw"), ("exchange_rate", "raw"), ("po_currency", "raw"), ("organization_id", "raw"),
       ("po_plant", "id"), ("update_time", "dt3")]
OO = [("id", "id"), ("po_line_id", "id"), ("po_id", "id"), ("open_qty", "raw"), ("received_qty", "raw"), ("scheduled_qty", "raw"),
      ("material_id", "id"), ("plant_id", "id"), ("organization_id", "raw"), ("purchase_order_number", "raw")]
# Item: search_node_BwcLu7r7's fields the bodies read (+ batchnum.js's item_category / item_group_id, SUBMIT's flags)
ITEM = [("id", "id"), ("organization_id", "raw"), ("material_code", "raw"), ("material_name", "raw"), ("material_desc", "raw"),
        ("based_uom", "id"), ("material_costing_method", "raw"), ("purchase_unit_price", "raw"), ("stock_control", "raw"),
        ("show_delivery", "raw"), ("show_receiving", "raw"), ("receiving_inspection", "raw"), ("item_batch_management", "raw"),
        ("serial_number_management", "raw"), ("batch_number_genaration", "raw"), ("item_category", "raw"),
        ("item_group_id", "raw"), ("is_active", "raw"), ("over_receive_tolerance", "raw")]
UOM = [("id", "id"), ("alt_uom_id", "id"), ("alt_qty", "raw"), ("base_qty", "raw"), ("base_uom_id", "id"),
       ("over_receive_tolerance", "raw"), ("over_delivery_tolerance", "raw")]
PS = [("id", "id"), ("plant_id", "id"), ("organization_id", "raw"), ("movement_type", "raw"), ("putaway_required", "raw"),
      ("auto_trigger_to", "raw"), ("auto_completed_gr", "raw"), ("putaway_mode", "raw"), ("default_loading_bay", "id"),
      ("is_loading_bay", "raw"), ("storage_location_id", "id"), ("category", "raw"), ("show_hu", "raw")]
SL = [("id", "id"), ("plant_id", "id"), ("organization_id", "raw"), ("storage_location_code", "raw"), ("location_type", "raw"),
      ("is_default", "raw"), ("storage_status", "raw"), ("table_bin_location", "raw")]
BNC = [("id", "id"), ("organization_id", "raw"), ("batch_level_selection", "raw"), ("item_id", "id"), ("item_category_id", "id"),
       ("item_group_id", "id"), ("batch_format", "raw"), ("running_number", "raw"), ("reset_frequency", "raw"),
       ("initial_value", "raw"), ("last_reset_date", "raw"), ("date_format", "raw"), ("format_preview", "raw"),
       ("update_time", "dt3")]
BATCH = [("id", "id"), ("batch_number", "raw"), ("material_id", "id"), ("plant_id", "id"), ("organization_id", "raw"),
         ("transaction_no", "raw"), ("parent_transaction_no", "raw"), ("initial_quantity", "raw"), ("update_time", "dt3")]

MANUAL = "l.item_batch_no IS NOT NULL AND l.item_batch_no NOT IN ('', '-', 'Auto-generated batch number')"

SQL = {
    "hdr": f"SELECT {jobj('h', 'goods_receiving')} AS j\n  FROM goods_receiving h\n WHERE h.tenant_id = {T} AND h.id = {G} AND h.is_deleted = 0",
    "lines": f"SELECT {jobj('l', 'goods_receiving_eg6l4ywi_sub')} AS j\n  FROM {LINES}\n ORDER BY l.id",
    # the lines of the GR's POs (code_node_e9pINRwN / KAeXsqwm walk every line of a PO) and every PO line a GR line names
    "pol": (
        f"SELECT {jcols('pl', POL)} AS j\n  FROM purchase_order_2ukyuanr_sub pl\n"
        f" WHERE pl.tenant_id = {T} AND pl.is_deleted = 0\n"
        f"   AND (pl.purchase_order_id IN (SELECT l.line_po_id FROM {LINES} AND l.line_po_id IS NOT NULL)\n"
        f"        OR pl.id IN (SELECT l.po_line_item_id FROM {LINES} AND l.po_line_item_id IS NOT NULL))\n ORDER BY pl.id"
    ),
    "poh": (
        f"SELECT {jcols('p', POH)} AS j\n  FROM purchase_order p\n"
        f" WHERE p.tenant_id = {T} AND p.is_deleted = 0\n"
        f"   AND p.id IN (SELECT l.line_po_id FROM {LINES} AND l.line_po_id IS NOT NULL)\n ORDER BY p.id"
    ),
    # get_node_K8mPq3Rt reads po_line_id = the row's PO line; update_node_J2vH9sLc writes every row of it
    "oo": (
        f"SELECT {jcols('o', OO)} AS j\n  FROM on_order_purchase_order o\n"
        f" WHERE o.tenant_id = {T} AND o.is_deleted = 0\n"
        f"   AND o.po_line_id IN (SELECT l.po_line_item_id FROM {LINES} AND l.po_line_item_id IS NOT NULL)\n ORDER BY o.id"
    ),
    # Items of the lines with their UOM conversion subform rows (item_mji552rc_sub) in id order, as search_node_BwcLu7r7 nests them
    "items": (
        f"SELECT JSON_MERGE_PRESERVE({jcols('i', ITEM)}, JSON_OBJECT('table_uom_conversion', COALESCE(\n"
        f"         (SELECT JSON_ARRAYAGG({jcols('u', UOM)}) OVER (ORDER BY u.id ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)\n"
        f"            FROM item_mji552rc_sub u WHERE u.Item_id = i.id AND u.is_deleted = 0 LIMIT 1), JSON_ARRAY()))) AS j\n"
        f"  FROM item i\n WHERE i.tenant_id = {T} AND i.is_deleted = 0\n"
        f"   AND i.id IN (SELECT l.item_id FROM {LINES} AND l.item_id IS NOT NULL)\n ORDER BY i.id"
    ),
    # PS: putaway_setup of org + plant (get_node_QBrFrLs9 answers the lowest id); LB: the plant's active default Loading Bay
    # storage location (get_node_njg7cSUu); TO: the Putaway numbering rule (get_node_xUdzlNqh: department_id = organization,
    # the serial-rule table is org-shared, so no tenant filter - as the platform reads it)
    "setup": (
        "SELECT x.k, x.j FROM (\n"
        f"SELECT 'PS' AS k, s.id AS sid, {jcols('s', PS)} AS j FROM putaway_setup s\n"
        f" WHERE s.tenant_id = {T} AND s.is_deleted = 0 AND s.organization_id = {O} AND s.plant_id = {PLANT}\n"
        "UNION ALL\n"
        f"SELECT 'LB' AS k, sl.id AS sid, {jcols('sl', SL)} AS j FROM storage_location sl\n"
        f" WHERE sl.tenant_id = {T} AND sl.is_deleted = 0 AND sl.storage_status = 1 AND sl.is_default = 1\n"
        f"   AND sl.location_type = 'Loading Bay' AND sl.plant_id = {PLANT}\n"
        "UNION ALL\n"
        "SELECT 'TO' AS k, r.id AS sid, JSON_OBJECT('id', CAST(r.id AS CHAR), 'business_type', r.business_type, 'is_default', r.is_default) AS j\n"
        f"  FROM su_code_serial_no_rule r WHERE r.is_deleted = 0 AND r.department_id = {ON} AND r.business_type = 'Putaway' AND r.is_default = 1\n"
        ") x ORDER BY x.k, x.sid"
    ),
    # GENERATE_BATCH's configuration rows of the organization (every level); batchnum.js picks as its get-nodes do
    "bnc": (
        f"SELECT {jcols('b', BNC)} AS j\n  FROM batch_number_config b\n"
        f" WHERE b.tenant_id = {T} AND b.is_deleted = 0 AND b.organization_id = {O}\n ORDER BY b.id"
    ),
    # search_existing_batch: live batches with a manual number of the GR's lines, for the same item, plant and organization
    "batches": (
        f"SELECT {jcols('b', BATCH)} AS j\n  FROM batch b\n"
        f" WHERE b.tenant_id = {T} AND b.is_deleted = 0 AND b.organization_id = {O} AND b.plant_id = {PLANT}\n"
        f"   AND (b.batch_number, b.material_id) IN (SELECT l.item_batch_no, l.item_id FROM {LINES} AND {MANUAL})\n ORDER BY b.id"
    ),
    # the GR's latest completion lock (GR_COMPLETE_SUBMIT): result_ref = the owning job's idempotency_key
    "lock": (
        "SELECT p.step_name, p.result_ref\n  FROM gd_publish_step p\n"
        f" WHERE p.tenant_id = {T} AND p.job_id = CONCAT('GRC|', '{G}') AND p.step_name LIKE 'LOCK|%' AND p.is_deleted = 0\n"
        " ORDER BY p.id DESC\n LIMIT 1"
    ),
}
COLUMNS = {k: ["j"] for k in SQL}
COLUMNS["setup"] = ["k", "j"]
COLUMNS["lock"] = ["step_name", "result_ref"]

# GR_COMPLETE_SUBMIT's gate reads (chain.js grGates), keyed on the FORM rather than a stored GR, in the same shapes (the
# adapter reads them unchanged: grAdapt({ items, pol, poh, setup })). From code_node_RSkeys (digits only, checked there):
#   tenantId, organizationId (quoted for varchar organization_id, bare for the serial rule's bigint department_id),
#   plantId (bare), itemIdsSql / poIdsSql: comma-separated digit ids, never empty ("0" when there is none)
#   items  search_node_BwcLu7r7: the form rows' item_id           (code_node_QB3GUnrS)
#   pol    search_node_nkWkBdXY's table_po: every line of each PO (code_node_e9pINRwN walks them)
#   poh    search_node_nkWkBdXY: the form rows' line_po_id         (code_node_4r2Fv9G5's poIds)
#   setup  get_node_QBrFrLs9 (PS) - plus the loading bay (LB) and the Putaway numbering rule (TO), which no gate reads
SK = "code_node_RSkeys"
ST = "'{{node:%s.data.tenantId}}'" % SK
SO = "'{{node:%s.data.organizationId}}'" % SK
SON = "{{node:%s.data.organizationId}}" % SK
SPLANT = "{{node:%s.data.plantId}}" % SK
SITEMS = "{{node:%s.data.itemIdsSql}}" % SK
SPOS = "{{node:%s.data.poIdsSql}}" % SK
SUBMIT_SQL = {
    "items": (
        f"SELECT JSON_MERGE_PRESERVE({jcols('i', ITEM)}, JSON_OBJECT('table_uom_conversion', COALESCE(\n"
        f"         (SELECT JSON_ARRAYAGG({jcols('u', UOM)}) OVER (ORDER BY u.id ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)\n"
        f"            FROM item_mji552rc_sub u WHERE u.Item_id = i.id AND u.is_deleted = 0 LIMIT 1), JSON_ARRAY()))) AS j\n"
        f"  FROM item i\n WHERE i.tenant_id = {ST} AND i.is_deleted = 0 AND i.id IN ({SITEMS})\n ORDER BY i.id"
    ),
    "pol": (
        f"SELECT {jcols('pl', POL)} AS j\n  FROM purchase_order_2ukyuanr_sub pl\n"
        f" WHERE pl.tenant_id = {ST} AND pl.is_deleted = 0 AND pl.purchase_order_id IN ({SPOS})\n ORDER BY pl.id"
    ),
    "poh": (
        f"SELECT {jcols('p', POH)} AS j\n  FROM purchase_order p\n"
        f" WHERE p.tenant_id = {ST} AND p.is_deleted = 0 AND p.id IN ({SPOS})\n ORDER BY p.id"
    ),
    "setup": (
        "SELECT x.k, x.j FROM (\n"
        f"SELECT 'PS' AS k, s.id AS sid, {jcols('s', PS)} AS j FROM putaway_setup s\n"
        f" WHERE s.tenant_id = {ST} AND s.is_deleted = 0 AND s.organization_id = {SO} AND s.plant_id = {SPLANT}\n"
        "UNION ALL\n"
        f"SELECT 'LB' AS k, sl.id AS sid, {jcols('sl', SL)} AS j FROM storage_location sl\n"
        f" WHERE sl.tenant_id = {ST} AND sl.is_deleted = 0 AND sl.storage_status = 1 AND sl.is_default = 1\n"
        f"   AND sl.location_type = 'Loading Bay' AND sl.plant_id = {SPLANT}\n"
        "UNION ALL\n"
        "SELECT 'TO' AS k, r.id AS sid, JSON_OBJECT('id', CAST(r.id AS CHAR), 'business_type', r.business_type, 'is_default', r.is_default) AS j\n"
        f"  FROM su_code_serial_no_rule r WHERE r.is_deleted = 0 AND r.department_id = {SON} AND r.business_type = 'Putaway' AND r.is_default = 1\n"
        ") x ORDER BY x.k, x.sid"
    ),
}
SUBMIT_COLUMNS = {k: ["j"] for k in SUBMIT_SQL}
SUBMIT_COLUMNS["setup"] = ["k", "j"]

if __name__ == "__main__":
    for k, v in SQL.items():
        print(f"-- PREPARE {k}: {len(v)} chars")
    for k, v in SUBMIT_SQL.items():
        print(f"-- SUBMIT {k}: {len(v)} chars")
