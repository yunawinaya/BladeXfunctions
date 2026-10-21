"""Builds the lean (2,000-line) SI conversions from the live DEV versions in base/dev/:

  GD_Convert_SI v25  -> out/GD_Convert_SI.json   (repo: Sales Invoice/GDconvertSIworkflow.json)
  SO_Convert_SI v56  -> out/SO_Convert_SI.json   (repo: Sales Invoice/SOconvertSIworkflow.json)

Same requests, responses, end codes (401 / 402 / 403 / 405) and messages, and the same SI_SAVE payloads. The whole-document search
nodes become sql-nodes that read only the columns the lifted code uses (cv.js puts the rows back into the old search shape), and
the loop hands SI_SAVE its own item instead of re-reading the whole invoice list through a Redis counter on every pass.

usage: python3 build_si_convert.py [NAME ...]
"""
import copy
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
R = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(R, "scratchpad", "grv2"))
import wfkit as K  # noqa: E402

BASE = {"GD_Convert_SI": "base/dev/GD_Convert_SI.v25.json", "SO_Convert_SI": "base/dev/SO_Convert_SI.v56.json"}
TYPES = json.load(open(os.path.join(HERE, "coltypes.json")))


def code_file(name):
    with open(os.path.join(HERE, "code", name), encoding="utf-8") as f:
        return f.read().rstrip("\n")


def walk(nodes):
    for n in nodes or []:
        if isinstance(n, dict):
            yield n
            yield from walk(n.get("blocks"))


def find(doc, nid):
    for n in walk(doc["nodes"]):
        if n.get("id") == nid:
            return n
    raise KeyError(nid)


def parent_list(doc, nid):
    def search(nodes):
        for i, n in enumerate(nodes or []):
            if isinstance(n, dict):
                if n.get("id") == nid:
                    return nodes, i
                hit = search(n.get("blocks"))
                if hit:
                    return hit
        return None
    hit = search(doc["nodes"])
    if not hit:
        raise KeyError(nid)
    return hit


def keys_in(doc):
    found = set()

    def w(n):
        if isinstance(n, dict):
            if isinstance(n.get("key"), str):
                found.add(n["key"])
            for v in n.values():
                w(v)
        elif isinstance(n, list):
            for v in n:
                w(v)
    w(doc)
    return found


def code_node(nid, title, body, names, arrays=(), objects=()):
    return K.code(nid, title, body, names, arrays, objects)


def sql_node(nid, title, text):
    for line in text.split("\n"):
        assert len(line) <= 160, (nid, line)
    return K.sql(nid, title, text, ["j"])


def bigints(table, cols):
    return [c for c in cols if TYPES[table][c] == "bigint"]


def json_object(alias, table, cols, doc=None):
    """SELECT JSON_OBJECT(...) AS j over the columns; bigint columns as exact text (cv.js turns them back into numbers below 16 digits)"""
    parts = []
    if doc:
        parts.append("'doc', CAST(%s AS CHAR)" % doc)
    for c in cols:
        expr = "%s.%s" % (alias, c)
        parts.append("'%s', %s" % (c, "CAST(%s AS CHAR)" % expr if TYPES[table][c] == "bigint" else expr))
    lines, cur = [], "SELECT JSON_OBJECT("
    for i, part in enumerate(parts):
        piece = part + (", " if i < len(parts) - 1 else ") AS j")
        if len(cur) + len(piece) > 150:
            lines.append(cur.rstrip())
            cur = "       "
        cur += piece
    lines.append(cur)
    return "\n".join(lines)


def js_list(xs):
    return json.dumps(xs)


def lifted(node, old_line, new_line):
    code = node["data"]["script"]["code"]
    assert code.count(old_line) == 1, (node["id"], old_line)
    node["data"]["script"]["code"] = code.replace(old_line, new_line)


