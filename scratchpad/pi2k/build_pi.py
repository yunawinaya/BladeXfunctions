"""Builds the lean (2,000-line) PI workflows from the live DEV versions in base/:

  PI_SAVE v19        -> Purchase Invoice/PIsaveWorkflow.json
  GR_Convert_PI v18  -> Purchase Invoice/convertGRtoPIworkflow.json
  PO_CONVERT_PI v5   -> Purchase Invoice/convertPOtoPIworkflow.json

Same requests, responses, end codes and messages; whole-document reads become sql-nodes that read only the columns the
lifted code uses, and the chains that copied every line through several nodes run as one node.

usage: python3 build_pi.py [--write] [NAME ...]
"""
import copy
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
R = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(R, "scratchpad", "grv2"))
import wfkit as K  # noqa: E402

WRITE = "--write" in sys.argv
OUT = {
    "PI_SAVE": "Purchase Invoice/PIsaveWorkflow.json",
    "GR_Convert_PI": "Purchase Invoice/convertGRtoPIworkflow.json",
    "PO_CONVERT_PI": "Purchase Invoice/convertPOtoPIworkflow.json",
}
BASE = {"PI_SAVE": "PI_SAVE.v19.json", "GR_Convert_PI": "GR_Convert_PI.v18.json", "PO_CONVERT_PI": "PO_CONVERT_PI.v5.json"}


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


def repoint(obj, old, new):
    """every {{node:old...}} reference (templates and ConditionRule props) -> new"""
    text = json.dumps(obj, ensure_ascii=False)
    text = text.replace("{{node:%s." % old, "{{node:%s." % new).replace('"node.%s.' % old, '"node.%s.' % new)
    return json.loads(text)


def set_expr(node, expr):
    node["data"]["expression"]["code"] = expr


def resp_types(names, arrays=(), objects=(), ints=()):
    out = K.resp(names, arrays, objects)
    for r in out:
        if r["name"] in ints:
            r["bsonType"] = "int"
    return out


def code_node(nid, title, body, names, arrays=(), objects=(), ints=()):
    n = K.code(nid, title, body, names, arrays, objects)
    n["data"]["response_json"] = resp_types(names, arrays, objects, ints)
    return n


def sql_node(nid, title, text):
    for line in text.split("\n"):
        assert len(line) <= 160, (nid, line)
    return K.sql(nid, title, text, ["j"])


# ------------------------------------------------------------------------------------------------------------------ PI_SAVE
PREP = "code_pi_prep"
T = "{{node:%s.data.tenantId}}" % PREP

SQL_PI_PO = """SELECT JSON_OBJECT('doc', CAST(p.id AS CHAR), 'id', CAST(l.id AS CHAR), 'parent_id', CAST(l.parent_id AS CHAR),
       'item_id', CAST(l.item_id AS CHAR), 'item_bundle_id', CAST(l.item_bundle_id AS CHAR), 'quantity', l.quantity,
       'invoice_qty', l.invoice_qty, 'pi_status', l.pi_status) AS j
  FROM purchase_order p
  LEFT JOIN purchase_order_2ukyuanr_sub l ON l.purchase_order_id = p.id AND l.is_deleted = 0
 WHERE p.tenant_id = '%s' AND p.is_deleted = 0 AND p.id IN ({{node:%s.data.poIdsSql}})
 ORDER BY p.id, l.id""" % (T, PREP)

SQL_PI_GR = """SELECT JSON_OBJECT('doc', CAST(g.id AS CHAR), 'id', CAST(l.id AS CHAR), 'parent_id', CAST(l.parent_id AS CHAR),
       'item_id', CAST(l.item_id AS CHAR), 'item_bundle_id', CAST(l.item_bundle_id AS CHAR), 'received_qty', l.received_qty,
       'invoice_qty', l.invoice_qty, 'pi_status', l.pi_status, 'parent_or_child', l.parent_or_child,
       'po_line_item_id', CAST(l.po_line_item_id AS CHAR), 'line_index', l.line_index) AS j
  FROM goods_receiving g
  LEFT JOIN goods_receiving_eg6l4ywi_sub l ON l.goods_receiving_id = g.id AND l.is_deleted = 0
 WHERE g.tenant_id = '%s' AND g.is_deleted = 0 AND g.id IN ({{node:%s.data.grIdsSql}})
 ORDER BY g.id, l.id""" % (T, PREP)

