"""patch_unhide.py <hidden_status> <commit_base> <commit_out> <picking_base> <picking_out>: Picking makes a hidden Packing shell
visible when it fills it (raw-text edits, each file's own formatting kept; every step asserted).
Why (user, 2026-10-26): GD Created V2 keeps the save-time Packing shell, but HIDDEN until something is picked, instead of the
shell showing empty (LSH "Packing task doesn't have item") or Picking creating Packings (at LSH, Pickings of one GD finish
within 2 s of each other 95 times in 1.2 days, so a create race would be constant). Both Picking paths already find the
GD's Packing by gd_id and refresh it, and neither writes packing_status.
What: each path collects the shells still at <hidden_status> into an un-hide list and writes packing_status Created for
those rows only. The refresh itself still never writes packing_status, so a Packing a packer just moved on is never reverted.
- PICKING_BULK_COMMIT code_node_PCp5build: unhideRows / hasUnhide; cor_PCp5unhide -> update_node_PCp5unhide, after the refresh
  inside the chunk loop.
- classic PICKING code_node_gudzrvMQ: packingsToUnhide / hasUnhide; if_PkUnhide -> update_node_PkUnhide, after if_PkUpdates."""
import copy
import json
import random
import re
import sys

HIDDEN, cbase, cout, pbase, pout = sys.argv[1:6]
assert re.fullmatch(r"[A-Za-z ]{3,30}", HIDDEN) and HIDDEN not in ("Created", "Completed", "Cancelled", "In Progress"), HIDDEN


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


def esc(s):
    return json.dumps(s, ensure_ascii=False)[1:-1]


def edit_code(t, w, nid, pairs):
    old = find(w, nid)["data"]["script"]["code"]
    new = old
    for a, b in pairs:
        assert new.count(a) == 1, (nid, a[:60], new.count(a))
        new = new.replace(a, b)
    assert t.count(esc(old)) == 1, (nid, "code not unique in the file")
    return t.replace(esc(old), esc(new))


class Keys:
    def __init__(self, t, seed):
        self.taken = set(re.findall(r'"key": "([a-z0-9]{8})"', t))
        self.rng = random.Random(seed)
        self.used = set(int(x) for x in re.findall(r'"(?:id|parentId)": (\d{13})', t))
        self.n = 1796400000951

    def key(self):
        while True:
            k = "".join(self.rng.choice("abcdefghijklmnopqrstuvwxyz0123456789") for _ in range(8))
            if k not in self.taken:
                self.taken.add(k)
                return k

    def num(self):
        while self.n in self.used:
            self.n += 1
        self.used.add(self.n)
        return self.n

    def field(self, name, bson="string", items=False):
        f = {"key": self.key(), "name": name, "title": name, "description": "", "bsonType": bson, "isExpand": items, "children": []}
        if items:
            f["children"] = [{"key": self.key(), "name": "items", "title": "", "description": "", "bsonType": "any", "isExpand": False,
                              "isArrayItem": True, "children": []}]
        return f


def add_response(t, w, nid, after_name, fields):
    """append fields to a code node's response_json, after the entry named after_name (raw text, that entry's indentation)"""
    rj = find(w, nid)["data"]["response_json"]
    k = [r for r in rj if r.get("name") == after_name][0]["key"]
    m = re.search(r'(\n(\s*)\{\n\s*"key": "' + k + r'",.*?\n\2\})', t, re.S)
    assert m, (nid, after_name)
    ind = m.group(2)
    body = "".join(",\n" + ind + json.dumps(f, ensure_ascii=False, indent=2).replace("\n", "\n" + ind) for f in fields)
    return t[:m.end()] + body + t[m.end():]


def insert_after(t, anchor_id, node):
    a = '"id": "' + anchor_id + '"'
    assert t.count(a) == 1, anchor_id
    start = t.rfind("{", 0, t.index(a))
    depth, i, in_str, escp = 0, start, False, False
    while True:
        ch = t[i]
        if in_str:
            if escp:
                escp = False
            elif ch == "\\":
                escp = True
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
    assert json.loads(t[start:i + 1])["id"] == anchor_id
    ind = t[t.rfind("\n", 0, start) + 1:start]
    assert ind.strip() == ""
    return t[:i + 1] + ",\n" + ind + json.dumps(node, ensure_ascii=False, indent=2).replace("\n", "\n" + ind) + t[i + 1:]


def titled(n, nid, title):
    n["id"] = nid
    for k in ("title", "nodeName", "name"):
        if k in n["data"]:
            n["data"][k] = title
    return n


def unhide_update(w, template_id, nid, rows_ref, K, label):
    u = titled(copy.deepcopy(find(w, template_id)), nid, "Un-hide WRITE: the filled Packing shell(s) packing_status Created")
    u["data"]["table_id"] = {"source": "Packing:Table:1993515601863524353", "rules": {"collectionId": "1993515601863524353", "list": [
        {"id": K.num(), "parentId": K.num(), "isTop": True, "prop": "id", "operator": "in", "valueType": "field", "value": "{{" + rows_ref + ".id}}",
         "type": "leaf", "level": 1, "propLabel": "主键ID", "valueLabel": "", "operatorLabel": "In"}]}}
    u["data"]["props"] = {"modelName": "", "list": [
        {"prop": "id", "operator": "", "valueType": "field", "value": "{{" + rows_ref + ".id}}", "valueLabel": "", "propLabel": "主键ID"},
        {"prop": "packing_status", "operator": "", "valueType": "field", "value": "{{" + rows_ref + ".packing_status}}", "valueLabel": "", "propLabel": label}]}
    return u


