"""Builds GET_ITEM_UNIT_PRICE_BULK (FlowGram JSON) into the repo's Purchase Order/GetItemUnitPriceBulk/.
Same request / response as GET_ITEM_UNIT_PRICE (dev = prod v52, 2067818102244966401); each price source is one SQL over every
line and one code node resolves each line in the configured sequence. Tooling: scratchpad/grv2 (wfkit, N, sub, wrap_doc_sql).
Published with .dbtools/wf_upload.mjs into the designer shell in ids.json (a compile-made sql-node never runs).

usage: python3 build_unitprice.py [--write]
"""
import copy
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "grv2"))
import wfkit as K  # noqa: E402
from build_grv2 import N, sub, wrap_doc_sql  # noqa: E402

R = "/Users/yunawinaya/Developer/BladeXfunctions/"
OUT = R + "Purchase Order/GetItemUnitPriceBulk/"
NAME = "GET_ITEM_UNIT_PRICE_BULK"
WRITE = "--write" in sys.argv
CONTRACT = json.load(open(os.path.join(HERE, "classic_contract.json"), encoding="utf-8"))
CHK, KEYS, PLAN, RES = "code_node_UPcheck", "code_node_UPkeys", "code_node_UPplan", "code_node_UPresolve"
CFG, ITEMS, HIST, TAG = "sql_node_UPcfg", "sql_node_UPitems", "sql_node_UPhist", "sql_node_UPtag"


def code(name):
    with open(os.path.join(HERE, "code", name), encoding="utf-8") as f:
        return f.read().rstrip("\n")


def typed(node, types):
    """sql-node values arrive coerced to their declared bsonType (the classic declares history unit_price 'decimal' -> a
    number, every price tag column 'string' -> a string): declare exactly what the classic declared"""
    for r in node["data"]["response_json"]:
        r["bsonType"] = types.get(r["name"], "string")
    return node


PAIRS = """JSON_TABLE('{{node:code_node_UPkeys.data.pairsJson}}', '$[*]' COLUMNS (item_id VARCHAR(32) PATH '$[0]', uom_id VARCHAR(32) PATH '$[1]',
                  ii BIGINT PATH '$[0]' NULL ON ERROR, uu BIGINT PATH '$[1]' NULL ON ERROR))"""

T, ORG, DOC = N(KEYS, "data.tenantId"), N(KEYS, "data.organizationId"), N(KEYS, "data.document_type")
PLANT, PARTY, NEED, FROM = N(KEYS, "data.plantIdSafe"), N(KEYS, "data.suppCustIdSafe"), N(KEYS, "data.needFetch"), N(KEYS, "data.fetchFrom")

# the organization's config for the document type (the classic's get-node: tenant + organization + document type, not deleted) and
# the party's price tag (the classic's Customer / Supplier get-node)
CFG_SQL = sub("""SELECT 'cfg' AS kind, CAST(c.id AS CHAR) AS id, CONVERT(c.config_sequence USING utf8mb4) COLLATE utf8mb4_general_ci AS val
  FROM price_history_config c
 WHERE c.tenant_id = '@T' AND c.organization_id = '@ORG' AND c.document_type = '@DOC' AND c.is_deleted = 0
UNION ALL
SELECT 'tag' AS kind, CAST(x.id AS CHAR) AS id, x.price_tag_id AS val
  FROM customer x
 WHERE '@NEED' = 'Yes' AND '@FROM' = 'Customer' AND x.tenant_id = '@T' AND x.id = '@PARTY' AND x.is_deleted = 0
UNION ALL
SELECT 'tag' AS kind, CAST(x.id AS CHAR) AS id, x.price_tag_id AS val
  FROM supplier_head x
 WHERE '@NEED' = 'Yes' AND '@FROM' = 'Supplier' AND x.tenant_id = '@T' AND x.id = '@PARTY' AND x.is_deleted = 0
 ORDER BY kind, LENGTH(id), id""", T=T, ORG=ORG, DOC=DOC, NEED=NEED, FROM=FROM, PARTY=PARTY)

