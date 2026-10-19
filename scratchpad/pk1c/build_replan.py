"""Builds GD_REPLAN (Picking/AsyncV2/GD_REPLAN.json): what GOODS_DELIVERY's Save as Created from PICKING (isPicking "Yes")
does to one Created GD's stock and reservations, computed and returned, nothing written. Runs GD Edit V2's lifted code and
SQL (scratchpad/gde: prepare/sql.py, lift/lifted_edit.js, code/**, imported by path and unchanged) with
scratchpad/pk1c/code/replan_guard.js + replan.js. gdc's wfkit is imported unchanged; gde's small node helpers are copied.
Published with .dbtools/wf_upload.mjs into a shell created in the designer.

usage: python3 build_replan.py [--write]
"""
import importlib.util
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
R = "/Users/yunawinaya/Developer/BladeXfunctions/"
GDE = R + "scratchpad/gde/"
GDC = R + "scratchpad/gdc/"
sys.path.insert(0, GDC + "pkv2tools")
import wfkit as K  # noqa: E402


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


PSQL = _load("gde_prepare_sql", GDE + "prepare/sql.py").SQL
FIELDS = json.load(open(GDC + "lift/fields.json"))
KINDS = {"header": FIELDS["goods_delivery"], "line": FIELDS["goods_delivery_fwii8mvb_sub"]}
OUT = R + "Picking/AsyncV2/GD_REPLAN.json"
PE = "code_node_GEentry"      # gde prepare/sql.py's token node
G, P = "code_node_GRguard", "code_node_GRplan"
# the reads the isPicking path uses (auto allocation, the Picking reads and the lock are idle under isPicking)
READS = [
    ("hdr", "The Goods Delivery (every schema field)", ["j"]), ("lines", "Its lines, top-level and bundle items", ["j"]),
    ("setup", "Picking Setup + Packing Setup of the organization", ["k", "j"]), ("link", "Internal-trading links of its Sales Orders", ["j"]),
    ("items", "Items of its lines", ["j"]), ("sohl", "Sales Order lines, the columns the SO nodes read", ["j"]),
    ("soh", "Its Sales Orders (status columns)", ["j"]), ("alloc", "on_reserved_gd Allocated to it (no row limit)", ["j"]),
    ("pend", "on_reserved_gd Pending for its materials and SO lines (no row limit)", ["j"]),
]
PLAN_MODS = ["gdc/lift/runtime.js", "@lift", "gdc/code/prepare/chain.js", "gdc/code/prepare/adapter.js", "gde/code/prepare/alloc_edit.js", "gde/code/prepare/chain_edit.js",
             "gde/code/submit/delta.js", "gde/code/prepare/apply_delta.js", "gde/code/prepare/plan_edit.js", "gde/code/commit/so_edit.js", "gde/code/prepare/adapter_edit.js", "@kinds",
             "pk1c/code/replan.js"]
OUT_FIELDS = ["route", "code", "message", "gd_id", "gd_no", "movements", "res_updates", "res_creates", "gdl_patches", "gdl_inserts", "gdl_deletes", "gdh_cells", "reorder", "line_count"]
OUT_ARRAYS = ("movements", "res_updates", "res_creates", "gdl_patches", "reorder")
OUT_OBJECTS = ("gdh_cells", "gdl_inserts", "gdl_deletes", "line_count")
GUARD_FIELDS = ["route", "gdId", "tenantId", "organizationId", "isLoadingBay", "lines", "deltaMaterialIdsSql", "deltaSoLineIdsSql", "deltaSoLineIdsQuoted", "deltaSoIdsSql",
                "deltaAllocMaterialIdsSql", "deltaAllocLineIdsSql", "result_code", "result_message"]


# ------------------------------------------------------------------------------------------------- helpers (gde's)
def N(node, path):
    return "{{node:%s.%s}}" % (node, path)


def is_(node, field, value):
    return "'%s' == '%s'" % (N(node, "data." + field), value)


def d(nid, path="data"):
    return "[%s][0]" % N(nid, path)


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read().rstrip("\n")


def lifted():
    chunks = re.split(r"(?m)^(?=// /)", read(GDE + "lift/lifted_edit.js") + "\n")
    out = [chunks[0]]
    for c in chunks[1:]:
        out.append(re.sub(r"\A// /\S*/([A-Za-z0-9_]+\.v\d+)\.json :: ", r"// \1 :: ", c))
    body = "".join(out).rstrip("\n")
    assert "{{" not in body and "/private/" not in body and "/Users/" not in body
    return body


def js(spec):
    if spec == "@kinds":
        return "const GE_KINDS = " + json.dumps(KINDS, separators=(",", ":")) + ";"
    if spec == "@lift":
        return lifted()
    root, rel = spec.split("/", 1)
    return read({"gdc": GDC, "gde": GDE, "pk1c": HERE + "/"}[root] + rel)


def cnode(nid, title, mods, tail, fields, arrays=(), objects=()):
    parts = [js(m) for m in mods]
    for m, p in zip(mods, parts):
        assert "{{" not in p, m + " holds a platform token"
    return K.code(nid, title, "\n".join(parts + [tail]), fields, arrays, objects)


SQL_WIDTH = 160
SQL_BREAK = ",\n\t\t"


