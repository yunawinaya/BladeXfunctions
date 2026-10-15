"""Phase 0 guards on the two classic GR saves, inserted right after the start node, before anything is read or written:
  1. more than 500 lines -> 400 (the classic save cannot carry it; the background save is the desktop path),
  2. an Edit of a GR a background job holds (stored gr_status 'Processing') -> 400.
GOODS_RECEIVING (Goods Receiving/GRsaveWorkflow.json) and GR_CREATED (Goods Receiving/GRsaveAsCreatedWorkflow.json)."""
from lib import absent, absent_num, code, if_, insert_after_start, json, load, ret400, save, sql

GUARD_JS = """// Classic-save guards: a receipt above 500 lines is refused (this save cannot carry it), and so is an Edit of a Goods Receiving a background job holds (stored gr_status 'Processing')
const rows = [{{workflowparams:allData.table_gr}}][0] || [];
let lineCount = 0;
for (const row of Array.isArray(rows) ? rows : []) {
  lineCount += 1 + (Array.isArray(row.children) ? row.children.length : 0);
}
const id = String([{{workflowparams:allData.id}}][0] || "").trim();
const edit = String([{{workflowparams:pageStatus}}][0] || "") === "Edit";
const ok = /^[0-9]{1,20}$/.test(id);
return {
  tooBig: lineCount > 500 ? "YES" : "NO",
  sizeMessage: "This Goods Receiving has " + lineCount + " lines. A save of more than 500 lines is not supported here - please split it into smaller receipts.",
  check: edit && ok ? "YES" : "NO",
  grId: ok ? id : "0",
};"""

BUSY_JS = """const row = (([{{node:sql_node_%(p)sProcGuard.data}}][0]) || [])[0] || {};
return { busy: String(row.gr_status || "") === "Processing" ? "YES" : "NO" };"""

SQL = """SELECT g.gr_status
  FROM goods_receiving g
 WHERE g.tenant_id = '{{system:tenantId}}'
   AND g.id = {{node:code_node_%(p)sSizeGuard.data.grId}}
   AND g.is_deleted = 0"""

BUSY_MSG = "This Goods Receiving is being processed in the background - please wait for it to finish."


def guard_nodes(p, fid):
    g = "code_node_%sSizeGuard" % p
    return [
        code(g, "Guard: line count + Edit of a stored GR?", GUARD_JS,
             [(p.lower() + "g1big", "tooBig"), (p.lower() + "g2msg", "sizeMessage"), (p.lower() + "g3chk", "check"), (p.lower() + "g4grid", "grId")]),
        if_("if_%sSizeGuard" % p, "IF more than 500 lines", "'{{node:%s.data.tooBig}}' == 'YES'" % g, fid,
            [ret400("return_node_%sSizeGuard" % p, "Return too many lines", "{{node:%s.data.sizeMessage}}" % g, field=True)]),
        if_("if_%sProcGuard" % p, "IF Edit of a stored GR", "'{{node:%s.data.check}}' == 'YES'" % g, fid + 2, [
            sql("sql_node_%sProcGuard" % p, "Stored GR Status", SQL % {"p": p}, [(p.lower() + "g5stat", "gr_status")]),
            code("code_node_%sProcBusy" % p, "Guard: held by a background job?", BUSY_JS % {"p": p}, [(p.lower() + "g6busy", "busy")]),
            if_("if_%sProcBusy" % p, "IF Processing (background job running)", "'{{node:code_node_%sProcBusy.data.busy}}' == 'YES'" % p, fid + 4,
                [ret400("return_node_%sProcBusy" % p, "Return Processing", BUSY_MSG)]),
        ]),
    ]


def patch(rel, p, fid):
    text = load(rel)
    doc = json.loads(text)
    absent(doc, "code_node_%sSizeGuard" % p, "if_%sSizeGuard" % p, "sql_node_%sProcGuard" % p, "if_%sProcBusy" % p)
    absent_num(doc, fid, fid + 1, fid + 2, fid + 3, fid + 4, fid + 5)
    insert_after_start(doc, guard_nodes(p, fid))
    save(rel, doc, text)
    print("patched", rel)


if __name__ == "__main__":
    patch("Goods Receiving/GRsaveWorkflow.json", "Gr", 1798100000001)
    patch("Goods Receiving/GRsaveAsCreatedWorkflow.json", "Gc", 1798100000011)
