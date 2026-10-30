"""IA_HOLD SQL (scratchpad/iasc/res01/RES01_PLAN.md). Filled with iav2 lib/v2build.sub after the guard checked every value is digits:
'@T' / '@IAQ' / '@ORG' / '@PLANTQ' hand-quoted (varchar columns: an unquoted 19-digit id against varchar compares as a DOUBLE and
matches neighbouring ids), @IA / @PLANT / @MATS bare digits (bigint columns), '@KEYS' / '@OPSQ' JSON text from a code node. Every
row is one JSON column `j`, ids cast to text."""

# the IA: header, live lines, its own hold rows (Allocated, and Processing / Releasing left by an unfinished run; the organisation lets
# the on_reserved_gd (tenant, organisation, is_deleted, doc_type) index serve it), the highest ticket and the HELD tickets of the IA's
# hold mutex, the clock (leases and timestamps: UTC+8 as the app writes every datetime; prod sessions run UTC, so never NOW()); one row
STATE = """SELECT JSON_OBJECT(
       'now', DATE_FORMAT(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'), '%Y-%m-%d %H:%i:%s'),
       'ia', (SELECT JSON_OBJECT('id', CAST(h.id AS CHAR), 'no', h.stock_movement_no, 'status', h.item_assembly_status, 'organization_id', h.organization_id,
                'plant_id', CAST(h.issuing_operation_faci AS CHAR), 'hold', h.material_hold_status, 'hold_at', h.material_hold_at, 'is_deleted', h.is_deleted,
                'ut', DATE_FORMAT(h.update_time, '%Y-%m-%d %H:%i:%s.%f'))
                FROM sm_item_assembly h WHERE h.tenant_id = '@T' AND h.id = @IA),
       'lines', (SELECT JSON_ARRAYAGG(JSON_OBJECT('id', CAST(l.id AS CHAR), 'item_selection', l.item_selection, 'item_name', l.item_name,
                'quantity_uom', CAST(l.quantity_uom AS CHAR), 'total_quantity', CAST(l.total_quantity AS CHAR), 'required_qty', CAST(l.required_qty AS CHAR),
                'requested_qty', CAST(l.requested_qty AS CHAR), 'temp_qty_data', l.temp_qty_data, 'temp_hu_data', l.temp_hu_data, 'is_deleted', l.is_deleted))
                FROM sm_item_assembly_tlm8ve69_sub l WHERE l.tenant_id = '@T' AND l.sm_item_assembly_id = @IA AND l.is_deleted = 0),
       'rows', (SELECT JSON_ARRAYAGG(JSON_OBJECT('id', CAST(r.id AS CHAR), 'status', r.status, 'doc_line_id', r.doc_line_id, 'material_id', CAST(r.material_id AS CHAR),
                'bin_location', CAST(r.bin_location AS CHAR), 'batch_id', CAST(r.batch_id AS CHAR), 'from_category', r.from_category, 'open_qty', CAST(r.open_qty AS CHAR),
                'reserved_qty', CAST(r.reserved_qty AS CHAR), 'item_uom', CAST(r.item_uom AS CHAR), 'job_line_key', r.job_line_key))
                FROM on_reserved_gd r WHERE r.tenant_id = '@T' AND r.organization_id = '@ORG' AND r.is_deleted = 0 AND r.doc_type = 'Item Assembly'
                 AND r.doc_id = '@IAQ' AND r.status IN ('Allocated', 'Processing', 'Releasing')),
       'ticket_max', (SELECT COALESCE(MAX(CAST(SUBSTRING(p.step_name, 8) AS UNSIGNED)), 0) FROM gd_publish_step p
                WHERE p.tenant_id = '@T' AND p.job_id = 'IAH|@IAQ' AND p.step_name LIKE 'TICKET|%' AND p.is_deleted = 0),
       'held', (SELECT JSON_ARRAYAGG(JSON_OBJECT('id', CAST(p.id AS CHAR), 'n', CAST(SUBSTRING(p.step_name, 8) AS UNSIGNED),
                'started_at', DATE_FORMAT(p.started_at, '%Y-%m-%d %H:%i:%s'), 'op', p.result_ref))
                FROM gd_publish_step p WHERE p.tenant_id = '@T' AND p.job_id = 'IAH|@IAQ' AND p.step_name LIKE 'TICKET|%' AND p.step_status = 'HELD'
                 AND p.is_deleted = 0),
       'transit', (SELECT JSON_OBJECT('id', CAST(q.id AS CHAR), 'no', q.stock_movement_no, 'status', q.stock_movement_status)
                FROM sm_location_transfer q WHERE q.tenant_id = '@T' AND q.is_deleted = 0 AND q.transfer_purpose = 'IA_SUPPLY' AND q.source_ia_id = '@IAQ'
                 AND q.stock_movement_status IN ('In Progress', 'Processing') ORDER BY q.id DESC LIMIT 1)) AS j"""