SQL_PI_STORED = """SELECT JSON_OBJECT('id', CAST(p.id AS CHAR), 'pi_status', p.pi_status, 'purchase_invoice_no', p.purchase_invoice_no) AS j
  FROM purchase_invoice p
 WHERE p.tenant_id = '%s' AND p.is_deleted = 0 AND p.id = {{node:%s.data.piIdSql}}""" % (T, PREP)

SQL_PI_AFTER = """SELECT JSON_OBJECT('id', CAST(p.id AS CHAR), 'purchase_invoice_no', p.purchase_invoice_no) AS j
  FROM purchase_invoice p
 WHERE p.tenant_id = '%s' AND p.is_deleted = 0 AND p.id = {{node:code_pi_saved.data.idSql}}""" % T


def build_pi_save(doc):
    doc = copy.deepcopy(doc)
    K._taken.update(keys_in(doc))
    ids = K.Ids(1799300000000)
    top = doc["nodes"]

    # 1. v19's draft / completed chains + fill-back -> one Prepare node and its two refusals
    end406 = copy.deepcopy(find(doc, "end_pi_failed"))
    end406["data"]["msg"]["code"] = "{{node:%s.data.message}}" % PREP
    end407 = copy.deepcopy(find(doc, "end_pi_qty_failed"))
    end407["data"]["msg"]["code"] = "{{node:%s.data.message}}" % PREP
    prep = code_node(PREP, "Prepare: doc no, required fields, invoice qty, header fields",
                     code_file("prep.js") + "\n\nreturn piPrep({{workflowparams:data}}, [{{system:tenantId}}][0]);",
                     ["route", "message", "entry", "isCompleted", "needPo", "needGr", "poIdsSql", "grIdsSql", "piIdSql", "piId", "tenantId",
                      "check"], objects=("entry", "piId", "check"))
    if406 = K.if_(ids, "if_pi_prep_406", "Required fields missing?", "'{{node:%s.data.route}}' == 'E406'" % PREP, [end406])
    if407 = K.if_(ids, "if_pi_prep_407", "Invoice qty 0?", "'{{node:%s.data.route}}' == 'E407'" % PREP, [end407])
    i = [n["id"] for n in top].index("if_save_draft")
    assert [n["id"] for n in top][i + 1] == "code_pi_fillback"
    top[i:i + 2] = [prep, if406, if407]

    # 2. parallel reads: only the columns the check uses; the stored invoice's status (Edit)
    fetch = find(doc, "condition_all_pi_fetch")
    br = {b["id"]: b for b in fetch["blocks"]}
    br["condition_all_pi_fetch_item_po"]["blocks"] = [
        K.if_(ids, "if_pi_need_po", "Completed with purchase orders?", "'{{node:%s.data.needPo}}' == '1'" % PREP,
              [sql_node("sql_node_pi_po", "Purchase order lines (columns the check reads)", SQL_PI_PO)])]
    br["condition_all_pi_fetch_item_gr"]["blocks"] = [
        K.if_(ids, "if_pi_need_gr", "Completed with goods receivings?", "'{{node:%s.data.needGr}}' == '1'" % PREP,
              [sql_node("sql_node_pi_gr", "Goods receiving lines (columns the check reads)", SQL_PI_GR)])]
    edit = find(doc, "if_pi_edit")
    assert [n["id"] for n in edit["blocks"][0]["blocks"]] == ["get_node_pi_stored"]
    edit["blocks"][0]["blocks"] = [sql_node("sql_node_pi_stored", "Stored PI status and number", SQL_PI_STORED)]

    # 3. the 409 guard
    guard = find(doc, "code_pi_guard")
    guard["data"]["script"]["code"] = (code_file("guard.js") +
                                       "\n\nreturn piGuard([{{node:%s.data.piId}}][0], [{{node:sql_node_pi_stored.data}}][0]);" % PREP)

    # 4. over-invoice check + PO / GR roll-up, before the write
    vblock = find(doc, "if_pi_completed_validate")
    set_expr(vblock, "'{{node:%s.data.isCompleted}}' == '1'" % PREP)
    tblock = vblock["blocks"][0]["blocks"]
    assert [n["id"] for n in tblock] == ["code_pi_validate", "if_pi_qty_validate_failed"]
    check = code_node("code_pi_check", "Over-invoice check + PO / GR roll-up",
                      code_file("check.js") + "\n\nreturn piCheck({{node:%s.data.check}}, [{{node:sql_node_pi_po.data}}][0], "
                                              "[{{node:sql_node_pi_gr.data}}][0]);" % PREP,
                      ["status", "allErrors", "poHeaders", "hasPoHeaders", "poLines", "hasPoLines", "grHeaders", "hasGrHeaders", "grLines",
                       "hasGrLines"], arrays=("allErrors", "poHeaders", "poLines", "grHeaders", "grLines"),
                      ints=("hasPoHeaders", "hasPoLines", "hasGrHeaders", "hasGrLines"))
    old_validate = tblock[0]
    check["data"]["response_json"][1] = old_validate["data"]["response_json"][0]  # allErrors: v19's typed declaration (code_pi_410 reads itemName)
    tblock[0] = check
    tblock[1] = repoint(tblock[1], "code_pi_validate", "code_pi_check")

    # 5. the write: same props, from the Prepare node
    addif = find(doc, "if_pi_add")
    addif["blocks"] = repoint(addif["blocks"], "code_pi_fillback", PREP)
    fblock = addif["blocks"][1]["blocks"]
    assert [n["id"] for n in fblock][-2:] == ["update_node_pi", "get_node_pi"]
    fblock.pop()  # get_node_pi: the id and number are read back below

    # 6. saved id -> read back id + number (v19 returned the whole invoice)
    j = [n["id"] for n in top].index("code_pi_maplatest")
    saved = code_node("code_pi_saved", "Saved PI id", code_file("saved.js") +
                      "\n\nreturn piSaved({{workflowparams:data.page_status}}, [{{node:add_node_pi.data.id}}][0], [{{node:%s.data.piId}}][0]);" % PREP,
                      ["idSql"])
    after = sql_node("sql_node_pi_after", "Saved PI id and number", SQL_PI_AFTER)
    latest = top[j]
    latest["data"]["script"]["code"] = code_file("maplatest.js") + "\n\nreturn piLatest([{{node:sql_node_pi_after.data}}][0]);"
    top[j:j] = [saved, after]

    # 7. PO / GR writes from the check node
    ablock = find(doc, "if_pi_completed_apply")
    set_expr(ablock, "'{{node:%s.data.isCompleted}}' == '1'" % PREP)
    tb = ablock["blocks"][0]["blocks"]
    assert [n["id"] for n in tb] == ["code_pi_apply", "condition_all_pi_update"]
    tb.pop(0)
    ablock["blocks"][0]["blocks"] = repoint(tb, "code_pi_apply", "code_pi_check")

    doc = repoint(doc, "code_pi_fillback", PREP)
    text = json.dumps(doc)
    for gone in ("code_pi_fillback", "code_pi_docno", "code_pi_draft_docno", "code_pi_required", "code_pi_draft_required", "workflow_pi_check",
                 "workflow_pi_draft_check", "code_pi_checkqty", "code_pi_validate", "code_pi_apply", "search_node_po", "search_node_gr",
                 "get_node_pi_stored", "get_node_pi", "if_save_draft"):
        for ref in ("{{node:%s." % gone, '"node.%s.' % gone, '"id": "%s"' % gone):
            assert ref not in text, (ref, text[max(0, text.find(ref) - 200):text.find(ref) + 100])
    return doc