def assert_gone(doc, gone):
    text = json.dumps(doc)
    for g in gone:
        for ref in ("{{node:%s." % g, "{{node:%s}}" % g, '"node.%s.' % g, '"id": "%s"' % g):
            assert ref not in text, (ref, text[max(0, text.find(ref) - 200):text.find(ref) + 100])


def ids_and_tenant(nid, param):
    return code_node(nid, "0. Ids + tenant for the reads", """const ids = {{workflowparams:%s}};
const tenant = [{{system:tenantId}}][0];
const list = (Array.isArray(ids) ? ids : [ids]).map((x) => (x === undefined || x === null ? "" : String(x).trim())).filter((x) => /^[0-9]{1,20}$/.test(x));
return {
  idsSql: list.length ? [...new Set(list)].join(",") : "0",
  tenantId: /^[0-9]{1,20}$/.test(String(tenant)) ? String(tenant) : "0",
};""" % param, ["idsSql", "tenantId"])


# ------------------------------------------------------------------------------------------------------------------ columns
# What the lifted code reads, and nothing else (the old search nodes handed over every column).
GD_HEAD = ("id so_id so_no delivery_no plant_id customer_name organization_id currency_code gd_billing_address gd_shipping_address sales_person "
           "document_description gd_area_id acc_integration_type customer_credit_limit overdue_limit outstanding_balance overdue_inv_total_amount "
           "is_accurate order_tnc order_payment_details order_delivery_term order_remark order_remark2 order_remark3 order_remark4 order_remark5 "
           "billing_address_name billing_address_phone billing_address_line_1 billing_address_line_2 billing_address_line_3 billing_address_line_4 "
           "billing_address_city billing_postal_code billing_address_state billing_address_country billing_attention billing_address_fax "
           "shipping_address_name shipping_address_phone shipping_address_line_1 shipping_address_line_2 shipping_address_line_3 "
           "shipping_address_line_4 shipping_address_city shipping_postal_code shipping_address_state shipping_address_country shipping_attention "
           "shipping_address_fax project_id").split()
GD_LINE = ("id parent_id so_line_item_id line_so_id gd_qty return_qty good_delivery_uom_id more_desc item_category_id material_name material_id "
           "item_bundle_id customer_id area_id line_remark_1 line_remark_2 line_remark_3 tariff_id custom_fields project_id").split()
GD_SO_HEAD = "id so_type so_no exchange_rate exchange_rate_currency".split()
GD_SO_LINE = ("id so_quantity so_item_price so_discount so_discount_amount so_tax_amount so_amount so_discount_uom invoice_qty return_qty "
              "sales_person_id so_item_uom so_desc payment_term_id so_tax_inclusive so_tax_preference so_tax_percentage").split()
SO_HEAD = ("id customer_name organization_id plant_name so_type so_no so_currency cust_billing_address cust_shipping_address so_sales_person "
           "so_payment_term exchange_rate_currency exchange_rate so_description so_area_id acc_integration_type customer_credit_limit overdue_limit "
           "outstanding_balance overdue_inv_total_amount is_accurate total_gross_currency total_discount_currency total_tax_currency "
           "total_amount_currency so_total_gross so_total_discount so_total_tax so_total myr_total_amount so_tnc so_payment_details so_delivery_term "
           "so_remarks so_remarks2 so_remarks3 so_remarks4 so_remarks5 billing_address_name billing_address_phone billing_address_line_1 "
           "billing_address_line_2 billing_address_line_3 billing_address_line_4 billing_address_city billing_postal_code billing_address_state "
           "billing_address_country billing_attention billing_address_fax shipping_address_name shipping_address_phone shipping_address_line_1 "
           "shipping_address_line_2 shipping_address_line_3 shipping_address_line_4 shipping_address_city shipping_postal_code "
           "shipping_address_state shipping_address_country shipping_attention shipping_address_fax project_id").split()
