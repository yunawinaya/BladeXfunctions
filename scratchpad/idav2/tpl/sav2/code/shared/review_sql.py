"""The SC Review build's reads as SQL (CONTRACT.md section 16; package A owns this file, B2 SUBMIT and A PREPARE both use it).

REVIEW_READS[name] reproduces one read of STOCK_COUNT v10 `par_review_fetch` (base/STOCK_COUNT.v10.json) for
code/shared/review_chain.js (saReviewAdapt turns the rows into the exact node outputs the classic build received):

  name             classic node                 filter (as the classic)                                 + here
  items            search_item                  id IN materialIds                                       tenant, is_deleted 0
  balances         search_item_balance          material_id IN materialIds AND location_id IN           tenant (the platform's own scope)
                                                locationIds AND is_deleted 0 (NO plant / org filter)
  batch_balances   search_item_batch_balance    same on item_batch_balance                              tenant
  bins             search_bin_location          id IN locationIds                                       tenant, is_deleted 0
  uoms             search_uom                   id IN baseUomIds                                        tenant, is_deleted 0
  batches          search_batch                 id IN batchIds                                          tenant, is_deleted 0
  costs            sql_review_costs             verbatim (WA / FIFO latest cost per material + plant    tenant; the materialIdCsv JSON_TABLE
                                                [+ batch]), organization_id = orgIdSql                  join is written `material_id IN (@MID)`
  prefix           get_sa_prefix (get-node)     business_type 'Stock Adjustment' AND department_id =    tenant, is_deleted 0, the non-draft
                                                organizationId AND is_default 1                         rule first (is_draft, id)

Tokens (fill with lib/v2build.sub(text, T=..., MID=..., ...); the caller's code node digit-checks every value):
  '@T'  the session tenant (hand-quoted here)     @ORG  the organization id (digits; '0' matches nothing)
  @MID  material ids      @LID  location ids      @UID  base UOM ids      @BID  batch ids
        each a bare digit list "id,id,..." - review_chain.js saReviewIds(prep) gives prep's materialIds / locationIds /
        baseUomIds / batchIds (the classic's own lists) with "0" for none. A SUPERSET is harmless: the build looks every
        row up by its own item's ids (find / filter), so extra rows never change its output.

Rows: one JSON_OBJECT per row as `j` (REVIEW_COLS) with exactly the columns the build reads (items also material_code for
LABELS): bigint ids / FKs CAST AS CHAR, decimals CAST AS CHAR (the adapter makes the numbers the platform hands a code node),
datetimes as a search node prints them ('YYYY-MM-DD HH:MM:SS.mmm', no fraction when it is .000; PLATFORM_DT), varchar / int
as stored. Order: id (a search without a sort returns
MySQL's order; id is what the recorded runs show). Uncapped (search-node limits are not applied anyway).
Checked read-only on dev + prod by test/prepare/test_review_shape.py (golden test b).
"""

# a datetime(3) as a search-node row prints it: 'YYYY-MM-DD HH:MM:SS.mmm' (3 digits, trailing zeros kept: .760, .030), no
# fraction when it is .000 (recorded runs vs the stored values, test_review_shape.py). A get-node prints differently (.380 -> .38)
# - no datetime of a get-node is read here. Two lines, each <= 160 characters with its indent.
def PLATFORM_DT(col, indent=""):
    return ("IF(MICROSECOND({c}) = 0, DATE_FORMAT({c}, '%Y-%m-%d %H:%i:%s'),\n{i}   LEFT(DATE_FORMAT({c}, '%Y-%m-%d %H:%i:%s.%f'), 23))"
            .format(c=col, i=indent))


