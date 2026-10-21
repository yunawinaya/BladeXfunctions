"""Builds the lean (2,000-line) SI_CANCEL from the live DEV version in base/dev/:

  SI_CANCEL v9 -> out/SI_CANCEL.json  (--write also writes Sales Invoice/SIcancelWorkflow.json)

Same request (si_id) and outcome. v9 read the whole invoice, the whole orders and deliveries and the whole receivables, then wrote
every order / delivery line back through table_so / table_gd. Here sql-nodes read only the columns v9's reversal uses, the reversal
code is v9's, and only the lines it changes are written, through the line collections.

usage: python3 build_si_cancel.py [--write]
"""
import copy
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
R = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(R, "scratchpad", "grv2"))
sys.path.insert(0, HERE)
import wfkit as K  # noqa: E402
from build_si_save import code_file, code_node, sql_node, find, keys_in, SO_LINES, GD_LINES  # noqa: E402

WRITE = "--write" in sys.argv
BASE = os.path.join(HERE, "base", "dev", "SI_CANCEL.v9.json")
OUT = "Sales Invoice/SIcancelWorkflow.json"
S0 = "code_sic_start"
REV = "code_node_CtfkSP3q"
T = "{{node:%s.data.tenantId}}" % S0

SQL_HEAD = """SELECT JSON_OBJECT('id', CAST(s.id AS CHAR), 'so_id', s.so_id, 'gd_id', s.gd_id, 'si_status', s.si_status,
       'sales_invoice_no', s.sales_invoice_no) AS j
  FROM sales_invoice s
 WHERE s.tenant_id = '%s' AND s.is_deleted = 0 AND s.id = {{node:%s.data.idSql}}""" % (T, S0)
SQL_LINES = """SELECT JSON_OBJECT('doc', CAST(l.sales_invoice_id AS CHAR), 'id', CAST(l.id AS CHAR), 'parent_id', CAST(l.parent_id AS CHAR),
       'line_so_id', l.line_so_id, 'so_line_id', CAST(l.so_line_id AS CHAR), 'line_gd_id', CAST(l.line_gd_id AS CHAR),
       'gd_line_id', CAST(l.gd_line_id AS CHAR), 'invoice_qty', l.invoice_qty) AS j
  FROM sales_invoice_zt0c3x55_sub l
 WHERE l.tenant_id = '%s' AND l.is_deleted = 0 AND l.sales_invoice_id = {{node:%s.data.idSql}}
 ORDER BY l.id""" % (T, S0)
SQL_AR = """SELECT JSON_OBJECT('id', CAST(a.id AS CHAR), 'ar_invoice_no', a.ar_invoice_no) AS j
  FROM ar_invoice a
 WHERE a.tenant_id = '%s' AND a.is_deleted = 0 AND a.si_id = {{node:%s.data.idSql}}
 ORDER BY a.id""" % (T, S0)
SQL_SO = """SELECT JSON_OBJECT('doc', CAST(s.id AS CHAR), 'id', CAST(l.id AS CHAR), 'parent_id', CAST(l.parent_id AS CHAR),
       'so_quantity', l.so_quantity, 'invoice_qty', l.invoice_qty, 'posted_qty', l.posted_qty, 'si_status', l.si_status) AS j
  FROM sales_order s
  LEFT JOIN sales_order_axszx8cj_sub l ON l.sales_order_id = s.id AND l.is_deleted = 0
 WHERE s.tenant_id = '%s' AND s.is_deleted = 0 AND s.id IN ({{node:code_sic_ids.data.soIdsSql}})
 ORDER BY s.id, l.id""" % T
SQL_GD = """SELECT JSON_OBJECT('doc', CAST(g.id AS CHAR), 'id', CAST(l.id AS CHAR), 'parent_id', CAST(l.parent_id AS CHAR),
       'gd_qty', l.gd_qty, 'invoice_qty', l.invoice_qty, 'si_status', l.si_status) AS j
  FROM goods_delivery g
  LEFT JOIN goods_delivery_fwii8mvb_sub l ON l.goods_delivery_id = g.id AND l.is_deleted = 0
 WHERE g.tenant_id = '%s' AND g.is_deleted = 0 AND g.id IN ({{node:code_sic_ids.data.gdIdsSql}})
 ORDER BY g.id, l.id""" % T