NOTE_C = "// A save-time shell is kept hidden (" + HIDDEN + ") until something is picked: filling it makes it visible. Only the shell's\n" \
         "// status is written, and only from " + HIDDEN + ", so a Packing a packer has moved on is never reverted."

# ---------------------------------------------------------------- PICKING_BULK_COMMIT (P5)
t = open(cbase, encoding="utf-8").read()
w = json.loads(t)
assert "PCp5unhide" not in t
K = Keys(t, "packing-unhide-commit-" + HIDDEN)
t = edit_code(t, w, "code_node_PCp5build", [
    ("const updateRows = [];", "const updateRows = [];\n  const unhideRows = [];"),
    ("updateRows.push(Object.assign({ existing_packing_id: s(existing.id), gd_id: s(gdId), table_item_source: rebuilt, table_hu_source: mergedHuSource }, deliveryInfo));",
     "updateRows.push(Object.assign({ existing_packing_id: s(existing.id), gd_id: s(gdId), table_item_source: rebuilt, table_hu_source: mergedHuSource }, deliveryInfo));\n"
     "      " + NOTE_C.replace("\n", "\n      ") + "\n"
     "      if (s(existing.packing_status) === \"" + HIDDEN + "\") unhideRows.push({ id: s(existing.id), packing_status: \"Created\" });"),
    ('hasUpdates: updateRows.length ? "YES" : "NO",', 'hasUpdates: updateRows.length ? "YES" : "NO", unhideRows: unhideRows, hasUnhide: unhideRows.length ? "YES" : "NO",'),
])
w = json.loads(t)
t = add_response(t, w, "code_node_PCp5build", "hasUpdates", [K.field("unhideRows", "array", True), K.field("hasUnhide")])
w = json.loads(t)
cor = titled(copy.deepcopy(find(w, "cor_PCp5update")), "cor_PCp5unhide", "Packing shells to un-hide?")
yes, no = cor["blocks"]
yes["id"], no["id"] = "cori_YPCp5unhide", "cori_NPCp5unhide"
leaf = yes["data"]["filter"]["list"][0]
assert leaf["prop"] == "node.code_node_PCp5build.data.hasUpdates"
leaf["id"], leaf["parentId"], leaf["prop"], leaf["propLabel"] = K.num(), K.num(), "node.code_node_PCp5build.data.hasUnhide", "hasUnhide"
for k in ("title", "nodeName", "name"):
    if k in yes["data"]:
        yes["data"][k] = "YES"
p1 = [p for p in find(w, "update_node_PCp5upd")["data"]["props"]["list"]]
yes["blocks"] = [unhide_update(w, "update_node_PCp5upd", "update_node_PCp5unhide", "node:code_node_PCp5build.data.unhideRows", K, "Packing Status")]
no["blocks"] = []
t = insert_after(t, "cor_PCp5update", cor)
w2 = json.loads(t)
loop = find(w2, "loop_PCp5chunks")
ids = [b.get("id") for b in loop["blocks"]]
assert ids.index("cor_PCp5unhide") == ids.index("cor_PCp5update") + 1, ids
open(cout, "w", encoding="utf-8").write(t)

# ---------------------------------------------------------------- classic PICKING
t = open(pbase, encoding="utf-8").read()
w = json.loads(t)
assert "PkUnhide" not in t
K = Keys(t, "packing-unhide-picking-" + HIDDEN)
t = edit_code(t, w, "code_node_gudzrvMQ", [
    ("const packingsToUpdate = [];", "const packingsToUpdate = [];\nconst packingsToUnhide = [];"),
    ("      ...pickDeliveryInfo(p)\n    });\n  } else {",
     "      ...pickDeliveryInfo(p)\n    });\n    " + NOTE_C.replace("\n", "\n    ") + "\n"
     "    if (existing.packing_status === \"" + HIDDEN + "\") packingsToUnhide.push({ id: existing.id, packing_status: \"Created\" });\n  } else {"),
    ("  hasUpdates: packingsToUpdate.length > 0 ? 1 : 0,", "  hasUpdates: packingsToUpdate.length > 0 ? 1 : 0,\n  packingsToUnhide: packingsToUnhide,\n  hasUnhide: packingsToUnhide.length > 0 ? 1 : 0,"),
])
w = json.loads(t)
t = add_response(t, w, "code_node_gudzrvMQ", "hasUpdates", [K.field("packingsToUnhide", "array", True), K.field("hasUnhide", "int")])
w = json.loads(t)
iff = titled(copy.deepcopy(find(w, "if_PkUpdates")), "if_PkUnhide", "IF hasUnhide")
leaf = iff["data"]["filter"]["list"][0]
assert leaf["prop"] == "node.code_node_gudzrvMQ.data.hasUpdates"
leaf["id"], leaf["parentId"], leaf["prop"], leaf["propLabel"] = K.num(), K.num(), "node.code_node_gudzrvMQ.data.hasUnhide", "hasUnhide"
tb, fb = iff["blocks"]
tb["id"], fb["id"] = "if_PkUnhide_t", "if_PkUnhide_f"
tb["blocks"] = [unhide_update(w, "update_node_Mt4SJsF8", "update_node_PkUnhide", "node:code_node_gudzrvMQ.data.packingsToUnhide", K, "Packing Status")]
fb["blocks"] = []
t = insert_after(t, "if_PkUpdates", iff)
json.loads(t)
open(pout, "w", encoding="utf-8").write(t)
print("patched ->", cout, "and", pout, "| hidden status:", HIDDEN)