# ------------------------------------------------------------------------------------------------------------------ conversions
TYPES = json.load(open(os.path.join(HERE, "coltypes.json")))
GR_HEAD = ("id gr_status po_id supplier_name plant_id gr_no gr_remark1 gr_remark2 gr_remark3 gr_remark4 gr_remark5 currency_code billing_address_name "
           "billing_address_phone billing_address_line_1 billing_address_line_2 billing_address_line_3 billing_address_line_4 billing_address_city "
           "billing_postal_code billing_address_state billing_address_country billing_attention billing_address_fax shipping_address_name "
           "shipping_address_phone shipping_address_line_1 shipping_address_line_2 shipping_address_line_3 shipping_address_line_4 shipping_address_city "
           "shipping_postal_code shipping_address_state shipping_address_country shipping_attention shipping_address_fax gr_billing_address "
           "gr_shipping_address organization_id purchase_order_number project_id custom_fields_e9609s2l").split()
GR_LINE = ("id item_id item_name item_bundle_id item_desc more_desc line_po_no received_qty item_uom line_remark_1 line_remark_2 line_po_id "
           "po_line_item_id item_category_id billing_country_id shipping_country_id billing_state_id supplier_id tariff_id further_description "
           "project_id custom_fields_d7o7rdkd parent_or_child parent_id").split()
