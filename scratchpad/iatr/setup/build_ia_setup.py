"""Item Assembly Setup form (RESERVED_REQUEST_PLAN.md Task 2, design D12), built from the Picking Setup form.

Template: Picking/PickingSetupFullJSON.json (the title flex, the field grid, the button flex). Kept: plant_id (hidden), organization_id
(hidden), the setup id (hidden), Cancel / Save and the platform's empty events. New: the Transfer Request switch. Dropped: every
Picking field and handler. Every widget gets a new 8-character key (md5 of its model); remoteFunc follows the key; widget events
point at the kept event-script keys, and the plant picker's Picking handler is unbound.

  python3 scratchpad/iatr/setup/build_ia_setup.py [--write]   -> Item Assembly & BOM/Setup/ItemAssemblySetup.json (page),
                                                                ItemAssemblySetupTable.json (table form), SettingPage.json (the tile)
"""
import copy
import hashlib
import json
import os
import sys

ROOT = "/Users/yunawinaya/Developer/BladeXfunctions"
TEMPLATE = os.path.join(ROOT, "Picking/PickingSetupFullJSON.json")
SRC = os.path.join(ROOT, "scratchpad/iatr/setup/src")
OUT = os.path.join(ROOT, "Item Assembly & BOM/Setup/ItemAssemblySetup.json")  # the PAGE (page 2115734457942458370)
# the TABLE form (item_assembly_setup, table 2115734409032679425): its publish creates the columns; built from Picking Setup's
# table form, pinned v25 (one grid of data-bound fields, empty events)
TABLE_TEMPLATE = os.path.join(ROOT, "scratchpad/iatr/base/rr_picking_setup_v25.json")
TABLE_OUT = os.path.join(ROOT, "Item Assembly & BOM/Setup/ItemAssemblySetupTable.json")
# the Setting page (page 1909260299874861057, pinned v87): an Item Assembly Setup tile, last in the Picking / Putaway / Packing card
SETTING_BASE = os.path.join(ROOT, "scratchpad/iatr/base/rr_SETTING_v87.json")
SETTING_OUT = os.path.join(ROOT, "Item Assembly & BOM/Setup/SettingPage.json")
SETUP_PAGE_ID = "2115734457942458370"
KEEP_EVENTS = ["onFormChange", "mounted", "refresh", "onParamUpdate", "onCommentPublish", "onCommentDelete", "onMention", "onLoad",
               "onClick_save", "onClick_cancel"]
PICKING_FIELDS_KEPT = {"plant_id", "organization_id", "picking_setup_id"}


def find(node, model):
    if isinstance(node, dict):
        if node.get("model") == model:
            return node
        for v in node.values():
            r = find(v, model)
            if r is not None:
                return r
    elif isinstance(node, list):
        for v in node:
            r = find(v, model)
            if r is not None:
                return r
    return None


def new_key(seed, prefix="iasetup|"):
    h = hashlib.md5((prefix + seed).encode("utf-8")).hexdigest()
    return "".join(c for c in h if c.isalnum())[:8]


def rekey(node, used, path="w", prefix="iasetup|"):
    if isinstance(node, list):
        for i, v in enumerate(node):
            rekey(v, used, path + "." + str(i), prefix)
        return
    if not isinstance(node, dict):
        return
    if isinstance(node.get("key"), str) and node.get("type"):
        seed = node.get("model") or path
        k = new_key(seed, prefix)
        while k in used:
            seed += "+"
            k = new_key(seed, prefix)
        used.add(k)
        old = node["key"]
        node["key"] = k
        if isinstance(node.get("model"), str) and node["model"].endswith("_" + old):
            node["model"] = node["model"][: -len(old)] + k
        opts = node.get("options")
        if isinstance(opts, dict) and "remoteFunc" in opts:
            opts["remoteFunc"] = "func_" + k
    for key, v in node.items():
        if key != "options":
            rekey(v, used, path + "." + key, prefix)


def build():
    tpl = json.load(open(TEMPLATE, encoding="utf-8"))
    form = copy.deepcopy(tpl)
    # the events: the platform's empty ones, mounted / Save from src, Cancel as in Picking Setup
    events = [e for e in form["config"]["eventScript"] if e.get("name") in KEEP_EVENTS]
    for e in events:
        if e["name"] == "mounted":
            e["func"] = open(os.path.join(SRC, "iaSetup_onMounted.js"), encoding="utf-8").read()
        elif e["name"] == "onClick_save":
            e["func"] = open(os.path.join(SRC, "iaSetup_save.js"), encoding="utf-8").read()
    form["config"]["eventScript"] = events
    form["config"]["uniqueGroup"] = []
    # the widgets
    title_flex, grid, buttons = form["list"]
    title = find(title_flex, "picking_setup_title")
    title["model"] = "ia_setup_title"
    title["name"] = "Item Assembly Setup"
    title["options"]["defaultValue"] = "Item Assembly Setup"
    col1, col2 = grid["columns"]
    switch = copy.deepcopy(find(col1, "picking_required"))
    switch["model"] = "transfer_request_enabled"
    switch["name"] = "Transfer Request"
    switch["events"] = {"onChange": ""}
    switch["options"]["defaultValue"] = 0
    switch["options"]["tip"] = "Item Assemblies can request their materials from the warehouse (Location Transfer requests)."
    plant = find(col1, "plant_id")
    plant["events"] = dict(plant.get("events") or {}, onChange="")
    org = find(col1, "organization_id")
    col1["list"] = [plant, switch, org]
    setup_id = find(col2, "picking_setup_id")
    setup_id["model"] = "item_assembly_setup_id"
    setup_id["name"] = "Item Assembly Setup ID"
    col2["list"] = [setup_id]
    rekey(form["list"], set())
    return form