# GET_ITEM_UNIT_PRICE's Get Item List (sql_node_ItemUomPrices) projected to what the resolver reads: the document's side (sales /
# purchase) and only the UOM rows the lines ask for, in the classic's row order (its .find takes the first); session tenant only
ITEM_SIDE = lambda side: ",\n                                  ".join(
    ["'alt_uom_id', CAST(u.alt_uom_id AS CHAR)"] + ["'%s', %su.%s" % (f % side, "" if "tax_id" not in f else "CAST(", f % side + ("" if "tax_id" not in f else " AS CHAR)"))
                                                     for f in ("%s_unit_price", "%s_min_price", "%s_max_price", "min_%s_qty", "max_%s_qty", "mat_%s_tax_id", "%s_tax_percent")])
ITEMS_SQL = sub("""WITH p AS (SELECT DISTINCT j.item_id, j.uom_id, j.ii, j.uu
             FROM @PAIRS j)
SELECT CAST(i.id AS CHAR) AS id,
       COALESCE((
           SELECT JSON_ARRAYAGG(IF('@SIDE' = 'sales',
                      JSON_OBJECT(@SALES),
                      JSON_OBJECT(@PURCHASE)))
             FROM item_mji552rc_sub u
            WHERE u.Item_id = i.id
              AND u.is_deleted = 0
              AND u.alt_uom_id IN (SELECT pp.uu FROM p pp WHERE pp.ii = i.id)
       ), '[]') AS uom_conversion_json
  FROM (SELECT DISTINCT p.ii FROM p) sel
  JOIN item i
    ON i.id = sel.ii
   AND i.tenant_id = '@T'
   AND i.is_deleted = 0""", PAIRS=PAIRS.replace("\n", "\n             "), SIDE=N(KEYS, "data.side"), SALES=ITEM_SIDE("sales"), PURCHASE=ITEM_SIDE("purchase"), T=T)

# Fetch latest record (sql_node_AFi9JgU7) for every line at once: per source the classic's filters, the line's item as text
# for a varchar item column and as a number for a bigint one (as the classic's quoted literal compared), the latest line
# by create_time and, on a tie, the lowest id (the classic's full scan in id order kept the first it met)
HIST_BRANCHES = [
    ("SO", "sales_order_axszx8cj_sub x", "x.item_name = p.item_id COLLATE utf8mb4_general_ci AND x.so_item_uom = p.uu", "x.so_item_price", "x.customer_id",
     "x.line_status NOT IN ('Cancelled', 'Draft')", ""),
    ("SQT", "quotation_rdywe1rx_sub x", "x.material_id = p.item_id COLLATE utf8mb4_general_ci AND x.sqt_order_uom_id = p.uu", "x.unit_price", "x.customer_id",
     "q.sqt_status NOT IN ('Cancelled', 'Draft')", "JOIN quotation q ON x.quotation_id = q.id"),
    ("PREQ", "purchase_requisition_9wptilyh_sub x", "x.pr_line_material_id = p.item_id COLLATE utf8mb4_general_ci AND x.pr_line_uom_id = p.uu",
     "x.pr_line_unit_price", "x.supplier_id", "x.line_status NOT IN ('Cancelled', 'Draft')", ""),
    ("PO", "purchase_order_2ukyuanr_sub x", "x.item_id = p.item_id COLLATE utf8mb4_general_ci AND x.quantity_uom = p.uu", "x.unit_price", "x.supplier_id",
     "x.line_status NOT IN ('Cancelled', 'Draft')", ""),
    ("SI", "sales_invoice_zt0c3x55_sub x", "x.material_id = p.ii AND x.invoice_qty_uom_id = p.uu", "x.unit_price", "x.customer_id",
     "hd.si_status NOT IN ('Cancelled', 'Draft')", "JOIN sales_invoice hd ON x.sales_invoice_id = hd.id"),
    ("PI", "purchase_invoice_xpuy7o4q_sub x", "x.material_id = p.ii AND x.quantity_uom = p.uu", "x.order_unit_price", "x.supplier_id",
     "hd.pi_status NOT IN ('Cancelled', 'Draft')", "JOIN purchase_invoice hd ON x.purchase_invoice_id = hd.id"),
]


