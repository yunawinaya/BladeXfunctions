"""Small Cycle SO side (scratchpad/iasc/CONTRACT.md section 10):
  SOform.json           = the live dev SO form v1240 (base/so_form_v1240.json, pinned md5) + two table_so row actions (Linked
                          IAs, Create IA; custom, permission keys so_item_linked_ias / so_item_create_ia) + their two handlers.
                          Additive only: everything else byte-identical (asserted; the form is a human developer's and the GD
                          sessions', so the base is re-checked against dev before any upload).
  SOLinkedIAsPage.json  = the new "SO Linked IAs" page: a summary, the line's IAs, the SO's IAs whose line was removed, Create IA /
                          Refresh / Close; its config = the page shell as the designer created it (dev 2112449353901772801,
                          base/page_so_linked_ias_shell.json), its widgets from the IA form v36 templates.
  python3 build_so_sc.py [--write]        previews -> so/out/ (ids.json as they are)
  python3 build_so_sc.py --write-repo     -> "Item Assembly & BOM/SmallCycle/" (refused while ids.json holds "0")
  SC_IDS=<ids.json> SC_SO_OUT=<dir> SC_SO_SRC=<dir>                       (tests / mutants)
"""
import copy
import hashlib
import json
import os
import random
import re
import string
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
IASC = os.path.dirname(HERE)
ROOT = os.path.abspath(os.path.join(IASC, "..", ".."))
sys.path.insert(0, os.path.join(IASC, "..", "iav2", "lib"))
from fmt import render  # noqa: E402

SO_BASE = os.path.join(IASC, "base", "so_form_v1240.json")
SO_MD5 = "a716b1b88b149ab0742ca4891df083ae"
PAGE_TPL = os.path.join(IASC, "base", "page_so_linked_ias_shell.json")
PAGE_MD5 = "697f7c1eb3f80db18bce40d899b1fe8d"
PAGE_LIFE = ["onFormChange", "mounted", "refresh", "onParamUpdate", "onBeforeAdd", "onAfterAdd", "onBeforeUpdate", "onAfterUpdate", "onCommentPublish",
             "onCommentDelete", "onMention", "onLoad"]
IA_FORM = os.path.join(IASC, "base", "ia_form_v36.json")
IA_MD5 = "3fd73ecbf835c0db1b729b76a19519e3"
SRC = os.environ.get("SC_SO_SRC") or os.path.join(HERE, "src")
IDS_FILE = os.environ.get("SC_IDS") or os.path.join(IASC, "ids.json")
OUT = os.environ.get("SC_SO_OUT") or os.path.join(HERE, "out")
OUT_REPO = os.path.join(ROOT, "Item Assembly & BOM", "SmallCycle")
SEED = 20261021
VIEW_INFO = "View Info"
PAGE_PARAMS = [("so_id", "SO ID"), ("so_line_id", "SO Line ID"), ("item_id", "Item ID"), ("organization_id", "Organization ID"), ("sc_action", "Action")]
# the summary (sli_summary, as the IA form's Sales Order Link section): one read-only text per fact (the SO form's delivery_method_text).
# SUMMARY_ROWS = the creation order (the rows of the live v3 first, so they keep their keys); SUMMARY_LAYOUT = the line left, the
# production right, the warnings full width; the key rows bold, the warnings (no label) in the app's error style
SUMMARY_ROWS = [("sli_summary_so", "Sales Order"), ("sli_summary_ordered", "Ordered"), ("sli_summary_planned", "Planned"), ("sli_summary_produced", "Produced"),
                ("sli_summary_open", "In Progress"), ("sli_summary_suggest", "Remaining to Plan"), ("sli_summary_warn", "Warnings"),
                ("sli_summary_customer", "Customer"), ("sli_summary_item", "Item"), ("sli_summary_delivered", "Delivered")]
SUMMARY_LAYOUT = [(12, ["sli_summary_so", "sli_summary_customer", "sli_summary_item", "sli_summary_ordered", "sli_summary_delivered"]),
                  (12, ["sli_summary_planned", "sli_summary_produced", "sli_summary_open", "sli_summary_suggest"]), (24, ["sli_summary_warn"])]
SUMMARY_CLASS = {"sli_summary_so": "font-bold", "sli_summary_suggest": "font-bold", "sli_summary_warn": "error-msg"}
TEXT_TPL = os.path.join(IASC, "client", "tpl", "text_so_delivery_method.json")
# UI-01 (BA handoff): the IA form's words; Output to Receive (an open IA's quantity) draws its key from rkeys, after every earlier
# draw, so the other columns keep theirs
PAGE_COLS = [("ia_no", "Item Assembly", "in"), ("status", "Status", "in"), ("mode", "BOM Mode", "in"), ("planned", "Planned Output", "num"),
             ("to_receive", "Output to Receive", "num-r"), ("actual", "Actual Received", "num"), ("uom", "UOM", "in"), ("counted", "Counted As", "in"),
             ("ia_id", "IA ID", "hid"), ("open", "Open", "link")]


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def pinned(path, md5):
    raw = read(path)
    assert hashlib.md5(raw.encode("utf-8")).hexdigest() == md5, path + " is not the pinned base"
    return raw


