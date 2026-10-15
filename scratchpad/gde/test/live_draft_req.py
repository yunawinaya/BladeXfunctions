"""live_draft_req.py <template_request.json> <tenant> <so_id> <out_request.json>: a GOODS_DELIVERY request that saves a Draft GD
for a cloned Sales Order, from a recorded SO -> GD save of the clone's source (SO_AUTO_GD's call: pageStatus Add, the form's
allData). The template's lines map onto the clone's lines in id order (the clone keeps its source's order; each material is
checked); header so_id / so_no and each line's SO links are the clone's; no line carries an allocation (a Draft has none).
Reads read-only (dev); the request goes to the session scratchpad.
"""
import json, re, sys

sys.path.insert(0, "/Users/yunawinaya/Developer/BladeXfunctions/scratchpad/gdc/pkv2tools")
from dbq import q  # noqa: E402

BIG = re.compile(r'"(?:[^"\\]|\\.)*"|-?\d{16,}(?![.\deE])')


def P(t):
    return json.loads(BIG.sub(lambda m: m.group(0) if m.group(0)[0] == '"' else '"' + m.group(0) + '"', t))


tpl_file, tenant, so_id, out = sys.argv[1:5]
assert tenant.isdigit() and so_id.isdigit()
tpl = P(open(tpl_file).read())
params = dict(tpl.get("workflowparams") or tpl)
a = json.loads(json.dumps(params["allData"]))
src_so = str((a.get("so_id") or [""])[0])
assert src_so.isdigit(), "template without an SO"
src = q("--dev", f"SELECT CAST(id AS CHAR) id, CAST(item_name AS CHAR) m FROM sales_order_axszx8cj_sub WHERE tenant_id = '{tenant}' AND sales_order_id = {src_so} AND is_deleted = 0 ORDER BY id")
dst = q("--dev", f"SELECT CAST(id AS CHAR) id, CAST(item_name AS CHAR) m FROM sales_order_axszx8cj_sub WHERE tenant_id = '{tenant}' AND sales_order_id = {so_id} AND is_deleted = 0 ORDER BY id")
hdr = q("--dev", f"SELECT so_no, so_status FROM sales_order WHERE tenant_id = '{tenant}' AND id = {so_id} AND is_deleted = 0")
assert hdr and len(src) == len(dst), (len(src), len(dst))
pos = {r["id"]: i for i, r in enumerate(src)}
for l in a["table_gd"]:
    i = pos[str(l["so_line_item_id"])]
    assert dst[i]["m"] == str(l["material_id"]), (i, dst[i]["m"], l["material_id"])
    l.update({"so_line_item_id": dst[i]["id"], "line_so_id": so_id, "line_so_no": hdr[0]["so_no"], "temp_qty_data": None, "temp_hu_data": None, "view_stock": None})
a.update({"so_id": [so_id], "so_no": hdr[0]["so_no"], "delivery_no": "", "gd_status": "Draft"})
params.update({"allData": a, "saveAs": "Draft", "pageStatus": "Add"})
json.dump(params, open(out, "w"))
print(f"Draft request for {hdr[0]['so_no']} ({hdr[0]['so_status']}): {len(a['table_gd'])} line(s), rule {a.get('delivery_no_type')}")
