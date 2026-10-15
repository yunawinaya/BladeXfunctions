"""Phase 0 guards on GR_CANCEL_CREATED and GR_REVERT_COMPLETED.
GR_CANCEL_CREATED: the workflow checks the STORED status itself (today only the list checks its own snapshot): delete
needs Draft / Cancelled, cancel needs Created; a Processing GR (background job) is refused with the busy text.
GR_REVERT_COMPLETED: more than 500 lines is refused (it would run one SUBTRACT per movement for minutes and can stop
half way); Processing is already refused by its own status rule (Completed / Received only)."""
from lib import absent, absent_num, code, find, if_, insert_after_start, json, load, replace_in_code, ret400, save, sql

CANCEL_KEY_JS = """// Stored-status gate: the list only checks its own snapshot of the row, which can be stale (a repeated cancel released the PO reservation twice)
const raw = [{{workflowparams:gr_id}}][0];
const ids = (Array.isArray(raw) ? raw : [raw]).map((v) => String(v === null || v === undefined ? "" : v).trim());
const ok = ids.length > 0 && ids.every((v) => /^[0-9]{1,20}$/.test(v));
return { idsCsv: ok ? ids.join(",") : "0", idCount: String(ok ? ids.length : 0) };"""

CANCEL_SQL = """SELECT CAST(g.id AS CHAR) AS id, g.gr_no, g.gr_status
  FROM goods_receiving g
 WHERE g.tenant_id = '{{system:tenantId}}'
   AND g.id IN ({{node:code_node_CcGuardKey.data.idsCsv}})
   AND g.is_deleted = 0"""

CANCEL_DECIDE_JS = """const rows = ([{{node:sql_node_CcGuard.data}}][0]) || [];
const list = Array.isArray(rows) ? rows : [rows];
const wanted = Number({{node:code_node_CcGuardKey.data.idCount}}) || 0;
const isDelete = String([{{workflowparams:action}}][0] || "") === "delete";
let message = "";
if (wanted === 0 || list.length < wanted) {
  message = "Goods Receiving not found - it may already have been deleted.";
} else {
  for (const row of list) {
    const status = String(row.gr_status || "");
    const no = String(row.gr_no || "");
    if (status === "Processing") {
      message = "Goods Receiving " + no + " is being processed in the background - please wait for it to finish.";
    } else if (isDelete && status !== "Draft" && status !== "Cancelled") {
      message = "Goods Receiving " + no + " cannot be deleted: only Draft or Cancelled receipts can be deleted (it is " + (status || "blank") + " now).";
    } else if (!isDelete && status !== "Created") {
      message = "Goods Receiving " + no + " cannot be cancelled: only Created receipts can be cancelled (it is " + (status || "blank") + " now).";
    }
    if (message) break;
  }
}
return { refuse: message ? "YES" : "NO", message };"""

REVERT_OLD = "const lines = gr ? flattenGrRows(gr.table_gr) : [];\n"
REVERT_NEW = REVERT_OLD + """// Above 500 lines this revert runs one SUBTRACT per movement for minutes and can stop half way: refused until the background revert takes it
if (!refuse && lines.length > 500) {
  deny("This Goods Receiving has " + lines.length + " lines. Reverting more than 500 lines is not supported yet.");
}
"""


def cancel():
    rel = "Bulk Actions/Procurement/Goods Receiving/GRcancelWorkflow.json"
    text = load(rel)
    doc = json.loads(text)
    absent(doc, "code_node_CcGuardKey", "sql_node_CcGuard", "code_node_CcGuardDecide", "if_CcGuard")
    absent_num(doc, 1798100000021, 1798100000022)
    insert_after_start(doc, [
        code("code_node_CcGuardKey", "Guard: the GR ids, digits only", CANCEL_KEY_JS, [("ccg1ids", "idsCsv"), ("ccg2cnt", "idCount")]),
        sql("sql_node_CcGuard", "Stored GR status", CANCEL_SQL, [("ccg3id", "id"), ("ccg4no", "gr_no"), ("ccg5st", "gr_status")]),
        code("code_node_CcGuardDecide", "Guard: does the stored status allow this action?", CANCEL_DECIDE_JS,
             [("ccg6ref", "refuse"), ("ccg7msg", "message")]),
        if_("if_CcGuard", "IF the stored status refuses it", "'{{node:code_node_CcGuardDecide.data.refuse}}' == 'YES'", 1798100000021,
            [ret400("return_node_CcGuard", "Return refused", "{{node:code_node_CcGuardDecide.data.message}}", field=True)]),
    ])
    save(rel, doc, text)
    print("patched", rel)


def revert():
    rel = "Goods Receiving/RevertCompletedGR/GRrevertCompletedWorkflow.json"
    text = load(rel)
    doc = json.loads(text)
    prep = find(doc, "code_node_grRvPrep")
    assert "Reverting more than 500 lines" not in prep["data"]["script"]["code"], "already patched"
    replace_in_code(prep, REVERT_OLD, REVERT_NEW)
    save(rel, doc, text)
    print("patched", rel)


if __name__ == "__main__":
    cancel()
    revert()
