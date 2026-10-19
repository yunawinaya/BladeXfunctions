"""PO busy guards (user 2026-10-19, after bladexfunctions-41's GD finding). While another Goods Receiving of the same purchase order
is Processing (completed or reverted in the background, its PO quantities not written yet) the conversion refuses that PO
(402 -> the PO list's "Unable to Convert") and the classic save refuses every save but Draft (400): else the same PO lines are
offered / received twice. Patches the repo copies from the dev-identical bases in base/ (PO_Convert_GR v5, GOODS_RECEIVING v103).
GR_CREATED: ../phase2b/build.py; GR_COMPLETE_SUBMIT: ../build_grv2.py. Re-runnable (always starts from base/).

usage: python3 patch_pobusy.py [--write]"""
import copy
import json
import os
import random
import string
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "phase0"))
from lib import absent, absent_num, code, find, if_, replace_in_code, ret400, save, sql  # noqa: E402

CONVERT_REL = "Bulk Actions/Procurement/Purchase Order/POconvertGRWorkflow.json"
GR_REL = "Goods Receiving/GRsaveWorkflow.json"
MSG = open(os.path.join(HERE, "msg.js"), encoding="utf-8").read().rstrip("\n")


def busy_sql(tenant, self_id, pos_json):
    """other receipts Processing that name one of the POs (po_id: JSON array of ids; exact text compare)"""
    return """SELECT CAST(g.id AS CHAR) AS id, g.gr_no, t.p AS po_id, po.purchase_order_no AS po_no
  FROM goods_receiving g
  JOIN JSON_TABLE(g.po_id, '$[*]' COLUMNS (p VARCHAR(32) CHARSET utf8mb4 COLLATE utf8mb4_general_ci PATH '$')) t
  LEFT JOIN purchase_order po ON po.tenant_id = g.tenant_id AND po.id = CAST(t.p AS UNSIGNED) AND po.is_deleted = 0
 WHERE g.tenant_id = '%s'
   AND g.gr_status = 'Processing'
   AND g.is_deleted = 0
   AND g.id <> %s
   AND t.p IN (SELECT k.k FROM JSON_TABLE('%s', '$[*]' COLUMNS (k VARCHAR(32) CHARSET utf8mb4 COLLATE utf8mb4_general_ci PATH '$')) k)""" % (
        tenant, self_id, pos_json)


class Keys:
    def __init__(self, doc, seed):
        self.taken = set()
        self.rng = random.Random(seed)

        def walk(n):
            if isinstance(n, dict):
                if isinstance(n.get("key"), str):
                    self.taken.add(n["key"])
                for v in n.values():
                    walk(v)
            elif isinstance(n, list):
                for v in n:
                    walk(v)
        walk(doc)

    def __call__(self, *names):
        out = []
        for n in names:
            while True:
                k = "".join(self.rng.choice(string.ascii_lowercase + string.digits) for _ in range(8))
                if k not in self.taken and not k.isdigit():
                    self.taken.add(k)
                    break
            out.append((k, n))
        return out


def base(name):
    path = os.path.join(HERE, "base", name)
    text = open(path, encoding="utf-8").read()
    return text, json.loads(text)


# ------------------------------------------------------------------------------------------------- PO_Convert_GR
CONVERT_KEYS_JS = """// PO -> GR: the selected purchase orders (digits only) for the background-receipt check
const ids = [{{workflowparams:po_ids}}][0];
const pos = (Array.isArray(ids) ? ids : ids ? [ids] : []).map((v) => String(v === undefined || v === null ? "" : v).trim()).filter((v) => /^[0-9]{1,20}$/.test(v));
return { posJson: JSON.stringify(pos.length ? pos : ["0"]) };"""

CONVERT_CHECK = """
// A purchase order another Goods Receiving is still receiving in the background (Processing: its quantities are not written
// yet) is not converted again - its lines would be offered a second time
const busyText = poBusyMessage([{{node:sql_node_PoGrBusy.data}}][0], true);
if (busyText) return result(402, busyText);
"""


