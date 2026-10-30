"""SO list (page 1901872125787099137), By Item tab: the Sales Order form's two line actions, Linked IAs and Create IA (the user, 10-28),
opening the SO Linked IAs page for the row's line. Additive: two row actions appended to the By Item table (custom_r7tpmpsj) after
View / Edit, and their two handlers appended to the page's events (so_line_ias.js, one source). Same permissions as the form's
(so_item_linked_ias / so_item_create_ia); hidden as there (an unsaved row; Create IA on a Completed / Cancelled line or an SO not Issued /
Processing) and, as View / Edit, while the order is saved in the background. Built on the live dev v541 and prod v271 (pinned md5):
out/so_list_items_dev.json, out/so_list_items_prod.json.

usage: python3 scratchpad/iasc/so_list/patch_so_list_items.py [--write]   (SO_LIST_OUT=<dir> writes there; --patches prints the additions)"""
import copy
import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.environ.get("SO_LIST_OUT") or os.path.join(HERE, "out")
BASES = {"dev": ("so_list_dev_v541.json", "07079735dc5494b5de6dc4a00af7fb17"), "prod": ("so_list_prod_v271.json", "8db233b2d3317e5e797fe524fb16c837")}
CRUD = "custom_r7tpmpsj"
PAGE = "2112449353901772801"  # SO Linked IAs, the same id on dev and prod
SOURCE = open(os.path.join(HERE, "so_line_ias.js"), encoding="utf-8").read()
SAVED = "!(arguments[0] && arguments[0].row && arguments[0].row.id && arguments[0].row.item_name)"
BUSY = "(arguments[0].row.sales_order_id && arguments[0].row.sales_order_id.is_processing == 1)"
OPEN = ("['Completed', 'Cancelled'].indexOf(arguments[0].row.line_status) >= 0 || "
        "['Issued', 'Processing'].indexOf(arguments[0].row.sales_order_id && arguments[0].row.sales_order_id.so_status) < 0")
# title, permission, handler, key, icon, what, sc_action, hidden
ACTIONS = [
    ("Linked IAs", "so_item_linked_ias", "func_lineLinkedIas", "sl7iaq2k", "diagram-3", "its Item Assemblies and figures", "",
     "{{" + SAVED + " || " + BUSY + "}}"),
    ("Create IA", "so_item_create_ia", "func_lineCreateIa", "sc4iaw9m", "plus-square", "and creates an Item Assembly for it", "create",
     "{{" + SAVED + " || " + BUSY + " || " + OPEN + "}}"),
]


def handler(title, name, what, action):
    return (SOURCE.replace("__HANDLER_NAME__", name).replace("__ACTION_TITLE__", title).replace("__WHAT__", what)
            .replace("__SO_LINKED_IAS_PAGE__", PAGE).replace("__ACTION__", action))


def find(o, model):
    if isinstance(o, dict):
        if o.get("model") == model:
            return [o]
        return [x for v in o.values() for x in find(v, model)]
    if isinstance(o, list):
        return [x for v in o for x in find(v, model)]
    return []


def build(base):
    name, md5 = BASES[base]
    raw = open(os.path.join(HERE, "base", name), encoding="utf-8").read()
    assert hashlib.md5(raw.encode("utf-8")).hexdigest() == md5, "base/%s is not the pinned live page" % name
    page = json.loads(raw)
    hits = find(page["list"], CRUD)
    assert len(hits) == 1 and hits[0].get("el") == "su-fm-vtable-crud", CRUD
    acts = hits[0]["options"]["customProps"]["rowActions"]
    assert [a["title"] for a in acts] == ["View", "Edit"], [a["title"] for a in acts]
    events = page["config"]["eventScript"]
    for title, perm, fn, key, icon, what, action, hidden in ACTIONS:
        assert fn not in raw and key not in raw, (fn, key)
        a = copy.deepcopy(acts[0])
        a.update({"title": title, "permission": perm, "icon": icon, "events": [{"key": key, "name": fn}], "hidden": hidden})
        acts.append(a)
        events.append({"key": key, "name": fn, "type": "js", "func": handler(title, fn, what, action)})
    return page


if __name__ == "__main__":
    if "--patches" in sys.argv:
        print(json.dumps({"actions": [{"title": t, "permission": p, "handler": f, "key": k, "icon": i, "sc_action": s, "hidden": h,
                                       "func": handler(t, f, w, s)} for t, p, f, k, i, w, s, h in ACTIONS], "crud": CRUD, "page": PAGE}))
        sys.exit(0)
    for base in BASES:
        page = build(base)
        text = json.dumps(page, ensure_ascii=False, separators=(",", ":"))
        path = os.path.join(OUT, "so_list_items_%s.json" % base)
        print("%s: md5 %s%s" % (base, hashlib.md5(text.encode("utf-8")).hexdigest(), " -> " + path if "--write" in sys.argv else " (dry)"))
        if "--write" in sys.argv:
            os.makedirs(OUT, exist_ok=True)
            open(path, "w", encoding="utf-8").write(text)
