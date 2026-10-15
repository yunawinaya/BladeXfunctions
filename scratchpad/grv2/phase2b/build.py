"""Phase 2 (plan ~/.claude/plans/we-have-done-v2-sleepy-iverson.md): lean GR_CREATED and GR_CANCEL_CREATED.
Builds both repo files from the dev-identical bases in base/ (GR_CREATED v12, GR_CANCEL_CREATED v7, Phase 0 guards in)
and the node bodies in code/. Re-runnable: always starts from base/. Usage: python3 build.py"""
import copy
import json
import os
import random
import string
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "phase0"))
sys.path.insert(0, os.path.join(HERE, ".."))
from lib import ROOT, save  # noqa: E402

CREATED_REL = "Goods Receiving/GRsaveAsCreatedWorkflow.json"
CANCEL_REL = "Bulk Actions/Procurement/Goods Receiving/GRcancelWorkflow.json"
PO_LINE_SRC = "Item Table(Purchase Order):Table:1939901372270747649"
PO_SRC = "Purchase Order:Table:1902776039445217282"
GR_SRC = "Goods Receiving:Table:1901845517592285186"


def body(path):
    with open(os.path.join(HERE, "code", path), encoding="utf-8") as f:
        text = f.read().rstrip("\n")
    if "//@@RULE@@" in text:
        with open(os.path.join(HERE, "code", "rule.js"), encoding="utf-8") as f:
            text = text.replace("//@@RULE@@", f.read().rstrip("\n"))
    return text


def status_sql(src):
    with open(os.path.join(HERE, "code", "postatus.sql.tmpl"), encoding="utf-8") as f:
        return f.read().rstrip("\n") % {"src": src}


