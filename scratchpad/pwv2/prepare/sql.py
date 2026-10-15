"""PUTAWAY_BULK_PREPARE reads (SQL) and the reads PUTAWAY_ASYNC_SUBMIT needs (SUBMIT_SQL): one JSON_OBJECT per row (`j`),
no row limits, run in parallel (condition-all-node).

PREPARE placeholders come from code_node_PPentry (digits only, checked there):
  tenantId        the session tenant (quoted: tenant_id is varchar)
  toId            the Transfer Order Putaway id (bare: every column it meets is a bigint)
  grId            the putaway's Goods Receiving id = transfer_order_putaway.gr_no (bare against goods_receiving.id; quoted
                  against the varchar columns that hold it: transfer_order_putaway.gr_no, in_transit_detail.doc_id,
                  basic_inspection_lot.goods_receiving_no). The plan checks it equals the stored TO's gr_no.
  organizationId  the job's organization (quoted: every organization_id met here is varchar)
SUBMIT placeholders come from SUBMIT_ENTRY (tenantId, toId; the same checks).

Shapes (code/prepare/adapter.js turns them into what the classic's nodes handed on):
- hdr / lines / records: every physical column of the three tables (lift/fields.json); bigint columns as JSON numbers
  (MySQL keeps them exact; the adapter reads 16+ digits as digit strings, as the platform's serializer does), JSON columns
  nested, decimals as JSON numbers, datetimes formatted like the platform.
- the projected reads: ids CAST AS CHAR, only the columns the lifted bodies and the plan read.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
COLS = json.load(open(os.path.join(HERE, "..", "lift", "fields.json")))

E = "code_node_PPentry"
SUBMIT_ENTRY = "code_node_PSentry"

TOL = "transfer_order_putaway_jz8m9w3h_sub"
TOR = "transfer_order_putaway_vrqs3cmr_sub"


# nested subform rows come without these (the platform drops them under the parent): not read
NESTED_DROP = {"create_user", "create_dept", "create_time", "update_user", "update_time", "tenant_id", "is_deleted",
               "transfer_order_putaway_id"}


def jobj(alias, table, nested=False):
    parts = []
    for c, k in COLS[table].items():
        if nested and (c in NESTED_DROP or c.startswith("sub_tenant_id")):
            continue
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


# The Item fields code_node_M7XzDZ48 reads (as PUTAWAY's sql_node_PwItems + code_node_PwItems hand them on) and the flags the
# eligibility check reads (serial items, stock control)
ITEM = [("id", "id"), ("based_uom", "id"), ("item_batch_management", "raw"), ("material_costing_method", "raw"),
        ("serial_number_management", "raw"), ("stock_control", "raw"), ("material_code", "raw")]
UOM = [("alt_uom_id", "id"), ("base_qty", "raw")]
# in_transit_detail: PUTAWAY's sql_node_PwTransit columns (code_node_ITmatch reads them all, cloneOf copies them)
IT = [("id", "id"), ("doc_type", "raw"), ("doc_id", "raw"), ("doc_no", "raw"), ("doc_line_id", "raw"), ("line_no", "raw"),
      ("parent_id", "raw"), ("parent_no", "raw"), ("parent_line_id", "raw"), ("material_id", "id"), ("item_code", "raw"),
      ("item_name", "raw"), ("item_desc", "raw"), ("item_uom", "id"), ("batch_id", "id"), ("handling_unit_id", "raw"),
      ("plant_id", "id"), ("organization_id", "raw"), ("transit_bin", "id"), ("from_plant_id", "id"), ("from_bin", "id"),
      ("from_category", "raw"), ("to_plant_id", "id"), ("to_bin", "id"), ("to_category", "raw"), ("transit_qty", "raw"),
      ("received_qty", "raw"), ("open_qty", "raw"), ("status", "raw"), ("transit_date", "dt"), ("received_date", "dt"),
      ("remark", "raw"), ("target_doc_type", "raw"), ("target_doc_id", "raw"), ("target_doc_no", "raw"),
      ("target_doc_line_id", "raw"), ("source_transit_id", "raw")]
IT_KEY = [("id", "id"), ("status", "raw"), ("material_id", "id"), ("batch_id", "id"), ("transit_bin", "id")]
# putaway_setup (get_node_ca2032Ub: plant + organization, the lowest id): code_node_ds7jurnq reads auto_completed_gr
PS = [("id", "id"), ("plant_id", "id"), ("organization_id", "raw"), ("movement_type", "raw"), ("putaway_required", "raw"),
      ("auto_trigger_to", "raw"), ("auto_completed_gr", "raw"), ("putaway_mode", "raw"), ("default_loading_bay", "id"),
      ("is_loading_bay", "raw"), ("storage_location_id", "id"), ("category", "raw"), ("show_hu", "raw")]
GR = [("id", "id"), ("gr_no", "raw"), ("gr_status", "raw"), ("putaway_status", "raw"), ("organization_id", "raw"),
      ("plant_id", "id"), ("update_time", "dt3")]
# item_batch_balance at a putaway line's source bin: SUBTRACT_INVENTORY's get_node_GjRiq3dT row, whose dates the classic
# passes on to the ADD (code_node_DUBS9GZF -> return_node_LbWU1lZh -> code_node_4Baken82)
BB = [("id", "id"), ("material_id", "id"), ("location_id", "id"), ("batch_id", "id"), ("plant_id", "id"),
      ("organization_id", "raw"), ("manufacturing_date", "dt"), ("expired_date", "dt")]


def reads(entry, prepare):
    T = "'{{node:%s.data.tenantId}}'" % entry
    TO = "{{node:%s.data.toId}}" % entry
    lines_of = f"{TOL} l WHERE l.tenant_id = {T} AND l.transfer_order_putaway_id = {TO} AND l.is_deleted = 0"
    hdr_of = f"transfer_order_putaway h WHERE h.tenant_id = {T} AND h.id = {TO} AND h.is_deleted = 0"
    plant = f"(SELECT h.plant_id FROM {hdr_of})"
    org = f"(SELECT h.organization_id FROM {hdr_of})"
    item_ids = f"SELECT l.item_code FROM {lines_of} AND l.item_code IS NOT NULL"
    items = (
        f"SELECT JSON_MERGE_PRESERVE({jcols('i', ITEM)}, JSON_OBJECT('table_uom_conversion', COALESCE(\n"
        f"         (SELECT JSON_ARRAYAGG({jcols('u', UOM)}) OVER (ORDER BY u.id ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)\n"
        f"            FROM item_mji552rc_sub u WHERE u.Item_id = i.id AND u.is_deleted = 0 LIMIT 1), JSON_ARRAY()))) AS j\n"
        f"  FROM item i\n WHERE i.tenant_id = {T} AND i.is_deleted = 0\n   AND i.id IN ({item_ids})\n ORDER BY i.id"
    )
    out = {
        # the TO header as get_node_C64LC1sr reads it (the subforms come from lines / records)
        "hdr": f"SELECT {jobj('h', 'transfer_order_putaway')} AS j\n  FROM {hdr_of}",
        # its lines (table_putaway_item), id order; bundle items carry parent_id
        "lines": f"SELECT {jobj('l', TOL, True)} AS j\n  FROM {lines_of}\n ORDER BY l.id",
        "items": items,
    }
    if not prepare:
        # SUBMIT: the classic lock's age (PUTAWAY_LOOP sql_node_LockGate) and the GR's status ride on the header row
        out["hdr"] = (
            f"SELECT {jobj('h', 'transfer_order_putaway')} AS j,\n"
            "       TIMESTAMPDIFF(SECOND, h.update_time, CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')) AS lock_age_sec,\n"
            "       (SELECT g.gr_status FROM goods_receiving g\n"
            "         WHERE g.tenant_id = h.tenant_id AND g.id = CAST(h.gr_no AS UNSIGNED) AND g.is_deleted = 0 LIMIT 1) AS gr_status\n"
            f"  FROM {hdr_of}"
        )
        # (item, batch) pairs of the lines whose costing rows make SUBTRACT_INVENTORY / INVENTORY_BULK_APPLY take the migration
        # branch (UNSUPPORTED_COSTING until the engine change): FIFO and WA rows of the plant + organization, batch-scoped the
        # engine's way (NULL / 0 = no batch), counted in one pass each; stock_control 0 / NULL items are skipped (401) before the check
        def counted(table, a):
            return (f"(SELECT {a}.material_id AS m, COALESCE({a}.batch_id, 0) AS b, COUNT(*) AS n FROM {table} {a}\n"
                    f"     WHERE {a}.tenant_id = {T} AND {a}.is_deleted = 0 AND {a}.plant_id = {plant} AND {a}.organization_id = {org}\n"
                    f"       AND {a}.material_id IN ({item_ids})\n     GROUP BY {a}.material_id, COALESCE({a}.batch_id, 0))")
        out["cost"] = (
            "SELECT JSON_OBJECT('material_id', CAST(k.m AS CHAR), 'batch_id', CAST(k.b AS CHAR), 'method', i.material_costing_method,\n"
            "         'fifo', COALESCE(f.n, 0), 'wa', COALESCE(w.n, 0)) AS j\n"
            f"  FROM (SELECT DISTINCT l.item_code AS m, COALESCE(l.batch_no, 0) AS b FROM {lines_of} AND l.item_code IS NOT NULL) k\n"
            f"  JOIN item i ON i.id = k.m AND i.tenant_id = {T} AND i.is_deleted = 0 AND i.stock_control <> 0\n"
            f"  LEFT JOIN {counted('fifo_costing_history', 'f')} f ON f.m = k.m AND f.b = k.b\n"
            f"  LEFT JOIN {counted('wa_costing_method', 'w')} w ON w.m = k.m AND w.b = k.b\n"
            " WHERE (COALESCE(f.n, 0) > 0 AND COALESCE(w.n, 0) > 0)\n"
            "    OR (i.material_costing_method = 'First In First Out' AND COALESCE(f.n, 0) = 0 AND COALESCE(w.n, 0) > 0)\n"
            "    OR (i.material_costing_method = 'Weighted Average' AND COALESCE(w.n, 0) = 0 AND COALESCE(f.n, 0) > 0)\n"
            " ORDER BY k.m, k.b"
        )
        return out
    G = "{{node:%s.data.grId}}" % entry
    O = "'{{node:%s.data.organizationId}}'" % entry
    out.update({
        # its records (table_putaway_records), id order; bundle items carry parent_id
        "records": f"SELECT {jobj('r', TOR, True)} AS j\n  FROM {TOR} r\n WHERE r.tenant_id = {T} AND r.transfer_order_putaway_id = {TO} AND r.is_deleted = 0\n ORDER BY r.id",
        "gr": f"SELECT {jcols('g', GR)} AS j\n  FROM goods_receiving g\n WHERE g.tenant_id = {T} AND g.id = {G} AND g.is_deleted = 0",
        # every in-transit row of the GR, all statuses: code_node_ITmatch draws on the open ones (every column: it closes,
        # splits and clones them) and keys the closed ones only by item / batch / bin, to refuse a double consumption
        "transit": (
            f"SELECT u.j FROM (\n"
            f"SELECT t.id AS k, {jcols('t', IT)} AS j\n  FROM in_transit_detail t\n"
            f" WHERE t.tenant_id = {T} AND t.doc_id = '{G}' AND t.organization_id = {O} AND t.is_deleted = 0 AND t.status = 'In Transit'\n"
            f"UNION ALL\n"
            f"SELECT t.id AS k, {jcols('t', IT_KEY)} AS j\n  FROM in_transit_detail t\n"
            f" WHERE t.tenant_id = {T} AND t.doc_id = '{G}' AND t.organization_id = {O} AND t.is_deleted = 0\n"
            f"   AND (t.status IS NULL OR t.status <> 'In Transit')\n) u\n ORDER BY u.k"
        ),
        # search_node_SVMdNd3K (every TO of the GR, this one included) and search_node_T5BGLPpK (its inspection lots): the
        # columns code_node_ds7jurnq reads
        "others": (
            "SELECT JSON_OBJECT('id', CAST(p.id AS CHAR), 'to_status', p.to_status) AS j\n  FROM transfer_order_putaway p\n"
            f" WHERE p.tenant_id = {T} AND p.gr_no = '{G}' AND p.is_deleted = 0\n ORDER BY p.id"
        ),
        "qi": (
            "SELECT JSON_OBJECT('id', CAST(b.id AS CHAR), 'receiving_insp_status', b.receiving_insp_status) AS j\n"
            f"  FROM basic_inspection_lot b\n WHERE b.tenant_id = {T} AND b.goods_receiving_no = '{G}' AND b.is_deleted = 0\n ORDER BY b.id"
        ),
        "setup": (
            f"SELECT {jcols('s', PS)} AS j\n  FROM putaway_setup s\n"
            f" WHERE s.tenant_id = {T} AND s.is_deleted = 0 AND s.plant_id = {plant} AND s.organization_id = {O}\n ORDER BY s.id"
        ),
        "bbal": (
            f"SELECT {jcols('b', BB)} AS j\n  FROM item_batch_balance b\n"
            f" WHERE b.tenant_id = {T} AND b.is_deleted = 0 AND b.organization_id = {O} AND b.plant_id = {plant}\n"
            f"   AND (b.material_id, b.location_id, b.batch_id) IN (SELECT l.item_code, l.source_bin, l.batch_no FROM {lines_of}\n"
            "        AND l.batch_no IS NOT NULL AND l.source_bin IS NOT NULL)\n ORDER BY b.id"
        ),
        # the TO's latest completion lock (PUTAWAY_ASYNC_SUBMIT): result_ref = the owning job's idempotency_key
        "lock": (
            "SELECT p.step_name, p.result_ref\n  FROM gd_publish_step p\n"
            f" WHERE p.tenant_id = {T} AND p.job_id = CONCAT('PWC|', '{TO}') AND p.step_name LIKE 'LOCK|%' AND p.is_deleted = 0\n"
            " ORDER BY p.id DESC\n LIMIT 1"
        ),
    })
    return out


SQL = reads(E, True)
SUBMIT_SQL = reads(SUBMIT_ENTRY, False)
COLUMNS = {k: ["j"] for k in SQL}
COLUMNS["lock"] = ["step_name", "result_ref"]
SUBMIT_COLUMNS = {k: ["j"] for k in SUBMIT_SQL}
SUBMIT_COLUMNS["hdr"] = ["j", "lock_age_sec", "gr_status"]
# the entry fields the statements interpolate
ENTRY_FIELDS = {"PREPARE": (E, ["tenantId", "toId", "grId", "organizationId"]), "SUBMIT": (SUBMIT_ENTRY, ["tenantId", "toId"])}

if __name__ == "__main__":
    for name, d in (("SQL", SQL), ("SUBMIT_SQL", SUBMIT_SQL)):
        for k, v in d.items():
            print(f"-- {name}[{k}]: {len(v)} chars")
