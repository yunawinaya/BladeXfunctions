"""PO_LINE_IMPORT: the PO form's Excel line import. Read-only - it writes nothing; the form puts the rows it answers into
table_po (Replace / Append) the way Batch Add does.

request: rows (the upload's parsed rows), organization_id, supplier_id, plant_id
answer:  code 200 + rows (JSON text: table_po rows as Batch Add builds them, alt_uom aside) + alt_uom (JSON: item id -> the
         line's alt_uom text, once per item) + tax_open (JSON: positions whose Tax Rate stays
         open) + count + message (columns not imported); code 400 + message + errors (JSON: [{row, message}], first 30) +
         error_count - nothing to add.
  python3 build_po_import.py [--write]
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "scratchpad", "grv2"))
import wfkit as K  # noqa: E402
from build_grv2 import N, sub, call, wrap_sql  # noqa: E402

OUT = os.path.join(ROOT, "Purchase Order", "LineImport", "PO_LINE_IMPORT.json")
PRICE = ("GET_ITEM_UNIT_PRICE_BULK", "2110564019682578434")
G, R, W = "code_node_PIguard", "code_node_PIresolve", "code_node_PIrows"
# item_mji552rc_sub (the Item's table_uom_conversion) without the audit / tenant columns: what Batch Add stores as alt_uom
CONV = [("id", "id"), ("alt_qty", "n"), ("alt_uom_id", "id"), ("text_b4j8h211", "s"), ("base_qty", "n"), ("base_uom_id", "id"), ("purchase_unit_price", "n"),
        ("mat_purchase_tax_id", "id"), ("purchase_max_price", "n"), ("over_delivery_tolerance", "n"), ("purchase_default_uom", "n"),
        ("over_receive_tolerance", "n"), ("purchase_tax_percent", "n"), ("sales_tax_percent", "n"), ("sales_min_price", "n"), ("purchase_min_price", "n"),
        ("mat_sales_tax_id", "id"), ("sales_unit_price", "n"), ("sales_max_price", "n"), ("min_purchase_qty", "n"), ("sales_default_uom", "n"),
        ("sales_price_1", "n"), ("sales_price_6", "n"), ("sales_price_2", "n"), ("sales_price_5", "n"), ("sales_price_4", "n"), ("sales_price_3", "n"),
        ("sales_tariff_id", "id"), ("purchase_tariff_id", "id"), ("max_purchase_qty", "n"), ("max_sales_qty", "n"), ("min_sales_qty", "n"), ("item_barcode", "s")]


def code(name):
    with open(os.path.join(HERE, "code", name), encoding="utf-8") as f:
        return f.read().rstrip("\n")


def items_sql():
    conv = ", ".join("'%s', %s" % (c, "CAST(c.`%s` AS CHAR)" % c if k == "id" else "c.`%s`" % c) for c, k in CONV)
    return sub("""SELECT JSON_OBJECT('id', CAST(i.id AS CHAR), 'material_code', i.material_code, 'material_name', i.material_name, 'material_desc', i.material_desc,
       'item_category', i.item_category, 'further_description', i.further_description, 'based_uom', CAST(i.based_uom AS CHAR),
       'mat_purchase_tax_id', CAST(i.mat_purchase_tax_id AS CHAR), 'is_active', i.is_active,
       'conv', COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT(@CONV, 'uom_name', u.uom_name))
                           OVER (ORDER BY c.id ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)
                           FROM item_mji552rc_sub c LEFT JOIN unit_of_measurement u ON u.id = c.alt_uom_id AND u.is_deleted = 0
                          WHERE c.Item_id = i.id AND c.is_deleted = 0 LIMIT 1), JSON_ARRAY()),
       'binds', COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('supplier_id', b.supplier_id, 'item_description', b.item_description))
                            OVER (ORDER BY b.id ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)
                            FROM item_eimnda1q_sub b
                           WHERE b.Item_id = i.id AND b.is_deleted = 0 AND b.supplier_id = '@SUP' LIMIT 1), JSON_ARRAY())) AS j
  FROM item i
 WHERE i.tenant_id = '@T' AND i.organization_id = '@ORG' AND i.is_deleted = 0
   AND i.material_code IN (SELECT (t.c COLLATE utf8mb4_general_ci) FROM JSON_TABLE('@CODES', '$[*]' COLUMNS (c VARCHAR(255) PATH '$.c')) t)
 ORDER BY i.id""", CONV=conv, T=N(G, "data.tenantId"), ORG=N(G, "data.organizationId"), SUP=N(G, "data.supplierId"), CODES=N(G, "data.codesSql"))


def build():
    ids = K.Ids(1799100000000)
    stop_ret = lambda tag, src: K.ret("return_node_PI%s" % tag, "Return 400 (%s)" % tag, [("code", N(src, "data.code")), ("message", N(src, "data.message")),
                                                                                         ("errors", N(src, "data.errorsJson")), ("error_count", N(src, "data.errorCount"))])
    nodes = [
        K.code(G, "Guard: the file's rows checked one by one, the distinct item codes", code("guard.js"),
               ["route", "code", "message", "errors", "errorsShown", "errorsJson", "errorCount", "rows", "codesSql", "count", "tenantId", "organizationId", "supplierId", "plantId"],
               arrays=("errors", "errorsShown", "rows"), objects=("count",)),
        K.if_(ids, "if_PIguard", "IF the file cannot be imported: 400 with every bad row, nothing added", "'%s' == 'STOP'" % N(G, "data.route"), [stop_ret("guard", G)]),
        K.sql("sql_node_PIitems", "The file's items (code as the database compares it, this organization), their UOMs (+ names) and this supplier's descriptions",
              items_sql(), ["j"]),
        K.code(R, "Resolve: each row's item and UOM, the lines as Batch Add starts them, the price request", code("resolve.js"),
               ["route", "code", "message", "errors", "errorsShown", "errorsJson", "errorCount", "lines", "itemData", "altUomJson", "count"],
               arrays=("errors", "errorsShown", "lines", "itemData"), objects=("count",)),
        K.if_(ids, "if_PIresolve", "IF a row has no item / UOM: 400 with every bad row, nothing added", "'%s' == 'STOP'" % N(R, "data.route"), [stop_ret("resolve", R)]),
        call(ids, "workflow_node_PIprice", "GET_ITEM_UNIT_PRICE_BULK (as Batch Add asks it, with the file's quantities)", PRICE, [
            ("document_type", "PO", "value"), ("supp_cust_id", N(G, "data.supplierId")), ("plant_id", N(G, "data.plantId")), ("item_data", N(R, "data.itemData")),
            ("organization_id", N(G, "data.organizationId"))]),
        K.code(W, "Rows: the price answer as Batch Add takes it, then the file's own values", code("rows.js"), ["route", "code", "rowsJson", "taxOpenJson", "count"]),
        K.ret("return_node_PIok", "Return 200 (the rows)", [("code", N(W, "data.code")), ("message", N(G, "data.message")), ("rows", N(W, "data.rowsJson")),
                                                           ("alt_uom", N(R, "data.altUomJson")), ("tax_open", N(W, "data.taxOpenJson")),
                                                           ("count", N(W, "data.count"))]),
    ]
    doc = K.workflow([("rows", "any", "the upload's parsed rows (header -> value)"), ("organization_id", "string", "the purchase order's organization"),
                      ("supplier_id", "string", "the purchase order's supplier"), ("plant_id", "string", "the purchase order's plant")],
                     ["code", "message", "rows", "alt_uom", "tax_open", "count", "errors", "error_count"], nodes)

    def wrap(n):
        if isinstance(n, dict):
            if n.get("type") == "sql-node":
                n["data"]["script"]["code"] = wrap_sql(n["data"]["script"]["code"])
            for v in n.values():
                wrap(v)
        elif isinstance(n, list):
            for v in n:
                wrap(v)
    wrap(doc)
    K.check_ids(doc)
    return doc


if __name__ == "__main__":
    doc = build()
    text = json.dumps(doc, ensure_ascii=False, indent=1)
    print("PO_LINE_IMPORT: %d chars, %d nodes" % (len(text), len(K.check_ids(doc))) + (" -> " + OUT if "--write" in sys.argv else " (dry; --write to save)"))
    if "--write" in sys.argv:
        os.makedirs(os.path.dirname(OUT), exist_ok=True)
        open(OUT, "w", encoding="utf-8").write(text + "\n")