# the IA header just before the finish (review I1): a save while this run worked marked it RESERVING again and moved its update_time
HEAD = """SELECT JSON_OBJECT('hold', h.material_hold_status, 'ut', DATE_FORMAT(h.update_time, '%Y-%m-%d %H:%i:%s.%f')) AS j
FROM sm_item_assembly h WHERE h.tenant_id = '@T' AND h.id = @IA"""

# the IA's items: stock / serial flags, base unit and conversions, costing method
ITEMS = """SELECT JSON_OBJECT('id', CAST(i.id AS CHAR), 'stock_control', i.stock_control, 'serial_number_management', i.serial_number_management,
       'material_code', i.material_code, 'material_name', i.material_name, 'material_desc', i.material_desc,
       'based_uom', CAST(i.based_uom AS CHAR), 'material_costing_method', i.material_costing_method,
       'table_uom_conversion', COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('alt_uom_id', CAST(u.alt_uom_id AS CHAR), 'alt_qty', CAST(u.alt_qty AS CHAR),
         'base_qty', CAST(u.base_qty AS CHAR))) FROM item_mji552rc_sub u WHERE u.Item_id = i.id AND u.is_deleted = 0), JSON_ARRAY())) AS j
  FROM item i
 WHERE i.tenant_id = '@T'
   AND i.is_deleted = 0
   AND i.id IN (SELECT CAST(l.item_selection AS UNSIGNED) FROM sm_item_assembly_tlm8ve69_sub l
                 WHERE l.tenant_id = '@T' AND l.sm_item_assembly_id = @IA AND l.is_deleted = 0 AND l.item_selection REGEXP '^[0-9]{1,20}$')"""

# the free stock at the (material, bin, batch or 0) keys to hold, at the IA's plant + organisation, with the engine's two
# refusals screened per key: duplicate balance rows (DUPLICATE_BALANCE) and costing rows that need migration (UNSUPPORTED_COSTING:
# FIFO and WA rows both, a FIFO item with WA rows only, a WA item with FIFO rows only); aggregated joins, never a correlated EXISTS
BAL = """SELECT JSON_OBJECT('material_id', CAST(k.m AS CHAR), 'location_id', CAST(k.l AS CHAR), 'batch_id', CAST(NULLIF(k.b, 0) AS CHAR),
       'unrestricted_qty', CAST(COALESCE(IF(k.b = 0, ib.u, bb.u), 0) AS CHAR), 'block_qty', CAST(COALESCE(IF(k.b = 0, ib.bk, bb.bk), 0) AS CHAR),
       'item_rows', COALESCE(ib.n, 0), 'batch_rows', COALESCE(bb.n, 0), 'method', i.material_costing_method, 'fifo', COALESCE(f.n, 0), 'wa', COALESCE(w.n, 0)) AS j
  FROM (SELECT DISTINCT jt.m, jt.l, jt.b FROM JSON_TABLE('@KEYS', '$[*]' COLUMNS (m BIGINT PATH '$[0]', l BIGINT PATH '$[1]', b BIGINT PATH '$[2]')) jt) k
  JOIN item i ON i.id = k.m AND i.tenant_id = '@T' AND i.is_deleted = 0
  LEFT JOIN (SELECT x.material_id AS m, x.location_id AS l, COUNT(*) AS n, SUM(x.unrestricted_qty) AS u, SUM(x.block_qty) AS bk
               FROM item_balance x
              WHERE x.tenant_id = '@T' AND x.is_deleted = 0 AND x.plant_id = @PLANT AND x.organization_id = '@ORG' AND x.material_id IN (@MATS)
              GROUP BY x.material_id, x.location_id) ib ON ib.m = k.m AND ib.l = k.l
  LEFT JOIN (SELECT y.material_id AS m, y.location_id AS l, y.batch_id AS b, COUNT(*) AS n, SUM(y.unrestricted_qty) AS u, SUM(y.block_qty) AS bk
               FROM item_batch_balance y
              WHERE y.tenant_id = '@T' AND y.is_deleted = 0 AND y.plant_id = @PLANT AND y.organization_id = '@ORG' AND y.material_id IN (@MATS)
              GROUP BY y.material_id, y.location_id, y.batch_id) bb ON bb.m = k.m AND bb.l = k.l AND bb.b = k.b
  LEFT JOIN (SELECT fc.material_id AS m, COALESCE(fc.batch_id, 0) AS b, COUNT(*) AS n
               FROM fifo_costing_history fc
              WHERE fc.tenant_id = '@T' AND fc.is_deleted = 0 AND fc.plant_id = @PLANT AND fc.organization_id = '@ORG' AND fc.material_id IN (@MATS)
              GROUP BY fc.material_id, COALESCE(fc.batch_id, 0)) f ON f.m = k.m AND f.b = k.b
  LEFT JOIN (SELECT wc.material_id AS m, COALESCE(wc.batch_id, 0) AS b, COUNT(*) AS n
               FROM wa_costing_method wc
              WHERE wc.tenant_id = '@T' AND wc.is_deleted = 0 AND wc.plant_id = '@PLANTQ' AND wc.organization_id = '@ORG' AND wc.material_id IN (@MATS)
              GROUP BY wc.material_id, COALESCE(wc.batch_id, 0)) w ON w.m = k.m AND w.b = k.b
 ORDER BY k.m, k.l, k.b"""

