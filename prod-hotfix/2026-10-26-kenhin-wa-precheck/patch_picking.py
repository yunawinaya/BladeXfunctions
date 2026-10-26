"""patch_picking.py <base.json> <out.json>: classic PICKING, a costing pre-check before anything is written (raw-text edits, the
file's own formatting kept; each edit asserted).
Why: an Auto Complete GD org completes each fully picked delivery right after PICKING writes the Picking. A Weighted Average
item with no costing record at its plant throws in SUBTRACT_INVENTORY's "process WA Data", the run dies half-way, the Picking
stays Completed and locked and the rest of its deliveries stay Created (Kenhin 528521: PI-20261023-0307 / 0310, PI-20261026-0315).
What: sql_node_WaCostGuard (after sql_node_GdLineCount) lists the WA items of the Picking's open deliveries whose stock lines
have no wa_costing_method row for their plant / organization (and batch, when the line has one), the same lookup as the stock
step; code_node_SizeGuard refuses with code 400 when the org auto-completes, so PICKING_LOOP releases the lock and shows it."""
import copy
import json
import random
import re
import sys

base, out = sys.argv[1:3]
t = open(base, encoding="utf-8").read()
w = json.loads(t)


def find(o, nid):
    if isinstance(o, dict):
        if o.get("id") == nid:
            return o
        for v in o.values():
            r = find(v, nid)
            if r:
                return r
    elif isinstance(o, list):
        for v in o:
            r = find(v, nid)
            if r:
                return r


WA_SQL = """SELECT g.delivery_no AS delivery_no,
       i.material_code AS material_code,
       i.material_name AS material_name
  FROM goods_delivery_fwii8mvb_sub gl
  JOIN goods_delivery g
    ON g.id = gl.goods_delivery_id AND g.tenant_id = gl.tenant_id AND g.is_deleted = 0
   AND g.gd_status NOT IN ('Completed', 'Cancelled')
  JOIN Item i ON i.id = gl.material_id AND i.material_costing_method = 'Weighted Average'
 CROSS JOIN JSON_TABLE(gl.temp_qty_data, '$[*]' COLUMNS (
         batch_id VARCHAR(32) PATH '$.batch_id',
         plant_id VARCHAR(32) PATH '$.plant_id',
         organization_id VARCHAR(32) PATH '$.organization_id',
         qty VARCHAR(40) PATH '$.gd_quantity')) a
 WHERE {{node:code_node_SizeGuardPrep.data.autoComplete}} = 1
   AND gl.tenant_id = '{{system:tenantId}}'
   AND gl.goods_delivery_id IN ({{node:code_node_SizeGuardPrep.data.gdIdCsv}})
   AND gl.is_deleted = 0
   AND CAST(COALESCE(NULLIF(a.qty, ''), '0') AS DECIMAL(65, 8)) > 0
   AND NOT EXISTS (SELECT 1
                     FROM wa_costing_method w
                    WHERE w.tenant_id = gl.tenant_id
                      AND w.is_deleted = 0
                      AND w.material_id = gl.material_id
                      AND w.plant_id = COALESCE(NULLIF(a.plant_id, ''), CAST(g.plant_id AS CHAR)) COLLATE utf8mb4_general_ci
                      AND w.organization_id = COALESCE(NULLIF(a.organization_id, ''), CAST(g.organization_id AS CHAR)) COLLATE utf8mb4_general_ci
                      AND (NULLIF(a.batch_id, '') IS NULL OR w.batch_id = CAST(a.batch_id AS UNSIGNED)))
 GROUP BY g.delivery_no, i.material_code, i.material_name
 LIMIT 5"""

# 1. the new SQL node: a copy of the line-count node's shape, after it in the same block
src = find(w, "sql_node_GdLineCount")
node = copy.deepcopy(src)
node["id"] = "sql_node_WaCostGuard"
title = "Costing Guard: Weighted Average items with no costing record at their plant (auto-complete orgs)"
for k in ("title", "nodeName", "name"):
    node["data"][k] = title
node["data"]["script"]["code"] = WA_SQL
taken = set(re.findall(r'"key": "([a-z0-9]{8})"', t))
rng = random.Random("kenhin-wa-precheck-20261026")


def key():
    while True:
        k = "".join(rng.choice("abcdefghijklmnopqrstuvwxyz0123456789") for _ in range(8))
        if k not in taken:
            taken.add(k)
            return k


node["data"]["response_json"] = [{"key": key(), "name": c, "title": c, "description": "", "bsonType": "string", "isExpand": False, "children": []}
                                 for c in ("delivery_no", "material_code", "material_name")]
anchor = '"id": "sql_node_GdLineCount"'
assert t.count(anchor) == 1
start = t.rfind("{", 0, t.index(anchor))
depth, i, in_str, esc = 0, start, False, False
while True:
    ch = t[i]
    if in_str:
        if esc:
            esc = False
        elif ch == "\\":
            esc = True
        elif ch == '"':
            in_str = False
    elif ch == '"':
        in_str = True
    elif ch == "{":
        depth += 1
    elif ch == "}":
        depth -= 1
        if depth == 0:
            break
    i += 1
