"""Small Cycle SQL (CONTRACT.md section 6). Filled with iav2 lib/v2build.sub: '@T' / '@ORG' / '@LINEQ' / '@SOQ' / '@ITEMQ' are
hand-quoted (the varchar link columns are ALWAYS compared as strings: an unquoted 19-digit id against varchar compares as a
DOUBLE and matches neighbouring ids; a CAST(... AS CHAR) compared with a column needs COLLATE utf8mb4_general_ci), @LINE / @SO / @ITEM / @IA are bare digits ("0" = none). The guard checked every value is
digits. Every row is one JSON column `j`, ids cast to text."""

# the line (deleted too, so a removed line is reported) and its header with the customer's display name
P_LINE = """SELECT JSON_OBJECT(
       'line', IF(l.id IS NULL, NULL, JSON_OBJECT('id', CAST(l.id AS CHAR), 'sales_order_id', CAST(l.sales_order_id AS CHAR),
         'item_name', l.item_name, 'so_quantity', CAST(l.so_quantity AS CHAR), 'so_item_uom', CAST(l.so_item_uom AS CHAR),
         'delivered_qty', CAST(l.delivered_qty AS CHAR), 'line_status', l.line_status, 'is_deleted', l.is_deleted, 'line_index', l.line_index,
         'plant_id', CAST(l.plant_id AS CHAR))),
       'header', IF(s.id IS NULL, NULL, JSON_OBJECT('id', CAST(s.id AS CHAR), 'so_no', s.so_no, 'so_status', s.so_status,
         'organization_id', s.organization_id, 'customer_id', CAST(s.customer_name AS CHAR), 'customer_name', c.customer_com_name,
         'is_deleted', s.is_deleted))) AS j
  FROM (SELECT 1 AS one) d
  LEFT JOIN sales_order_axszx8cj_sub l ON l.tenant_id = '@T' AND l.id = @LINE
  LEFT JOIN sales_order s ON s.tenant_id = '@T' AND s.id = COALESCE(l.sales_order_id, @SO)
  LEFT JOIN customer c ON c.tenant_id = '@T' AND CAST(c.id AS CHAR) COLLATE utf8mb4_general_ci = s.customer_name"""

IA_COLS = """JSON_OBJECT('id', CAST(h.id AS CHAR), 'no', h.stock_movement_no, 'status', h.item_assembly_status, 'item_id', h.item_id,
       'item_qty', CAST(h.item_qty AS CHAR), 'item_uom', CAST(h.item_uom AS CHAR), 'planned_output_qty', CAST(h.planned_output_qty AS CHAR),
       'mode', h.bom_consumption_mode, 'is_deleted', h.is_deleted, 'source_so_id', h.source_so_id, 'source_so_line_id', h.source_so_line_id)"""

# the IAs linked to one line, in the caller's organisation
P_IAS = """SELECT """ + IA_COLS + """ AS j
  FROM sm_item_assembly h
 WHERE h.tenant_id = '@T'
   AND h.is_deleted = 0
   AND h.organization_id = '@ORG'
   AND h.source_so_line_id = '@LINEQ'
 ORDER BY h.id"""

# the FG item with its UOM conversions
P_FG = """SELECT JSON_OBJECT('id', CAST(i.id AS CHAR), 'material_name', i.material_name, 'based_uom', CAST(i.based_uom AS CHAR),
       'table_uom_conversion', COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('alt_uom_id', CAST(u.alt_uom_id AS CHAR), 'alt_qty', CAST(u.alt_qty AS CHAR),
         'base_qty', CAST(u.base_qty AS CHAR), 'base_uom_id', CAST(u.base_uom_id AS CHAR)))
           FROM item_mji552rc_sub u WHERE u.Item_id = i.id AND u.is_deleted = 0), JSON_ARRAY())) AS j
  FROM item i
 WHERE i.tenant_id = '@T'
   AND i.id = @ITEM
   AND i.is_deleted = 0"""