class Kit:
    """Node builders in the shapes the deployed workflows use; keys / filter ids unique per file."""

    def __init__(self, base_doc, fid_start, seed):
        text = json.dumps(base_doc)
        self.taken = set()
        self._collect(base_doc)
        self.rng = random.Random(seed)
        self.fid = fid_start
        while str(self.fid + 1) in text or str(self.fid + 40) in text:
            self.fid += 1000

    def _collect(self, n):
        if isinstance(n, dict):
            if isinstance(n.get("key"), str):
                self.taken.add(n["key"])
            for v in n.values():
                self._collect(v)
        elif isinstance(n, list):
            for v in n:
                self._collect(v)

    def key(self):
        while True:
            k = "".join(self.rng.choice(string.ascii_lowercase + string.digits) for _ in range(8))
            if k not in self.taken and not k.isdigit():
                self.taken.add(k)
                return k

    def ids(self):
        self.fid += 1
        return self.fid

    @staticmethod
    def title(t):
        return {"title": t, "isValidator": True, "nodeName": t, "name": t}

    def resp(self, names, arrays=(), objects=()):
        out = []
        for n in names:
            if n in arrays:
                out.append({"key": self.key(), "name": n, "title": n, "description": "", "bsonType": "array", "isExpand": True,
                            "children": [{"key": self.key(), "name": "items", "title": "", "description": "", "bsonType": "any",
                                          "isExpand": False, "isArrayItem": True, "children": []}]})
            else:
                out.append({"key": self.key(), "name": n, "title": n, "description": "", "isExpand": False, "children": [],
                            "bsonType": "any" if n in objects else "string"})
        return out

    def code(self, nid, t, src, names, arrays=(), objects=()):
        d = {"language": "javascript", "code": "", "timeout": 30000}
        d.update(self.title(t))
        d["script"] = {"type": "javascript", "code": src}
        d["response_json"] = self.resp(names, arrays, objects)
        return {"id": nid, "type": "code-node", "data": d, "blocks": []}

    def sql(self, nid, t, text, names):
        d = {"database_id": "", "sql": "", "params": {}}
        d.update(self.title(t))
        d["script"] = {"type": "sql", "code": text}
        d["response_json"] = self.resp(names)
        return {"id": nid, "type": "sql-node", "data": d, "blocks": []}

    def if_(self, nid, t, expr, yes, tid=None, fidb=None):
        assert yes, "an if node's true block must not be empty"
        a = self.ids()
        b = self.ids()
        d = self.title(t)
        d.update({"condition_type": "Expression",
                  "filter": {"list": [{"id": a, "parentId": b, "isTop": True, "prop": "", "operator": "", "valueType": "",
                                       "value": "", "type": "leaf", "level": 1}]},
                  "expression": {"type": "javascript", "code": expr}})
        return {"id": nid, "type": "if", "data": d,
                "blocks": [{"id": tid or nid.replace("if_", "ifBlock_T"), "type": "ifBlock", "data": {"title": "true"}, "blocks": list(yes)},
                           {"id": fidb or nid.replace("if_", "ifBlock_F"), "type": "ifBlock", "data": {"title": "false"}, "blocks": []}]}

    def ret(self, nid, t, code, fields):
        """fields: [(prop, value, is_field)]"""
        lst = [{"prop": "code", "propLabel": "code", "operator": "", "operatorLabel": "", "valueType": "value", "valueTypeLabel": "",
                "value": str(code), "valueLabel": ""}]
        for p, v, is_field in fields:
            lst.append({"prop": p, "propLabel": p, "operator": "", "operatorLabel": "", "valueType": "field" if is_field else "value",
                        "valueTypeLabel": "", "value": v, "valueLabel": ""})
        d = {"return_data": {}, "status_code": 200}
        d.update(self.title(t))
        d["response_value"] = {"list": lst}
        d["return_raw_data"] = 0
        return {"id": nid, "type": "return-node", "data": d, "blocks": []}

    def where_in(self, source, value):
        coll = source.split(":Table:")[1]
        a = self.ids()
        b = self.ids()
        return {"source": source, "rules": {"collectionId": coll, "list": [
            {"id": a, "parentId": b, "isTop": True, "prop": "id", "operator": "in", "valueType": "field", "value": value,
             "type": "leaf", "level": 1, "propLabel": "主键ID", "valueLabel": "", "operatorLabel": "In"}]}}

    @staticmethod
    def props(items):
        """items: [(prop, value, is_field, label)]"""
        return {"modelName": "", "list": [{"prop": p, "operator": "", "valueType": "field" if f else "value", "value": v,
                                           "valueLabel": "", "propLabel": lab or p} for p, v, f, lab in items]}

    def update(self, nid, t, source, where_value, items):
        d = {"table_id": self.where_in(source, where_value), "fields": [], "condition": {}}
        d.update(self.title(t))
        d["props"] = self.props(items)
        return {"id": nid, "type": "update-node", "data": d, "blocks": []}

    def parallel(self, nid, t, branches):
        items = []
        for iid, bt, nodes in branches:
            items.append({"id": iid, "type": "condition-all-node-item",
                          "data": {"title": bt, "filter": {"list": []}, "expression": {"code": "", "type": "javascript"},
                                   "displayContent": "sdk.form.setCondition", "isValidator": True, "nodeName": bt, "name": bt,
                                   "condition_type": "ConditionRule"},
                          "blocks": list(nodes)})
        return {"id": nid, "type": "condition-all-node",
                "data": {"title": t, "filter": {"list": []}, "expression": {"code": ""}, "displayContent": "sdk.form.setCondition"},
                "blocks": items}

    def loop(self, nid, t, var_ref, nodes):
        a = self.ids()
        b = self.ids()
        d = self.title(t)
        d.update({"loopType": "Var",
                  "loopSeletSource": {"datasource": {"rules": {"collectionId": "", "list": [
                      {"id": a, "parentId": b, "isTop": True, "prop": "", "operator": "", "valueType": "", "value": "", "type": "leaf",
                       "level": 1}]}},
                      "auto_refresh": 1, "auto_refresh_debounce": 100, "options": [],
                      "props": {"value": "", "label": "", "image": "", "icon": "", "explain": ""}, "remote": False,
                      "remoteType": "datasource"},
                  "loopSeletVar": {"type": "markdown", "code": var_ref}})
        return {"id": nid, "type": "loop", "data": d, "blocks": list(nodes)}


def index(doc):
    out = {}

    def walk(n):
        if isinstance(n, dict):
            if isinstance(n.get("id"), str) and "type" in n:
                assert n["id"] not in out, "duplicate id " + n["id"]
                out[n["id"]] = n
            for v in n.values():
                walk(v)
        elif isinstance(n, list):
            for v in n:
                walk(v)
    walk(doc)
    return out