def hist_sql():
    parts = []
    for src, table, on, price, party, status, extra in HIST_BRANCHES:
        parts.append(sub("""SELECT '@SRC' AS src, p.item_id, p.uom_id, @PRICE AS unit_price, x.create_time, x.id
         FROM p
         JOIN @TABLE ON @ON
         @EXTRA
        WHERE '@USE' = 'YES'
          AND x.tenant_id = '@T' AND x.plant_id = '@PLANT' AND @PARTYCOL = '@PARTY'
          AND x.is_deleted = 0 AND @STATUS""", SRC=src, PRICE=price, TABLE=table, ON=on, EXTRA=extra, USE=N(PLAN, "data.use" + src), T=T, PLANT=PLANT, PARTYCOL=party,
                         PARTY=PARTY, STATUS=status).replace("\n         \n", "\n"))
    return ("WITH p AS (SELECT DISTINCT j.item_id, j.uom_id, j.ii, j.uu\n             FROM " + PAIRS.replace("\n", "\n             ") + " j),\n"
            "     h AS (" + "\n       UNION ALL\n       ".join(parts) + ")\n"
            "SELECT r.src, r.item_id, r.uom_id, r.unit_price\n"
            "  FROM (SELECT h.src, h.item_id, h.uom_id, h.unit_price,\n"
            "               ROW_NUMBER() OVER (PARTITION BY h.src, h.item_id, h.uom_id ORDER BY h.create_time DESC, h.id) AS rn\n"
            "          FROM h) r\n"
            " WHERE r.rn = 1")


# Fetch price tag (sql_node_IS2go2ob) for every line's item + UOM at once: the classic's party / tag / date filters and columns;
# its quantity limits are applied per line by the resolver; rows in the classic's order (its Item_id index: id within an item)
TAG_HALF = """SELECT p.item_id, p.uom_id, @A.@Pmin_order_qty AS min_order_qty, @A.@Pmax_order_qty AS max_order_qty, @A.@Kdiscount AS discount,
       @A.@Kdiscount_type AS discount_type, @A.@Ktax AS tax, @A.@Ktax_percent AS tax_percent, @A.@Kunit_price AS unit_price,
       @A.@Kmin_price AS min_price, @A.@Kmax_price AS max_price, @A.id AS rid
  FROM p
  JOIN @TABLE @A ON @A.Item_id = p.ii AND @A.@UOM = p.uu
  JOIN item i ON @A.Item_id = i.id
 WHERE '@NEED' = 'YES' AND '@FROM' = '@WHO' AND @A.tenant_id = '@T' AND @A.is_deleted = 0
   AND (@A.@TAGCOL = '@TAGID' OR ('@PARTY' IS NOT NULL AND '@PARTY' != '' AND @A.@PARTYCOL = '@PARTY'))
   AND ((@A.@Fdate_from IS NULL AND @A.@Fdate_to IS NULL) OR (@A.@Fdate_from < CURDATE() AND @A.@Fdate_to IS NULL)
        OR (@A.@Fdate_from IS NULL AND @A.@Fdate_to > CURDATE()) OR (@A.@Fdate_from < CURDATE() AND @A.@Fdate_to > CURDATE()))"""


def tag_sql():
    halves = []
    for who, alias, table, pre, partycol in (("Supplier", "sq", "item_qd8nxw32_sub", "sup", "supplier_id"), ("Customer", "sc", "item_i9q0d8uj_sub", "cust", "customer_id")):
        halves.append(sub(TAG_HALF, A=alias, P=pre + "_", K=pre + "_price_", F=pre + "_price_", UOM=pre + "_price_uom", TABLE=table, NEED=N(PLAN, "data.needTag"),
                          FROM=FROM, WHO=who, T=T, TAGCOL=pre + "_price_tag_id", TAGID=N(PLAN, "data.tagIdSql"), PARTY=PARTY, PARTYCOL=partycol))
    return ("WITH p AS (SELECT DISTINCT j.item_id, j.uom_id, j.ii, j.uu\n             FROM " + PAIRS.replace("\n", "\n             ") + " j)\n"
            "SELECT t.item_id, t.uom_id, t.min_order_qty, t.max_order_qty, t.discount, t.discount_type, t.tax, t.tax_percent, t.unit_price, t.min_price,\n"
            "       t.max_price\n"
            "  FROM (" + "\nUNION ALL\n".join(halves).replace("\n", "\n        ") + ") t\n"
            " ORDER BY t.item_id, t.uom_id, t.rid")