SO_OF_LINE = """SELECT COALESCE((SELECT x.sales_order_id FROM sales_order_axszx8cj_sub x WHERE x.tenant_id = '@T' AND x.id = @LINE), @SO) AS so"""

# re-link candidates: the live lines of the same SO for the same item
P_RELINK = """SELECT JSON_OBJECT('id', CAST(l.id AS CHAR), 'line_index', l.line_index, 'item_name', l.item_name,
       'so_quantity', CAST(l.so_quantity AS CHAR), 'so_item_uom', CAST(l.so_item_uom AS CHAR), 'delivered_qty', CAST(l.delivered_qty AS CHAR),
       'line_status', l.line_status) AS j
  FROM sales_order_axszx8cj_sub l
 CROSS JOIN (""" + SO_OF_LINE + """) k
 WHERE l.tenant_id = '@T'
   AND l.sales_order_id = k.so
   AND l.is_deleted = 0
   AND l.item_name = '@ITEMQ'
 ORDER BY l.id"""

# IAs of this SO whose line no longer exists (shown on the SO page with a Re-link action)
P_ORPHANS = """SELECT """ + IA_COLS + """ AS j
  FROM sm_item_assembly h
 CROSS JOIN (""" + SO_OF_LINE + """) k
 WHERE h.tenant_id = '@T'
   AND h.is_deleted = 0
   AND h.organization_id = '@ORG'
   AND h.source_so_id = CAST(k.so AS CHAR) COLLATE utf8mb4_general_ci
   AND NOT EXISTS (SELECT 1 FROM sales_order_axszx8cj_sub l
                    WHERE l.tenant_id = '@T' AND l.sales_order_id = k.so AND l.is_deleted = 0 AND CAST(l.id AS CHAR) COLLATE utf8mb4_general_ci = h.source_so_line_id)
 ORDER BY h.id"""

# CANDIDATES: live lines of eligible SOs for one item, newest 200
P_CAND = """SELECT JSON_OBJECT(
       'line', JSON_OBJECT('id', CAST(l.id AS CHAR), 'sales_order_id', CAST(l.sales_order_id AS CHAR), 'item_name', l.item_name,
         'so_quantity', CAST(l.so_quantity AS CHAR), 'so_item_uom', CAST(l.so_item_uom AS CHAR), 'delivered_qty', CAST(l.delivered_qty AS CHAR),
         'line_status', l.line_status, 'is_deleted', l.is_deleted, 'line_index', l.line_index, 'plant_id', CAST(l.plant_id AS CHAR)),
       'header', JSON_OBJECT('id', CAST(s.id AS CHAR), 'so_no', s.so_no, 'so_status', s.so_status, 'organization_id', s.organization_id,
         'customer_id', CAST(s.customer_name AS CHAR), 'customer_name', c.customer_com_name, 'is_deleted', s.is_deleted)) AS j
  FROM sales_order_axszx8cj_sub l
  JOIN sales_order s ON s.id = l.sales_order_id AND s.tenant_id = '@T' AND s.is_deleted = 0
  LEFT JOIN customer c ON c.tenant_id = '@T' AND CAST(c.id AS CHAR) COLLATE utf8mb4_general_ci = s.customer_name
 WHERE l.tenant_id = '@T'
   AND l.is_deleted = 0
   AND l.item_name = '@ITEMQ'
   AND s.organization_id = '@ORG'
   AND s.so_status IN ('Issued', 'Processing')
   AND (l.line_status IS NULL OR l.line_status NOT IN ('Completed', 'Cancelled'))
 ORDER BY s.id DESC, l.id
 LIMIT 200"""

# CANDIDATES: the linked IAs of that item (grouped by line in JS)
P_CAND_IAS = """SELECT """ + IA_COLS + """ AS j
  FROM sm_item_assembly h
 WHERE h.tenant_id = '@T'
   AND h.is_deleted = 0
   AND h.organization_id = '@ORG'
   AND h.item_id = '@ITEMQ'
   AND h.source_so_line_id <> ''
 ORDER BY h.id"""