def load_base(name):
    with open(os.path.join(HERE, "base", name), encoding="utf-8") as f:
        text = f.read()
    return text, json.loads(text)


def write(rel, doc):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        current = f.read()
    save(rel, doc, current)


# ------------------------------------------------------------------------------------------------- GR_CREATED
CREATED_PREP_OUT = ["tooBig", "sizeMessage", "edit", "check", "grId", "keyCheck", "keySql", "keyStore", "zeroStop",
                    "zeroMessage", "invalid", "invalidMessage", "hasError", "errorMessage", "noRule", "clientGrNo", "gr", "lines",
                    "poLineCsv", "itemCsv", "lineCount"]


def build_created():
    text, base = load_base("GR_CREATED.v12.json")
    old = index(base)
    k = Kit(base, 1798200000000, 20261014)
    P = "code_node_GcPrep"

    prep = k.code(P, "Prepare: guards, fill, checks (reads allData once)", body("created/prep.js"), CREATED_PREP_OUT,
                  arrays=("lines",), objects=("gr",))

    size_ret = copy.deepcopy(old["return_node_GcSizeGuard"])
    size_ret["data"]["response_value"]["list"][1]["value"] = "{{node:%s.data.sizeMessage}}" % P
    if_size = k.if_("if_GcSizeGuard", "IF more than 2000 lines", "'{{node:%s.data.tooBig}}' == 'YES'" % P, [size_ret])

    key_hit = k.if_("if_GcKey", "IF Add with an idempotency key", "'{{node:%s.data.keyCheck}}' == 'YES'" % P, [
        k.sql("sql_node_GcKeyHit", "GR already saved with this key?", body("created/keyhit.sql"), ["id", "gr_no", "gr_status"]),
        k.code("code_node_GcKeyHit", "Earlier attempt found?", body("created/keyhit.js"), ["hit", "id", "grNo", "message"]),
        k.if_("if_GcKeyHit", "IF the first attempt already saved it", "'{{node:code_node_GcKeyHit.data.hit}}' == 'YES'", [
            k.ret("return_node_GcKeyHit", "Return the first GR", 200, [
                ("message", "{{node:code_node_GcKeyHit.data.message}}", True), ("id", "{{node:code_node_GcKeyHit.data.id}}", True),
                ("gr_no", "{{node:code_node_GcKeyHit.data.grNo}}", True), ("duplicate", "YES", False)])]),
    ])

    stored_sql = copy.deepcopy(old["sql_node_GcProcGuard"])
    stored_sql["data"]["script"]["code"] = body("created/stored.sql")
    stored_sql["data"]["response_json"] = k.resp(["gr_status", "gr_no", "po_line_id", "qty"])
    stored_sql["data"].update(k.title("Stored GR: status, number, reserved qty per PO line"))
    busy = k.code("code_node_GcProcBusy", "Guard: may the stored GR be saved as Created?", body("created/stored.js"),
                  ["busy", "message", "storedStatus", "oldAgg", "grNo"], objects=("oldAgg",))
    busy_ret = copy.deepcopy(old["return_node_GcProcBusy"])
    msg = busy_ret["data"]["response_value"]["list"][1]
    msg.update({"valueType": "field", "value": "{{node:code_node_GcProcBusy.data.message}}"})
    busy_ret["data"].update(k.title("Return refused"))
    if_busy = k.if_("if_GcProcBusy", "IF the stored GR refuses it", "'{{node:code_node_GcProcBusy.data.busy}}' == 'YES'", [busy_ret])
    # read on every save (an Add looks up id 0: no row, no table access), so no later node depends on an Edit-only branch
    stored_nodes = [stored_sql, busy, if_busy]

    def reuse_ret(nid, value):
        r = copy.deepcopy(old[nid])
        r["data"]["response_value"]["list"][1]["value"] = value
        return r

    if_zero = k.if_("if_zero", "IF Zero Qty", "'{{node:%s.data.zeroStop}}' == 'YES'" % P,
                    [reuse_ret("ret_zero", "{{node:%s.data.zeroMessage}}" % P)], tid="if_zero_t", fidb="if_zero_f")
    if_invalid = k.if_("if_invalid", "IF invalidMessage", "'{{node:%s.data.invalid}}' == 'YES'" % P,
                       [reuse_ret("ret_invalid", "{{node:%s.data.invalidMessage}}" % P)], tid="if_invalid_t", fidb="if_invalid_f")
    if_validate = k.if_("if_validate", "IF Validation Failed", "'{{node:%s.data.hasError}}' == 'YES'" % P,
                        [reuse_ret("ret_validate", "{{node:%s.data.errorMessage}}" % P)], tid="if_validate_t", fidb="if_validate_f")

    reads = k.parallel("condition_all_GcReads", "Read PO lines + item tolerances", [
        ("condition_all_node_item_GcPoLines", "PO lines", [
            k.sql("sql_node_GcPoLines", "PO lines of this GR (new + stored)", body("created/polines.sql"),
                  ["id", "po_id", "quantity", "received_qty", "created_received_qty"])]),
        ("condition_all_node_item_GcTol", "Item tolerances", [
            k.sql("sql_node_GcTol", "Over-receive tolerance per item + UOM", body("created/tol.sql"), ["item_id", "uom_id", "tol"])]),
    ])
    qty = k.code("code_node_GcQty", "Over-receive checks + reservation plan", body("created/qty.js"),
                 ["qtyStop", "errorMessage", "overStop", "warningMessage", "hasLineUpdates", "slices", "lineUpdateCount", "newPoCsv",
                  "relPoCsv"], arrays=("slices",))
    if_qty = k.if_("if_qtyError", "IF Qty Error", "'{{node:code_node_GcQty.data.qtyStop}}' == 'YES'",
                   [reuse_ret("ret_qty", "{{node:code_node_GcQty.data.errorMessage}}")], tid="if_qtyError_t", fidb="if_qtyError_f")
    if_over = k.if_("if_overcommit", "IF Over Commitment", "'{{node:code_node_GcQty.data.overStop}}' == 'YES'",
                    [reuse_ret("ret_overcommit", "{{node:code_node_GcQty.data.warningMessage}}")], tid="if_overcommit_t",
                    fidb="if_overcommit_f")

    # GR add / update: same columns as before, values from the prepared row
    def retarget(nid, edit):
        n = copy.deepcopy(old[nid])
        for p in n["data"]["props"]["list"]:
            if p["valueType"] != "field":
                continue
            field = p["prop"]
            if field == "gr_no" and edit:
                p["value"] = "{{node:code_node_GcProcBusy.data.grNo}}"
            else:
                assert p["value"] == "{{node:cn_fill.data.allData.%s}}" % field, (nid, field, p["value"])
                p["value"] = "{{node:%s.data.gr.%s}}" % (P, field)
        if edit:
            leaf = n["data"]["table_id"]["rules"]["list"][0]
            assert leaf["value"] == "{{node:cn_fill.data.allData.id}}"
            leaf["value"] = "{{node:%s.data.grId}}" % P
        else:
            n["data"]["props"]["list"].append({"prop": "gr_idem_key", "operator": "", "valueType": "field",
                                               "value": "{{node:%s.data.keyStore}}" % P, "valueLabel": "", "propLabel": "Idempotency Key"})
        return n

    update_gr = retarget("update_gr", True)
    add_gr = retarget("add_gr", False)
    mapped = {p["prop"] for p in add_gr["data"]["props"]["list"]}
    import re
    prep_fields = set(re.search(r"const FIELDS = \[(.*?)\];", body("created/prep.js"), re.S).group(1).replace('"', "").replace("\n", "").replace(" ", "").split(","))
    extra = {"gr_status", "po_id", "gr_no", "table_gr", "gr_idem_key"}
    assert mapped == prep_fields | extra, mapped ^ (prep_fields | extra)
    assert "grn_uuid" not in json.dumps(add_gr) + json.dumps(update_gr), "grn_uuid is SQL Accounting's document key: never written here"

    key_dup = k.if_("if_GcKeyDup", "IF Add with an idempotency key (a twin attempt?)", "'{{node:%s.data.keyCheck}}' == 'YES'" % P, [
        k.sql("sql_node_GcKeyDup", "GRs saved with this key", body("created/keydup.sql"), ["id", "gr_no", "gr_idem_key"]),
        k.code("code_node_GcKeyDup", "Is this attempt the twin?", body("created/keydup.js"), ["lose", "mine", "myId", "winnerId", "winnerNo", "message"]),
        k.if_("if_GcKeyLose", "IF a twin attempt saved it first", "'{{node:code_node_GcKeyDup.data.lose}}' == 'YES'", [
            k.update("update_node_GcKeyLose", "Remove this twin GR (nothing reserved yet)", GR_SRC, "{{node:code_node_GcKeyDup.data.mine}}",
                     [("is_deleted", 1, False, "删除状态")]),
            k.ret("return_node_GcKeyLose", "Return the first GR", 200, [
                ("message", "{{node:code_node_GcKeyDup.data.message}}", True), ("id", "{{node:code_node_GcKeyDup.data.winnerId}}", True),
                ("gr_no", "{{node:code_node_GcKeyDup.data.winnerNo}}", True), ("duplicate", "YES", False)])]),
    ])
    if_edit = k.if_("if_edit", "IF Edit Mode", "'{{node:%s.data.edit}}' == 'YES'" % P, [update_gr], tid="if_edit_t", fidb="if_edit_f")
    if_edit["blocks"][1]["blocks"] = [add_gr, key_dup]

    loop = k.loop("loop_GcPoLines", "Reserve on PO lines (slices of <= 250)", "{{node:code_node_GcQty.data.slices}}", [
        k.code("code_node_GcSlice", "This slice (the loop item: <= 250 rows)", body("created/slice.js"), ["n", "rows"], arrays=("rows",)),
        k.update("update_node_GcPoLines", "PO lines: created_received_qty (<= 250 per call)", PO_LINE_SRC,
                 "{{node:code_node_GcSlice.data.rows.id}}",
                 [("id", "{{node:code_node_GcSlice.data.rows.id}}", True, "主键ID"),
                  ("created_received_qty", "{{node:code_node_GcSlice.data.rows.created_received_qty}}", True, "Created Received Qty")]),
    ])
    if_lines = k.if_("if_poUpdates", "IF PO hasUpdate", "'{{node:code_node_GcQty.data.hasLineUpdates}}' == 'YES'", [loop],
                     tid="if_poUpdates_t", fidb="if_poUpdates_f")
    po_status = k.sql("sql_node_GcPoStatus", "POs this GR left: lines as they are now", status_sql("code_node_GcQty.data.relPoCsv"),
                      ["po_id", "reserved", "countable", "partially", "fully"])
    po_hdr = k.code("code_node_GcPoHdr", "PO gr_status + the GR id for the answer", body("created/pohdr.js"), ["headers", "hasHeaders", "grId"],
                    arrays=("headers",))
    upd_po = k.update("update_po", "Update PO gr_status", PO_SRC, "{{node:code_node_GcPoHdr.data.headers.id}}",
                      [("id", "{{node:code_node_GcPoHdr.data.headers.id}}", True, "ID"),
                       ("gr_status", "{{node:code_node_GcPoHdr.data.headers.gr_status}}", True, "GR Status")])
    if_hdr = k.if_("if_GcPoHdr", "IF PO headers to write", "'{{node:code_node_GcPoHdr.data.hasHeaders}}' == 'YES'", [upd_po])
    ok = copy.deepcopy(old["ret_success"])
    ok["data"]["response_value"]["list"].append({"prop": "id", "propLabel": "id", "operator": "", "operatorLabel": "", "valueType": "field",
                                                 "valueTypeLabel": "", "value": "{{node:code_node_GcPoHdr.data.grId}}", "valueLabel": ""})

    doc = copy.deepcopy(base)
    doc["request_json"].append({"key": k.key(), "name": "idempotency_key", "title": "idempotency_key",
                                "description": "optional, Add only: one key per new GR (kept across retries); a retry returns the first GR",
                                "bsonType": "string", "isExpand": False})
    for name in ("gr_no", "duplicate"):
        doc["response_json"].append({"key": k.key(), "name": name, "title": name, "description": "", "bsonType": "string", "isExpand": False})
    doc["nodes"] = [old["start"], prep, if_size, key_hit] + stored_nodes + [if_zero, if_invalid, if_validate, reads, qty, if_qty, if_over, if_edit,
                    if_lines, po_status, po_hdr, if_hdr, ok, old["end"]]
    index(doc)
    write(CREATED_REL, doc)
    return base, doc