def wrap_sql(text):
    """a long SQL line breaks after ", " outside quotes (the platform's addDraft failed on a 5,681-char SQL line)"""
    assert SQL_BREAK not in text
    out, line, quote, i = [], 0, False, 0
    while i < len(text):
        c = text[i]
        out.append(c)
        line = 0 if c == "\n" else line + 1
        if c == "'":
            quote = not quote
        elif c == "," and not quote and line > SQL_WIDTH and text[i + 1:i + 2] == " ":
            out.append(SQL_BREAK[1:])
            line = len(SQL_BREAK) - 2
            i += 1
        i += 1
    w = "".join(out)
    assert w.replace(SQL_BREAK, ", ") == text, "wrapping changed the SQL"
    return w


def wrap_doc_sql(doc):
    def walk(n):
        if isinstance(n, dict):
            if n.get("type") == "sql-node":
                n["data"]["script"]["code"] = wrap_sql(n["data"]["script"]["code"])
            for v in n.values():
                walk(v)
        elif isinstance(n, list):
            for v in n:
                walk(v)
    walk(doc)
    return doc


# ------------------------------------------------------------------------------------------------- GD_REPLAN
def build():
    ids = K.Ids(1798200000000)
    guard_tail = ("const res = grGuard({ gdId: [{{workflowparams:gd_id}}][0], organizationId: [{{workflowparams:organization_id}}][0], "
                  "isLoadingBay: [{{workflowparams:is_loading_bay}}][0], lines: [{{workflowparams:lines}}][0], tenantId: [{{system:tenantId}}][0] });\n"
                  "console.log(\"replan guard\", JSON.stringify({ route: res.route, gd: res.gdId, lines: res.lines.length, message: res.result_message }));\nreturn res;")
    rej_tail = ("const g = %s;\nconst res = { route: \"STOP\", code: g.result_code, message: g.result_message, gd_id: \"\", gd_no: \"\", movements: [], res_updates: [], "
                "res_creates: [], gdl_patches: [], gdl_inserts: 0, gdl_deletes: 0, gdh_cells: {}, reorder: [], line_count: 0 };\nreturn res;") % d(G)
    reads = "{ " + ", ".join("%s: %s" % (k, d("sql_node_GR" + k)) for k, _, _ in READS) + " }"
    plan_tail = ("const g = %s;\nconst S = Object.assign({ organizationId: g.organizationId }, %s);\n"
                 "const res = grPlan({ gdId: g.gdId, organizationId: g.organizationId, tenantId: g.tenantId, isLoadingBay: g.isLoadingBay, lines: g.lines }, geAdapt(S), GE_KINDS);\n"
                 "console.log(\"replan\", JSON.stringify({ route: res.route, code: res.code, message: res.message, movements: res.movements.length, "
                 "updates: res.res_updates.length, creates: res.res_creates.length }));\nreturn res;") % (d(G), reads)
    nodes = [
        cnode(G, "Guard: gd_id / organization_id (digits), is_loading_bay 0 | 1, lines = the moved lines' cells", ["pk1c/code/replan_guard.js"], guard_tail, GUARD_FIELDS,
              arrays=("lines",), objects=("isLoadingBay",)),
        K.if_(ids, "if_GRreject", "IF the input is invalid: answer, read nothing", is_(G, "route", "REJECT"), [
            K.code("code_node_GRrejres", "Result (rejected input)", rej_tail, OUT_FIELDS, OUT_ARRAYS, OUT_OBJECTS),
            K.ret("return_node_GRrej", "Return (rejected input)", [(f, N("code_node_GRrejres", "data." + f)) for f in OUT_FIELDS])]),
        K.parallel("condition_all_GRread", "Set-based reads in parallel (no row limits): the GD as stored, its reservations, items, Sales Orders, setups",
                   [("cai_GR" + k, k, [K.sql("sql_node_GR" + k, title, PSQL[k].replace(PE, G), cols)]) for k, title, cols in READS]),
        cnode(P, "Plan: GOODS_DELIVERY's Save as Created from PICKING on the post-move GD (lifted, in-process) -> movements, reservation writes, line changes",
              PLAN_MODS, plan_tail, OUT_FIELDS, OUT_ARRAYS, OUT_OBJECTS),
        K.ret("return_node_GRdone", "Return (the plan)", [(f, N(P, "data." + f)) for f in OUT_FIELDS]),
    ]
    return K.workflow([("gd_id", "string", "goods_delivery.id (digits): a Created delivery"),
                       ("organization_id", "string", "its organization (digits)"),
                       ("is_loading_bay", "string", "0 | 1: Picking Setup's is_loading_bay, as classic PICKING passes it"),
                       ("lines", "string", "JSON [{id, cells: {temp_qty_data, prev_temp_qty_data, view_stock, picking_status}}]: the moved lines as classic PICKING wrote them")],
                      OUT_FIELDS, nodes)


if __name__ == "__main__":
    K._rng.seed("pk1c:GD_REPLAN")
    K._taken.clear()
    doc = wrap_doc_sql(build())
    K.check_ids(doc)
    text = json.dumps(doc, ensure_ascii=False, indent=1)
    print("GD_REPLAN: %d chars, %d nodes" % (len(text), len(K.check_ids(doc))) + (" -> " + OUT if "--write" in sys.argv else " (dry; --write to save)"))
    if "--write" in sys.argv:
        open(OUT, "w", encoding="utf-8").write(text + "\n")