def build_table():
    tpl = json.load(open(TABLE_TEMPLATE, encoding="utf-8"))
    form = copy.deepcopy(tpl)
    grid = form["list"][0]
    col1 = grid["columns"][0]
    switch = copy.deepcopy(find(col1, "picking_required"))
    switch["model"] = "transfer_request_enabled"
    switch["name"] = "Transfer Request"
    switch["events"] = {"onChange": ""}
    switch["options"]["defaultValue"] = 0
    plant = find(col1, "plant_id")
    plant["events"] = {k: "" for k in (plant.get("events") or {})}
    org = find(col1, "organization_id")
    col1["list"] = [plant, switch, org]
    for c in grid["columns"][1:]:
        c["list"] = []
    form["config"]["uniqueGroup"] = []
    rekey(form["list"], set(), prefix="iasetup-table|")
    return form


def build_setting():
    page = json.load(open(SETTING_BASE, encoding="utf-8"))
    used = set()

    def collect(n):
        if isinstance(n, dict):
            if isinstance(n.get("key"), str) and n.get("type"):
                used.add(n["key"])
            for v in n.values():
                collect(v)
        elif isinstance(n, list):
            for v in n:
                collect(v)
    collect(page["list"])
    used.update(e["key"] for e in page["config"]["eventScript"])

    def key(seed):
        k = new_key(seed, "iasetup-setting|")
        while k in used:
            seed += "+"
            k = new_key(seed, "iasetup-setting|")
        used.add(k)
        return k
    row = find_key(page["list"], "ndvvfxls")
    picking = find_key(row, "zztobtae")
    ev_picking = [e for e in page["config"]["eventScript"] if e["key"] == picking["events"]["onClick"]][0]
    tile = copy.deepcopy(picking)
    card = tile["list"][0]
    k_tile, k_card, k_ev = key("tile"), key("card"), key("event")
    tile.update(key=k_tile, model="flex_" + k_tile, events={"onClick": k_ev})
    tile["options"].update(remoteFunc="func_" + k_tile, remoteOption="option_" + k_tile)
    card.update(key=k_card, model="html_" + k_card)
    card["options"].update(remoteFunc="func_" + k_card, remoteOption="option_" + k_card)
    html = card["options"]["defaultValue"]
    assert html.count("lucide/scan-barcode.svg") == 1 and html.count("<p>Picking Setup</p>") == 1
    card["options"]["defaultValue"] = html.replace("lucide/scan-barcode.svg", "lucide/boxes.svg").replace("<p>Picking Setup</p>", "<p>Item Assembly Setup</p>")
    func = ev_picking["func"]
    assert func.count('"1935615059287412738"') == 1 and func.count('"Picking Setup"') == 1
    func = func.replace('"1935615059287412738"', '"' + SETUP_PAGE_ID + '"').replace('"Picking Setup"', '"Item Assembly Setup"')
    row["list"].append(tile)
    page["config"]["eventScript"].append({"key": k_ev, "name": "onClick_item_assembly_setup", "func": func, "type": "js"})
    return page


def find_key(node, key):
    if isinstance(node, dict):
        if node.get("key") == key:
            return node
        for v in node.values():
            r = find_key(v, key)
            if r is not None:
                return r
    elif isinstance(node, list):
        for v in node:
            r = find_key(v, key)
            if r is not None:
                return r
    return None


def main():
    setting = json.dumps(build_setting(), ensure_ascii=False, separators=(",", ":"))
    if "--write" in sys.argv:
        open(SETTING_OUT, "w", encoding="utf-8").write(setting)
        print("wrote " + SETTING_OUT)
    table = build_table()
    ttext = json.dumps(table, ensure_ascii=False, indent=1) + "\n"
    if "--write" in sys.argv:
        os.makedirs(os.path.dirname(TABLE_OUT), exist_ok=True)
        open(TABLE_OUT, "w", encoding="utf-8").write(ttext)
        print("wrote " + TABLE_OUT)
    form = build()
    text = json.dumps(form, ensure_ascii=False, indent=1) + "\n"
    if "--write" in sys.argv:
        os.makedirs(os.path.dirname(OUT), exist_ok=True)
        open(OUT, "w", encoding="utf-8").write(text)
        print("wrote " + OUT)
    else:
        print("built %d bytes (pass --write to save)" % len(text))


if __name__ == "__main__":
    main()
