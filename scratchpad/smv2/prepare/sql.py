"""LOT_V2_PREPARE reads (CONTRACT.md section 9 / 14): one JSON_OBJECT per row (`j`), no row caps, run in one condition-all fork-join
after the entry. Placeholders come from the guard (tenantId, jobId) and code_node_LPentry (lotId, organizationId), all digit-checked
there; the tenant / org / varchar ids are hand-quoted, bigint ids bare.

Shapes (code/prepare/adapter.js turns them into what the classic's read nodes handed on): bigint ids CAST AS CHAR, decimals of the
ledger CAST AS CHAR (exact text; the adapter makes the search-node numbers from it), datetimes 'YYYY-MM-DD HH:MM:SS'.
The auto allocation's reads (aitem / abal, V2.1) copy GD Edit V2's (scratchpad/gde/prepare/sql.py) with gdc's jobj row builder.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
# item_balance / item_batch_balance columns and kinds (a copy of gde's lift/fields_alloc.json)
ALLOC_COLS = {k: v for k, v in json.load(open(os.path.join(HERE, "..", "lift", "fields_alloc.json"))).items() if not k.startswith("_")}
GUARD = "code_node_LPguard"
ENTRY = "code_node_LPentry"

T = "'{{node:%s.data.tenantId}}'" % GUARD
JOB = "{{node:%s.data.jobId}}" % GUARD
LOT = "{{node:%s.data.lotId}}" % ENTRY
ORG = "{{node:%s.data.organizationId}}" % ENTRY
ET = "'{{node:%s.data.tenantId}}'" % ENTRY

LINES_OF = f"sm_location_transfer_d2c7o1jd_sub l WHERE l.tenant_id = {ET} AND l.sm_location_transfer_id = {LOT} AND l.is_deleted = 0"
SCOPE = "'{{node:%s.data.allocScope}}'" % ENTRY
PLANT = f"(SELECT h.issuing_operation_faci FROM sm_location_transfer h WHERE h.tenant_id = {ET} AND h.id = {LOT} AND h.is_deleted = 0)"
# the items the auto allocation may run for (code/prepare/alloc.js lotAllocScope is the same rule): stored lines asking for a
# quantity with an item; DIRECT / STAGE (EMPTY) only the unpicked ones, COMPLETE / EDIT (REQ) any (their lines come from S|..|LINES)
CAND = (f"SELECT CAST(l.item_selection AS UNSIGNED) FROM {LINES_OF} AND l.requested_qty > 0 AND COALESCE(l.item_selection, '') <> ''\n"
        f"                     AND ({SCOPE} = 'REQ' OR ({SCOPE} = 'EMPTY' AND (l.temp_qty_data IS NULL OR TRIM(l.temp_qty_data) IN ('', '[]'))))")


def jobj(alias, table):
    """gdc's prepare/sql.py jobj: bigint / decimal / int raw (JSON numbers), datetimes as the platform prints them"""
    parts = []
    for c, (k, _phys) in ALLOC_COLS[table].items():
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


# the job (+ DB clock, lease flag, request) and, for a SUBMIT that stopped before "link", the LOT it left Processing
JOB_SQL = f"""SELECT DATE_FORMAT(n.t, '%Y-%m-%d %H:%i:%s') AS db_now,
       CAST(j.id AS CHAR) AS id, j.organization_id, j.command, j.job_status, j.lease_owner, (j.lease_expires_at > n.t) AS lease_live, j.row_version,
       j.attempt_count, j.idempotency_key, j.correlation_id, j.request_payload, j.is_deleted,
       (SELECT CAST(MAX(g.id) AS CHAR) FROM sm_location_transfer g
         WHERE g.tenant_id = {T} AND g.lot_v2_job_id = '{JOB}' AND g.stock_movement_status = 'Processing' AND g.is_deleted = 0) AS linked_lot
  FROM (SELECT NOW(3) AS t) n
  LEFT JOIN gd_async_job j
    ON j.tenant_id = {T}
   AND j.id = {JOB}"""
JOB_COLS = ["db_now", "id", "organization_id", "command", "job_status", "lease_owner", "lease_live", "row_version", "attempt_count", "idempotency_key",
            "correlation_id", "request_payload", "is_deleted", "linked_lot"]