# ------------------------------------------------------------------------------------------------- GR_CANCEL_CREATED
def build_cancel():
    text, base = load_base("GR_CANCEL_CREATED.v7.json")
    old = index(base)
    k = Kit(base, 1798200000100, 20261015)

    lines = k.sql("sql_node_CcLines", "This GR's PO lines: reserved qty + fresh created_received_qty", body("cancel/lines.sql"),
                  ["id", "po_id", "created_received_qty", "rev"])
    plan = k.code("code_node_CcPlan", "Releases + the GR stamp", body("cancel/plan.js"),
                  ["grStamps", "hasLines", "slices", "releaseCount", "poCsv"], arrays=("grStamps", "slices"))
    stamp = copy.deepcopy(old["update_node_gr"])
    stamp["data"]["table_id"]["rules"]["list"][0]["value"] = "{{node:code_node_CcPlan.data.grStamps.id}}"
    stamp["data"]["props"] = k.props([("id", "{{node:code_node_CcPlan.data.grStamps.id}}", True, "主键ID"),
                                      ("gr_status", "Cancelled", False, "GR Status"),
                                      ("gr_no", "{{node:code_node_CcPlan.data.grStamps.gr_no}}", True, "Goods Receiving Number")])
    loop = k.loop("loop_CcPoLines", "Release on PO lines (slices of <= 250)", "{{node:code_node_CcPlan.data.slices}}", [
        k.code("code_node_CcSlice", "This slice (the loop item: <= 250 rows)", body("cancel/slice.js"), ["n", "rows"], arrays=("rows",)),
        k.update("update_node_CcPoLines", "PO lines: created_received_qty (<= 250 per call)", PO_LINE_SRC,
                 "{{node:code_node_CcSlice.data.rows.id}}",
                 [("id", "{{node:code_node_CcSlice.data.rows.id}}", True, "主键ID"),
                  ("created_received_qty", "{{node:code_node_CcSlice.data.rows.created_received_qty}}", True, "Created Received Qty")]),
    ])
    if_lines = k.if_("if_CcLines", "IF PO lines to release", "'{{node:code_node_CcPlan.data.hasLines}}' == 'YES'", [loop])
    po_status = k.sql("sql_node_CcPoStatus", "This GR's POs: lines as they are now", status_sql("code_node_CcPlan.data.poCsv"),
                      ["po_id", "reserved", "countable", "partially", "fully"])
    po_hdr = k.code("code_node_CcPoHdr", "PO gr_status from its lines", body("cancel/pohdr.js"), ["headers", "hasHeaders"], arrays=("headers",))
    upd_po = k.update("update_node_CcPoHdr", "Update PO gr_status", PO_SRC, "{{node:code_node_CcPoHdr.data.headers.id}}",
                      [("id", "{{node:code_node_CcPoHdr.data.headers.id}}", True, "主键ID"),
                       ("gr_status", "{{node:code_node_CcPoHdr.data.headers.gr_status}}", True, "GR Status")])
    if_hdr = k.if_("if_CcPoHdr", "IF PO headers to write", "'{{node:code_node_CcPoHdr.data.hasHeaders}}' == 'YES'", [upd_po])

    doc = copy.deepcopy(base)
    keep = ["start", "code_node_CcGuardKey", "sql_node_CcGuard", "code_node_CcGuardDecide", "if_CcGuard", "if_is_delete"]
    top = [n["id"] for n in base["nodes"]]
    assert top == keep + ["parallel_fetch", "code_reversals", "loop_po", "update_node_gr", "return_success", "end"], top
    doc["nodes"] = [old[i] for i in keep] + [lines, plan, stamp, if_lines, po_status, po_hdr, if_hdr, old["return_success"], old["end"]]
    index(doc)
    write(CANCEL_REL, doc)
    return base, doc


def diff(name, base, doc):
    a = index(base)
    b = index(doc)
    removed = sorted(set(a) - set(b))
    added = sorted(set(b) - set(a))
    changed = sorted(i for i in set(a) & set(b) if json.dumps(a[i], sort_keys=True) != json.dumps(b[i], sort_keys=True))
    print("%s: %d nodes -> %d" % (name, len(a), len(b)))
    print("  removed:", ", ".join(removed))
    print("  added:  ", ", ".join(added))
    print("  changed:", ", ".join(changed))


if __name__ == "__main__":
    diff("GR_CREATED", *build_created())
    diff("GR_CANCEL_CREATED", *build_cancel())
