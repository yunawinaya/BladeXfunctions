"""Builds the lean (2,000-line) SI_SAVE from the live DEV version in base/dev/:

  SI_SAVE v83 -> out/SI_SAVE.json  (--write also writes Sales Invoice/SIsaveWorkflow.json)

Same request, responses, end codes (406-411, 413) and messages. v83's draft / completed pre-save chains and the fill-back run as one
node; the SO / GD reads are sql-nodes holding only the line columns the over-invoice check and the roll-up use; the check and the
roll-up run in one node before the write; the saved id / number / total are read back by sql instead of copying the whole invoice;
the SO / GD invoiced quantities and statuses are written per changed line through the line collections (v83 wrote whole
table_so / table_gd arrays through the header update-nodes, re-validating every column of every line).

usage: python3 build_si_save.py [--write]
"""
import copy
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
R = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(R, "scratchpad", "grv2"))
import wfkit as K  # noqa: E402

WRITE = "--write" in sys.argv
BASE = os.path.join(HERE, "base", "dev", "SI_SAVE.v83.json")
OUT = "Sales Invoice/SIsaveWorkflow.json"
PREP = "code_si_prep"
STATUS = "code_si_status"
CHECK = "code_si_check"
T = "{{node:%s.data.tenantId}}" % PREP
SO_LINES = "sales_order_axszx8cj_sub:Table:1939903359943024642"
GD_LINES = "(Goods Delivery):Table:1939904186426433537"


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


def repoint_text(obj, pairs):
    text = json.dumps(obj, ensure_ascii=False)
    for old, new in pairs:
        text = text.replace(old, new)
    return json.loads(text)


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


def lifted(node, old, new):
    code = node["data"]["script"]["code"]
    assert code.count(old) == 1, (node["id"], old)
    node["data"]["script"]["code"] = code.replace(old, new)


SQL_SO = """SELECT JSON_OBJECT('doc', CAST(s.id AS CHAR), 'id', CAST(l.id AS CHAR), 'parent_id', CAST(l.parent_id AS CHAR),
       'item_name', l.item_name, 'item_id', l.item_id, 'item_bundle_id', CAST(l.item_bundle_id AS CHAR),
       'so_quantity', l.so_quantity, 'return_qty', l.return_qty, 'invoice_qty', l.invoice_qty, 'si_status', l.si_status) AS j
  FROM sales_order s
  LEFT JOIN sales_order_axszx8cj_sub l ON l.sales_order_id = s.id AND l.is_deleted = 0
 WHERE s.tenant_id = '%s' AND s.is_deleted = 0 AND s.id IN ({{node:%s.data.soIdsSql}})
 ORDER BY s.id, l.id""" % (T, PREP)

SQL_GD = """SELECT JSON_OBJECT('doc', CAST(g.id AS CHAR), 'id', CAST(l.id AS CHAR), 'parent_id', CAST(l.parent_id AS CHAR),
       'material_id', CAST(l.material_id AS CHAR), 'material_name', l.material_name, 'item_bundle_id', CAST(l.item_bundle_id AS CHAR),
       'gd_qty', l.gd_qty, 'return_qty', l.return_qty, 'invoice_qty', l.invoice_qty, 'si_status', l.si_status) AS j
  FROM goods_delivery g
  LEFT JOIN goods_delivery_fwii8mvb_sub l ON l.goods_delivery_id = g.id AND l.is_deleted = 0
 WHERE g.tenant_id = '%s' AND g.is_deleted = 0 AND g.id IN ({{node:%s.data.gdIdsSql}})
 ORDER BY g.id, l.id""" % (T, PREP)

SQL_AFTER = """SELECT JSON_OBJECT('id', CAST(s.id AS CHAR), 'sales_invoice_no', s.sales_invoice_no, 'invoice_total', s.invoice_total) AS j
  FROM sales_invoice s
 WHERE s.tenant_id = '%s' AND s.is_deleted = 0 AND s.id = {{node:code_si_saved.data.idSql}}""" % T


def line_update(ids, nid, title, source, rows_ref):
    coll = source.split(":Table:")[1]
    return {"id": nid, "type": "update-node", "data": {
        "table_id": {"source": source, "rules": {"collectionId": coll, "list": [
            {"id": ids(), "parentId": ids(), "isTop": True, "prop": "id", "operator": "in", "valueType": "field", "value": "{{node:%s.id}}" % rows_ref,
             "type": "leaf", "level": 1, "propLabel": "主键ID", "valueLabel": "", "operatorLabel": "In"}]}},
        "fields": [], "condition": {}, "title": title, "isValidator": True, "nodeName": title, "name": title,
        "props": {"modelName": "", "list": [
            {"prop": "id", "valueType": "field", "value": "{{node:%s.id}}" % rows_ref, "operator": "", "valueLabel": "", "propLabel": "主键ID"},
            {"prop": "invoice_qty", "valueType": "field", "value": "{{node:%s.invoice_qty}}" % rows_ref, "operator": "", "valueLabel": "",
             "propLabel": "Invoice Qty"},
            {"prop": "si_status", "valueType": "field", "value": "{{node:%s.si_status}}" % rows_ref, "operator": "", "valueLabel": "",
             "propLabel": "Line SI Status"}]}},
        "blocks": []}