BACK_SQL = f"""SELECT CAST(j.id AS CHAR) AS id, j.job_status, j.progress_message, j.error_code, j.error_message
  FROM gd_async_job j
 WHERE j.tenant_id = {T}
   AND j.id = {JOB}"""
BACK_COLS = ["id", "job_status", "progress_message", "error_code", "error_message"]

READS = {
    # SUBMIT's payload parts of this job (COMPLETE / EDIT: S|<nonce>|LINES|<nnn>)
    "parts": (f"""SELECT p.step_name, p.result_ref
  FROM gd_publish_step p
 WHERE p.tenant_id = {ET}
   AND p.job_id = '{{{{node:{ENTRY}.data.jobId}}}}'
   AND p.step_name LIKE 'S|%'
   AND p.is_deleted = 0
 ORDER BY p.step_name""", ["step_name", "result_ref"]),
    # the header: what the lifted bodies read + the lock fields
    "hdr": (f"""SELECT JSON_OBJECT('id', CAST(h.id AS CHAR), 'stock_movement_no', h.stock_movement_no, 'stock_movement_no_type', CAST(h.stock_movement_no_type AS CHAR),
       'stock_movement_status', h.stock_movement_status, 'issuing_operation_faci', CAST(h.issuing_operation_faci AS CHAR),
       'receiving_operation_faci', CAST(h.receiving_operation_faci AS CHAR), 'organization_id', h.organization_id,
       'issue_date', DATE_FORMAT(h.issue_date, '%Y-%m-%d %H:%i:%s'), 'is_production_order', h.is_production_order, 'movement_type', h.movement_type,
       'movement_reason', h.movement_reason, 'issued_by', h.issued_by, 'tenant_id', h.tenant_id, 'lot_v2_job_id', CAST(h.lot_v2_job_id AS CHAR)) AS j
  FROM sm_location_transfer h
 WHERE h.tenant_id = {ET}
   AND h.id = {LOT}
   AND h.is_deleted = 0""", ["j"]),
    # its stored lines, line_index order (the get-node's nested stock_movement)
    "lines": (f"""SELECT JSON_OBJECT('id', CAST(l.id AS CHAR), 'line_index', l.line_index, 'item_selection', l.item_selection, 'item_name', l.item_name,
       'quantity_uom', CAST(l.quantity_uom AS CHAR), 'location_id', CAST(l.location_id AS CHAR), 'storage_location_id', CAST(l.storage_location_id AS CHAR),
       'temp_qty_data', l.temp_qty_data, 'total_quantity', l.total_quantity, 'organization_id', l.organization_id, 'issuing_plant', CAST(l.issuing_plant AS CHAR),
       'receiving_plant', CAST(l.receiving_plant AS CHAR), 'item_remark', l.item_remark, 'parent_id', CAST(l.parent_id AS CHAR),
       'item_bundle_id', l.item_bundle_id, 'requested_qty', l.requested_qty) AS j
  FROM {LINES_OF}
 ORDER BY CAST(l.line_index AS UNSIGNED), l.id""", ["j"]),
    # every in-transit row of the document, all statuses (the classic's search: doc_id + organization_id, not deleted)
    "transit": (f"""SELECT JSON_OBJECT('id', CAST(t.id AS CHAR), 'doc_type', t.doc_type, 'doc_id', t.doc_id, 'doc_no', t.doc_no, 'doc_line_id', t.doc_line_id,
       'line_no', t.line_no, 'material_id', CAST(t.material_id AS CHAR), 'item_code', t.item_code, 'item_uom', CAST(t.item_uom AS CHAR),
       'batch_id', CAST(t.batch_id AS CHAR), 'handling_unit_id', t.handling_unit_id, 'plant_id', CAST(t.plant_id AS CHAR), 'organization_id', t.organization_id,
       'transit_bin', CAST(t.transit_bin AS CHAR), 'from_bin', CAST(t.from_bin AS CHAR), 'from_category', t.from_category, 'to_bin', CAST(t.to_bin AS CHAR),
       'to_category', t.to_category, 'transit_qty', CAST(t.transit_qty AS CHAR), 'received_qty', CAST(t.received_qty AS CHAR),
       'open_qty', CAST(t.open_qty AS CHAR), 'status', t.status, 'transit_date', DATE_FORMAT(t.transit_date, '%Y-%m-%d %H:%i:%s'),
       'received_date', DATE_FORMAT(t.received_date, '%Y-%m-%d %H:%i:%s')) AS j
  FROM in_transit_detail t
 WHERE t.tenant_id = {ET}
   AND t.doc_id = '{LOT}'
   AND t.organization_id = '{ORG}'
   AND t.is_deleted = 0
 ORDER BY t.id""", ["j"]),
    # the items of its lines (what the Enrich nodes and LABELS read)
    "items": (f"""SELECT JSON_OBJECT('id', CAST(i.id AS CHAR), 'material_code', i.material_code, 'material_name', i.material_name, 'material_desc', i.material_desc) AS j
  FROM item i
 WHERE i.tenant_id = {ET}
   AND i.is_deleted = 0
   AND i.id IN (SELECT CAST(l.item_selection AS UNSIGNED) FROM {LINES_OF})
 ORDER BY i.id""", ["j"]),
    # the plant's bins (LABELS: a failing movement's bin code)
    "bins": (f"""SELECT JSON_OBJECT('id', CAST(b.id AS CHAR), 'bin', b.bin_location_combine) AS j
  FROM bin_location b
 WHERE b.tenant_id = {ET}
   AND b.is_deleted = 0
   AND b.plant_id = (SELECT h.issuing_operation_faci FROM sm_location_transfer h WHERE h.tenant_id = {ET} AND h.id = {LOT} AND h.is_deleted = 0)
 ORDER BY b.id""", ["j"]),
    # GLOBAL_ALLOCATION's sql_node_ItemAlloc for every candidate at once (an sql-node row: its JSON columns stay text)
    "aitem": (f"""SELECT JSON_OBJECT('id', CAST(i.id AS CHAR), 'material_code', i.material_code, 'item_batch_management', i.item_batch_management,
       'stock_control', i.stock_control,
       'uom_conversion_json', CAST(COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('alt_uom_id', CAST(u.alt_uom_id AS CHAR), 'base_qty', u.base_qty))
                                             FROM item_mji552rc_sub u WHERE u.Item_id = i.id AND u.is_deleted = 0), '[]') AS CHAR),
       'default_bin_json', CAST(COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('plant_id', CAST(b.plant_id AS CHAR), 'bin_location', CAST(b.bin_location AS CHAR)))
                                          FROM item_wu520fpw_sub b WHERE b.Item_id = i.id AND b.is_deleted = 0), '[]') AS CHAR)) AS j
  FROM item i
 WHERE i.tenant_id = {ET}
   AND i.is_deleted = 0
   AND i.id IN ({CAND})
 ORDER BY i.id""", ["j"]),
    # GLOBAL_ALLOCATION's balance searches (search_node_mb8Vv8fZ / search_node_ARAmvXyd: material, organization, plant), id order
    "abal": (f"""SELECT x.k, x.j FROM (
SELECT 'IB' AS k, b.id AS sid, {jobj('b', 'item_balance')} AS j FROM item_balance b
 WHERE b.tenant_id = {ET} AND b.is_deleted = 0 AND b.organization_id = '{ORG}' AND b.plant_id = {PLANT} AND b.material_id IN ({CAND})
UNION ALL
SELECT 'IBB' AS k, bb.id AS sid, {jobj('bb', 'item_batch_balance')} AS j FROM item_batch_balance bb
 WHERE bb.tenant_id = {ET} AND bb.is_deleted = 0 AND bb.organization_id = '{ORG}' AND bb.plant_id = {PLANT} AND bb.material_id IN ({CAND})
) x ORDER BY x.k, x.sid""", ["k", "j"]),
    # the LOT's latest document lock (result_ref = the owning job's idempotency_key)
    "lock": (f"""SELECT p.step_name, p.result_ref
  FROM gd_publish_step p
 WHERE p.tenant_id = {ET}
   AND p.job_id = 'SMLT|{LOT}'
   AND p.step_name LIKE 'LOCK|%'
   AND p.is_deleted = 0
 ORDER BY p.id DESC
 LIMIT 1""", ["step_name", "result_ref"]),
}