def ids():
    d = json.load(open(IDS_FILE, encoding="utf-8"))
    out = {k: str(d[k]) for k in ("SO_IA_PROJECTION", "SO_LINKED_IAS_PAGE", "IA_FORM_TABLE")}
    assert all(re.fullmatch(r"[0-9]{1,20}", v) for v in out.values()), out
    return out


def fill(text, c):
    for k, v in c.items():
        text = text.replace("__%s__" % k, v)
    left = re.findall(r"__[A-Z][A-Z0-9_]*__", text)
    assert not left, left
    assert "{{" not in text, "platform token"
    return text


def find(n, model):
    if isinstance(n, dict):
        if n.get("model") == model and "type" in n:
            return n
        for v in n.values():
            r = find(v, model)
            if r:
                return r
    elif isinstance(n, list):
        for v in n:
            r = find(v, model)
            if r:
                return r
    return None


class Keys:
    def __init__(self, text, seed=SEED):
        self.taken = set(re.findall(r"[a-z0-9]{8}", text))
        self.rng = random.Random(seed)

    def new(self):
        while True:
            k = "".join(self.rng.choice(string.ascii_lowercase + string.digits) for _ in range(8))
            if k not in self.taken and not k[0].isdigit():
                self.taken.add(k)
                return k


def build_so(c):
    raw = pinned(SO_BASE, SO_MD5)
    form = json.loads(raw)
    keys = Keys(raw)
    table = find(form["list"], "table_so")
    ra = table["options"]["rowActions"]
    assert [a["title"] for a in ra] == ["Delete", VIEW_INFO], [a["title"] for a in ra]
    tpl = ra[1]
    assert tpl["type"] == "custom" and tpl["ignoreFormDisabled"] is True and len(tpl["events"]) == 1
    names = {e["name"] for e in form["config"]["eventScript"]}
    mirrors = {}
    actions = json.load(open(os.path.join(SRC, "so_actions.json"), encoding="utf-8"))["actions"]
    for x in actions:
        title, perm, name, icon, what, action, hidden = (x[k] for k in ("title", "permission", "handler", "icon", "what", "sc_action", "hidden"))
        assert hidden.startswith("{{") and hidden.endswith("}}") and hidden.count("{{") == 1, title
        assert name not in names
        func = fill(read(os.path.join(SRC, "so_open_page.js")), dict(c, HANDLER_NAME=name, ACTION_TITLE=title, WHAT=what, ACTION=action))
        k = keys.new()
        form["config"]["eventScript"].append({"key": k, "name": name, "func": func, "type": "js"})
        a = copy.deepcopy(tpl)
        a.update({"title": title, "permission": perm, "icon": icon, "events": [{"key": k, "name": name}], "hidden": hidden, "disabled": "", "ignoreFormDisabled": True})
        ra.append(a)
        mirrors["so_" + name] = func
    # additive only: undo -> the base
    undo = copy.deepcopy(form)
    find(undo["list"], "table_so")["options"]["rowActions"] = ra[:2]
    undo["config"]["eventScript"] = undo["config"]["eventScript"][:-len(actions)]
    assert json.dumps(undo, sort_keys=True) == json.dumps(json.loads(raw), sort_keys=True)
    return form, mirrors