# the engine's own record of these operation keys (INVENTORY_BULK_APPLY's gd_publish_step rows: IBA|I|<n> intents, IBA|DONE):
# DONE = it applied; no intent = nothing moved; intents without DONE = uncertain. The JSON_TABLE column takes job_id's collation
# (else MySQL refuses the IN: utf8mb4_general_ci vs utf8mb4_0900_ai_ci, found on dev 10-21)
OPS = """SELECT JSON_OBJECT('op', p.job_id, 'done', SUM(p.step_name = 'IBA|DONE'), 'intents', SUM(p.step_name LIKE 'IBA|I|%')) AS j
  FROM gd_publish_step p
 WHERE p.tenant_id = '@T'
   AND p.is_deleted = 0
   AND p.job_id IN (SELECT jt.op FROM JSON_TABLE('@OPSQ', '$[*]' COLUMNS (op VARCHAR(32) COLLATE utf8mb4_general_ci PATH '$')) jt)
 GROUP BY p.job_id"""

# CLOSE: this cycle = after the IA was created and after its last revert ('IA-R') under this number. kind OUT = what its completion
# issued from Reserved per (item, bin, batch) in base units (inventory_movement: bin_location_id / batch_number_id, no index but the
# PK: the id bound keeps it a range scan); kind DELIVERED = this cycle's own Delivered rows (a re-run never delivers twice).
# '@NOHEX' = the IA number as the upper-case hex of its UTF-8 bytes (hold/plan.js): only hex digits reach the SQL text (review M6).
# trx_no / doc_no are utf8mb4_general_ci and the connection utf8mb4_0900_ai_ci: without the COLLATE, MySQL 8.4 refuses the '='
NO = "CONVERT(UNHEX('@NOHEX') USING utf8mb4) COLLATE utf8mb4_general_ci"
CYCLE = """(SELECT GREATEST(@IA, COALESCE(MAX(r.id), 0)) AS lo FROM inventory_movement r
         WHERE r.tenant_id = '@T' AND r.is_deleted = 0 AND r.id > @IA AND r.trx_no = """ + NO + """ AND r.transaction_type = 'IA-R')"""