def line_update(ids, nid, title, source, rows_ref, props):
    coll = source.split(":Table:")[1]
    return {"id": nid, "type": "update-node", "data": {
        "table_id": {"source": source, "rules": {"collectionId": coll, "list": [
            {"id": ids(), "parentId": ids(), "isTop": True, "prop": "id", "operator": "in", "valueType": "field", "value": "{{node:%s.id}}" % rows_ref,
             "type": "leaf", "level": 1, "propLabel": "主键ID", "valueLabel": "", "operatorLabel": "In"}]}},
        "fields": [], "condition": {}, "title": title, "isValidator": True, "nodeName": title, "name": title,
        "props": {"modelName": "", "list": [{"prop": p, "valueType": "field", "value": "{{node:%s.%s}}" % (rows_ref, p), "operator": "", "valueLabel": "",
                                             "propLabel": label} for p, label in props]}},
        "blocks": []}


def build_si_cancel(doc):
    doc = copy.deepcopy(doc)
    K._taken.update(keys_in(doc))
    ids = K.Ids(1799700000000)
    top = doc["nodes"]
    assert [n["id"] for n in top] == ["start", "get_node_FPExdl9O", "code_node_LBv1T4sZ", "search_node_V3rnGDPj", "search_node_Gvy1Uni8",
                                      "search_node_CuUfIpII", "code_node_CtfkSP3q", "update_node_qrMaG8y2", "update_node_3zWZ9YIP",
                                      "update_node_EdPzs1en", "update_node_iH3XNTHq", "end"]
    start = code_node(S0, "0. Invoice id + tenant for the reads", """const siId = {{workflowparams:si_id}};
const tenant = [{{system:tenantId}}][0];
const id = siId === undefined || siId === null ? "" : String(Array.isArray(siId) ? siId[0] : siId).trim();
return {
  idSql: /^[0-9]{1,20}$/.test(id) ? id : "0",
  tenantId: /^[0-9]{1,20}$/.test(String(tenant)) ? String(tenant) : "0",
};""", ["idSql", "tenantId"])
    read1 = K.parallel("condition_all_sic_read1", "1. The invoice, its lines and its receivables (parallel)", [
        ("cai_sic_head", "Invoice", [sql_node("sql_node_sic_head", "1. Invoice (status, number, orders, deliveries)", SQL_HEAD)]),
        ("cai_sic_lines", "Invoice lines", [sql_node("sql_node_sic_lines", "1. Invoice lines (what the reversal reads)", SQL_LINES)]),
        ("cai_sic_ar", "Receivables", [sql_node("sql_node_sic_ar", "1. Receivables of the invoice (id, number)", SQL_AR)]),
    ])
    idsn = code_node("code_sic_ids", "2. Orders and deliveries of the invoice", code_file("sic_reverse.js") + """

const head = sicRows([{{node:sql_node_sic_head.data}}][0], ["id"])[0] || {};
const list = (v) => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]).map((x) => String(x).trim()).filter((x) => /^[0-9]{1,20}$/.test(x));
const so = list(head.so_id);
const gd = list(head.gd_id);
return { soIdsSql: so.length ? [...new Set(so)].join(",") : "0", gdIdsSql: gd.length ? [...new Set(gd)].join(",") : "0" };""",
                     ["soIdsSql", "gdIdsSql"])
    read2 = K.parallel("condition_all_sic_read2", "3. Their lines (parallel)", [
        ("cai_sic_so", "Order lines", [sql_node("sql_node_sic_so", "3. Sales order lines (what the reversal reads)", SQL_SO)]),
        ("cai_sic_gd", "Delivery lines", [sql_node("sql_node_sic_gd", "3. Goods delivery lines (what the reversal reads)", SQL_GD)]),
    ])
    rev = find(doc, REV)
    rev["data"]["script"]["code"] = (code_file("sic_reverse.js") + "\n\nreturn sicReverse([{{node:sql_node_sic_head.data}}][0], [{{node:sql_node_sic_lines.data}}][0], "
                                     "[{{node:sql_node_sic_so.data}}][0], [{{node:sql_node_sic_gd.data}}][0], [{{node:sql_node_sic_ar.data}}][0]);")
    from build_si_save import resp_types
    rj = {r["name"]: r for r in rev["data"]["response_json"]}
    rev["data"]["response_json"] = [rj["updatedSI"], rj["updatedAR"]] + resp_types(
        ["hasAR", "soHeaders", "hasSoHeaders", "soLines", "hasSoLines", "soPosted", "hasSoPosted", "gdHeaders", "hasGdHeaders", "gdLines", "hasGdLines"],
        arrays=("soHeaders", "soLines", "soPosted", "gdHeaders", "gdLines"),
        ints=("hasAR", "hasSoHeaders", "hasSoLines", "hasSoPosted", "hasGdHeaders", "hasGdLines"))

    so_head, gd_head = find(doc, "update_node_qrMaG8y2"), find(doc, "update_node_3zWZ9YIP")
    for head, rows in ((so_head, "soHeaders"), (gd_head, "gdHeaders")):
        props = [p for p in head["data"]["props"]["list"] if p["prop"] in ("id", "si_status")]
        assert len(props) == 2
        for p in props:
            p["value"] = "{{node:%s.data.%s.%s}}" % (REV, rows, p["prop"])
        head["data"]["props"]["list"] = props
        head["data"]["table_id"]["rules"]["list"][0]["value"] = "{{node:%s.data.%s.id}}" % (REV, rows)
    so_lines = K.if_(ids, "if_sic_so_lines", "SO lines to update?", "'{{node:%s.data.hasSoLines}}' == '1'" % REV,
                     [line_update(ids, "update_node_sic_so_lines", "Update SO Lines (invoiced qty / status)", SO_LINES, "%s.data.soLines" % REV,
                                  [("id", "主键ID"), ("invoice_qty", "Invoice Qty"), ("si_status", "Line SI Status")])])
    so_posted = K.if_(ids, "if_sic_so_posted", "SO posted quantities to update?", "'{{node:%s.data.hasSoPosted}}' == '1'" % REV,
                      [line_update(ids, "update_node_sic_so_posted", "Update SO Lines (posted qty)", SO_LINES, "%s.data.soPosted" % REV,
                                   [("id", "主键ID"), ("posted_qty", "Posted Qty")])])
    gd_lines = K.if_(ids, "if_sic_gd_lines", "GD lines to update?", "'{{node:%s.data.hasGdLines}}' == '1'" % REV,
                     [line_update(ids, "update_node_sic_gd_lines", "Update GD Lines (invoiced qty / status)", GD_LINES, "%s.data.gdLines" % REV,
                                  [("id", "主键ID"), ("invoice_qty", "Invoice Qty"), ("si_status", "Line SI Status")])])
    so_hdr_if = K.if_(ids, "if_sic_so_heads", "SO headers to update?", "'{{node:%s.data.hasSoHeaders}}' == '1'" % REV, [so_head])
    gd_hdr_if = K.if_(ids, "if_sic_gd_heads", "GD headers to update?", "'{{node:%s.data.hasGdHeaders}}' == '1'" % REV, [gd_head])
    ar = find(doc, "update_node_EdPzs1en")
    ar_if = K.if_(ids, "if_sic_ar", "Receivables to rename?", "'{{node:%s.data.hasAR}}' == '1'" % REV, [ar])
    doc["nodes"] = [top[0], start, read1, idsn, read2, rev, so_hdr_if, so_lines, so_posted, gd_hdr_if, gd_lines, ar_if,
                    find(doc, "update_node_iH3XNTHq"), top[-1]]
    text = json.dumps(doc, ensure_ascii=False)
    for gone in ("get_node_FPExdl9O", "code_node_LBv1T4sZ", "search_node_V3rnGDPj", "search_node_Gvy1Uni8", "search_node_CuUfIpII"):
        for ref in ("{{node:%s." % gone, '"node.%s.' % gone, '"id": "%s"' % gone):
            assert ref not in text, (ref, text[max(0, text.find(ref) - 200):text.find(ref) + 100])
    for gone in ("updatedSO", "updatedGD"):
        assert "{{node:%s.data.%s" % (REV, gone) not in text, gone
    K.check_ids(doc)
    return doc


def main():
    base = json.load(open(BASE, encoding="utf-8"))
    out = build_si_cancel(base)
    rendered = json.dumps(out, ensure_ascii=False, indent=2) + "\n"
    with open(os.path.join(HERE, "out", "SI_CANCEL.json"), "w", encoding="utf-8") as f:
        f.write(rendered)
    if WRITE:
        with open(os.path.join(R, OUT), "w", encoding="utf-8") as f:
            f.write(rendered)
    print("SI_CANCEL: %d top nodes -> out/SI_CANCEL.json%s" % (len(out["nodes"]), (" + " + OUT) if WRITE else ""))


if __name__ == "__main__":
    main()