def build_page(c):
    page_tpl = json.loads(pinned(PAGE_TPL, PAGE_MD5))
    ia = json.loads(pinned(IA_FORM, IA_MD5))
    keys = Keys(json.dumps(page_tpl) + json.dumps(ia))
    # the summary rows draw their own keys, so every widget the live v2 has keeps its key
    rkeys = Keys(json.dumps(page_tpl) + json.dumps(ia), SEED + 1)
    text_tpl = json.load(open(TEXT_TPL, encoding="utf-8"))
    assert (text_tpl["type"], text_tpl["group"], text_tpl["options"]["dataBind"], text_tpl["events"]) == ("text", "View", False, {"onChange": ""})
    T = {m: find(ia["list"], m) for m in ("remarks", "button_draft", "flex_t6y2yh5r", "table_hu", "grid_x46134mc")}
    col = {x["model"]: x for x in T["table_hu"]["tableColumns"]}
    link = [x for x in find(ia["list"], "stock_movement")["tableColumns"] if x["model"] == "transfer_stock"][0]

    def w(tpl, model, name, gen=None, **opts):
        x = copy.deepcopy(tpl)
        k = (gen or keys).new()
        x.update({"key": k, "model": model, "name": name})
        x["options"]["remoteFunc"] = "func_" + k
        x["options"]["remoteOption"] = "option_" + k
        x["options"].update(opts)
        if isinstance(x.get("events"), dict):
            x["events"] = {e: "" for e in x["events"]}
        return x

    def table(model, name):
        cols = []
        for m, label, kind in PAGE_COLS:
            if kind in ("num", "num-r"):
                cols.append(w(col["item_quantity"], m, label, gen=rkeys if kind == "num-r" else None))
            elif kind == "link":
                cols.append(w(link, m, label, linkName="Open"))
            else:
                cols.append(w(col["handling_no"], m, label, hidden=(kind == "hid")))
        # as tall as its rows (the user, 10-29: fixed = a 400px box, so the buttons needed a scroll)
        t = w(T["table_hu"], model, name, isAdd=False, isDelete=False, paging=True, pageSize=10, hideLabel=False, tableHeightMode="auto", virtualTable=False)
        t["tableColumns"] = cols
        return t

    rows = {m: w(text_tpl, m, label, gen=rkeys, hidden=True, defaultValue="", customClass=SUMMARY_CLASS.get(m, ""), hideLabel=m == "sli_summary_warn", color="")
            for m, label in SUMMARY_ROWS}
    # hidden since the figure tiles (10-29): its rows are still filled, so un-hiding it brings the labelled view back
    summary = w({k: v for k, v in T["grid_x46134mc"].items() if k != "columns"}, "sli_summary", "Sales Order Line", hidden=True)
    col_tpl = {k: v for k, v in T["grid_x46134mc"]["columns"][0].items() if k != "list"}
    summary["columns"] = []
    for span, ms in SUMMARY_LAYOUT:
        column = copy.deepcopy(col_tpl)
        column["key"] = rkeys.new()
        column["options"].update({"span": span, "xs": 24, "sm": span, "md": span, "lg": span, "xl": span})
        column["list"] = [rows[m] for m in ms]
        summary["columns"].append(column)
    ias = table("sli_ias", "Item Assemblies of this line")
    orphans = table("sli_orphans", "Item Assemblies of this Sales Order whose line was removed")
    orphans["options"]["hidden"] = True
    buttons = []
    for model, label, kind in (("sli_btn_create", "Create Item Assembly", "primary"), ("sli_btn_refresh", "Refresh", "info"), ("sli_btn_close", "Close", "info")):
        b = w(T["button_draft"], model, label, hidden=(model == "sli_btn_create"), buttonName=label, buttonType=kind, buttonPlain=True, customClass="marginright")
        b["options"].pop("permission", None)
        buttons.append(b)
    # the buttons' own gap (the user, 10-29: they touched - "marginright" spaces them only inside the IA form's fixbutton bar)
    actions = w(T["flex_t6y2yh5r"], "sli_actions", "Actions", hidden=False, customClass="", justifyContent="flex-end", alignItems="center", hGap="8px")
    actions["list"] = buttons
    page = {"list": [summary, ias, orphans, actions], "config": copy.deepcopy(page_tpl["config"])}
    cfg = page["config"]
    cfg["params"] = [{"key": keys.new(), "name": n, "title": t, "description": "", "bsonType": "string", "isExpand": False} for n, t in PAGE_PARAMS]
    life = [e for e in cfg["eventScript"] if e["key"] == e["name"]]
    assert [e["name"] for e in life] == PAGE_LIFE and len(life) == len(cfg["eventScript"]) and page_tpl["list"] == [], [e["name"] for e in life]
    by = {e["name"]: e for e in life}
    by["mounted"].update({"type": "js", "func": '// SO Linked IAs page (Small Cycle): the figures, and on "Create IA" the Item Assembly form\n'
                          'this.triggerEvent("sli_load", { action: this.getParamsVariables("sc_action") });\n'})
    by["refresh"].update({"type": "js", "func": "// the page refreshed (an Item Assembly saved from it): the figures again\nthis.triggerEvent(\"sli_load\", {});\n"})
    mirrors = {}
    events = [("sli_load", fill(read(os.path.join(SRC, "sli_load.js")), c)),
              ("sli_onClick_create", "// Create Item Assembly: the figures read again, the IA form opened only on an eligible line\nthis.triggerEvent(\"sli_load\", { action: \"create\" });\n"),
              ("sli_onClick_refresh", "// Refresh\nthis.triggerEvent(\"sli_load\", {});\n"),
              ("sli_onClick_close", "// Close\nthis.parentGenerateForm.$refs.SuPageDialogRef.hide();\n"),
              ("sli_onClick_open", fill(read(os.path.join(SRC, "sli_open.js")), dict(c, HANDLER_NAME="sli_onClick_open", TABLE="the line's IAs"))),
              ("sli_onClick_openOrphan", fill(read(os.path.join(SRC, "sli_open.js")), dict(c, HANDLER_NAME="sli_onClick_openOrphan", TABLE="the IAs whose line was removed")))]
    keyed = {}
    cfg["eventScript"] = life
    for name, func in events:
        k = keys.new()
        cfg["eventScript"].append({"key": k, "name": name, "func": func, "type": "js"})
        keyed[name] = k
        mirrors["page_" + name] = func
    mirrors["page_mounted"] = by["mounted"]["func"]
    mirrors["page_refresh"] = by["refresh"]["func"]
    for b, name in zip(buttons, ("sli_onClick_create", "sli_onClick_refresh", "sli_onClick_close")):
        assert b["events"] == {"onClick": ""}
        b["events"]["onClick"] = keyed[name]
    for t, name in ((ias, "sli_onClick_open"), (orphans, "sli_onClick_openOrphan")):
        o = [x for x in t["tableColumns"] if x["model"] == "open"][0]
        o["events"]["onClick"] = keyed[name]
    # Select Plant (the user, 10-28: an organisation-level Sales Order picks the plant first, as SO -> GD): the IA form's own dialog and
    # plant widgets; keys from their own stream, drawn last, so every widget and event of the live page keeps its key
    dkeys = Keys(json.dumps(page_tpl) + json.dumps(ia), SEED + 2)
    note = w(text_tpl, "sli_plant_note", "Note", gen=dkeys, hidden=False, defaultValue="Please select a plant to create the item assembly.", customClass="",
             hideLabel=True, color="")
    plant = w(find(ia["list"], "issuing_operation_faci"), "sli_plant_id", "Plant", gen=dkeys, dataBind=False, required=False, hidden=False, disabled=False,
              defaultValue="")
    plant["rules"] = []
    dialog = w(find(ia["list"], "sm_item_balance"), "sli_plant_dialog", "Select Plant", gen=dkeys, title="Select Plant", width="")
    dialog["list"] = [note, plant]
    page["list"].append(dialog)
    for name, func in (("sli_onConfirm_plant", read(os.path.join(SRC, "sli_plant.js"))),
                       ("sli_onCancel_plant", "// Select Plant cancelled\nthis.closeDialog(\"sli_plant_dialog\");\n")):
        k = dkeys.new()
        cfg["eventScript"].append({"key": k, "name": name, "func": func, "type": "js"})
        keyed[name] = k
        mirrors["page_" + name] = func
    assert set(dialog["events"]) == {"onCancel", "onConfirm"}, dialog["events"]
    dialog["events"].update({"onConfirm": keyed["sli_onConfirm_plant"], "onCancel": keyed["sli_onCancel_plant"]})
    # the figure tiles (the user, 10-29): one html display on top, filled by sli_load; the IA form's html status widget, its own key stream
    tkeys = Keys(json.dumps(page_tpl) + json.dumps(ia), SEED + 3)
    tiles = w(find(ia["list"], "draft_status"), "sli_summary_html", "Summary", gen=tkeys, defaultValue="", hidden=False, hideLabel=True, dataBind=True)
    page["list"].insert(0, tiles)
    return page, mirrors