CONSUMED = """SELECT JSON_OBJECT('kind', 'OUT', 'key', CONCAT(CAST(m.item_id AS CHAR), '|', CAST(m.bin_location_id AS CHAR), '|', COALESCE(CAST(m.batch_number_id AS CHAR), '')),
       'base', CAST(SUM(m.base_qty) AS CHAR)) AS j
  FROM inventory_movement m
  JOIN """ + CYCLE + """ b ON m.id > b.lo
 WHERE m.tenant_id = '@T' AND m.is_deleted = 0 AND m.organization_id = '@ORG' AND m.trx_no = """ + NO + """
   AND m.transaction_type = 'IA' AND m.movement = 'OUT' AND m.inventory_category = 'Reserved'
 GROUP BY m.item_id, m.bin_location_id, m.batch_number_id
UNION ALL
SELECT JSON_OBJECT('kind', 'DELIVERED', 'id', CAST(d.id AS CHAR), 'material_id', CAST(d.material_id AS CHAR), 'bin_location', CAST(d.bin_location AS CHAR),
       'batch_id', CAST(d.batch_id AS CHAR), 'item_uom', CAST(d.item_uom AS CHAR), 'delivered_qty', CAST(d.delivered_qty AS CHAR)) AS j
  FROM on_reserved_gd d
  JOIN """ + CYCLE + """ b ON d.id > b.lo
 WHERE d.tenant_id = '@T' AND d.organization_id = '@ORG' AND d.is_deleted = 0 AND d.doc_type = 'Item Assembly' AND d.doc_id = '@IAQ' AND d.status = 'Delivered'
   AND d.doc_no = """ + NO

# the HELD tickets after ours was written (the mutex: the lowest live one wins)
TICKETS = """SELECT JSON_OBJECT('id', CAST(p.id AS CHAR), 'n', CAST(SUBSTRING(p.step_name, 8) AS UNSIGNED), 'started_at', DATE_FORMAT(p.started_at, '%Y-%m-%d %H:%i:%s'),
       'op', p.result_ref) AS j
  FROM gd_publish_step p
 WHERE p.tenant_id = '@T' AND p.job_id = 'IAH|@IAQ' AND p.step_name LIKE 'TICKET|%' AND p.step_status = 'HELD' AND p.is_deleted = 0
 ORDER BY p.id"""

# MIN-05 (BA 10-22): SWEEP - the IAs deleted while still marked as holding (a list delete writes the header first, then releases: one
# interrupted in between leaves its mark), at most 20, tenant-wide (each release is a RELEASE_ALL that checks the user's organisation)
SWEEP = """SELECT JSON_OBJECT('ias', (SELECT JSON_ARRAYAGG(JSON_OBJECT('id', CAST(x.id AS CHAR), 'org', CAST(x.organization_id AS CHAR), 'no', x.stock_movement_no))
                FROM (SELECT h.id, h.organization_id, h.stock_movement_no FROM sm_item_assembly h
                       WHERE h.tenant_id = '@T' AND h.is_deleted = 1 AND h.material_hold_status IS NOT NULL
                         AND h.material_hold_status NOT IN ('', 'NONE', 'CLOSED') ORDER BY h.id LIMIT 20) x)) AS j"""

# BA rev 1.2 C2: CHECK - the IA's completion claims (IAS|<ia> / CLAIM|<n>: HELD, or FREE with how it ended) and its status, organisation, the clock
CHECK = """SELECT JSON_OBJECT(
       'claims', (SELECT JSON_ARRAYAGG(JSON_OBJECT('n', CAST(SUBSTRING(p.step_name, 7) AS UNSIGNED), 'status', p.step_status, 'ref', p.result_ref,
                'at', DATE_FORMAT(p.started_at, '%Y-%m-%d %H:%i:%s')))
                FROM gd_publish_step p WHERE p.tenant_id = '@T' AND p.job_id = 'IAS|@IAQ' AND p.step_name LIKE 'CLAIM|%' AND p.is_deleted = 0),
       'status', (SELECT h.item_assembly_status FROM sm_item_assembly h WHERE h.tenant_id = '@T' AND h.id = '@IAQ' AND h.is_deleted = 0),
       'org', (SELECT CAST(h.organization_id AS CHAR) FROM sm_item_assembly h WHERE h.tenant_id = '@T' AND h.id = '@IAQ' AND h.is_deleted = 0),
       'now', DATE_FORMAT(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'), '%Y-%m-%d %H:%i:%s')) AS j"""
