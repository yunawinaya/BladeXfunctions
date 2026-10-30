"""IA_TRANSFER_REQUEST's reads (ENH-20261027-001; builder scratchpad/iatr/build_iatr.py). Every read is one row, one JSON column j.
Tokens: @T tenant, @IA the Item Assembly, @ORG its organisation, @UID the session user, @LOT the request named (0 = none), @SL / @BIN
the destination (0 = none), @NEEDLINES / @NEEDNAMED / @NEEDDEST / @NEEDDEFECT 'YES' when the operation needs that part (else the part
is NULL). v8 (reserved requests, RESERVED_REQUEST_PLAN.md Task 7): the IA's lines with their picks, its RES-01 reservation rows, the
Item Assembly Setup rows of the organisation, and for DEFECT the names a stock summary shows and the received request's log.
Physical names: the IA's lines are sm_item_assembly_tlm8ve69_sub, a LOT's sm_location_transfer_d2c7o1jd_sub, an item's units
item_mji552rc_sub (its alt_uom_id rows, the base unit included); the IA's varchar item_selection is cast to the item id (exact)."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "iasc", "code", "shared"))
import sql as IASC  # noqa: E402

OPEN_JOBS = "('QUEUED', 'VALIDATING', 'READY_TO_COMMIT', 'COMMITTING_LOT', 'REQUIRES_REVIEW')"
NOW = "DATE_FORMAT(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'), '%Y-%m-%d %H:%i:%s')"
TS3 = "LEFT(DATE_FORMAT({c}, '%Y-%m-%d %H:%i:%s.%f'), 23)"
FIRST_LINE = """(SELECT CAST(l.{col} AS CHAR) FROM sm_location_transfer_d2c7o1jd_sub l
                   WHERE l.tenant_id = '@T' AND l.sm_location_transfer_id = g.id AND l.is_deleted = 0 ORDER BY l.id LIMIT 1)"""
IA_ITEMS = """(SELECT CAST(a2.item_selection AS UNSIGNED) FROM sm_item_assembly_tlm8ve69_sub a2
                       WHERE a2.tenant_id = '@T' AND a2.sm_item_assembly_id = @IA AND a2.is_deleted = 0)"""
# the IA's live RES-01 reservation rows (doc_id is varchar: the IA id quoted)
HOLDS = """r.tenant_id = '@T' AND r.organization_id = '@ORG' AND r.is_deleted = 0 AND r.doc_type = 'Item Assembly' AND r.doc_id = '@IA' AND r.status = 'Allocated'"""

# the IA: its header (status, hold, plant, organisation, number + the fingerprint basis); with @NEEDLINES its lines, their items and
# each item's units as the LOT form's uom_options rows (unit_of_measurement's columns as the form's collection read gives them)
IA_READ = """SELECT JSON_OBJECT(
  'ia', (SELECT JSON_OBJECT('id', CAST(h.id AS CHAR), 'status', h.item_assembly_status, 'hold', h.material_hold_status,
                 'plant', CAST(h.issuing_operation_faci AS CHAR), 'org', h.organization_id, 'no', h.stock_movement_no, 'item_id', CAST(h.item_id AS CHAR),
                 'item_qty', h.item_qty, 'planned_output_qty', h.planned_output_qty, 'bom_consumption_mode', h.bom_consumption_mode,
                 'source_bom_id', CAST(h.source_bom_id AS CHAR))
           FROM sm_item_assembly h WHERE h.tenant_id = '@T' AND h.id = @IA AND h.is_deleted = 0),
  'lines', (SELECT JSON_ARRAYAGG(JSON_OBJECT('id', CAST(a.id AS CHAR), 'item_selection', a.item_selection, 'item_name', a.item_name,
                   'quantity_uom', CAST(a.quantity_uom AS CHAR), 'requested_qty', a.requested_qty, 'required_qty', a.required_qty, 'sc_ref_key', a.sc_ref_key,
                   'line_index', a.line_index, 'temp_qty_data', a.temp_qty_data, 'temp_hu_data', a.temp_hu_data))
              FROM sm_item_assembly_tlm8ve69_sub a WHERE '@NEEDLINES' = 'YES' AND a.tenant_id = '@T' AND a.sm_item_assembly_id = @IA AND a.is_deleted = 0),
  'holds', (SELECT JSON_ARRAYAGG(JSON_OBJECT('id', CAST(r.id AS CHAR), 'status', r.status, 'doc_line_id', r.doc_line_id, 'material_id', CAST(r.material_id AS CHAR),
                   'bin_location', CAST(r.bin_location AS CHAR), 'batch_id', CAST(r.batch_id AS CHAR), 'from_category', r.from_category,
                   'open_qty', CAST(r.open_qty AS CHAR), 'reserved_qty', CAST(r.reserved_qty AS CHAR), 'item_uom', CAST(r.item_uom AS CHAR), 'job_line_key', r.job_line_key))
              FROM on_reserved_gd r WHERE '@NEEDLINES' = 'YES' AND """ + HOLDS + """),
  'uomNames', (SELECT JSON_ARRAYAGG(JSON_OBJECT('id', CAST(u.id AS CHAR), 'uom_name', u.uom_name))
                 FROM unit_of_measurement u WHERE '@NEEDDEFECT' = 'YES' AND u.id IN (SELECT a3.quantity_uom FROM sm_item_assembly_tlm8ve69_sub a3
                                                                                      WHERE a3.tenant_id = '@T' AND a3.sm_item_assembly_id = @IA AND a3.is_deleted = 0)),
  'binNames', (SELECT JSON_ARRAYAGG(JSON_OBJECT('id', CAST(b.id AS CHAR), 'name', b.bin_location_combine))
                 FROM bin_location b WHERE '@NEEDDEFECT' = 'YES' AND b.tenant_id = '@T' AND b.id IN (SELECT r.bin_location FROM on_reserved_gd r WHERE """ + HOLDS + """)),
  'batchNos', (SELECT JSON_ARRAYAGG(JSON_OBJECT('id', CAST(c.id AS CHAR), 'batch_number', c.batch_number))
                 FROM batch c WHERE '@NEEDDEFECT' = 'YES' AND c.tenant_id = '@T' AND c.id IN (SELECT r.batch_id FROM on_reserved_gd r WHERE """ + HOLDS + """)),
  'items', (SELECT JSON_ARRAYAGG(JSON_OBJECT('id', CAST(i.id AS CHAR), 'stock_control', i.stock_control, 'serial_number_management', i.serial_number_management,
                   'material_name', i.material_name, 'material_code', i.material_code, 'material_desc', i.material_desc))
              FROM item i WHERE '@NEEDLINES' = 'YES' AND i.tenant_id = '@T' AND i.is_deleted = 0 AND i.id IN """ + IA_ITEMS + """),
  'uoms', (SELECT JSON_ARRAYAGG(JSON_OBJECT('item', x.item, 'row', x.row_j))
             FROM (SELECT CAST(c.Item_id AS CHAR) AS item,
                          JSON_OBJECT('create_dept', CAST(u.create_dept AS CHAR), 'create_time', """ + TS3.format(c="u.create_time") + """, 'create_user', CAST(u.create_user AS CHAR),
                            'id', CAST(u.id AS CHAR), 'is_deleted', u.is_deleted, 'organization_id', u.organization_id, 'sub_tenant_id', CAST(u.sub_tenant_id AS CHAR),
                            'tenant_id', u.tenant_id, 'uom_name', u.uom_name, 'update_time', """ + TS3.format(c="u.update_time") + """,
                            'update_user', CAST(u.update_user AS CHAR)) AS row_j
                     FROM item_mji552rc_sub c JOIN unit_of_measurement u ON u.id = c.alt_uom_id AND u.is_deleted = 0
                    WHERE '@NEEDLINES' = 'YES' AND c.tenant_id = '@T' AND c.is_deleted = 0 AND c.Item_id IN """ + IA_ITEMS + """
                    ORDER BY c.Item_id, c.id LIMIT 100000) x)) AS j"""

# the IA's requests (each with its first line's destination) and, with @NEEDNAMED, the request named: + its purpose, source, log, lines,
# open SAVE_LOT jobs and open In Transit rows
REQ_READ = """SELECT JSON_OBJECT(
  'reqs', (SELECT JSON_ARRAYAGG(JSON_OBJECT('id', CAST(g.id AS CHAR), 'no', g.stock_movement_no, 'status', g.stock_movement_status, 'rev', g.source_ia_rev,
                  'fp', g.source_ia_fp, 'sl', """ + FIRST_LINE.format(col="storage_location_id") + """, 'bin', """ + FIRST_LINE.format(col="location_id") + """,
                  'log', IF('@NEEDDEFECT' = 'YES', g.request_log, NULL)))
             FROM sm_location_transfer g
            WHERE g.tenant_id = '@T' AND g.is_deleted = 0 AND g.transfer_purpose = 'IA_SUPPLY' AND g.source_ia_id = '@IA'),
  'named', (SELECT JSON_OBJECT('id', CAST(g.id AS CHAR), 'no', g.stock_movement_no, 'status', g.stock_movement_status, 'purpose', g.transfer_purpose,
                   'source', g.source_ia_id, 'fp', g.source_ia_fp, 'rev', g.source_ia_rev, 'log', g.request_log, 'org', CAST(g.organization_id AS CHAR),
                   'sl', """ + FIRST_LINE.format(col="storage_location_id") + """, 'bin', """ + FIRST_LINE.format(col="location_id") + """,
                   'lines', (SELECT JSON_ARRAYAGG(JSON_OBJECT('id', CAST(l.id AS CHAR), 'item_selection', l.item_selection, 'quantity_uom', CAST(l.quantity_uom AS CHAR),
                                    'requested_qty', l.requested_qty, 'source_ia_line_id', l.source_ia_line_id,
                                    'storage_location_id', CAST(l.storage_location_id AS CHAR), 'location_id', CAST(l.location_id AS CHAR)))
                               FROM sm_location_transfer_d2c7o1jd_sub l WHERE l.tenant_id = '@T' AND l.sm_location_transfer_id = g.id AND l.is_deleted = 0),
                   'openJobs', (SELECT COUNT(*) FROM gd_async_job j WHERE j.tenant_id = '@T' AND j.is_deleted = 0 AND j.command = 'SAVE_LOT'
                                   AND j.correlation_id = 'LOT|@LOT' AND j.job_status IN """ + OPEN_JOBS + """),
                   'openTransit', (SELECT COUNT(*) FROM in_transit_detail t WHERE t.tenant_id = '@T' AND t.doc_id = '@LOT' AND t.is_deleted = 0
                                      AND t.status = 'In Transit'))
              FROM sm_location_transfer g WHERE '@NEEDNAMED' = 'YES' AND g.tenant_id = '@T' AND g.id = @LOT AND g.is_deleted = 0)) AS j"""

# CREATE: the destination storage location and bin, and the organisation's Location Transfer number rule (the issued one: every prod
# tenant has exactly one is_default 1 / is_draft 0 row per department, 10-28)
DEST_READ = """SELECT JSON_OBJECT(
  'sl', (SELECT JSON_OBJECT('id', CAST(s.id AS CHAR), 'plant', CAST(s.plant_id AS CHAR), 'active', s.storage_status, 'name', s.storage_location_name)
           FROM storage_location s WHERE '@NEEDDEST' = 'YES' AND s.tenant_id = '@T' AND s.id = @SL AND s.is_deleted = 0),
  'bin', (SELECT JSON_OBJECT('id', CAST(b.id AS CHAR), 'plant', CAST(b.plant_id AS CHAR), 'sl', CAST(b.storage_location_id AS CHAR), 'active', b.bin_status,
                  'name', b.bin_location_combine)
            FROM bin_location b WHERE '@NEEDDEST' = 'YES' AND b.tenant_id = '@T' AND b.id = @BIN AND b.is_deleted = 0),
  'rule', (SELECT CAST(r.id AS CHAR) FROM su_code_serial_no_rule r
            WHERE '@NEEDDEST' = 'YES' AND r.tenant_id = '@T' AND r.business_type = 'Location Transfer' AND r.is_default = 1 AND r.is_draft = 0
              AND r.department_id = @ORG AND r.is_deleted = 0 ORDER BY r.id LIMIT 1)) AS j"""

# the session user: assigned to the organisation (FIX-03, IA_SC_RELINK's rule), its name (the requester), the server clock (UTC+8) and the
# IA's highest claim number ever (IATR|<ia> / CLAIM|<n>: the unique key counts soft-deleted rows too)
WHO_READ = """SELECT JSON_OBJECT(
  'member', """ + IASC.MEMBER_EXPR + """,
  'user', (SELECT COALESCE(NULLIF(u.real_name, ''), NULLIF(u.name, ''), u.account) FROM blade_user u WHERE u.tenant_id = '@T' AND u.is_deleted = 0 AND u.id = @UID LIMIT 1),
  'max', (SELECT COALESCE(MAX(CAST(SUBSTRING(p.step_name, 7) AS UNSIGNED)), 0) FROM gd_publish_step p
           WHERE p.tenant_id = '@T' AND p.job_id = 'IATR|@IA' AND p.step_name LIKE 'CLAIM|%'),
  'now', """ + NOW + """,
  'setup', (SELECT JSON_ARRAYAGG(JSON_OBJECT('organization_id', s.organization_id, 'plant_id', CAST(s.plant_id AS CHAR), 'transfer_request_enabled', s.transfer_request_enabled,
                   'is_deleted', s.is_deleted))
              FROM item_assembly_setup s WHERE s.tenant_id = '@T' AND s.organization_id = '@ORG' AND s.is_deleted = 0)) AS j"""

# after our claim: the IA's HELD claims, its status, its requests and the named request's open SAVE_LOT jobs now
CLAIM_READ = """SELECT JSON_OBJECT(
  'claims', (SELECT JSON_ARRAYAGG(JSON_OBJECT('id', CAST(p.id AS CHAR), 'name', p.step_name, 'started_at', DATE_FORMAT(p.started_at, '%Y-%m-%d %H:%i:%s')))
               FROM gd_publish_step p WHERE p.tenant_id = '@T' AND p.job_id = 'IATR|@IA' AND p.step_name LIKE 'CLAIM|%' AND p.step_status = 'HELD'
                AND p.is_deleted = 0),
  'status', (SELECT h.item_assembly_status FROM sm_item_assembly h WHERE h.tenant_id = '@T' AND h.id = @IA AND h.is_deleted = 0),
  'reqs', (SELECT JSON_ARRAYAGG(JSON_OBJECT('id', CAST(g.id AS CHAR), 'status', g.stock_movement_status))
             FROM sm_location_transfer g WHERE g.tenant_id = '@T' AND g.is_deleted = 0 AND g.transfer_purpose = 'IA_SUPPLY' AND g.source_ia_id = '@IA'),
  'openJobs', (SELECT COUNT(*) FROM gd_async_job j WHERE @LOT > 0 AND j.tenant_id = '@T' AND j.is_deleted = 0 AND j.command = 'SAVE_LOT'
                  AND j.correlation_id = 'LOT|@LOT' AND j.job_status IN """ + OPEN_JOBS + """),
  'now', """ + NOW + """) AS j"""

# after the write: the request (the one named, else the IA's newest - ours: the claim held, no live one) with its lines
BACK_READ = """SELECT JSON_OBJECT('lot', (SELECT JSON_OBJECT('id', CAST(g.id AS CHAR), 'no', g.stock_movement_no, 'status', g.stock_movement_status,
                 'fp', g.source_ia_fp, 'rev', g.source_ia_rev, 'purpose', g.transfer_purpose, 'source', g.source_ia_id, 'job', g.lot_v2_job_id,
                 'lines', (SELECT JSON_ARRAYAGG(JSON_OBJECT('id', CAST(l.id AS CHAR), 'source_ia_line_id', l.source_ia_line_id, 'requested_qty', l.requested_qty))
                             FROM sm_location_transfer_d2c7o1jd_sub l WHERE l.tenant_id = '@T' AND l.sm_location_transfer_id = g.id AND l.is_deleted = 0))
           FROM sm_location_transfer g
          WHERE g.tenant_id = '@T' AND g.is_deleted = 0 AND g.transfer_purpose = 'IA_SUPPLY' AND g.source_ia_id = '@IA' AND (@LOT = 0 OR g.id = @LOT)
          ORDER BY g.id DESC LIMIT 1),
  'holds', (SELECT JSON_ARRAYAGG(JSON_OBJECT('id', CAST(r.id AS CHAR), 'status', r.status, 'open_qty', CAST(r.open_qty AS CHAR)))
              FROM on_reserved_gd r WHERE '@NEEDDEFECT' = 'YES' AND r.tenant_id = '@T' AND r.organization_id = '@ORG' AND r.is_deleted = 0 AND r.doc_type = 'Item Assembly'
               AND r.doc_id = '@IA'),
  'lines', (SELECT JSON_ARRAYAGG(JSON_OBJECT('id', CAST(a.id AS CHAR), 'temp_qty_data', a.temp_qty_data, 'stock_summary', a.stock_summary))
              FROM sm_item_assembly_tlm8ve69_sub a WHERE '@NEEDDEFECT' = 'YES' AND a.tenant_id = '@T' AND a.sm_item_assembly_id = @IA AND a.is_deleted = 0)) AS j"""

# the LOT columns the LOT form publish creates (WP5); until then a dev SQL check stubs them
NEW_LOT_COLUMNS = ["transfer_purpose", "source_ia_id", "source_ia_no", "source_ia_fp", "source_ia_rev", "required_date", "requested_by", "requested_at",
                   "replaces_id", "request_log", "replacement_for_id"]
NEW_LOT_LINE_COLUMNS = ["source_ia_line_id", "source_ref_key"]
NEW_IA_COLUMNS = ["transfer_request_id", "transfer_request_no"]