PO_HEAD = ("id exchange_rate exchange_rate_currency po_status approve_flow_status purchase_order_no po_supplier_id po_currency po_plant "
           "organization_id acc_integration_type po_payment_terms po_description po_remark po_remark2 po_remark3 po_remark4 po_remark5 "
           "po_billing_address po_shipping_address billing_address_name billing_address_phone billing_address_line_1 billing_address_line_2 "
           "billing_address_line_3 billing_address_line_4 billing_address_city billing_postal_code billing_address_state billing_address_country "
           "billing_attention billing_address_fax shipping_address_name shipping_address_phone shipping_address_line_1 shipping_address_line_2 "
           "shipping_address_line_3 shipping_address_line_4 shipping_address_city shipping_postal_code shipping_address_state "
           "shipping_address_country shipping_attention shipping_address_fax project_id custom_fields_b3w85tmv").split()
PO_LINE = ("id parent_id quantity unit_price discount discount_amount tax_amount po_amount discount_uom tax_preference tax_percent tax_inclusive "
           "invoice_qty payment_term_id item_id item_name item_bundle_id item_desc more_desc received_qty quantity_uom line_remark_1 line_remark_2 "
           "item_category_id tariff_id further_description project_id custom_fields_va4w0xz3").split()
GR_PO_HEAD = ["id", "exchange_rate", "exchange_rate_currency"]
GR_PO_LINE = ("id quantity unit_price discount discount_amount tax_amount po_amount discount_uom tax_preference tax_percent tax_inclusive "
              "invoice_qty payment_term_id").split()
PHYS = {"gr": "goods_receiving", "grl": "goods_receiving_eg6l4ywi_sub", "po": "purchase_order", "pol": "purchase_order_2ukyuanr_sub"}


def bigints(table, cols):
    return [c for c in cols if TYPES[PHYS[table]][c] == "bigint"]


def json_object(alias, table, cols, doc=None):
    parts = []
    if doc:
        parts.append("'doc', CAST(%s AS CHAR)" % doc)
    for c in cols:
        expr = "%s.%s" % (alias, c)
        parts.append("'%s', %s" % (c, "CAST(%s AS CHAR)" % expr if TYPES[PHYS[table]][c] == "bigint" else expr))
    lines, cur = [], "SELECT JSON_OBJECT("
    for i, part in enumerate(parts):
        piece = part + (", " if i < len(parts) - 1 else ") AS j")
        if len(cur) + len(piece) > 150:
            lines.append(cur.rstrip())
            cur = "       "
        cur += piece
    lines.append(cur)
    return "\n".join(lines)


def cv_call(fn, *args):
    return "%s(%s)" % (fn, ", ".join(args))


def js_list(xs):
    return json.dumps(xs)


def lifted(node, old_line, new_line):
    code = node["data"]["script"]["code"]
    assert code.count(old_line) == 1, (node["id"], old_line)
    node["data"]["script"]["code"] = code.replace(old_line, new_line)