SO_LINE = ("id parent_id so_tax_amount so_quantity so_discount return_qty sales_person_id so_discount_amount so_item_uom so_desc more_desc "
           "so_discount_uom item_category_id payment_term_id item_id so_amount so_gross so_tax_inclusive so_tax_preference so_tax_percentage "
           "so_item_price item_name item_bundle_id customer_id area_id line_remark_1 line_remark_2 line_remark_3 tariff_id custom_fields "
           "further_description project_id").split()
GD, GDL, SO, SOL = "goods_delivery", "goods_delivery_fwii8mvb_sub", "sales_order", "sales_order_axszx8cj_sub"


# ------------------------------------------------------------------------------------------------------------------ GD_Convert_SI
def build_gd_convert(doc):
    doc = copy.deepcopy(doc)
    K._taken.update(keys_in(doc))
    top = doc["nodes"]
    S0 = "code_node_gdcvStart"
    TT = "{{node:%s.data.tenantId}}" % S0
    IDS = "{{node:%s.data.idsSql}}" % S0
    cv = code_file("cv.js")

    # 1. the selected GDs: only the status (2-1) and the sales orders (2-2) were read off them
    start = ids_and_tenant(S0, "ids")
    heads = sql_node("sql_node_gdcvHeads", "1. Selected GDs: status and sales orders",
                     "SELECT JSON_OBJECT('id', CAST(g.id AS CHAR), 'gd_status', g.gd_status, 'so_id', g.so_id) AS j\n  FROM goods_delivery g\n"
                     " WHERE g.tenant_id = '%s' AND g.is_deleted = 0\n   AND g.id IN (%s)\n ORDER BY g.id" % (TT, IDS))
    i = [n["id"] for n in top].index("search_node_AHtHRmqi")
    top[i:i + 1] = [start, heads]
    HEADS = "cvRows([{{node:sql_node_gdcvHeads.data}}][0], %s)" % js_list(["id"])
    for nid in ("code_node_5lS2tGyt", "code_node_42o2wYvS"):
        n = find(doc, nid)
        lifted(n, "const gdList = {{node:search_node_AHtHRmqi.data.data}};", cv + "\n\nconst gdList = %s;" % HEADS)
    somap = find(doc, "code_node_42o2wYvS")
    lifted(somap, "return {\n  uniqueSoIDs,\n};",
           "return {\n  uniqueSoIDs,\n  soIdsSql: uniqueSoIDs.map(String).filter((x) => /^[0-9]{1,20}$/.test(x)).join(\",\") || \"0\",\n};")
    somap["data"]["response_json"].append(K.resp(["soIdsSql"])[0])

    # 2-3 / 4. the Completed GDs and their lines, the sales orders and the order lines behind the GD lines - in parallel
    done_sql = (json_object("g", GD, GD_HEAD) + "\n  FROM goods_delivery g\n WHERE g.tenant_id = '%s' AND g.is_deleted = 0 AND g.gd_status = 'Completed'"
                "\n   AND g.id IN (%s)\n ORDER BY g.id" % (TT, IDS))
    lines_sql = (json_object("l", GDL, GD_LINE, doc="g.id") + "\n  FROM goods_delivery g\n  JOIN goods_delivery_fwii8mvb_sub l ON l.goods_delivery_id = g.id"
                 " AND l.is_deleted = 0\n WHERE g.tenant_id = '%s' AND g.is_deleted = 0 AND g.gd_status = 'Completed'\n   AND g.id IN (%s)\n"
                 " ORDER BY g.id, l.id" % (TT, IDS))
    soh_sql = (json_object("s", SO, GD_SO_HEAD) + "\n  FROM sales_order s\n WHERE s.tenant_id = '%s' AND s.is_deleted = 0"
               "\n   AND s.id IN ({{node:code_node_42o2wYvS.data.soIdsSql}})\n ORDER BY s.id" % TT)
    # so_line_item_id is varchar: compared as a number it would match neighbouring 19-digit ids (DOUBLE), so it is cast first
    sol_sql = (json_object("sl", SOL, GD_SO_LINE) + "\n  FROM sales_order_axszx8cj_sub sl\n WHERE sl.tenant_id = '%s' AND sl.is_deleted = 0"
               "\n   AND sl.id IN (\n       SELECT CAST(gl.so_line_item_id AS UNSIGNED) FROM goods_delivery_fwii8mvb_sub gl\n"
               "        WHERE gl.tenant_id = '%s' AND gl.is_deleted = 0\n          AND gl.goods_delivery_id IN (%s))\n ORDER BY sl.id" % (TT, TT, IDS))
    reads = K.parallel("condition_all_gdcvRead", "2-3 / 4. Completed GDs, their lines, SO data (parallel)", [
        ("cai_gdcvDone", "Completed GDs", [sql_node("sql_node_gdcvDone", "2-3. Completed GDs (header fields the SI takes)", done_sql)]),
        ("cai_gdcvLines", "Their lines", [sql_node("sql_node_gdcvLines", "2-3. Their lines (fields the SI takes)", lines_sql)]),
        ("cai_gdcvSoHeads", "SO data", [sql_node("sql_node_gdcvSoHeads", "4. Sales orders (type, number, exchange rate)", soh_sql)]),
        ("cai_gdcvSoLines", "SO line data", [sql_node("sql_node_gdcvSoLines", "4. SO lines behind the GD lines (price / tax fields)", sol_sql)]),
    ])
    yes, j = parent_list(doc, "search_node_bOF3TVA2")
    assert [n["id"] for n in yes] == ["search_node_bOF3TVA2", "code_node_LqEGUXmi", "if_uiTR0Npr"]
    yes[0:1] = [reads]
    DONE = "cvRows([{{node:sql_node_gdcvDone.data}}][0], %s)" % js_list(bigints(GD, GD_HEAD))
    chk = find(doc, "code_node_LqEGUXmi")
    lifted(chk, "const gdRaw = {{node:search_node_bOF3TVA2.data.data}} || [];", "const gdRaw = %s || [];" % DONE)
    chk["data"]["script"]["code"] = cv + "\n\n" + chk["data"]["script"]["code"]

    rest = find(doc, "if_uiTR0Npr")["blocks"][1]["blocks"]
    assert [n["id"] for n in rest] == ["get_node_yDMG0Sab", "code_node_ZtKdDFYw", "search_node_Ivek0yYx", "search_node_r3bnMaWy", "get_node_srSetup1",
                                       "code_node_sQX9tldw", "if_no_si", "code_node_YRozjK8Z", "set_cache_node_LhSMNwfs", "set_cache_results_init",
                                       "loop_9Jv4BHg1", "get_cache_final", "code_summary", "end_ok"]
    fmt, sr, mapper, nosi, rname, rinit, loop = rest[0], rest[4], rest[5], rest[6], rest[7], rest[9], rest[10]
    GDS = "cvDocs([{{node:sql_node_gdcvDone.data}}][0], [{{node:sql_node_gdcvLines.data}}][0], \"table_gd\", %s, %s)" % (
        js_list(bigints(GD, GD_HEAD)), js_list(bigints(GDL, GD_LINE)))
    code = mapper["data"]["script"]["code"]
    for old, new in (("const gdRaw = {{node:search_node_bOF3TVA2.data.data}} || [];", "const gdRaw = %s || [];" % GDS),
                     ("const soLineItemList = {{node:search_node_r3bnMaWy.data.data}} || [];",
                      "const soLineItemList = cvRows([{{node:sql_node_gdcvSoLines.data}}][0], %s) || [];" % js_list(bigints(SOL, GD_SO_LINE))),
                     ("const soList = {{node:search_node_Ivek0yYx.data.data}} || [];",
                      "const soList = cvRows([{{node:sql_node_gdcvSoHeads.data}}][0], %s) || [];" % js_list(bigints(SO, GD_SO_HEAD)))):
        assert code.count(old) == 1, old
        code = code.replace(old, new)
    mapper["data"]["script"]["code"] = cv + "\n\n" + code

    # the loop hands SI_SAVE its own item (v25 re-read the whole siList per pass through a cache counter); the results cache stays
    body = loop["blocks"]
    assert [n["id"] for n in body] == ["get_cache_node_l03kAFq7", "code_node_9PRotptG", "workflow_node_gz6u8DqY", "get_cache_results", "code_collect",
                                       "set_cache_results", "set_cache_node_FdcwMlCb"]
    cur = body[1]
    cur["data"]["script"]["code"] = "// The invoice of this pass: the loop's own item\nconst siData = {{node:loop_9Jv4BHg1}};\n\nreturn {\n  siData,\n};"
    cur["data"]["response_json"] = [r for r in cur["data"]["response_json"] if r["name"] == "siData"]
    loop["blocks"] = [cur, body[2], body[3], body[4], body[5]]
    find(doc, "if_uiTR0Npr")["blocks"][1]["blocks"] = [fmt, sr, mapper, nosi, rname, rinit, loop] + rest[11:]

    assert_gone(doc, ("search_node_AHtHRmqi", "search_node_bOF3TVA2", "search_node_Ivek0yYx", "search_node_r3bnMaWy", "code_node_ZtKdDFYw",
                      "set_cache_node_LhSMNwfs", "get_cache_node_l03kAFq7", "set_cache_node_FdcwMlCb"))
    K.check_ids(doc)
    return doc