# the build copies these balance columns into balance_index (code_review_build_sa balanceEntry), so their presence and
# types decide the stored text byte for byte
_BAL_COLS = """'id', CAST(b.id AS CHAR), 'material_id', CAST(b.material_id AS CHAR), 'plant_id', CAST(b.plant_id AS CHAR),
       'location_id', CAST(b.location_id AS CHAR), %s'balance_quantity', CAST(b.balance_quantity AS CHAR),
       'unrestricted_qty', CAST(b.unrestricted_qty AS CHAR), 'block_qty', CAST(b.block_qty AS CHAR),
       'qualityinsp_qty', CAST(b.qualityinsp_qty AS CHAR), 'reserved_qty', CAST(b.reserved_qty AS CHAR),
       'intransit_qty', CAST(b.intransit_qty AS CHAR), 'organization_id', b.organization_id, 'tenant_id', b.tenant_id,
       'create_user', CAST(b.create_user AS CHAR),
       'create_time', %s,
       'create_dept', CAST(b.create_dept AS CHAR), 'update_user', CAST(b.update_user AS CHAR),
       'update_time', %s,
       'is_deleted', b.is_deleted, 'material_uom', CAST(b.material_uom AS CHAR)"""


def _balances(table, batch):
    cols = _BAL_COLS % ("'batch_id', CAST(b.batch_id AS CHAR), " if batch else "", PLATFORM_DT("b.create_time", " " * 22), PLATFORM_DT("b.update_time", " " * 22))
    return f"""SELECT JSON_OBJECT({cols}) AS j
  FROM {table} b
 WHERE b.tenant_id = '@T'
   AND b.material_id IN (@MID)
   AND b.location_id IN (@LID)
   AND b.is_deleted = 0
 ORDER BY b.id"""


REVIEW_READS = {
    # search_item: what the build reads (material_name, item_batch_management, material_costing_method, purchase_unit_price,
    # the UOM Conversion subform rows - alt_uom_id / base_qty) + material_code (LABELS)
    "items": f"""SELECT JSON_OBJECT('id', CAST(i.id AS CHAR), 'material_code', i.material_code, 'material_name', i.material_name,
       'item_batch_management', i.item_batch_management, 'material_costing_method', i.material_costing_method,
       'purchase_unit_price', CAST(i.purchase_unit_price AS CHAR),
       'table_uom_conversion', (SELECT JSON_ARRAYAGG(JSON_OBJECT('id', CAST(u.id AS CHAR), 'alt_uom_id', CAST(u.alt_uom_id AS CHAR),
                                       'base_uom_id', CAST(u.base_uom_id AS CHAR), 'alt_qty', CAST(u.alt_qty AS CHAR),
                                       'base_qty', CAST(u.base_qty AS CHAR)))
                                  FROM item_mji552rc_sub u
                                 WHERE u.tenant_id = '@T'
                                   AND u.item_id = i.id
                                   AND u.is_deleted = 0)) AS j
  FROM item i
 WHERE i.tenant_id = '@T'
   AND i.id IN (@MID)
   AND i.is_deleted = 0
 ORDER BY i.id""",
    "balances": _balances("item_balance", False),
    "batch_balances": _balances("item_batch_balance", True),
    "bins": f"""SELECT JSON_OBJECT('id', CAST(b.id AS CHAR), 'bin_location_combine', b.bin_location_combine, 'plant_id', CAST(b.plant_id AS CHAR)) AS j
  FROM bin_location b
 WHERE b.tenant_id = '@T'
   AND b.id IN (@LID)
   AND b.is_deleted = 0
 ORDER BY b.id""",
    "uoms": f"""SELECT JSON_OBJECT('id', CAST(u.id AS CHAR), 'uom_name', u.uom_name) AS j
  FROM unit_of_measurement u
 WHERE u.tenant_id = '@T'
   AND u.id IN (@UID)
   AND u.is_deleted = 0
 ORDER BY u.id""",
    "batches": f"""SELECT JSON_OBJECT('id', CAST(t.id AS CHAR), 'batch_number', t.batch_number) AS j
  FROM batch t
 WHERE t.tenant_id = '@T'
   AND t.id IN (@BID)
   AND t.is_deleted = 0
 ORDER BY t.id""",
    # sql_review_costs verbatim (+ tenant): every value as the sql-node returned it - text (its response_json declares all
    # seven columns string); a NULL batch_id is absent
    "costs": """SELECT JSON_OBJECT('src', c.src, 'material_id', CAST(c.material_id AS CHAR), 'plant_id', CAST(c.plant_id AS CHAR),
       'batch_id', CAST(c.batch_id AS CHAR), 'cost', CAST(c.cost AS CHAR), 'rn', CAST(c.rn AS CHAR), 'rn_any', CAST(c.rn_any AS CHAR)) AS j
FROM (
  SELECT 'WA' AS src, w.material_id, w.plant_id, w.batch_id, w.wa_cost_price AS cost,
         ROW_NUMBER() OVER (PARTITION BY w.material_id, w.plant_id, w.batch_id
                            ORDER BY w.create_time DESC, w.id DESC) AS rn,
         ROW_NUMBER() OVER (PARTITION BY w.material_id, w.plant_id
                            ORDER BY w.create_time DESC, w.id DESC) AS rn_any
  FROM wa_costing_method w
  WHERE w.tenant_id = '@T' AND w.material_id IN (@MID)
    AND w.is_deleted = 0 AND w.organization_id = '@ORG'
    AND w.wa_cost_price > 0
  UNION ALL
  SELECT 'FIFO', f.material_id, f.plant_id, f.batch_id, f.fifo_cost_price,
         ROW_NUMBER() OVER (PARTITION BY f.material_id, f.plant_id, f.batch_id
                            ORDER BY CAST(f.fifo_sequence AS UNSIGNED) DESC, f.id DESC),
         ROW_NUMBER() OVER (PARTITION BY f.material_id, f.plant_id
                            ORDER BY f.create_time DESC, f.id DESC)
  FROM fifo_costing_history f
  WHERE f.tenant_id = '@T' AND f.material_id IN (@MID)
    AND f.is_deleted = 0 AND f.organization_id = '@ORG'
    AND f.fifo_cost_price > 0
) c
WHERE c.rn = 1 OR c.rn_any = 1
ORDER BY c.src, c.material_id, c.plant_id, c.batch_id""",
    # get_sa_prefix: the default rule of the organization; `id` as text (the get-node hands ids as strings). Ruling (B2, 2026-10-16):
    # the NON-draft default first (7 dev departments hold a draft and a non-draft default; prod one non-draft default each)
    "prefix": f"""SELECT JSON_OBJECT('id', CAST(r.id AS CHAR), 'rule_name', r.rule_name, 'business_type', r.business_type,
       'department_id', CAST(r.department_id AS CHAR), 'is_default', r.is_default, 'is_draft', r.is_draft, 'tenant_id', r.tenant_id) AS j
  FROM su_code_serial_no_rule r
 WHERE r.tenant_id = '@T'
   AND r.business_type = 'Stock Adjustment'
   AND r.department_id = @ORG
   AND r.is_default = 1
   AND r.is_deleted = 0
 ORDER BY r.is_draft, r.id""",
}

