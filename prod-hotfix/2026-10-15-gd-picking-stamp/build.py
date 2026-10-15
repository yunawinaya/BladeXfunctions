#!/usr/bin/env python3
"""BUG-20261015-020 (TAF TA189054): GD_UNUSED_FN_NEW Branch 4 stamps Picking records only inside the
Pickings named by each GD line's line_to_id. A GD-from-PP line whose temp_qty_data draws from a second
Picking leaves that Picking's records unstamped, so their qty looks available again.

Fix: look up the stamped records' own Picking headers and fetch those as well.

  python3 build.py          # patch the dev repo file in place + build GD_UNUSED_FN_NEW.prod.json from prod enabled
  python3 build.py --check  # build both into memory only and print the node-level diff
"""
import json, os, subprocess, sys, glob, copy

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
REPO_FILE = os.path.join(ROOT, "Goods Delivery", "GDinventoryProcessWorkflow.json")
PROD_OUT = os.path.join(HERE, "GD_UNUSED_FN_NEW.prod.json")
WF_ID = 2032273338771128322

OB_OLD = """const pickingIds = Array.from(pickingIdsSet);

return {
  pickingRecordUpdates: pickingRecordUpdates,
  pickingIds: pickingIds,
};"""
OB_NEW = """const pickingIds = Array.from(pickingIdsSet);
const recordIds = Array.from(touchedIds);

return {
  pickingRecordUpdates: pickingRecordUpdates,
  pickingIds: pickingIds,
  recordIds: recordIds.length > 0 ? recordIds : ["0"],
};"""

XV_OLD = "const pickings = {{node:search_node_68C0TVzK.data.data}};"
XV_NEW = "const pickings = {{node:search_node_68C0TVzK.data.data}} || [];"

HDR_CODE = """const lineToIds = {{node:code_node_OBz5tEws.data.pickingIds}} || [];
const records = {{node:search_node_PkRec8Hd.data.data}} || [];

// A line's picks can sit in Pickings other than its line_to_id (one PP line picked in several Pickings).
const ids = new Set(lineToIds.map(String));
for (const r of records) {
  if (r.transfer_order_id) ids.add(String(r.transfer_order_id));
}

const pickingIds = Array.from(ids);

return {
  pickingIds: pickingIds.length > 0 ? pickingIds : ["0"],
};"""


def array_field(key, item_key, name):
    return {"key": key, "name": name, "title": name, "description": "", "bsonType": "array", "isExpand": True,
            "children": [{"key": item_key, "name": "items", "title": "", "description": "", "bsonType": "any",
                          "isExpand": False, "isArrayItem": True, "children": []}]}


SEARCH_NODE = {
    "id": "search_node_PkRec8Hd",
    "type": "search-node",
    "data": {
        "table_id": {
            "source": "Picking Items(Transfer Order Picking):Table:1939915130372202497",
            "rules": {"collectionId": "1939915130372202497", "list": [{
                "id": 1779960000101, "parentId": 1779960000100, "isTop": True, "prop": "id", "operator": "in",
                "valueType": "field", "value": "{{node:code_node_OBz5tEws.data.recordIds}}", "type": "leaf",
                "level": 1, "propLabel": "主键ID", "valueLabel": "", "operatorLabel": "In"}]},
        },
        "condition": {},
        "limit": 500,
        "title": "Get Stamped Picking Records",
        "isValidator": True,
        "nodeName": "Get Stamped Picking Records",
        "name": "Get Stamped Picking Records",
    },
    "blocks": [],
}

CODE_NODE = {
    "id": "code_node_PkHdrIds",
    "type": "code-node",
    "data": {
        "language": "javascript",
        "code": "",
        "timeout": 30000,
        "title": "Picking Header IDs",
        "isValidator": True,
        "nodeName": "Picking Header IDs",
        "name": "Picking Header IDs",
        "script": {"type": "javascript", "code": HDR_CODE},
        "response_json": [array_field("pk7h2d9q", "pk3m8x1w", "pickingIds")],
    },
    "blocks": [],
}


def find(n, nid):
    if isinstance(n, dict):
        if n.get("id") == nid:
            return n
        for v in n.values():
            r = find(v, nid)
            if r is not None:
                return r
    elif isinstance(n, list):
        for v in n:
            r = find(v, nid)
            if r is not None:
                return r
    return None


def replace_once(text, old, new, where):
    if text.count(old) != 1:
        sys.exit(f"  {where}: expected exactly one match of the baseline text, found {text.count(old)} -- baseline drifted")
    return text.replace(old, new)


