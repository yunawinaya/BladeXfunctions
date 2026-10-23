"""patch_gd_uom_guard.py [--write]: GOODS_DELIVERY (the classic save, repo Goods Delivery/GDheadWorkflow.json) refuses a NEW
delivery with a stock line whose unit its item does not have (user 2026-10-23, after 128671's GD-2610-971: classic counted
1 箱CTN of a 6-packet carton as 1 packet). Classic converts gd_order_uom_id || good_delivery_uom_id with the item's conversion
rows and falls back to 1 (GD_UNUSED_FN_NEW convFactor); GD Created V2 refuses the same line as GD_INVALID_UOM.

"New delivery" = saveAs Created / Completed and the GD is new (Add / Clone / SO_AUTO_GD) or stored as Draft - the SO guard's
rule, so a stored Created GD (Picking / Packing completion, SO cascade) is never refused. Checked: lines with a material,
gd_qty > 0, a stock-controlled item (stock_control 1), top-level rows and bundle children. Not checked: Picking Plan
deliveries (is_select_picking 1, their own unit fields). Prod scan 10-23 (30 days, all tenants): 17 GDs in 3 tenants
(528521, 073522, 128671), all classic.

A new block right after the SO guard (if_GdSoGuard), before any read or write of the save: code -> IF YES -> sql (stored
status + the items' units + the unit names, one statement) -> code -> IF refuse -> return 400 + message. Built from the
Processing guard's node layout, as patch_gd_so_guard.py. Text-level insert (the file does not round-trip json.dumps).
Dry run unless --write."""
import copy
import json
import re
import sys

P = "/Users/yunawinaya/Developer/BladeXfunctions/Goods Delivery/GDheadWorkflow.json"
raw = open(P, encoding="utf-8").read()
W = json.loads(raw)

GUARD = r"""// A new delivery (an Add, or a stored Draft saved as Created / Completed) may not carry a stock line in a unit its item does not have: classic would count it 1:1 (GD Created V2 refuses it as GD_INVALID_UOM)
const saveAs = String([{{workflowparams:saveAs}}][0] || "");
const allData = [{{workflowparams:allData}}][0] || {};
const idOf = (v) => { const s = String(v == null ? "" : v).trim(); return /^[0-9]{1,20}$/.test(s) ? s : ""; };
const mats = {};
const uoms = {};
const add = (row) => {
  const m = idOf(row.material_id);
  const u = idOf(row.gd_order_uom_id) || idOf(row.good_delivery_uom_id);
  if (!m || !u || !(parseFloat(row.gd_qty) > 0)) return;
  mats[m] = 1;
  uoms[u] = 1;
};
for (const row of Array.isArray(allData.table_gd) ? allData.table_gd : []) {
  if (!row) continue;
  add(row);
  for (const child of Array.isArray(row.children) ? row.children : []) if (child) add(child);
}
// a Picking Plan delivery takes its units from to_order_uom_id / picking_plan_uom_id: not checked here
const fromPlan = Number(allData.is_select_picking || 0) === 1;
const materialIds = Object.keys(mats);
return {
  check: (saveAs === "Created" || saveAs === "Completed") && !fromPlan && materialIds.length > 0 ? "YES" : "NO",
  gdId: idOf(allData.id) || "0",
  materialIdsSql: materialIds.join(",") || "0",
  uomIdsSql: Object.keys(uoms).join(",") || "0",
};"""

C = "CONVERT(%s USING utf8mb4) COLLATE utf8mb4_general_ci"
SQL = """SELECT %s AS kind,
       %s AS k,
       %s AS base_uom,
       %s AS stock_control,
       %s AS conv,
       %s AS name
UNION ALL
SELECT %s,
       %s,
       %s,
       %s,
       %s,
       %s
  FROM item i
 WHERE i.id IN ({{node:code_node_GdUomGuard.data.materialIdsSql}})
   AND i.is_deleted = 0
UNION ALL
SELECT %s,
       %s,
       %s,
       %s,
       %s,
       %s
  FROM unit_of_measurement u
 WHERE u.id IN ({{node:code_node_GdUomGuard.data.uomIdsSql}})""" % (
    C % "'GD'",
    C % "IFNULL((SELECT g.gd_status FROM goods_delivery g WHERE g.id = {{node:code_node_GdUomGuard.data.gdId}} AND g.is_deleted = 0), '')",
    C % "''", C % "''", C % "''", C % "''",
    C % "'ITEM'",
    C % "CAST(i.id AS CHAR)",
    C % "IFNULL(CAST(i.based_uom AS CHAR), '')",
    C % "IFNULL(CAST(i.stock_control AS CHAR), '')",
    C % "IFNULL((SELECT GROUP_CONCAT(CAST(c.alt_uom_id AS CHAR)) FROM item_mji552rc_sub c WHERE c.Item_id = i.id AND c.is_deleted = 0 AND c.base_qty > 0), '')",
    C % "IFNULL(i.material_name, '')",
    C % "'UNIT'",
    C % "CAST(u.id AS CHAR)",
    C % "''", C % "''", C % "''",
    C % "IFNULL(u.uom_name, '')",
)