def build_gr_convert(doc):
    doc = copy.deepcopy(doc)
    K._taken.update(keys_in(doc))
    ids = K.Ids(1799400000000)
    top = doc["nodes"]
    S0 = "code_node_grcvStart"
    TT = "{{node:%s.data.tenantId}}" % S0
    IDS = "{{node:%s.data.idsSql}}" % S0
    cv = code_file("cv.js")

    start = code_node(S0, "0. Ids + tenant for the reads", """const ids = {{workflowparams:ids}};
const tenant = [{{system:tenantId}}][0];
const list = (Array.isArray(ids) ? ids : [ids]).map((x) => (x === undefined || x === null ? "" : String(x).trim())).filter((x) => /^[0-9]{1,20}$/.test(x));
return {
  idsSql: list.length ? [...new Set(list)].join(",") : "0",
  tenantId: /^[0-9]{1,20}$/.test(String(tenant)) ? String(tenant) : "0",
};""", ["idsSql", "tenantId"])
    heads = sql_node("sql_node_grcvHeads", "1. Selected GRs: status and purchase orders",
                     "SELECT JSON_OBJECT('id', CAST(g.id AS CHAR), 'gr_status', g.gr_status, 'po_id', g.po_id) AS j\n  FROM goods_receiving g\n"
                     " WHERE g.tenant_id = '%s' AND g.is_deleted = 0\n   AND g.id IN (%s)\n ORDER BY g.id" % (TT, IDS))
    i = [n["id"] for n in top].index("search_node_AHtHRmqi")
    top[i:i + 1] = [start, heads]
    HEADS = "cvRows([{{node:sql_node_grcvHeads.data}}][0], %s)" % js_list(["id"])
    for nid in ("code_node_5lS2tGyt", "code_node_42o2wYvS"):
        n = find(doc, nid)
        lifted(n, "const grList = {{node:search_node_AHtHRmqi.data.data}};", cv + "\n\nconst grList = %s;" % HEADS)
    pomap = find(doc, "code_node_42o2wYvS")
    lifted(pomap, "return {\n  uniquePoIDs,\n};", "return {\n  uniquePoIDs,\n  poIdsSql: uniquePoIDs.map(String).filter((x) => /^[0-9]{1,20}$/.test(x)).join(\",\") || \"0\",\n};")
    pomap["data"]["response_json"].append(resp_types(["poIdsSql"])[0])

    # completed GRs, their lines, the purchase orders and order lines, the number rule - in parallel
    # Received (putaway still to do) is invoiced like Completed: the receipt is done, 2-1's status check already lets it through (user 2026-10-21)
    done_sql = (json_object("g", "gr", GR_HEAD) + "\n  FROM goods_receiving g\n WHERE g.tenant_id = '%s' AND g.is_deleted = 0 AND g.gr_status IN ('Completed', 'Received')"
                "\n   AND g.id IN (%s)\n ORDER BY g.id" % (TT, IDS))
    lines_sql = (json_object("l", "grl", GR_LINE, doc="g.id") + "\n  FROM goods_receiving g\n  JOIN goods_receiving_eg6l4ywi_sub l ON l.goods_receiving_id = g.id"
                 " AND l.is_deleted = 0\n WHERE g.tenant_id = '%s' AND g.is_deleted = 0 AND g.gr_status IN ('Completed', 'Received')\n   AND g.id IN (%s)\n"
                 " ORDER BY g.id, l.id" % (TT, IDS))
    poh_sql = (json_object("p", "po", GR_PO_HEAD) + "\n  FROM purchase_order p\n WHERE p.tenant_id = '%s' AND p.is_deleted = 0"
               "\n   AND p.id IN ({{node:code_node_42o2wYvS.data.poIdsSql}})\n ORDER BY p.id" % TT)
    pol_sql = (json_object("pl", "pol", GR_PO_LINE) + "\n  FROM purchase_order_2ukyuanr_sub pl\n WHERE pl.tenant_id = '%s' AND pl.is_deleted = 0"
               "\n   AND pl.id IN (\n       SELECT gl.po_line_item_id FROM goods_receiving_eg6l4ywi_sub gl\n"
               "        WHERE gl.tenant_id = '%s' AND gl.is_deleted = 0\n          AND gl.goods_receiving_id IN (%s))\n ORDER BY pl.id" % (TT, TT, IDS))
    fmt = copy.deepcopy(find(doc, "get_node_yDMG0Sab"))
    reads = K.parallel("condition_all_grcvRead", "2-3. Completed / Received GRs and PO data (parallel)", [
        ("cai_grcvDone", "Completed / Received GRs", [sql_node("sql_node_grcvDone", "2-3. Completed / Received GRs (header fields the PI takes)", done_sql)]),
        ("cai_grcvLines", "Their lines", [sql_node("sql_node_grcvLines", "2-3. Their lines (fields the PI takes)", lines_sql)]),
        ("cai_grcvPoHeads", "PO data", [sql_node("sql_node_grcvPoHeads", "4. PO exchange rates", poh_sql)]),
        ("cai_grcvPoLines", "PO line data", [sql_node("sql_node_grcvPoLines", "4. PO lines of the selected GRs (price / tax fields)", pol_sql)]),
    ])
    yes, j = parent_list(doc, "search_node_bOF3TVA2")
    assert [n["id"] for n in yes] == ["search_node_bOF3TVA2", "code_node_LqEGUXmi", "if_uiTR0Npr"]
    # nothing left to convert (only Draft / Created / Cancelled GRs, the user chose Proceed): v18 crashed in 5. Map PI Data
    none = code_node("code_node_grcvNone", "2-3. Anything left to convert?", cv + """

const left = cvRows([{{node:sql_node_grcvDone.data}}][0], ["id"]);

return {
  none: left.length === 0 ? "1" : "0",
  message: "None of the selected Goods Receivings can be converted. Only Completed or Received Goods Receivings can be invoiced.",
};""", ["none", "message"])
    end402 = copy.deepcopy(find(doc, "end_EKbfI_dO"))
    end402["id"] = "end_grcvNone"
    end402["data"]["msg"]["code"] = "{{node:code_node_grcvNone.data.message}}"
    ifnone = K.if_(ids, "if_grcvNone", "Nothing left to convert?", "'{{node:code_node_grcvNone.data.none}}' == '1'", [end402])
    yes[0:1] = [reads, none, ifnone]
    DONE = "cvRows([{{node:sql_node_grcvDone.data}}][0], %s)" % js_list(bigints("gr", GR_HEAD))
    lifted(find(doc, "code_node_LqEGUXmi"), "const grList = {{node:search_node_bOF3TVA2.data.data}}", cv + "\n\nconst grList = " + DONE)

    rest = find(doc, "if_uiTR0Npr")["blocks"][1]["blocks"]
    assert [n["id"] for n in rest] == ["get_node_yDMG0Sab", "code_node_ZtKdDFYw", "search_node_Ivek0yYx", "search_node_r3bnMaWy", "code_node_sQX9tldw",
                                       "code_node_YRozjK8Z", "set_cache_node_LhSMNwfs", "loop_9Jv4BHg1"]
    mapper, loop = rest[4], rest[7]
    GRL = "cvDocs([{{node:sql_node_grcvDone.data}}][0], [{{node:sql_node_grcvLines.data}}][0], \"table_gr\", %s, %s)" % (
        js_list(bigints("gr", GR_HEAD)), js_list(bigints("grl", GR_LINE)))
    code = mapper["data"]["script"]["code"]
    for old, new in (("const grList = {{node:search_node_bOF3TVA2.data.data}};", "const grList = " + GRL + ";"),
                     ("const poLineItemList = {{node:search_node_r3bnMaWy.data.data}};",
                      "const poLineItemList = cvRows([{{node:sql_node_grcvPoLines.data}}][0], %s);" % js_list(bigints("pol", GR_PO_LINE))),
                     ("const poList = {{node:search_node_Ivek0yYx.data.data}};",
                      "const poList = cvRows([{{node:sql_node_grcvPoHeads.data}}][0], %s);" % js_list(bigints("po", GR_PO_HEAD)))):
        assert code.count(old) == 1, old
        code = code.replace(old, new)
    mapper["data"]["script"]["code"] = cv + "\n\n" + code
    # the loop hands PI_SAVE its own item (v18 re-read the whole list per pass through a cache counter)
    body = loop["blocks"]
    assert [n["id"] for n in body] == ["get_cache_node_l03kAFq7", "code_node_9PRotptG", "workflow_node_gz6u8DqY", "set_cache_node_FdcwMlCb"]
    cur = body[1]
    cur["data"]["script"]["code"] = "// The invoice of this pass: the loop's own item\nconst piData = {{node:loop_9Jv4BHg1}};\n\nreturn {\n  piData,\n};"
    cur["data"]["response_json"] = [r for r in cur["data"]["response_json"] if r["name"] == "piData"]
    loop["blocks"] = [cur, body[2]]
    # the number rule is read where v18 read it, outside the parallel block (it filters on the session's {{global:firstLvDeptId}})
    find(doc, "if_uiTR0Npr")["blocks"][1]["blocks"] = [fmt, mapper, loop]

    text = json.dumps(doc)
    for gone in ("search_node_AHtHRmqi", "search_node_bOF3TVA2", "search_node_Ivek0yYx", "search_node_r3bnMaWy", "code_node_ZtKdDFYw",
                 "code_node_YRozjK8Z", "set_cache_node_LhSMNwfs", "get_cache_node_l03kAFq7", "set_cache_node_FdcwMlCb"):
        for ref in ("{{node:%s." % gone, '"node.%s.' % gone, '"id": "%s"' % gone):
            assert ref not in text, (ref, text[max(0, text.find(ref) - 200):text.find(ref) + 100])
    return doc