REVIEW_COLS = ["j"]

# the classic node each read stands for (review_chain.js SA_REVIEW_NODES holds the same map)
REVIEW_NODES = {"items": "search_item", "balances": "search_item_balance", "batch_balances": "search_item_batch_balance",
                "bins": "search_bin_location", "uoms": "search_uom", "batches": "search_batch", "costs": "sql_review_costs",
                "prefix": "get_sa_prefix"}

# which token each read uses (a caller may point a token of one read at its own list, e.g. "0" when it needs no rows)
REVIEW_TOKENS = {"items": ["T", "MID"], "balances": ["T", "MID", "LID"], "batch_balances": ["T", "MID", "LID"], "bins": ["T", "LID"],
                 "uoms": ["T", "UID"], "batches": ["T", "BID"], "costs": ["T", "MID", "ORG"], "prefix": ["T", "ORG"]}


def review_sql(name, **tokens):
    """REVIEW_READS[name] with its tokens filled (T, MID, LID, UID, BID, ORG as needed); every token of the read must be given"""
    import re
    need = REVIEW_TOKENS[name]
    missing = [t for t in need if t not in tokens]
    assert not missing, (name, missing)
    text = REVIEW_READS[name]
    for k in sorted(need, key=len, reverse=True):
        text = text.replace("@" + k, tokens[k])
    left = re.findall(r"@[A-Z]+", text)
    assert not left, (name, left)
    return text