CHECK = r"""// refused: a stock line whose unit is neither its item's base unit nor one of its conversions; a stored Created GD is never a new delivery
const allData = [{{workflowparams:allData}}][0] || {};
const raw = [{{node:sql_node_GdUomGuard.data}}][0];
const rows = Array.isArray(raw) ? raw : raw ? [raw] : [];
const idOf = (v) => { const s = String(v == null ? "" : v).trim(); return /^[0-9]{1,20}$/.test(s) ? s : ""; };
const txt = (v) => (v == null ? "" : String(v)).trim();
let stored = "";
const items = {};
const units = {};
for (const r of rows) {
  if (!r) continue;
  if (r.kind === "GD") stored = txt(r.k);
  else if (r.kind === "ITEM") items[txt(r.k)] = { base: txt(r.base_uom), stock: txt(r.stock_control), conv: txt(r.conv).split(","), name: txt(r.name) };
  else if (r.kind === "UNIT") units[txt(r.k)] = txt(r.name);
}
const fresh = txt([{{workflowparams:pageStatus}}][0]) !== "Edit" || stored === "" || stored === "Draft";
const bad = [];
const check = (row, label) => {
  const m = idOf(row.material_id);
  const u = idOf(row.gd_order_uom_id) || idOf(row.good_delivery_uom_id);
  if (!m || !u || !(parseFloat(row.gd_qty) > 0)) return;
  const it = items[m];
  // an item not found is left to the save's own checks; a non-stock item moves no stock
  if (!it || it.stock !== "1" || u === it.base || it.conv.indexOf(u) >= 0) return;
  bad.push("line " + label + " (" + (txt(row.material_name) || it.name || m) + ") is in " + (units[u] || "unit " + u));
};
(Array.isArray(allData.table_gd) ? allData.table_gd : []).forEach((row, i) => {
  if (!row) return;
  check(row, String(i + 1));
  (Array.isArray(row.children) ? row.children : []).forEach((child, j) => {
    if (child) check(child, i + 1 + "." + (j + 1));
  });
});
const message = bad.length
  ? "Not saved: " + bad.slice(0, 3).join("; ") + (bad.length > 3 ? "; and " + (bad.length - 3) + " more line(s)" : "") + ". " +
    (bad.length === 1 ? "That unit is" : "Those units are") + " not one of the item's units, so the stock quantity cannot be worked out. Choose the item's own unit, or add the unit to the item's unit conversions, then save again."
  : "";
return { refuse: bad.length > 0 && fresh ? "YES" : "NO", message: message };"""


def find(o, nid):
    if isinstance(o, dict):
        if o.get("id") == nid:
            return o
        for v in o.values():
            r = find(v, nid)
            if r is not None:
                return r
    elif isinstance(o, list):
        for v in o:
            r = find(v, nid)
            if r is not None:
                return r
    return None


def span(text, nid):
    """[start, end) of the object whose "id" is nid, in the file's text (string-aware brace match)"""
    i = text.index('"id": "%s"' % nid)
    start = text.rfind("{", 0, i)
    depth, j, in_str = 0, start, False
    while True:
        c = text[j]
        if in_str:
            if c == "\\":
                j += 1
            elif c == '"':
                in_str = False
        elif c == '"':
            in_str = True
        elif c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return start, j + 1
        j += 1


def dump(o, indent):
    text = json.dumps(o, indent=2, ensure_ascii=False)
    text = re.sub(r'\{\n\s*"title": "(true|false)"\n\s*\}', r'{ "title": "\1" }', text)
    return text.replace("\n", "\n" + " " * indent)


# the file's style for a top-level node = json.dumps(indent=2) at a 4-space offset (checked on the blocks cloned)
for nid in ("code_node_GdProcGuard", "if_GdProcGuard", "code_node_GdSoGuard", "if_GdSoGuard"):
    a, b = span(raw, nid)
    assert raw[a:b] == dump(find(W, nid), 4), nid + ": the file's layout is not json.dumps(indent=2)"
assert "GdUomGuard" not in raw, "already patched"