# RELINK: the IA being repaired
R_IA = """SELECT JSON_OBJECT('id', CAST(h.id AS CHAR), 'no', h.stock_movement_no, 'status', h.item_assembly_status, 'item_id', h.item_id,
       'item_uom', CAST(h.item_uom AS CHAR), 'organization_id', h.organization_id, 'source_so_id', h.source_so_id,
       'source_so_line_id', h.source_so_line_id, 'source_so_context_json', h.source_so_context_json,
       'old_line_live', (SELECT COUNT(*) FROM sales_order_axszx8cj_sub x
                          WHERE x.tenant_id = '@T' AND x.is_deleted = 0 AND h.source_so_line_id REGEXP '^[0-9]{1,20}$'
                            AND x.id = CAST(h.source_so_line_id AS UNSIGNED))) AS j
  FROM sm_item_assembly h
 WHERE h.tenant_id = '@T'
   AND h.id = @IA
   AND h.is_deleted = 0"""

# FIX-03: whether the session user (@UID) is assigned to the organisation (@ORG) or one of its plants: blade_user.dept_id, the CSV
# INVENTORY_APPLY_OPERATION's permission check reads, against the organisation's dept subtree; bare digits ("0" matches nobody)
MEMBER_EXPR = """(SELECT COUNT(*) FROM blade_dept p
          WHERE p.tenant_id = '@T' AND p.is_deleted = 0 AND @ORG > 0 AND (p.id = @ORG OR FIND_IN_SET('@ORG', p.ancestors) > 0)
            AND FIND_IN_SET(CAST(p.id AS CHAR) COLLATE utf8mb4_general_ci,
                  (SELECT COALESCE(u.dept_id, '') FROM blade_user u WHERE u.tenant_id = '@T' AND u.is_deleted = 0 AND u.id = @UID LIMIT 1)) > 0)"""
MEMBER = """SELECT JSON_OBJECT('member', """ + MEMBER_EXPR + """) AS j"""

# the new / dev columns the IA form publish creates (sqlcheck stand-ins until then)
NEW_IA_COLUMNS = ["source_so_id", "source_so_line_id", "source_so_context_json", "bom_consumption_mode", "source_bom_id",
                  "bom_snapshot_json", "planned_output_qty"]

# IA_SAVE v13 / IA_V2_SUBMIT v4: the stored Small Cycle fields of an Edit (@IA, "0" = Add / Clone) and the line of the payload's
# link (@LINE), else of the stored link, with its SO header, and whether the session user (@UID) is assigned to the IA's
# organisation (@ORG, FIX-03); one row
CLASSIC_SC_SOURCE = """SELECT JSON_OBJECT(
       'member', """ + MEMBER_EXPR + """,
       'stored', IF(h.id IS NULL, NULL, JSON_OBJECT('source_so_id', h.source_so_id, 'source_so_line_id', h.source_so_line_id,
         'source_so_context_json', h.source_so_context_json, 'bom_consumption_mode', h.bom_consumption_mode, 'source_bom_id', h.source_bom_id,
         'bom_snapshot_json', h.bom_snapshot_json, 'planned_output_qty', CAST(h.planned_output_qty AS CHAR), 'item_id', h.item_id)),
       'line', IF(l.id IS NULL, NULL, JSON_OBJECT('id', CAST(l.id AS CHAR), 'sales_order_id', CAST(l.sales_order_id AS CHAR),
         'item_name', l.item_name, 'so_quantity', CAST(l.so_quantity AS CHAR), 'so_item_uom', CAST(l.so_item_uom AS CHAR),
         'delivered_qty', CAST(l.delivered_qty AS CHAR), 'line_status', l.line_status, 'is_deleted', l.is_deleted, 'line_index', l.line_index)),
       'header', IF(s.id IS NULL, NULL, JSON_OBJECT('id', CAST(s.id AS CHAR), 'so_no', s.so_no, 'so_status', s.so_status,
         'organization_id', s.organization_id, 'customer_id', CAST(s.customer_name AS CHAR), 'is_deleted', s.is_deleted))) AS j
  FROM (SELECT 1 AS one) d
  LEFT JOIN sm_item_assembly h ON h.tenant_id = '@T' AND h.id = @IA AND h.is_deleted = 0
  LEFT JOIN sales_order_axszx8cj_sub l ON l.tenant_id = '@T'
   AND l.id = IF(@LINE > 0, @LINE, IF(h.source_so_line_id REGEXP '^[0-9]{1,20}$', CAST(h.source_so_line_id AS UNSIGNED), 0))
  LEFT JOIN sales_order s ON s.tenant_id = '@T' AND s.id = l.sales_order_id"""