TAG_COLS = ["item_id", "uom_id", "min_order_qty", "max_order_qty", "discount", "discount_type", "tax", "tax_percent", "unit_price", "min_price", "max_price"]


def end_401():
    d = copy.deepcopy(CONTRACT["end_401"])
    d["msg"]["code"] = N(CHK, "data.message")
    return {"id": "end_UPinvalid", "type": "end-node", "data": d, "blocks": []}


def build():
    ids = K.Ids(1792100000000)
    nodes = [
        K.code(CHK, "Check workflow input (GET_ITEM_UNIT_PRICE code_node_Q1zqehTx, verbatim)", code("check.js"), ["status", "message"]),
        K.if_(ids, "if_UPinvalid", "IF validation failed: 401 with the message (as GET_ITEM_UNIT_PRICE)", "'%s' == 'Failed'" % N(CHK, "data.status"), [end_401()]),
        K.code(KEYS, "Keys: document type, plant / party / tenant / organization, the lines' item + UOM pairs (digits only)", code("keys.js"),
               ["document_type", "plantIdSafe", "suppCustIdSafe", "needFetch", "fetchFrom", "side", "pairsJson", "pairCount", "tenantId", "organizationId"],
               objects=("pairCount",)),
        K.sql(CFG, "Price History Config of the organization + document type, and the customer's / supplier's price tag", CFG_SQL, ["kind", "id", "val"]),
        K.code(PLAN, "Plan: the rule sequence (config, else the document type's default), the history sources and price tag it needs", code("plan.js"),
               ["sequence", "useSQT", "useSO", "useSI", "usePREQ", "usePO", "usePI", "needTag", "tagIdSql", "configCount"], objects=("sequence", "configCount")),
        K.parallel("condition_all_UPread", "The three price sources in parallel, each one SQL over every line (no row limits)", [
            ("cai_UPitems", "items", [K.sql(ITEMS, "Items: the lines' UOM rows - price, limits, tax of the document's side (Get Item List, projected)", ITEMS_SQL, ["id", "uom_conversion_json"])]),
            ("cai_UPhist", "history", [typed(K.sql(HIST, "History: the latest line per source + item + UOM of this party and plant (the sequence's sources only)",
                                                   hist_sql(), ["src", "item_id", "uom_id", "unit_price"]), {"unit_price": "decimal"})]),
            ("cai_UPtag", "price tag", [K.sql(TAG, "Price tag rows per item + UOM (tag or party, valid today), in the classic's row order", tag_sql(), TAG_COLS)]),
        ]),
        K.code(RES, "Resolve: each line through the sequence (first rule with an answer), then needOverwrite (Map return data)", code("resolve.js"),
               ["data", "needOverwrite"], objects=("data",)),
    ]
    doc = K.workflow([], [], nodes)
    doc["request_json"] = copy.deepcopy(CONTRACT["request_json"])
    # beyond the classic contract: a nested caller's organization ({{global:firstLvDeptId}} is empty inside a workflow-node call)
    doc["request_json"].append({"key": "u7orgp3k", "name": "organization_id", "title": "Organization ID",
                                "description": "used when the session has no organization (a call from another workflow)", "bsonType": "string", "isExpand": False})
    doc["response_json"] = copy.deepcopy(CONTRACT["response_json"])
    end = copy.deepcopy(CONTRACT["end"])
    end["response_value"]["list"][0]["value"] = N(RES, "data.data")
    end["response_value"]["list"][1]["value"] = N(RES, "data.needOverwrite")
    doc["nodes"][-1]["data"] = end
    return doc


if __name__ == "__main__":
    doc = wrap_doc_sql(build())
    K.check_ids(doc)
    text = json.dumps(doc, ensure_ascii=False, indent=1)
    path = os.path.join(OUT, NAME + ".json")
    print(f"{NAME}: {len(text)} chars, {len(K.check_ids(doc))} nodes" + (f" -> {path}" if WRITE else " (dry; --write to save)"))
    if WRITE:
        os.makedirs(OUT, exist_ok=True)
        open(path, "w", encoding="utf-8").write(text + "\n")