def patch_convert():
    text, doc = base("PO_Convert_GR.v5.json")
    absent(doc, "code_node_PoGrBusyKeys", "sql_node_PoGrBusy")
    key = Keys(doc, 20261019)
    keys_node = code("code_node_PoGrBusyKeys", "1b. Selected POs for the background-receipt check", CONVERT_KEYS_JS, key("posJson"))
    busy = sql("sql_node_PoGrBusy", "1c. Other receipts of these POs still Processing (received in the background)",
               busy_sql("{{system:tenantId}}", "0", "{{node:code_node_PoGrBusyKeys.data.posJson}}"), key("id", "gr_no", "po_id", "po_no"))
    at = [n["id"] for n in doc["nodes"]].index("search_node_PoGrGetAll") + 1
    doc["nodes"][at:at] = [keys_node, busy]
    m = find(doc, "code_node_PoGrMap")
    anchor = """if (poList.length === 0) {
  return result(
    402,
    "No selected records are available for conversion. Please select records with status 'Issued' or 'Processing'.",
  );
}
"""
    replace_in_code(m, anchor, anchor + CONVERT_CHECK)
    replace_in_code(m, "const toNumber = (value) => parseFloat(value) || 0;\n", "const toNumber = (value) => parseFloat(value) || 0;\n\n" + MSG + "\n")
    return CONVERT_REL, text, doc


# ------------------------------------------------------------------------------------------------- GOODS_RECEIVING
GR_KEYS_JS = """// Classic save: the receipt's purchase orders (header po_id + every line's line_po_id, digits only). A save other than Draft
// is refused while another Goods Receiving of one of them is Processing (received in the background, quantities not written yet)
const str = (v) => (v === undefined || v === null ? "" : String(v)).trim();
let head = [{{workflowparams:allData.po_id}}][0];
if (typeof head === "string" && head.trim().charAt(0) === "[") {
  try {
    head = JSON.parse(head);
  } catch (e) {
    head = [];
  }
}
const rows = [{{workflowparams:allData.table_gr}}][0] || [];
const pos = {};
const add = (v) => {
  const t = str(v && typeof v === "object" ? v.id : v);
  if (/^[0-9]{1,20}$/.test(t)) pos[t] = 1;
};
for (const v of Array.isArray(head) ? head : [head]) add(v);
for (const r of Array.isArray(rows) ? rows : []) {
  add(r && r.line_po_id);
  for (const c of r && Array.isArray(r.children) ? r.children : []) add(c && c.line_po_id);
}
const list = Object.keys(pos);
const saveAs = str([{{workflowparams:saveAs}}][0]);
return { need: list.length && saveAs !== "Draft" ? "YES" : "NO", posJson: JSON.stringify(list.length ? list : ["0"]) };"""

GR_CHECK_JS = MSG + """
const message = poBusyMessage([{{node:sql_node_GrPoBusy.data}}][0], false);
return { busy: message ? "YES" : "NO", message: message };"""


def patch_gr():
    text, doc = base("GOODS_RECEIVING.v103.json")
    absent(doc, "code_node_GrPoBusyKeys", "if_GrPoBusyNeed", "sql_node_GrPoBusy", "code_node_GrPoBusy", "if_GrPoBusy")
    absent_num(doc, 1798100000101, 1798100000102, 1798100000103, 1798100000104)
    key = Keys(doc, 20261019)
    keys_node = code("code_node_GrPoBusyKeys", "Guard: the receipt's purchase orders (a save other than Draft)", GR_KEYS_JS, key("need", "posJson"))
    busy = sql("sql_node_GrPoBusy", "Other receipts of these POs still Processing (received in the background)",
               busy_sql("{{system:tenantId}}", "{{node:code_node_GrSizeGuard.data.grId}}", "{{node:code_node_GrPoBusyKeys.data.posJson}}"),
               key("id", "gr_no", "po_id", "po_no"))
    check = code("code_node_GrPoBusy", "Guard: a purchase order received in the background?", GR_CHECK_JS, key("busy", "message"))
    refuse = if_("if_GrPoBusy", "IF a purchase order is still received in the background", "'{{node:code_node_GrPoBusy.data.busy}}' == 'YES'", 1798100000103,
                 [ret400("return_node_GrPoBusy", "Return purchase order busy", "{{node:code_node_GrPoBusy.data.message}}", field=True)])
    need = if_("if_GrPoBusyNeed", "IF a save that receives or reserves (not Draft)", "'{{node:code_node_GrPoBusyKeys.data.need}}' == 'YES'", 1798100000101,
               [busy, check, refuse])
    at = [n["id"] for n in doc["nodes"]].index("if_GrProcGuard") + 1
    doc["nodes"][at:at] = [keys_node, need]
    return GR_REL, text, doc


if __name__ == "__main__":
    for rel, text, doc in (patch_convert(), patch_gr()):
        print(rel, ": nodes", len(json.dumps(doc)), "chars")
        if "--write" in sys.argv:
            save(rel, doc, text)
            print("  written")