def main():
    wf = ids()
    c = {"SO_IA_PROJECTION": wf["SO_IA_PROJECTION"], "SO_LINKED_IAS_PAGE": wf["SO_LINKED_IAS_PAGE"], "IA_FORM_TABLE": wf["IA_FORM_TABLE"]}
    so, m1 = build_so(c)
    page, m2 = build_page(c)
    print("SO form: +%d row actions and events; page: %d widgets, %d events" % (len(m1), len(page["list"]), len(page["config"]["eventScript"])))
    targets = []
    if "--write" in sys.argv:
        targets.append(OUT)
    if "--write-repo" in sys.argv:
        assert all(re.fullmatch(r"[1-9][0-9]{0,19}", wf[k]) for k in ("SO_IA_PROJECTION", "SO_LINKED_IAS_PAGE")), ("--write-repo needs the real ids in ids.json", wf)
        targets.append(OUT_REPO)
    for out in targets:
        os.makedirs(out, exist_ok=True)
        for name, obj in (("SOform.json", so), ("SOLinkedIAsPage.json", page)):
            text = render(obj, "indent")
            assert json.loads(text) == obj
            open(os.path.join(out, name), "w", encoding="utf-8").write(text)
        for name, func in list(m1.items()) + list(m2.items()):
            open(os.path.join(out, name + ".js"), "w", encoding="utf-8").write(func)
        print("wrote", out)


if __name__ == "__main__":
    main()
