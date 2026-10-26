"""patch_gd_guard_tenant.py [file] [--write]: GOODS_DELIVERY's GD Created V2 guards read only the session tenant's rows
(GD Edit & Picking V2's finding, 10-27). sql_node_GdSoGuard / sql_node_GdUomGuard read goods_delivery, gd_async_job, item
and unit_of_measurement by id alone, and the job scan's organization scope comes from the client (1 = 1 when it is
missing), so a crafted save naming another tenant's GD / SO / item read that tenant's status, job id or SO number back
through the refusal. Each read gets the session tenant, as sql_node_GdProcGuard already has; the organization scope stays.

Checked on prod 10-27: units are per tenant (57 tenants) and only label the refusal; all 1,170 CREATE_GD_FROM_FORM jobs
carry their first SO's tenant_id; the job scan keeps its plan (Lease Recovery range, 7 rows).
Default file: the repo's Goods Delivery/GDheadWorkflow.json. Text-level replace of the two SQL strings; dry run unless --write."""
import json
import sys

args = [a for a in sys.argv[1:] if not a.startswith("--")]
P = args[0] if args else "/Users/yunawinaya/Developer/BladeXfunctions/Goods Delivery/GDheadWorkflow.json"
raw = open(P, encoding="utf-8").read()
W = json.loads(raw)
T = "'{{system:tenantId}}'"

EDITS = {
    "sql_node_GdSoGuard": [
        ("         WHERE g.id = {{node:code_node_GdSoGuard.data.gdId}}\n",
         "         WHERE g.tenant_id = " + T + "\n           AND g.id = {{node:code_node_GdSoGuard.data.gdId}}\n"),
        ("         WHERE {{node:code_node_GdSoGuard.data.scopeSql}}\n",
         "         WHERE j.tenant_id = " + T + "\n           AND {{node:code_node_GdSoGuard.data.scopeSql}}\n"),
    ],
    "sql_node_GdUomGuard": [
        ("FROM goods_delivery g WHERE g.id = {{node:code_node_GdUomGuard.data.gdId}} AND",
         "FROM goods_delivery g WHERE g.tenant_id = " + T + " AND g.id = {{node:code_node_GdUomGuard.data.gdId}} AND"),
        (" WHERE i.id IN ({{node:code_node_GdUomGuard.data.materialIdsSql}})\n",
         " WHERE i.tenant_id = " + T + "\n   AND i.id IN ({{node:code_node_GdUomGuard.data.materialIdsSql}})\n"),
        (" WHERE u.id IN ({{node:code_node_GdUomGuard.data.uomIdsSql}})",
         " WHERE u.tenant_id = " + T + "\n   AND u.id IN ({{node:code_node_GdUomGuard.data.uomIdsSql}})"),
    ],
}


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


new_code = {}
for nid, edits in EDITS.items():
    code = find(W, nid)["data"]["script"]["code"]
    if "tenant_id" in code:
        sys.exit(nid + ": already reads by tenant, nothing to do")
    for old, new in edits:
        assert code.count(old) == 1, (nid, old)
        code = code.replace(old, new)
    new_code[nid] = code
    old_lit, new_lit = json.dumps(find(W, nid)["data"]["script"]["code"], ensure_ascii=False), json.dumps(code, ensure_ascii=False)
    assert raw.count(old_lit) == 1, nid + ": the SQL string is not stored once, as json.dumps writes it"
    raw = raw.replace(old_lit, new_lit)

W2 = json.loads(raw)
for nid, code in new_code.items():
    assert find(W2, nid)["data"]["script"]["code"] == code
    find(W2, nid)["data"]["script"]["code"] = find(W, nid)["data"]["script"]["code"]
assert W2 == W, "something besides the two SQL strings changed"
for nid, code in new_code.items():
    print("=====", nid)
    print(code)
if "--write" in sys.argv:
    open(P, "w", encoding="utf-8").write(raw)
    print("written", P)
else:
    print("dry run: pass --write")