# IA_SAVE only: the same row + the stored sc_ref_key, required_qty and requested_qty (RES-01) of the payload lines asked for (@IDS,
# "0" = none: those without sc_ref_key, a mobile save; holds on: every line with an id), by primary key; and the stored
# material_hold_status (RES-01 enrolment)
CLASSIC_SC_SOURCE_KEYS = CLASSIC_SC_SOURCE.replace(
    "'organization_id', s.organization_id, 'customer_id', CAST(s.customer_name AS CHAR), 'is_deleted', s.is_deleted))) AS j",
    "'organization_id', s.organization_id, 'customer_id', CAST(s.customer_name AS CHAR), 'is_deleted', s.is_deleted)),\n"
    "       'hold', h.material_hold_status,\n"
    "       'keys', (SELECT JSON_ARRAYAGG(JSON_OBJECT('id', CAST(x.id AS CHAR), 'k', x.sc_ref_key, 'r', CAST(x.required_qty AS CHAR), 'q', CAST(x.requested_qty AS CHAR),\n"
    "                'm', x.required_manual)) FROM sm_item_assembly_tlm8ve69_sub x\n"
    "         WHERE x.tenant_id = '@T' AND x.id IN (@IDS) AND x.sm_item_assembly_id = @IA AND x.is_deleted = 0)) AS j", 1)
assert CLASSIC_SC_SOURCE_KEYS != CLASSIC_SC_SOURCE

# RES-01 R4 (IA_SAVE, a completion of an IA that reserves): its own holds (Allocated, and Processing / Releasing in flight) and its
# hold tickets still running (HELD within IA_HOLD's 10-minute lease; started_at is written from the same UTC+8 clock). @T, @IAQ and
# @ORG are digits (code_node_RESdue); the organisation lets the on_reserved_gd (tenant, organisation, is_deleted, doc_type) index serve it
RES_OWN = """SELECT JSON_OBJECT(
       'rows', (SELECT JSON_ARRAYAGG(JSON_OBJECT('id', CAST(r.id AS CHAR), 'status', r.status, 'doc_line_id', r.doc_line_id, 'material_id', CAST(r.material_id AS CHAR),
                'bin_location', CAST(r.bin_location AS CHAR), 'batch_id', CAST(r.batch_id AS CHAR), 'from_category', r.from_category, 'open_qty', CAST(r.open_qty AS CHAR),
                'item_uom', CAST(r.item_uom AS CHAR)))
                FROM on_reserved_gd r WHERE r.tenant_id = '@T' AND r.organization_id = '@ORG' AND r.is_deleted = 0 AND r.doc_type = 'Item Assembly'
                 AND r.doc_id = '@IAQ' AND r.status IN ('Allocated', 'Processing', 'Releasing')),
       'live', (SELECT COUNT(*) FROM gd_publish_step p WHERE p.tenant_id = '@T' AND p.job_id = 'IAH|@IAQ' AND p.step_name LIKE 'TICKET|%' AND p.step_status = 'HELD'
                 AND p.is_deleted = 0 AND p.started_at > CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00') - INTERVAL 10 MINUTE)) AS j"""