# ------------------------------------------------------------------------------------------------------------------ SO_Convert_SI
def build_so_convert(doc):
    doc = copy.deepcopy(doc)
    K._taken.update(keys_in(doc))
    top = doc["nodes"]
    S0 = "code_node_socvStart"
    TT = "{{node:%s.data.tenantId}}" % S0
    IDS = "{{node:%s.data.idsSql}}" % S0
    cv = code_file("cv.js")

    # 1. the selected SOs: only the status (2-1) was read off them
    start = ids_and_tenant(S0, "so_ids")
    heads = sql_node("sql_node_socvHeads", "1. Selected SOs: status",
                     "SELECT JSON_OBJECT('id', CAST(s.id AS CHAR), 'so_status', s.so_status) AS j\n  FROM sales_order s\n"
                     " WHERE s.tenant_id = '%s' AND s.is_deleted = 0\n   AND s.id IN (%s)\n ORDER BY s.id" % (TT, IDS))
    i = [n["id"] for n in top].index("search_node_AHtHRmqi")
    top[i:i + 1] = [start, heads]
    st = find(doc, "code_node_5lS2tGyt")
    lifted(st, "const soList = {{node:search_node_AHtHRmqi.data.data}};",
           cv + "\n\nconst soList = cvRows([{{node:sql_node_socvHeads.data}}][0], %s);" % js_list(["id"]))

    # 2-3. the non-Draft SOs and their lines, in parallel
    done_sql = (json_object("s", SO, SO_HEAD) + "\n  FROM sales_order s\n WHERE s.tenant_id = '%s' AND s.is_deleted = 0 AND s.so_status <> 'Draft'"
                "\n   AND s.id IN (%s)\n ORDER BY s.id" % (TT, IDS))
    lines_sql = (json_object("l", SOL, SO_LINE, doc="s.id") + "\n  FROM sales_order s\n  JOIN sales_order_axszx8cj_sub l ON l.sales_order_id = s.id"
                 " AND l.is_deleted = 0\n WHERE s.tenant_id = '%s' AND s.is_deleted = 0 AND s.so_status <> 'Draft'\n   AND s.id IN (%s)\n"
                 " ORDER BY s.id, l.id" % (TT, IDS))
    reads = K.parallel("condition_all_socvRead", "2-3. Non-Draft SOs and their lines (parallel)", [
        ("cai_socvDone", "Non-Draft SOs", [sql_node("sql_node_socvDone", "2-3. Non-Draft SOs (header fields the SI takes)", done_sql)]),
        ("cai_socvLines", "Their lines", [sql_node("sql_node_socvLines", "2-3. Their lines (fields the SI takes)", lines_sql)]),
    ])
    yes, j = parent_list(doc, "search_node_bOF3TVA2")
    assert [n["id"] for n in yes] == ["search_node_bOF3TVA2", "code_node_LqEGUXmi", "if_uiTR0Npr"]
    yes[0:1] = [reads]
    HEADS = "cvRows([{{node:sql_node_socvDone.data}}][0], %s)" % js_list(bigints(SO, SO_HEAD))
    ALL = "cvDocs([{{node:sql_node_socvDone.data}}][0], [{{node:sql_node_socvLines.data}}][0], \"table_so\", %s, %s)" % (
        js_list(bigints(SO, SO_HEAD)), js_list(bigints(SOL, SO_LINE)))
    lifted(find(doc, "code_node_LqEGUXmi"), "const soList = {{node:search_node_bOF3TVA2.data.data}}\n", cv + "\n\nconst soList = %s;\n" % HEADS)

    rest = find(doc, "if_uiTR0Npr")["blocks"][1]["blocks"]
    assert [n["id"] for n in rest] == ["code_node_ssy49eEb", "get_node_yDMG0Sab", "get_node_srSetup1", "code_node_sQX9tldw", "code_node_YRozjK8Z",
                                       "set_cache_node_LhSMNwfs", "loop_9Jv4BHg1", "get_cache_node_ConvertSI10", "code_node_MapSIOut11", "end_convert_si_ok"]
    lifted(rest[0], "const soList = {{node:search_node_bOF3TVA2.data.data}};", cv + "\n\nconst soList = %s;" % HEADS)
    mapper = rest[3]
    lifted(mapper, "const soList = {{node:search_node_bOF3TVA2.data.data}};", "const soList = %s;" % ALL)
    mapper["data"]["script"]["code"] = cv + "\n\n" + mapper["data"]["script"]["code"]

    # the loop hands SI_SAVE its own item (v56 re-read the whole siList per pass); the { index, si_list } state stays
    cur = find(doc, "code_node_9PRotptG")
    lifted(cur, "const siList = {{node:code_node_sQX9tldw.data.siList}};\n", "")
    lifted(cur, "const siData = siList[state.index];",
           "// The invoice of this pass: the loop's own item (v56 re-read the whole list per pass)\nconst siData = {{node:loop_9Jv4BHg1}};")
    lifted(cur, 'console.log("Convert SI - invoice", state.index + 1, "of", siList.length);', 'console.log("Convert SI - invoice", state.index + 1);')

    assert_gone(doc, ("search_node_AHtHRmqi", "search_node_bOF3TVA2"))
    assert "code_node_sQX9tldw.data.siList}}" in json.dumps(find(doc, "loop_9Jv4BHg1")["data"])
    K.check_ids(doc)
    return doc


BUILDERS = {"GD_Convert_SI": build_gd_convert, "SO_Convert_SI": build_so_convert}


def render(doc):
    return json.dumps(doc, ensure_ascii=False, indent=2) + "\n"


def main():
    names = [a for a in sys.argv[1:] if not a.startswith("--")] or list(BUILDERS)
    os.makedirs(os.path.join(HERE, "out"), exist_ok=True)
    for name in names:
        base = json.load(open(os.path.join(HERE, BASE[name]), encoding="utf-8"))
        out = BUILDERS[name](base)
        with open(os.path.join(HERE, "out", name + ".json"), "w", encoding="utf-8") as f:
            f.write(render(out))
        print("%s: %d top nodes -> out/%s.json" % (name, len(out["nodes"]), name))


if __name__ == "__main__":
    main()