def build_si_save(doc):
    doc = copy.deepcopy(doc)
    K._taken.update(keys_in(doc))
    ids = K.Ids(1799600000000)
    top = doc["nodes"]
    assert [n["id"] for n in top] == ["start", "if_aWrhMuyO", "if_si_pi_gate_completed", "code_node_JoF0YVzG", "search_node_NDKdFanY",
                                      "search_node_lTy219I0", "if_KzCWBJ76", "if_D49IflKy", "code_node_ytRbog2e", "if_5DHm2eA0", "end"]

    # 1. v83's draft / completed chains + fill-back -> one Prepare node and its two refusals; the credit-limit check follows it
    end406 = copy.deepcopy(find(doc, "end_node_7w09ASUe"))
    end406["id"] = "end_si_prep_406"
    end406["data"]["msg"]["code"] = "{{node:%s.data.message}}" % PREP
    end407 = copy.deepcopy(find(doc, "end_node_Xl2tnvr8"))
    end407["id"] = "end_si_prep_407"
    end407["data"]["msg"]["code"] = "{{node:%s.data.message}}" % PREP
    prep = code_node(PREP, "Prepare: doc no, required fields, invoice qty, header fields",
                     code_file("si_prep.js") + "\n\nreturn siPrep({{workflowparams:data}}, [{{system:tenantId}}][0]);",
                     ["route", "message", "entry", "isDraft", "needCl", "clCustomerId", "clTotal", "siStatus", "postedStatus", "docNo",
                      "paymentStatus", "soIds", "gdIdsSearch", "gdIdsReal", "tenantId", "soIdsSql", "gdIdsSql", "siIdSql", "siId", "check"],
                     objects=("entry", "clCustomerId", "clTotal", "siStatus", "postedStatus", "docNo", "paymentStatus", "soIds", "gdIdsSearch",
                              "gdIdsReal", "siId", "check"))
    if406 = K.if_(ids, "if_si_prep_406", "Required fields missing?", "'{{node:%s.data.route}}' == 'E406'" % PREP, [end406])
    if407 = K.if_(ids, "if_si_prep_407", "Invoice qty 0?", "'{{node:%s.data.route}}' == 'E407'" % PREP, [end407])

    needcl = copy.deepcopy(find(doc, "if_RYZU6f21"))
    needcl["data"]["expression"]["code"] = "'{{node:%s.data.needCl}}' == 'required'" % PREP
    cl = needcl["blocks"][0]["blocks"]
    assert [n["id"] for n in cl] == ["workflow_node_G4KBFPGT", "if_yqk0qfvn"]
    params = {b["prop"]: b for b in cl[0]["data"]["body_params"]["list"]}
    params["customer_id"]["value"] = "{{node:%s.data.clCustomerId}}" % PREP
    params["total"]["value"] = "{{node:%s.data.clTotal}}" % PREP
    convert = cl[1]["blocks"][0]["blocks"][0]
    assert convert["id"] == "if_7IMJkojx" and [n["id"] for n in convert["blocks"][1]["blocks"]] == ["code_node_Z0Tcxb1v"]
    convert["blocks"][1]["blocks"] = [code_node("code_si_cldraft", "Change Status to Draft (convert over credit limit)",
                                                "// v83's Change Status to Draft; Final Status applies it\nreturn { downgraded: '1' };", ["downgraded"])]
    status = code_node(STATUS, "Final Status: si_status / posted_status / number / payment_status",
                       code_file("si_status.js") + "\n\nreturn siStatus({ siStatus: {{node:%s.data.siStatus}}, postedStatus: {{node:%s.data.postedStatus}}, "
                       "docNo: {{node:%s.data.docNo}}, paymentStatus: {{node:%s.data.paymentStatus}} }, {{node:code_si_cldraft.data.downgraded}});"
                       % (PREP, PREP, PREP, PREP),
                       ["si_status", "posted_status", "sales_invoice_no", "payment_status", "isCompleted"],
                       objects=("si_status", "posted_status", "sales_invoice_no", "payment_status"))
    top[1:2] = [prep, if406, if407, needcl, status]

    # 2. the PI gate reads the request's own scalars and the Prepare node's source ids (v83 copied the whole request twice)
    gate_if = find(doc, "if_si_pi_gate_completed")
    gblock = gate_if["blocks"][0]["blocks"]
    assert gblock[0]["id"] == "code_si_srcids"
    gblock.pop(0)
    lifted(find(doc, "code_si_gate"), "const data = {{workflowparams:data}};",
           "const data = { si_status: {{workflowparams:data.si_status}}, auto_pi_confirmed: {{workflowparams:data.auto_pi_confirmed}}, "
           "auto_pi_skip: {{workflowparams:data.auto_pi_skip}} };")

    # 3. the whole-document SO / GD reads go; the check reads only the columns it uses, in parallel, completed only
    for gone in ("code_node_JoF0YVzG", "search_node_NDKdFanY", "search_node_lTy219I0"):
        top.remove(find(doc, gone))
    vblock = find(doc, "if_KzCWBJ76")
    vblock["data"]["expression"]["code"] = "'{{node:%s.data.isCompleted}}' == '1'" % STATUS
    vb = vblock["blocks"][0]["blocks"]
    assert [n["id"] for n in vb] == ["get_node_siSrSetup1", "code_node_hHnkhdFI", "if_i2nGxo5C"]
    reads = K.parallel("condition_all_si_read", "Order / delivery lines + sales return setup (parallel)", [
        ("cai_si_so", "Sales order lines", [sql_node("sql_node_si_so", "Sales order lines (columns the check reads)", SQL_SO)]),
        ("cai_si_gd", "Delivery lines", [sql_node("sql_node_si_gd", "Goods delivery lines (columns the check reads)", SQL_GD)]),
        ("cai_si_sr", "Sales return setup", [vb[0]]),
    ])
    check = code_node(CHECK, "Over-invoice check + SO / GD roll-up",
                      code_file("si_check.js") + "\n\nreturn siCheck({{node:%s.data.check}}, [{{node:sql_node_si_so.data}}][0], "
                      "[{{node:sql_node_si_gd.data}}][0], {{node:get_node_siSrSetup1.data.data}});" % PREP,
                      ["status", "allErrors", "updatedGD", "updatedSO", "soHeaders", "hasSoHeaders", "soLines", "hasSoLines", "gdHeaders",
                       "hasGdHeaders", "gdLines", "hasGdLines"],
                      arrays=("soHeaders", "soLines", "gdHeaders", "gdLines"), ints=("hasSoHeaders", "hasSoLines", "hasGdHeaders", "hasGdLines"))
    old_rj = {r["name"]: r for r in vb[1]["data"]["response_json"]}
    check["data"]["response_json"] = [old_rj[r["name"]] if r["name"] in ("allErrors", "updatedGD", "updatedSO") else r
                                      for r in check["data"]["response_json"]]
    vblock["blocks"][0]["blocks"] = [reads, check, vb[2]]

    # 4. the write: same props; Fetch SI (the whole invoice, re-read after every Edit) moves to where Map AR Data needs it
    addif = find(doc, "if_D49IflKy")
    fblock = addif["blocks"][1]["blocks"]
    assert [n["id"] for n in fblock] == ["update_node_I7KGszOE", "get_node_fcE2I4vj"]
    fetch_si = fblock.pop()

    # 5. saved id -> read back id, number and total (v83 copied the whole inserted row / re-read the whole invoice)
    j = [n["id"] for n in top].index("code_node_ytRbog2e")
    saved = code_node("code_si_saved", "Saved SI id", code_file("si_saved.js") +
                      "\n\nconst saved = siSaved({{workflowparams:data.page_status}}, [{{node:add_node_adYeQB4a.data.id}}][0], "
                      "[{{node:%s.data.siId}}][0]);\nconst pageStatus = {{workflowparams:data.page_status}};\n"
                      "return { idSql: saved.idSql, isInsert: pageStatus === 'Add' || pageStatus === 'Convert' ? '1' : '0' };" % PREP,
                      ["idSql", "isInsert"])
    after = sql_node("sql_node_si_after", "Saved SI id, number and total", SQL_AFTER)
    top[j]["data"]["script"]["code"] = code_file("si_latest.js") + "\n\nreturn siLatest([{{node:sql_node_si_after.data}}][0]);"
    top[j:j] = [saved, after]

    # 6. after a completed save: drafts, the SO / GD counters by line, receivable, posting, cash payment, auto PI
    ablock = find(doc, "if_5DHm2eA0")
    ablock["data"]["expression"]["code"] = "'{{node:%s.data.isCompleted}}' == '1'" % STATUS
    tb = ablock["blocks"][0]["blocks"]
    assert [n["id"] for n in tb] == ["code_node_4CvJopJk", "search_node_I3e7ZpkH", "delete_node_vpLUnjoe", "condition_all_bCtEHeEx",
                                     "get_node_oLOE8Qt7", "if_WSO-qb5O", "if_-xQaPih0", "if_T-6kKe6I", "if_si_trigger_pi"]
    tb.pop(0)
    par = find(doc, "condition_all_bCtEHeEx")
    so_head, gd_head = par["blocks"][0]["blocks"][0], par["blocks"][1]["blocks"][0]
    assert so_head["id"] == "update_node_CTTDlnVN" and gd_head["id"] == "update_node_co3J1EoF"
    for head, rows in ((so_head, "soHeaders"), (gd_head, "gdHeaders")):
        props = [p for p in head["data"]["props"]["list"] if p["prop"] in ("id", "si_status")]
        assert len(props) == 2
        for p in props:
            p["value"] = "{{node:%s.data.%s.%s}}" % (CHECK, rows, p["prop"])
        head["data"]["props"]["list"] = props
    par["blocks"][0]["blocks"] = [
        K.if_(ids, "if_si_so_lines", "SO lines to update?", "'{{node:%s.data.hasSoLines}}' == '1'" % CHECK,
              [line_update(ids, "update_node_si_so_lines", "Update SO Lines (invoiced qty / status)", SO_LINES, "%s.data.soLines" % CHECK)]),
        so_head]
    par["blocks"][1]["blocks"] = [
        K.if_(ids, "if_si_gd_lines", "GD lines to update?", "'{{node:%s.data.hasGdLines}}' == '1'" % CHECK,
              [line_update(ids, "update_node_si_gd_lines", "Update GD Lines (invoiced qty / status)", GD_LINES, "%s.data.gdLines" % CHECK)]),
        gd_head]
    ar = find(doc, "if_WSO-qb5O")
    arb = ar["blocks"][0]["blocks"]
    assert [n["id"] for n in arb] == ["code_node_p0XoMz8H", "workflow_node_OJQSOuvk"]
    arb.insert(0, K.if_(ids, "if_si_ar_stored", "Edit: read the stored invoice for the receivable",
                        "'{{node:code_si_saved.data.isInsert}}' == '0'", [fetch_si]))

    # 7. every remaining reference to a node that is gone
    doc = repoint_text(doc, [
        ("{{node:code_node_JoF0YVzG.data.entry.si_status}}", "{{node:%s.data.si_status}}" % STATUS),
        ("{{node:code_node_JoF0YVzG.data.entry.posted_status}}", "{{node:%s.data.posted_status}}" % STATUS),
        ("{{node:code_node_JoF0YVzG.data.entry.sales_invoice_no}}", "{{node:%s.data.sales_invoice_no}}" % STATUS),
        ("{{node:code_node_JoF0YVzG.data.entry.payment_status}}", "{{node:%s.data.payment_status}}" % STATUS),
        ("{{node:code_node_JoF0YVzG.data.entry", "{{node:%s.data.entry" % PREP),
        ("{{node:code_si_srcids.data.", "{{node:%s.data." % PREP),
        ("{{node:code_node_hHnkhdFI.data.", "{{node:%s.data." % CHECK),
        ("{{node:code_node_4CvJopJk.data.updatedSO.so_id}}", "{{node:%s.data.soHeaders.id}}" % CHECK),
        ("{{node:code_node_4CvJopJk.data.updatedGD.gd_id}}", "{{node:%s.data.gdHeaders.id}}" % CHECK),
    ])
    text = json.dumps(doc, ensure_ascii=False)
    for gone in ("code_node_JoF0YVzG", "code_node_2Pxz18TD", "code_node_pFAvrqMt", "workflow_node_sA0QWuCO", "code_node_QdIIcL7J",
                 "code_node_zy0OA1sN", "workflow_node_1wzUt9V3", "code_node_QaPUxa3s", "code_node_Z0Tcxb1v", "code_si_srcids",
                 "search_node_NDKdFanY", "search_node_lTy219I0", "code_node_hHnkhdFI", "code_node_4CvJopJk", "if_aWrhMuyO"):
        for ref in ("{{node:%s." % gone, '"node.%s.' % gone, '"id": "%s"' % gone):
            assert ref not in text, (ref, text[max(0, text.find(ref) - 200):text.find(ref) + 100])
    K.check_ids(doc)
    return doc


def render(doc):
    return json.dumps(doc, ensure_ascii=False, indent=2) + "\n"


def main():
    base = json.load(open(BASE, encoding="utf-8"))
    out = build_si_save(base)
    rendered = render(out)
    os.makedirs(os.path.join(HERE, "out"), exist_ok=True)
    with open(os.path.join(HERE, "out", "SI_SAVE.json"), "w", encoding="utf-8") as f:
        f.write(rendered)
    if WRITE:
        with open(os.path.join(R, OUT), "w", encoding="utf-8") as f:
            f.write(rendered)
    print("SI_SAVE: %d top nodes -> out/SI_SAVE.json%s" % (len(out["nodes"]), (" + " + OUT) if WRITE else ""))


if __name__ == "__main__":
    main()