# RES-01 R5 + review I3 (the reverts): the same + the IA's Delivered rows (CLOSE: what each hold's completion used, in the row's unit, and the
# bucket it came from); a revert keeps those of the cycle it undoes (resRevertBound)
RES_DELIVERED = """       'delivered', (SELECT JSON_ARRAYAGG(JSON_OBJECT('id', CAST(d.id AS CHAR), 'material_id', CAST(d.material_id AS CHAR),
                'bin_location', CAST(d.bin_location AS CHAR), 'batch_id', CAST(d.batch_id AS CHAR), 'from_category', d.from_category,
                'delivered_qty', CAST(d.delivered_qty AS CHAR), 'item_uom', CAST(d.item_uom AS CHAR)))
                FROM on_reserved_gd d WHERE d.tenant_id = '@T' AND d.organization_id = '@ORG' AND d.is_deleted = 0 AND d.doc_type = 'Item Assembly'
                 AND d.doc_id = '@IAQ' AND d.status = 'Delivered'),
"""
RES_REVERT_OWN = RES_OWN.replace("       'live', (SELECT COUNT(*)", RES_DELIVERED + "       'live', (SELECT COUNT(*)", 1)
assert RES_REVERT_OWN != RES_OWN


def res_gate(sql, empty):
    """review M13: prod's on_reserved_gd has only its primary key, so an own-holds read scans the whole table: a read made on every V2
    completion or revert (the PREPAREs) reads it only for an IA with a stored hold status (CASE: otherwise the scan is never executed;
    EXPLAIN ANALYZE on dev 10-21); @IA = the IA id as bare digits (bigint)"""
    assert sql.startswith("SELECT JSON_OBJECT(") and sql.endswith(" AS j"), sql[:40]
    return ("SELECT CASE WHEN (SELECT h.material_hold_status FROM sm_item_assembly h WHERE h.tenant_id = '@T' AND h.id = @IA) <> '' THEN "
            + sql[len("SELECT "):-len(" AS j")] + " ELSE " + empty + " END AS j")


def res_hold(sql):
    """the same + the IA's material_hold_status (whether it reserves)"""
    out = sql.replace("SELECT JSON_OBJECT(\n       'rows',",
                      "SELECT JSON_OBJECT(\n       'hold', (SELECT h.material_hold_status FROM sm_item_assembly h WHERE h.tenant_id = '@T' AND h.id = @IA),\n"
                      "       'rows',", 1)
    assert out != sql
    return out


# RES-01 R4 (IA_V2_PREPARE) and R5 (IA_REVERT_V2_PREPARE): with the hold status, read only for an IA that reserves
RES_OWN_HOLD = res_gate(res_hold(RES_OWN), "JSON_OBJECT('hold', '', 'rows', NULL, 'live', 0)")
RES_REVERT_OWN_HOLD = res_gate(res_hold(RES_REVERT_OWN), "JSON_OBJECT('hold', '', 'rows', NULL, 'delivered', NULL, 'live', 0)")

# MIN-02 (BA 10-22): the classic completion's claim (IAS|<ia> / CLAIM|<n>, HELD): the highest claim number ever (the unique key counts
# soft-deleted rows too) and the server clock; after our insert, the HELD claims of the IA and its status now
CLAIM_STATE = """SELECT JSON_OBJECT(
       'max', (SELECT COALESCE(MAX(CAST(SUBSTRING(p.step_name, 7) AS UNSIGNED)), 0) FROM gd_publish_step p
                WHERE p.tenant_id = '@T' AND p.job_id = 'IAS|@IAQ' AND p.step_name LIKE 'CLAIM|%'),
       'now', DATE_FORMAT(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'), '%Y-%m-%d %H:%i:%s')) AS j"""
CLAIM_READ = """SELECT JSON_OBJECT(
       'claims', (SELECT JSON_ARRAYAGG(JSON_OBJECT('id', CAST(p.id AS CHAR), 'name', p.step_name, 'started_at', DATE_FORMAT(p.started_at, '%Y-%m-%d %H:%i:%s')))
                FROM gd_publish_step p WHERE p.tenant_id = '@T' AND p.job_id = 'IAS|@IAQ' AND p.step_name LIKE 'CLAIM|%' AND p.step_status = 'HELD'
                 AND p.is_deleted = 0),
       'status', (SELECT h.item_assembly_status FROM sm_item_assembly h WHERE h.tenant_id = '@T' AND h.id = '@IAQ' AND h.is_deleted = 0),
       'now', DATE_FORMAT(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'), '%Y-%m-%d %H:%i:%s')) AS j"""