def patch(doc):
    doc = copy.deepcopy(doc)
    raw = json.dumps(doc, ensure_ascii=False)
    for nid in ("search_node_PkRec8Hd", "code_node_PkHdrIds", "1779960000101", "pk7h2d9q", "pk3m8x1w", "ob4r9c2k", "ob8t1v6m"):
        if nid in raw:
            sys.exit(f"  {nid} already present -- already patched?")

    ob = find(doc, "code_node_OBz5tEws")
    ob["data"]["script"]["code"] = replace_once(ob["data"]["script"]["code"], OB_OLD, OB_NEW, "code_node_OBz5tEws")
    names = [f["name"] for f in ob["data"]["response_json"]]
    assert names == ["pickingRecordUpdates", "pickingIds"], names
    ob["data"]["response_json"].append(array_field("ob4r9c2k", "ob8t1v6m", "recordIds"))

    xv = find(doc, "code_node_xVqrs3Yi")
    xv["data"]["script"]["code"] = replace_once(xv["data"]["script"]["code"], XV_OLD, XV_NEW, "code_node_xVqrs3Yi")

    hdr = find(doc, "search_node_68C0TVzK")
    leaf = hdr["data"]["table_id"]["rules"]["list"]
    assert len(leaf) == 1 and leaf[0]["value"] == "{{node:code_node_OBz5tEws.data.pickingIds}}", leaf
    leaf[0]["value"] = "{{node:code_node_PkHdrIds.data.pickingIds}}"

    b4 = find(doc, "condition_all_item_JuVfL4gU")
    order = [b["id"] for b in b4["blocks"]]
    assert order == ["code_node_OBz5tEws", "search_node_68C0TVzK", "code_node_xVqrs3Yi", "if_qn0atlM6", "if_XM6iqY3U"], order
    b4["blocks"][1:1] = [copy.deepcopy(SEARCH_NODE), copy.deepcopy(CODE_NODE)]
    return doc


def prettier(text):
    found = glob.glob(os.path.expanduser("~/.npm/_npx/*/node_modules/prettier/bin/prettier.cjs"))
    cmd = ["node", found[0]] if found else ["npx", "--yes", "prettier@3.9.8"]
    out = subprocess.run(cmd + ["--parser", "json"], input=text, capture_output=True, text=True)
    if out.returncode:
        sys.exit("prettier failed: " + out.stderr[:300])
    return out.stdout


def render_like(doc, raw):
    renderers = [lambda d, i=i, nl=nl: json.dumps(d, indent=i, ensure_ascii=False) + ("\n" if nl else "")
                 for i in (1, 2) for nl in (True, False)]
    renderers += [lambda d: prettier(json.dumps(d, ensure_ascii=False, separators=(",", ":"))),
                  lambda d: prettier(json.dumps(d, ensure_ascii=False, indent=2))]
    for r in renderers:
        if r(json.loads(raw)) == raw:
            return r(doc)
    sys.exit("  repo file formatting is not reproducible -- refusing to rewrite it")


def prod_enabled():
    out = subprocess.run([os.path.join(ROOT, ".dbtools", "db"), "--prod", "--json",
                          f"SELECT version_number, script_json FROM su_code_workflow_history "
                          f"WHERE data_id={WF_ID} AND status='enabled' ORDER BY version_number DESC LIMIT 1"],
                         capture_output=True, text=True)
    s = out.stdout
    rows = json.loads(s[s.index("["):])
    return rows[0]["version_number"], json.loads(rows[0]["script_json"])


def nodes(doc):
    out = {}
    def walk(n):
        if isinstance(n, dict):
            if n.get("id") and isinstance(n.get("data"), dict):
                out[n["id"]] = json.dumps({k: v for k, v in n.items() if k != "blocks"}, sort_keys=True, ensure_ascii=False)
            for v in n.values():
                walk(v)
        elif isinstance(n, list):
            for v in n:
                walk(v)
    walk(doc)
    return out


def node_diff(a, b):
    na, nb = nodes(a), nodes(b)
    return {"added": sorted(set(nb) - set(na)), "removed": sorted(set(na) - set(nb)),
            "changed": sorted(k for k in set(na) & set(nb) if na[k] != nb[k])}


if __name__ == "__main__":
    check = "--check" in sys.argv
    repo_raw = open(REPO_FILE, encoding="utf-8").read()
    dev_base = json.loads(repo_raw)
    dev_new = patch(dev_base)
    pv, prod_base = prod_enabled()
    prod_new = patch(prod_base)
    print(f"  dev  repo  -> {node_diff(dev_base, dev_new)}")
    print(f"  prod v{pv} -> {node_diff(prod_base, prod_new)}")
    print(f"  prod built vs dev built -> {node_diff(prod_new, dev_new)}")
    if check:
        sys.exit(0)
    open(REPO_FILE, "w", encoding="utf-8").write(render_like(dev_new, repo_raw))
    open(PROD_OUT, "w", encoding="utf-8").write(json.dumps(prod_new, indent=2, ensure_ascii=False) + "\n")
    print(f"  wrote {os.path.relpath(REPO_FILE, ROOT)} and {os.path.relpath(PROD_OUT, ROOT)} (from prod v{pv})")