def build_po_convert(doc):
    doc = copy.deepcopy(doc)
    K._taken.update(keys_in(doc))
    ids = K.Ids(1799500000000)
    top = doc["nodes"]
    S0 = "code_node_pocvStart"
    TT = "{{node:%s.data.tenantId}}" % S0
    IDS = "{{node:%s.data.idsSql}}" % S0
    cv = code_file("cv.js")
    start = code_node(S0, "0. Ids + tenant for the reads", """const ids = {{workflowparams:po_ids}};
const tenant = [{{system:tenantId}}][0];
const list = (Array.isArray(ids) ? ids : [ids]).map((x) => (x === undefined || x === null ? "" : String(x).trim())).filter((x) => /^[0-9]{1,20}$/.test(x));
return {
  idsSql: list.length ? [...new Set(list)].join(",") : "0",
  tenantId: /^[0-9]{1,20}$/.test(String(tenant)) ? String(tenant) : "0",
};""", ["idsSql", "tenantId"])
    heads_sql = json_object("p", "po", PO_HEAD) + "\n  FROM purchase_order p\n WHERE p.tenant_id = '%s' AND p.is_deleted = 0\n   AND p.id IN (%s)\n ORDER BY p.id" % (TT, IDS)
    lines_sql = (json_object("l", "pol", PO_LINE, doc="p.id") + "\n  FROM purchase_order p\n  JOIN purchase_order_2ukyuanr_sub l ON l.purchase_order_id = p.id"
                 " AND l.is_deleted = 0\n WHERE p.tenant_id = '%s' AND p.is_deleted = 0\n   AND p.id IN (%s)\n ORDER BY p.id, l.id" % (TT, IDS))
    reads = K.parallel("condition_all_pocvRead", "1. Selected POs and their lines (parallel)", [
        ("cai_pocvHeads", "PO headers", [sql_node("sql_node_pocvHeads", "1. Selected POs (fields the checks and the PI take)", heads_sql)]),
        ("cai_pocvLines", "PO lines", [sql_node("sql_node_pocvLines", "1. Their lines (fields the checks and the PI take)", lines_sql)]),
    ])
    i = [n["id"] for n in top].index("search_node_PoConvGetAll")
    top[i:i + 1] = [start, reads]
    HB, LB = js_list(bigints("po", PO_HEAD)), js_list(bigints("pol", PO_LINE))
    ALL = "cvDocs([{{node:sql_node_pocvHeads.data}}][0], [{{node:sql_node_pocvLines.data}}][0], \"table_po\", %s, %s)" % (HB, LB)
    lifted(find(doc, "code_node_PoConvStatus"), "const poList = {{node:search_node_PoConvGetAll.data.data}} || [];",
           cv + "\n\nconst poList = cvRows([{{node:sql_node_pocvHeads.data}}][0], %s);" % HB)
    chk = find(doc, "code_node_PoConvCheck")
    body = chk["data"]["script"]["code"]
    old = "const allPOs = {{node:search_node_PoConvGetAll.data.data}} || [];"
    assert body.count(old) == 1
    body = body.replace(old, "const allPOs = " + ALL + ";")
    chk["data"]["script"]["code"] = (cv + "\n\n// v5's check, unchanged; the purchase orders it lets through go on by id (the mapper re-reads them from the same rows)\n"
                                     "const res = (() => {\n" + body + "\n})();\n\nreturn {\n  status: res.status,\n  message: res.message,\n"
                                     "  poIds: (res.poList || []).map((po) => po.id),\n"
                                     "  organization_id: res.poList && res.poList[0] ? res.poList[0].organization_id : null,\n};")
    rj = [r for r in chk["data"]["response_json"] if r["name"] in ("status", "message")]
    chk["data"]["response_json"] = rj + resp_types(["poIds", "organization_id"], arrays=("poIds",))
    # 3. Get Org ID: the check hands the organization over itself
    yes, j = parent_list(doc, "code_node_PoConvOrg")
    yes.pop(j)
    fmt = find(doc, "get_node_PoConvDocFormat")
    fmt["data"] = repoint(fmt["data"], "code_node_PoConvOrg", "code_node_PoConvCheck")
    mapper = find(doc, "code_node_PoConvMap")
    lifted(mapper, "const poList = {{node:code_node_PoConvCheck.data.poList}} || [];",
           "const poIdsLetThrough = new Set(([{{node:code_node_PoConvCheck.data.poIds}}][0] || []).map(String));\n"
           "const poList = " + ALL + ".filter((po) => poIdsLetThrough.has(String(po.id)));")
    mapper["data"]["script"]["code"] = cv + "\n\n" + mapper["data"]["script"]["code"]
    cur = find(doc, "code_node_PoConvCurrent")
    lifted(cur, "const piList = {{node:code_node_PoConvMap.data.piList}};\n", "")
    lifted(cur, "const piData = piList[state.index];", "// the invoice of this pass: the loop's own item (v5 re-read the whole list per pass)\nconst piData = {{node:loop_PoConvSave}};")
    lifted(cur, 'console.log("Convert PI - invoice", state.index + 1, "of", piList.length);', 'console.log("Convert PI - invoice", state.index + 1);')
    text = json.dumps(doc)
    for gone in ("search_node_PoConvGetAll", "code_node_PoConvOrg"):
        for ref in ("{{node:%s." % gone, '"node.%s.' % gone, '"id": "%s"' % gone):
            assert ref not in text, (ref, text[max(0, text.find(ref) - 200):text.find(ref) + 100])
    return doc


BUILDERS = {"PI_SAVE": build_pi_save, "GR_Convert_PI": build_gr_convert, "PO_CONVERT_PI": build_po_convert}


def render(doc):
    return json.dumps(doc, ensure_ascii=False, indent=2) + "\n"


def main():
    names = [a for a in sys.argv[1:] if not a.startswith("--")] or [n for n in BUILDERS]
    for name in names:
        base = json.load(open(os.path.join(HERE, "base", BASE[name]), encoding="utf-8"))
        out = BUILDERS[name](base)
        path = os.path.join(R, OUT[name])
        rendered = render(out)
        os.makedirs(os.path.join(HERE, "out"), exist_ok=True)
        with open(os.path.join(HERE, "out", name + ".json"), "w", encoding="utf-8") as f:
            f.write(rendered)
        if WRITE:
            with open(path, "w", encoding="utf-8") as f:
                f.write(rendered)
        print("%s: %d top nodes -> %s%s" % (name, len(out["nodes"]), "out/%s.json" % name, (" + " + OUT[name]) if WRITE else ""))


if __name__ == "__main__":
    main()
