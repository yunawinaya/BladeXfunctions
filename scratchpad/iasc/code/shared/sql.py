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

# the new / dev columns the IA form publish creates (sqlcheck stand-ins until then)
NEW_IA_COLUMNS = ["source_so_id", "source_so_line_id", "source_so_context_json", "bom_consumption_mode", "source_bom_id",
                  "bom_snapshot_json", "planned_output_qty"]

# IA_SAVE v13 / IA_V2_SUBMIT v4: the stored Small Cycle fields of an Edit (@IA, "0" = Add / Clone) and the line of the payload's
# link (@LINE), else of the stored link, with its SO header; one row
CLASSIC_SC_SOURCE = """SELECT JSON_OBJECT(
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

# IA_SAVE only: the same row + the stored non-empty sc_ref_key of the payload lines that came back with an id but without one (@IDS,
# "0" = none; a mobile save), by primary key
CLASSIC_SC_SOURCE_KEYS = CLASSIC_SC_SOURCE.replace(
    "'organization_id', s.organization_id, 'customer_id', CAST(s.customer_name AS CHAR), 'is_deleted', s.is_deleted))) AS j",
    "'organization_id', s.organization_id, 'customer_id', CAST(s.customer_name AS CHAR), 'is_deleted', s.is_deleted)),\n"
    "       'keys', (SELECT JSON_ARRAYAGG(JSON_OBJECT('id', CAST(x.id AS CHAR), 'k', x.sc_ref_key)) FROM sm_item_assembly_tlm8ve69_sub x\n"
    "         WHERE x.tenant_id = '@T' AND x.id IN (@IDS) AND x.sm_item_assembly_id = @IA AND x.is_deleted = 0 AND x.sc_ref_key <> '')) AS j", 1)
assert CLASSIC_SC_SOURCE_KEYS != CLASSIC_SC_SOURCE