end = i + 1
assert json.loads(t[start:end])["id"] == "sql_node_GdLineCount"
line_start = t.rfind("\n", 0, start) + 1
indent = t[line_start:start]
assert indent.strip() == ""
dumped = json.dumps(node, ensure_ascii=False, indent=2).replace("\n", "\n" + indent)
t = t[:end] + ",\n" + indent + dumped + t[end:]

# 1b. code_node_SizeGuardPrep also answers autoComplete (0 / 1): the costing guard's SQL is a constant-false no-op for other orgs
prep = find(w, "code_node_SizeGuardPrep")["data"]["script"]["code"]
old_prep = """return { gdIdCsv: ids.length > 0 ? ids.map((x) => "'" + x + "'").join(",") : "'0'" };"""
new_prep = """// whether the org auto-completes its deliveries: sql_node_WaCostGuard checks costing records only then
const setupRaw = {{node:get_node_Uj1uV9PU.data.data}};
const setup = (Array.isArray(setupRaw) ? setupRaw[0] : setupRaw) || {};
return { gdIdCsv: ids.length > 0 ? ids.map((x) => "'" + x + "'").join(",") : "'0'", autoComplete: Number(setup.auto_completed_gd || 0) === 1 ? 1 : 0 };"""
assert prep.count(old_prep) == 1
new_p = prep.replace(old_prep, new_prep)
pe_old, pe_new = json.dumps(prep, ensure_ascii=False)[1:-1], json.dumps(new_p, ensure_ascii=False)[1:-1]
assert t.count(pe_old) == 1
t = t.replace(pe_old, pe_new)
prep_node = find(w, "code_node_SizeGuardPrep")
gk = [r for r in prep_node["data"]["response_json"] if r.get("name") == "gdIdCsv"][0]["key"]
m = re.search(r'(\n(\s*)\{\n\s*"key": "' + gk + r'",.*?\n\2\})', t, re.S)
assert m, "gdIdCsv response entry not found"
ind = m.group(2)
entry = ("{\n" + ind + '  "key": "' + key() + '",\n' + ind + '  "name": "autoComplete",\n' + ind + '  "title": "autoComplete",\n' + ind
         + '  "description": "",\n' + ind + '  "bsonType": "string",\n' + ind + '  "isExpand": false,\n' + ind + '  "children": []\n' + ind + "}")
t = t[:m.end()] + ",\n" + ind + entry + t[m.end():]

# 2. the refusal, in code_node_SizeGuard (after the busy check, before the size check)
guard = find(w, "code_node_SizeGuard")["data"]["script"]["code"]
old = """if (needFullSave === 1 && maxLines > MAX_SYNC_GD_LINES) {"""
new = """// An auto-complete org completes each fully picked delivery right after this Picking is written. A Weighted Average item
// with no costing record at its plant fails that completion half-way: the Picking stays Completed and locked and the rest
// of its deliveries stay Created (Kenhin 10-23, 10-26). Refuse first; the returned 400 releases the lock.
const waRaw = {{node:sql_node_WaCostGuard.data}};
const waMissing = (Array.isArray(waRaw) ? waRaw : waRaw ? [waRaw] : []).filter((r) => r && r.delivery_no);
if (Number(setup.auto_completed_gd || 0) === 1 && waMissing.length > 0) {
  const items = waMissing.slice(0, 3).map((r) => (String(r.material_code || "") + " " + String(r.material_name || "")).trim() +
    " (Goods Delivery " + r.delivery_no + ")");
  return {
    code: "400",
    message: "No Weighted Average costing record at the delivery's plant for " + items.join("; ") +
      (waMissing.length > 3 ? " and more" : "") +
      ". The delivery would be completed automatically and could not be. Create the costing record, then confirm this Picking again. Nothing was saved.",
    lineCounts,
    needFullSave,
    maxLines,
  };
}

if (needFullSave === 1 && maxLines > MAX_SYNC_GD_LINES) {"""
assert guard.count(old) == 1
new_guard = guard.replace(old, new)
old_esc, new_esc = json.dumps(guard, ensure_ascii=False)[1:-1], json.dumps(new_guard, ensure_ascii=False)[1:-1]
assert t.count(old_esc) == 1
t = t.replace(old_esc, new_esc)

w2 = json.loads(t)
blocks = None


def parent(o):
    global blocks
    if isinstance(o, dict):
        for k, v in o.items():
            if k == "blocks" and isinstance(v, list) and any(isinstance(b, dict) and b.get("id") == "sql_node_WaCostGuard" for b in v):
                blocks = [b.get("id") for b in v]
            parent(v)
    elif isinstance(o, list):
        for v in o:
            parent(v)


parent(w2)
k = blocks.index("sql_node_GdLineCount")
assert blocks[k + 1] == "sql_node_WaCostGuard" and blocks[k + 2] == "code_node_SizeGuard", blocks[k:k + 3]
open(out, "w", encoding="utf-8").write(t)
print("patched ->", out)