keys = set(re.findall(r'"key": "([A-Za-z0-9]{8})"', raw))
fresh_keys = (k for k in ("gdum%04d" % n for n in range(10000)) if k not in keys)
nums = set(int(x) for x in re.findall(r'"(?:id|parentId)": (\d{9,})', raw))
fresh_nums = (n for n in range(2113500000001, 2113500009999) if n not in nums)


def outputs(node, names, types=None):
    tpl = node["data"]["response_json"][0]
    node["data"]["response_json"] = [dict(copy.deepcopy(tpl), key=next(fresh_keys), name=n, title=n, bsonType=(types or {}).get(n, "string")) for n in names]


def titled(node, title):
    for k in ("title", "nodeName", "name"):
        node["data"][k] = title


def renumber(node):
    for leaf in node["data"]["filter"]["list"]:
        leaf["id"], leaf["parentId"] = next(fresh_nums), next(fresh_nums)


code_guard = copy.deepcopy(find(W, "code_node_GdProcGuard"))
code_guard["id"] = "code_node_GdUomGuard"
titled(code_guard, "Unit Guard: a new delivery with stock lines?")
code_guard["data"]["script"]["code"] = GUARD
outputs(code_guard, ["check", "gdId", "materialIdsSql", "uomIdsSql"])

if_guard = copy.deepcopy(find(W, "if_GdProcGuard"))
if_guard["id"] = "if_GdUomGuard"
titled(if_guard, "IF a new delivery (Created / Completed) with stock lines")
if_guard["data"]["expression"]["code"] = "'{{node:code_node_GdUomGuard.data.check}}' == 'YES'"
renumber(if_guard)
t_block, f_block = if_guard["blocks"]
assert [b["id"] for b in t_block["blocks"]] == ["sql_node_GdProcGuard", "code_node_GdProcBusy", "if_GdProcBusy"] and f_block["blocks"] == []
t_block["id"], f_block["id"] = "ifBlock_TGdUomGuard", "ifBlock_FGdUomGuard"
sql, chk, if_chk = t_block["blocks"]
sql["id"] = "sql_node_GdUomGuard"
titled(sql, "Unit Guard: stored status, the items' units, the unit names")
sql["data"]["script"]["code"] = SQL
outputs(sql, ["kind", "k", "base_uom", "stock_control", "conv", "name"])
chk["id"] = "code_node_GdUomCheck"
titled(chk, "Unit Guard: refuse?")
chk["data"]["script"]["code"] = CHECK
outputs(chk, ["refuse", "message"])
if_chk["id"] = "if_GdUomCheck"
titled(if_chk, "IF a line's unit is not one of its item's units")
if_chk["data"]["expression"]["code"] = "'{{node:code_node_GdUomCheck.data.refuse}}' == 'YES'"
renumber(if_chk)
bt, bf = if_chk["blocks"]
assert [b["id"] for b in bt["blocks"]] == ["return_node_GdProcBusy"] and bf["blocks"] == []
bt["id"], bf["id"] = "ifBlock_TGdUomCheck", "ifBlock_FGdUomCheck"
ret = bt["blocks"][0]
ret["id"] = "return_node_GdUomCheck"
titled(ret, "Return Unit not on the item")
msg = [x for x in ret["data"]["response_value"]["list"] if x["prop"] == "message"]
code = [x for x in ret["data"]["response_value"]["list"] if x["prop"] == "code"]
assert len(msg) == 1 and len(code) == 1 and code[0]["value"] == "400"
msg[0]["value"] = "{{node:code_node_GdUomCheck.data.message}}"

block = ",\n    " + dump(code_guard, 4) + ",\n    " + dump(if_guard, 4)
_, end = span(raw, "if_GdSoGuard")
raw = raw[:end] + block + raw[end:]

W2 = json.loads(raw)
order = [n["id"] for n in W2["nodes"]]
assert order[:8] == ["start", "code_node_GdProcGuard", "if_GdProcGuard", "code_node_GdSoGuard", "if_GdSoGuard", "code_node_GdUomGuard", "if_GdUomGuard", "if_gr_gate_completed"], order[:8]
ids = re.findall(r'"id": "([A-Za-z0-9_\-]+)"', raw)
assert len(ids) == len(set(ids)), "duplicate node ids"
new_keys = re.findall(r'"key": "(gdum\d{4})"', block)
assert len(new_keys) == 12 and not set(new_keys) & keys, new_keys
print("ok: block inserted after if_GdSoGuard; %d nodes in the file, ids unique; top-level order %s" % (len(ids), order[:8]))
if "--write" in sys.argv:
    open(P, "w", encoding="utf-8").write(raw)
    print("written", P)
else:
    print("dry run: pass --write")