# IA output split (plan 10-27), IA_SAVE v14: the stored row's split, plant and bin (the mobile guard; a payload without output_split keeps
# the stored rows), added to the Small Cycle source read every Edit already makes (no read of its own)
OS_SC_STORED = ("'item_id', h.item_id)),\n",
                "'item_id', h.item_id,\n         'output_split', h.output_split, 'plant', CAST(h.issuing_operation_faci AS CHAR), 'bin', CAST(h.location_id AS CHAR))),\n")
# a split completion: its rows' bins by primary key (bin_location has no tenant column; the plant is compared in code_node_OScheck);
# @IDS = digits (code_node_OSmerge binIds, "0" = none)
OS_BINS = """SELECT JSON_OBJECT('bins', (SELECT JSON_ARRAYAGG(JSON_OBJECT('id', CAST(b.id AS CHAR), 'plant', CAST(b.plant_id AS CHAR),
       'sl', CAST(b.storage_location_id AS CHAR), 'active', b.bin_status)) FROM bin_location b WHERE b.id IN (@IDS) AND b.is_deleted = 0)) AS j"""
# the Batch rows the split's add-node just inserted, by primary key (@T, @IDS digits: code_node_OSbatchIds)
OS_BATCH_READ = """SELECT JSON_OBJECT('rows', (SELECT JSON_ARRAYAGG(JSON_OBJECT('id', CAST(b.id AS CHAR), 'batch_number', b.batch_number,
       'material_id', CAST(b.material_id AS CHAR))) FROM batch b WHERE b.tenant_id = '@T' AND b.id IN (@IDS) AND b.is_deleted = 0)) AS j"""
# IA_V2_SUBMIT v6 (plan 10-27, phase 2): the split rows' bins (the payload's by primary key + the stored IA's rows) and the stored IA's
# split, plant, item and bin (osMerge: a payload without the key keeps the stored rows and may not move them); @T tenant, @IA the stored
# IA ("0" = an Add), @IDS digits (code_node_ISkeys osBinIds, "0" = none)
OS_SUBMIT_READ = """SELECT JSON_OBJECT(
       'bins', (SELECT JSON_ARRAYAGG(JSON_OBJECT('id', CAST(b.id AS CHAR), 'plant', CAST(b.plant_id AS CHAR), 'sl', CAST(b.storage_location_id AS CHAR),
                       'active', b.bin_status))
                  FROM (SELECT DISTINCT k.v
                          FROM (SELECT b2.id AS v FROM bin_location b2 WHERE b2.id IN (@IDS)
                                UNION ALL
                                SELECT CAST(s.loc AS UNSIGNED)
                                  FROM sm_item_assembly h2,
                                       JSON_TABLE(IF(JSON_VALID(h2.output_split), h2.output_split, '[]'), '$[*]' COLUMNS (loc VARCHAR(32) PATH '$.os_location_id')) s
                                 WHERE h2.tenant_id = '@T' AND h2.id = @IA AND h2.is_deleted = 0 AND s.loc REGEXP '^[0-9]{1,20}$') k) x
                  JOIN bin_location b ON b.id = x.v
                 WHERE b.tenant_id = '@T' AND b.is_deleted = 0),
       'stored', (SELECT JSON_OBJECT('output_split', h.output_split, 'plant', CAST(h.issuing_operation_faci AS CHAR), 'item_id', h.item_id,
                         'bin', CAST(h.location_id AS CHAR))
                    FROM sm_item_assembly h WHERE h.tenant_id = '@T' AND h.id = @IA AND h.is_deleted = 0)) AS j"""
