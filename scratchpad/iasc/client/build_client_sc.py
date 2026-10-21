"""Small Cycle IA form client (scratchpad/iasc/CONTRACT.md section 9), built from the live dev form v36 (base/ia_form_v36.json,
pinned md5; = the IA V2 ON publish of 2026-10-19).

OFF = v36 + the new widgets, every one hidden, no event bound to them, no handler changed (the first publish: creates the
      columns). ON = OFF + `sc_main` and its forwarders bound to the new widgets + the patched v36 handlers:
      onChange_assembledItem / onChange_itemQty (prologue), onChange_Plant (epilogue), mounted (block + one call), the four
      confirmBomVariance copies (v36 body renamed, Small Cycle wrapper after it) and IA_NOT_RECORD of the two IA V2 handlers;
      and the UI-01 layout (BA handoff): the header fields regrouped into stacked sections, Quantity labelled Output to Receive.
Every patched handler is asserted to be its pinned v36 text plus exactly those insertions.

  python3 build_client_sc.py [--write]          OFF -> client/out/off/ (the rollback build); ON preview -> client/out/on/
  python3 build_client_sc.py --on --write       the same + ON -> "Item Assembly & BOM/SmallCycle/" (= dev since v38; refused while ids.json holds "0")
  SC_IDS=<ids.json> SC_OUT_DIR=<dir> SC_SRC=<dir> SC_CODE=<dir> python3 build_client_sc.py --write   (tests / mutants: elsewhere)
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

BASE = os.path.join(IASC, "base", "ia_form_v36.json")
BASE_MD5 = "3fd73ecbf835c0db1b729b76a19519e3"
RADIO_TPL = os.path.join(HERE, "tpl", "radio_msi_type.json")
TEXT_TPL = os.path.join(HERE, "tpl", "text_so_delivery_method.json")  # the SO form's delivery_method_text (v1240): a display-only text set by setData
COLLAPSE_TPL = os.path.join(HERE, "tpl", "collapse_so_basic_info.json")  # the SO form's "Basic Info" section (v1240)
SRC = os.environ.get("SC_SRC") or os.path.join(HERE, "src")
CODE = os.environ.get("SC_CODE") or os.path.join(IASC, "code")
IDS_FILE = os.environ.get("SC_IDS") or os.path.join(IASC, "ids.json")
OUT_REPO = os.environ.get("SC_OUT_DIR") or os.path.join(ROOT, "Item Assembly & BOM", "SmallCycle")
OUT_CLIENT = os.path.join(os.environ["SC_OUT_DIR"], "client_out") if os.environ.get("SC_OUT_DIR") else os.path.join(HERE, "out")
SEED = 20261020
PRO_START = "// Small Cycle (scratchpad/iasc):"
PRO_END = "// -- end Small Cycle --\n"

# the v36 handlers this build changes, pinned (the build stops if dev moved)
PINS = {
    "wv07g9xe": "12af7da6f921d0aa181e5c588f4185c466a84a55e23ff02acc7eed16f484cb57",  # onChange_assembledItem
    "iaqty01x": "4864efbb0078b3dcafbf2ccd2274cf3218bc2fdacca820b93000963493b88ef2",  # onChange_itemQty
    "fgivan7v": "0bb9605852cf927f14d3cd81f0a9b8003b32d104addd77ed8f13e0f05cab4e69",  # onChange_Plant
    "mounted": "fd3dfa46e447dead13097a6c34a2125627bf762ef2088b500c0e3340270428bb",
    "iasvcomp": "0335abbe2ca89b8a44ec073553f192a9842e16b807e95b7840f48f3f5482d8cc",  # onClick_saveAsCompleted
    "aymq6q8z": "985f52a223982a21c3435bd826a72b70b85504ddbde2a67fe5f413e13f421639",  # onClick_saveAsCompletedPost
    "uhn48srb": "afc2ad4790dca22dc29ae12a3c9185fc0aefa7bf80173dfa52f3a8ffda36931c",  # iaV2_onClick_completed
    "wia8s2r9": "828ddf446064f6cc909e6ad9a697b83f3f18a8366c53debf90322e9b1ff406e3",  # iaV2_onClick_completed_post
    "iasvdrft": "26f315ae52ff41fd0405ac2add9b44cd9b0177476a014191fef2e358f81a299d",  # onClick_saveAsDraft (RES-01)
    "iacqty01": "1e79dadc94d5b69e1bfebe246d020d7acb86f955e643c896de58afde9fef1628",  # onChange_componentQty (RES-01)
}
# a rule event: its js action's func, pinned the same way
RULE_PINS = {"evhzkk8e": "b9ebf784c77d78cea006b6e6d15cade3e07c19b41d5f32194c71ac00a4cd0ad9"}  # onClick_select_stock (RES-01)
# RES-01 raw-material holds (scratchpad/iasc/res01/RES01_PLAN.md): the client switch, shipped off with IA_SAVE's own
RES_ENABLED = False
# the Draft handler starts the reservation once IA_SAVE answered (user 10-21: never inside the save)
DRAFT_DONE = '    this.$message.success("Item Assembly saved as draft");\n    this.hideLoading();\n    closeDialog();\n'
DRAFT_HOLD = '    this.$message.success("Item Assembly saved as draft");\n    await resHoldAfterSave(workflowResult.data, data);\n    this.hideLoading();\n    closeDialog();\n'
VARIANCE = ["iasvcomp", "aymq6q8z", "uhn48srb", "wia8s2r9"]
NOT_RECORD = ["uhn48srb", "wia8s2r9"]
VARIANCE_START = "// The BOM seeds the component table"
VARIANCE_HEAD = "const confirmBomVariance = async (data) => {"
VARIANCE_RENAMED = "const scBaseConfirmBomVariance = async (data) => {"
EXPLODE_HELPERS_END = "// The BOM is a template: once the table has been edited away from what the last"
# the two IA V2 handlers (bladexfunctions-8c, 10-21): a double click on Complete & Post started a twin flow on the same job key
# and both posted on COMPLETED; src/v2_double_patch.json (also read by test_sc_json.js) claims the click before its first await
# and posts a job once while still unposted
DOUBLE = [(p["was"], p["now"]) for p in json.load(open(os.path.join(SRC, "v2_double_patch.json"), encoding="utf-8"))["patch"]]
MOUNT_ANCHOR = '(async () => {\n  try {\n    let pageStatus = "";\n'
MOUNT_CALL_AFTER = "    iaBackgroundView(pageStatus, status);\n"
MOUNT_CALL = "    scMount(pageStatus, status);\n"
NOT_RECORD_TAIL = '"item_assembly_tittle"];'

# forwarders: handler name -> (comment, the op object after scOp)
FORWARDERS = [
    ("sc_onChange_mode", "BOM Mode changed", '{ scOp: "MODE", value: arguments[0] && arguments[0].value }'),
    ("sc_onChange_planned", "Planned Output Qty changed", '{ scOp: "PLANNED", value: arguments[0] && arguments[0].value }'),
    ("sc_onClick_line", "Select SO Line", '{ scOp: "SELECT_LINE" }'),
    ("sc_onClick_unlink", "Unlink", '{ scOp: "UNLINK" }'),
    ("sc_onClick_relink", "Re-link (a Completed Item Assembly whose line is gone)", '{ scOp: "RELINK" }'),
    ("sc_onClick_suggest", "Use Suggested Qty", '{ scOp: "SUGGEST" }'),
    ("sc_onClick_bom", "Prepare BOM", '{ scOp: "BOM" }'),
    ("sc_onClick_refresh", "Refresh Figures", '{ scOp: "REFRESH" }'),
    ("sc_onClick_expandAll", "Expand All in the Flat dialog", '{ scOp: "EXPAND_ALL" }'),
    ("sc_onClick_pickLine", "Select on a line of the Select SO Line dialog",
     '{ scOp: "PICK_LINE", rowIndex: arguments[0] && arguments[0].rowIndex, row: arguments[0] && arguments[0].row }'),
    ("sc_onCancel_line", "Select SO Line dialog closed", '{ scOp: "LINE_CLOSE" }'),
    ("sc_onCancel_expand", "Flat dialog cancelled", '{ scOp: "EXPAND_CLOSE" }'),
    ("sc_onConfirm_expand", "Flat dialog confirmed", '{ scOp: "EXPAND_OK" }'),
]
BIND = {  # widget model -> (event, forwarder)
    "bom_consumption_mode": ("onChange", "sc_onChange_mode"), "planned_output_qty": ("onChange", "sc_onChange_planned"),
    "sc_btn_line": ("onClick", "sc_onClick_line"), "sc_btn_unlink": ("onClick", "sc_onClick_unlink"), "sc_btn_relink": ("onClick", "sc_onClick_relink"),
    "sc_btn_suggest": ("onClick", "sc_onClick_suggest"), "sc_btn_bom": ("onClick", "sc_onClick_bom"), "sc_btn_refresh": ("onClick", "sc_onClick_refresh"),
    "sc_expand_all": ("onClick", "sc_onClick_expandAll"),
}
DIALOG_BIND = {"sc_line_dialog": {"onCancel": "sc_onCancel_line"}, "sc_expand_dialog": {"onCancel": "sc_onCancel_expand", "onConfirm": "sc_onConfirm_expand"}}
# the Sales Order Link section (sc_section > sc_collapse > sc_info + sc_actions): one read-only text per fact. ROWS = the creation
# order (the rows of the live v39 first, so they keep their keys); LAYOUT = the line left, the production right, the rest full width
ROWS = [("sc_info_so", "Sales Order"), ("sc_info_ordered", "Ordered"), ("sc_info_produced", "Produced"), ("sc_info_open", "In Progress"),
        ("sc_info_suggest", "Remaining to Plan"), ("sc_info_cover", "After This IA"), ("sc_info_bom", "BOM"), ("sc_info_warn", "Warnings"),
        ("sc_info_customer", "Customer"), ("sc_info_delivered", "Delivered"), ("sc_info_over", "Over the Order")]
LAYOUT = [(12, ["sc_info_so", "sc_info_customer", "sc_info_ordered", "sc_info_delivered"]), (12, ["sc_info_produced", "sc_info_open", "sc_info_suggest", "sc_info_cover"]),
          (24, ["sc_info_bom", "sc_info_over", "sc_info_warn"])]
# the Flat dialog's note (BA handoff FIX-04: a tick is item-wide)
EXPAND_NOTE = ("Tick a sub-assembly to make it from its own components in this Item Assembly. A tick applies to every place the item is used "
               "(see Used).")
# the key rows bold, the two messages (no label) in the app's error style (the Item form's error_msg)
ROW_CLASS = {"sc_info_so": "font-bold", "sc_info_suggest": "font-bold", "sc_info_over": "error-msg", "sc_info_warn": "error-msg"}
MESSAGE_ROWS = ("sc_info_over", "sc_info_warn")
# UI-01 (BA handoff), ON only: the header keeps the plant (changing it clears the materials, so it is chosen first), the number, the
# date and Issued By; stacked collapse sections take the other header fields. (model, title, collapsed, grid model, [(span, models)],
# placed after this top-level widget)
SECTIONS = [
    ("sc_sec_production", "Production", False, "sc_prod_grid", [(12, ["item_id", "item_name", "item_desc", "bom_consumption_mode"]),
     (12, ["planned_output_qty", "item_qty", "sc_actual", "item_uom"]), (24, ["sc_info_bom", "sc_prod_actions"])], "grid_x46134mc"),
    ("sc_sec_output", "Output Location", False, "sc_output_grid", [(12, ["storage_location_id", "inventory_category", "manufacturing_date"]),
     (12, ["location_id", "batch_no", "expired_date"])], "sc_section"),
    ("sc_sec_more", "Additional Details", True, "sc_more_grid", [(12, ["project_id", "reference_documents"]), (12, ["remarks", "remarks_2", "remarks_3"])], "bom_tab"),
]
HEADER = [["issuing_operation_faci", "serial_flex_wrapper_6b2xyt4c"], ["item_assembly_date", "issued_by"]]
# FIX-05 (BA handoff), ON only: the platform's per-field change history (who, when, the new value; every save path) for the IA's link,
# plan, output, mode, BOM, snapshot, item and status; the material lines are not tracked one by one (big saves stay fast)
SC_HISTORY = ["source_so_id", "source_so_line_id", "source_so_context_json", "planned_output_qty", "item_qty", "bom_consumption_mode", "source_bom_id",
              "bom_snapshot_json", "item_id", "item_assembly_status", "posted_status", "material_hold_status"]
UI01_TOP = ["sc_sec_production", "sc_prod_grid", "sc_sec_output", "sc_output_grid", "sc_sec_more", "sc_more_grid", "sc_actual", "sc_prod_actions"]
UI_TOP = (["sc_section", "sc_collapse", "sc_info"] + [m for m, _ in ROWS] + ["sc_actions", "sc_btn_line", "sc_btn_unlink", "sc_btn_relink", "sc_btn_suggest", "sc_btn_bom",
          "sc_btn_refresh", "sc_line_dialog", "sc_expand_dialog"] + UI01_TOP)


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def sha(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def ids():
    d = json.load(open(IDS_FILE, encoding="utf-8"))
    out = {k: str(d[k]) for k in ("SO_IA_PROJECTION", "IA_SC_RELINK", "IA_HOLD")}
    assert all(re.fullmatch(r"[0-9]{1,20}", v) for v in out.values()), out
    return out


def find(n, model, key=None):
    """(the widget with this model [and key], the list holding it)"""
    def walk(x, holder):
        if isinstance(x, dict):
            if x.get("model") == model and (key is None or x.get("key") == key) and "type" in x:
                return x, holder
            for v in x.values():
                r = walk(v, x if isinstance(v, list) else holder)
                if r:
                    return r
        elif isinstance(x, list):
            for v in x:
                r = walk(v, x)
                if r:
                    return r
        return None
    return walk(n, None)


def by_key(doc):
    return {e["key"]: e for e in doc["config"]["eventScript"]}


def js(name):
    """a client source with its __PLACEHOLDERS__ left for fill()"""
    return read(os.path.join(SRC, name))


def shared(name, only=None):
    """code/shared/<name> without its module.exports line; `only` = the top-level const statements to keep, in file order"""
    text = read(os.path.join(CODE, "shared", name))
    lines = [ln for ln in text.split("\n") if not ln.startswith("if (typeof module")]
    assert len(lines) == len(text.split("\n")) - 1, name + ": one module.exports line"
    if not only:
        return "\n".join(lines).rstrip()
    units, cur, order = {}, None, []
    for ln in lines:
        m = re.match(r"^const (\w+)\s*=", ln)
        if m:
            cur = m.group(1)
            units[cur] = [ln]
            order.append(cur)
        elif ln.startswith("//") or not ln.strip():
            cur = None
        elif cur:
            units[cur].append(ln)
    missing = [n for n in only if n not in units]
    assert not missing, (name, "missing", missing)
    return "\n".join("\n".join(units[n]) for n in order if n in only)


def fill(text, c, markers=None):
    for k, v in c.items():
        text = text.replace("__%s__" % k, v)
    for marker, body in (markers or {}).items():
        assert text.count(marker) == 1, (marker, text.count(marker))
        text = text.replace(marker, body)
    left = re.findall(r"__[A-Z][A-Z0-9_]*__", text)
    assert not left, left
    assert "/*@@" not in text, "a marker left"
    return text


class Keys:
    def __init__(self, base_text, seed=SEED):
        self.taken = set(re.findall(r"[a-z0-9]{8}", base_text))
        self.rng = random.Random(seed)

    def new(self):
        while True:
            k = "".join(self.rng.choice(string.ascii_lowercase + string.digits) for _ in range(8))
            if k not in self.taken and not k[0].isdigit():
                self.taken.add(k)
                return k


def widget(tpl, keys, model, name, **opts):
    """a clone of `tpl` with a fresh key, its own remote ids, no events bound, the given options"""
    w = copy.deepcopy(tpl)
    k = keys.new()
    w.update({"key": k, "model": model, "name": name})
    o = w["options"]
    o["remoteFunc"] = "func_" + k
    o["remoteOption"] = "option_" + k
    for kk, v in opts.items():
        o[kk] = v
    if isinstance(w.get("events"), dict):
        w["events"] = {e: "" for e in w["events"]}
    return w


def make_grid(grid, gen, colkeys, model, name, columns, **opts):
    """a grid like `grid` (the header's), keyed from `gen`, its columns (span, widgets) keyed from `colkeys`"""
    col_tpl = {k: copy.deepcopy(v) for k, v in grid["columns"][0].items() if k != "list"}
    g = widget({k: v for k, v in grid.items() if k != "columns"}, gen, model, name, **opts)
    g["columns"] = []
    for span, lst in columns:
        c = copy.deepcopy(col_tpl)
        c["key"] = colkeys.new()
        c["options"].update({"span": span, "xs": 24, "sm": span, "md": span, "lg": span, "xl": span})
        c["list"] = lst
        g["columns"].append(c)
    return g


def collapse(pkeys, model, title, tab_name, children, collapsed):
    """one collapse panel (the SO form's section look) holding `children`"""
    tpl = json.load(open(COLLAPSE_TPL, encoding="utf-8"))
    assert (tpl["type"], len(tpl["tabs"]), tpl["options"]["customClass"]) == ("collapse", 1, "collapse-overflow el-collapse")
    box = widget(tpl, pkeys, model, title, hidden=False, defaultCollapsed=collapsed)
    box["tabs"] = [{"title": title, "name": tab_name, "list": children, "key": pkeys.new()}]
    return box


def build_widgets(form, keys, pkeys):
    """adds the Small Cycle widgets to `form` (in place); returns their models. The panel rows take their keys from `pkeys`, so
    every widget the live v38 has keeps its key (`keys` draws the same sequence as the v38 build)"""
    T = {m: find(form["list"], m)[0] for m in ("page_status", "remarks", "item_qty", "button_draft", "flex_t6y2yh5r", "sm_item_balance", "table_hu")}
    th = T["table_hu"]
    col = {c["model"]: c for c in th["tableColumns"]}
    sm = find(form["list"], "stock_movement", "tlm8ve69")[0]
    smcol = {c["model"]: c for c in sm["tableColumns"]}
    radio_tpl = json.load(open(RADIO_TPL, encoding="utf-8"))
    text_tpl = json.load(open(TEXT_TPL, encoding="utf-8"))
    assert (text_tpl["type"], text_tpl["group"], text_tpl["options"]["dataBind"], text_tpl["events"]) == ("text", "View", False, {"onChange": ""}), text_tpl["options"]
    for t, want in ((T["page_status"], ("input", True, True)), (T["remarks"], ("textarea", False, True)), (T["item_qty"], ("number", False, True)),
                    (T["button_draft"], ("button", True, None)), (col["handling_no"], ("input", False, True)), (col["item_quantity"], ("number", False, True)),
                    (col["hu_select"], ("switch", False, True)), (smcol["balance_id"], ("input", True, True))):
        assert (t["type"], t["options"].get("hidden"), t["options"].get("dataBind")) == want, (t["model"], t["type"], want)
    link_tpl = smcol["transfer_stock"]
    assert link_tpl["type"] == "link" and radio_tpl["type"] == "radio" and T["sm_item_balance"]["type"] == "dialog" and th["type"] == "table"

    def hidden_input(model, name):
        return widget(T["page_status"], keys, model, name)

    def hidden_text(model, name):
        return widget(T["remarks"], keys, model, name, hidden=True)

    # the data fields: hidden, top level after ia_idem_key
    top = form["list"]
    at = [w.get("model") for w in top].index("ia_idem_key")
    data = [hidden_input("source_so_id", "Source SO ID"), hidden_input("source_so_line_id", "Source SO Line ID"),
            hidden_text("source_so_context_json", "Source SO Context"), hidden_input("source_bom_id", "Source BOM ID"),
            hidden_text("bom_snapshot_json", "BOM Snapshot")]
    top[at + 1:at + 1] = data
    # mode + planned after item_uom; the Sales Order Link section right after the header grid
    grid = find(top, "grid_x46134mc")[0]
    left = grid["columns"][0]["list"]
    mode = copy.deepcopy(radio_tpl)
    mode.pop("version", None)
    mode = widget(mode, keys, "bom_consumption_mode", "BOM Mode", hidden=True, disabled=False, defaultValue="",
                  options=[{"value": "STANDARD", "label": "Standard", "explain": ""}, {"value": "FLAT", "label": "Flat", "explain": ""}])
    planned = widget(T["item_qty"], keys, "planned_output_qty", "Planned Output", hidden=True, required=False, defaultValue=None)
    planned["rules"] = []
    i = [w.get("model") for w in left].index("item_uom")
    left[i + 1:i + 1] = [mode, planned]
    rows = {m: widget(text_tpl, pkeys, m, label, hidden=True, defaultValue="", customClass=ROW_CLASS.get(m, ""), hideLabel=m in MESSAGE_ROWS, color="")
            for m, label in ROWS}
    info = make_grid(grid, keys, pkeys, "sc_info", "Sales Order Link", [(span, [rows[m] for m in ms]) for span, ms in LAYOUT], hidden=True)
    buttons = []
    for model, label in (("sc_btn_line", "Select SO Line"), ("sc_btn_unlink", "Unlink"), ("sc_btn_relink", "Re-link"), ("sc_btn_suggest", "Use Suggestion"),
                         ("sc_btn_bom", "Prepare BOM"), ("sc_btn_refresh", "Refresh Figures")):
        b = widget(T["button_draft"], keys, model, label, hidden=True, buttonName=label, buttonType="primary", buttonPlain=True, customClass="marginright")
        b["options"].pop("permission", None)
        buttons.append(b)
    actions = widget(T["flex_t6y2yh5r"], keys, "sc_actions", "Small Cycle Actions", hidden=True, customClass="", justifyContent="flex-start",
                     alignItems="center", flexWrap="wrap")
    actions["list"] = buttons
    section_box = collapse(pkeys, "sc_collapse", "Sales Order Link", "sc_link", [info, actions], False)
    # the grid around it hides the whole section (this.hide on a grid is proven in this app; on a collapse it is not)
    section = make_grid(grid, pkeys, pkeys, "sc_section", "Sales Order Link Section", [(24, [section_box])], hidden=True, gutter=0)
    top.insert([w.get("model") for w in top].index("grid_x46134mc") + 1, section)
    # the stock_movement line key
    ref = widget(smcol["balance_id"], keys, "sc_ref_key", "SC Ref Key")
    sm["tableColumns"].append(ref)

    # dialogs (copies of sm_item_balance), their tables (copies of table_hu)
    def column(tpl, model, name, **opts):
        return widget(tpl, keys, model, name, **opts)

    def table(model, name, cols):
        t = widget(th, keys, model, name, isAdd=False, isDelete=False, paging=True, pageSize=10)
        t["tableColumns"] = cols
        return t

    def dialog(model, title, children, **opts):
        d = widget(T["sm_item_balance"], keys, model, "对话框", title=title, **opts)
        d["list"] = children
        return d

    tin, tnum = col["handling_no"], col["item_quantity"]
    line_cols = [column(tin, "so_no", "Sales Order"), column(tin, "line_no", "Line"), column(tin, "customer", "Customer"),
                 column(tnum, "ordered", "Ordered"), column(tnum, "delivered", "Delivered"), column(tnum, "suggestion", "Remaining to Plan"),
                 column(tin, "uom", "UOM"), column(tin, "line_id", "Line ID", hidden=True), column(tin, "so_id", "SO ID", hidden=True),
                 column(tin, "uom_id", "UOM ID", hidden=True), column(link_tpl, "pick", "Select", linkName="Select",
                        # fixed to the right (the user's designer change, dev v42)
                        fixedColumn=True, fixedColumnPosition="right")]
    expand_cols = [column(tin, "component", "Component"), column(tnum, "level", "Level", precision=0), column(tin, "bom", "BOM"),
                   column(tin, "under", "Used Under"),
                   # how many BOM lines use it (a tick applies to all of them); keyed from pkeys so the existing keys stay
                   widget(tnum, pkeys, "uses", "Used", precision=0), column(tin, "item_id", "Item ID", hidden=True),
                   column(col["hu_select"], "expand", "Expand", fixedColumn=False)]
    expand_all = widget(T["button_draft"], keys, "sc_expand_all", "Expand All", hidden=False, buttonName="Expand All", buttonType="primary",
                        buttonPlain=True, customClass="marginright")
    expand_all["options"].pop("permission", None)
    top.append(dialog("sc_line_dialog", "Select Sales Order Line", [table("sc_line_table", "Sales Order Lines", line_cols)], width="80%",
                      showOk=False, cancelText="Close"))
    note = widget(text_tpl, pkeys, "sc_expand_note", "Note", hidden=False, defaultValue=EXPAND_NOTE, customClass="", hideLabel=True, color="")
    top.append(dialog("sc_expand_dialog", "Flat BOM: sub-assemblies to expand", [note, expand_all, table("sc_expand_table", "Sub-assemblies", expand_cols)],
                      width="70%", okText="Prepare", cancelText="Cancel"))
    return ["source_so_id", "source_so_line_id", "source_so_context_json", "source_bom_id", "bom_snapshot_json", "bom_consumption_mode",
            "planned_output_qty", "sc_section", "sc_collapse", "sc_info"] + [m for m, _ in ROWS] + ["sc_actions", "sc_line_dialog", "sc_expand_dialog", "sc_ref_key"]


def build_res_widgets(form, rkeys):
    """RES-01 R1 (both builds): the IA's raw-material hold result and when it was checked (header, hidden, server-owned) and each
    line's requirement required_qty (decision A: from the BOM, follows the output, changed by a hand edit, never by
    auto-allocation; no default = none recorded). Keys from their own stream, so every earlier key stays"""
    top = form["list"]
    tpl = find(top, "page_status")[0]
    at = [w.get("model") for w in top].index("bom_snapshot_json")
    top[at + 1:at + 1] = [widget(tpl, rkeys, "material_hold_status", "Material Hold Status"), widget(tpl, rkeys, "material_hold_at", "Material Hold Checked At")]
    sm = find(top, "stock_movement", "tlm8ve69")[0]
    req_tpl = [c for c in sm["tableColumns"] if c["model"] == "requested_qty"][0]
    assert (req_tpl["type"], req_tpl["options"]["hidden"], req_tpl["options"]["dataBind"], req_tpl["options"]["precision"]) == ("number", True, True, 8)
    req = widget(req_tpl, rkeys, "required_qty", "Required Qty", defaultValue=None)
    req["rules"] = []
    sm["tableColumns"].append(req)
    # R3: Required editable (empty = the BOM reference: the save fills it); Reserved / Short display-only text (IA_SAVE drops them, so
    # no decimal column is written from the screen) and the Materials row; all hidden until sc_main shows them for an enrolled IA
    req["name"] = "Required"
    req["options"]["disabled"] = False
    txt_tpl = [c for c in sm["tableColumns"] if c["model"] == "balance_id"][0]
    assert (txt_tpl["type"], txt_tpl["options"]["hidden"]) == ("input", True)
    sm["tableColumns"] += [widget(txt_tpl, rkeys, "res_reserved", "Reserved", disabled=True, defaultValue=""),
                           widget(txt_tpl, rkeys, "res_short", "Short", disabled=True, defaultValue="")]
    text_tpl = json.load(open(TEXT_TPL, encoding="utf-8"))
    at = [w.get("model") for w in top].index("bom_tab")
    top.insert(at, widget(text_tpl, rkeys, "res_summary", "Raw material reservation", hidden=True, defaultValue="", customClass="", hideLabel=True, color=""))
    return ["material_hold_status", "material_hold_at", "required_qty", "res_reserved", "res_short", "res_summary"]


def regroup(form, pkeys):
    """UI-01, ON only: the header fields moved (the same widgets, keys kept) into the stacked sections of SECTIONS; the BOM row,
    Use Suggestion and Prepare BOM into Production; a read-only Actual Received row beside Quantity, which reads Output to Receive
    (sc_main swaps the two on a completed IA: the platform has no label setter). New keys from pkeys, after every earlier draw."""
    top = form["list"]
    grid = find(top, "grid_x46134mc")[0]
    pool = {w["model"]: w for c in grid["columns"] for w in c["list"]}
    info = find(top, "sc_info")[0]
    pool["sc_info_bom"] = info["columns"][2]["list"].pop(0)
    assert pool["sc_info_bom"]["model"] == "sc_info_bom"
    actions = find(top, "sc_actions")[0]
    moved = [b for b in actions["list"] if b["model"] in ("sc_btn_suggest", "sc_btn_bom")]
    assert [b["model"] for b in moved] == ["sc_btn_suggest", "sc_btn_bom"]
    actions["list"] = [b for b in actions["list"] if b not in moved]
    text_tpl = json.load(open(TEXT_TPL, encoding="utf-8"))
    pool["sc_actual"] = widget(text_tpl, pkeys, "sc_actual", "Actual Received", hidden=True, defaultValue="", customClass="", hideLabel=False, color="")
    prod = widget(find(top, "flex_t6y2yh5r")[0], pkeys, "sc_prod_actions", "Production Actions", hidden=True, customClass="", justifyContent="flex-start",
                  alignItems="center", flexWrap="wrap")
    prod["list"] = moved
    pool["sc_prod_actions"] = prod
    pool["item_qty"]["name"] = "Output to Receive"
    placed = []

    def take(models):
        placed.extend(models)
        return [pool[m] for m in models]

    for c, models in zip(grid["columns"], HEADER):
        c["list"] = take(models)
    for model, title, collapsed, grid_model, columns, after in SECTIONS:
        g = make_grid(grid, pkeys, pkeys, grid_model, title, [(span, take(models)) for span, models in columns], hidden=False)
        box = collapse(pkeys, model, title, model[3:], [g], collapsed)
        top.insert([w.get("model") for w in top].index(after) + 1, box)
    assert sorted(placed) == sorted(pool) and len(placed) == len(set(placed)), "every header widget placed once"


def track_history(form):
    """FIX-05, ON only: options.history on each SC_HISTORY field (the SO form's flag; the publish creates the history table)"""
    for model in SC_HISTORY:
        w = find(form["list"], model)[0]
        assert "history" not in w["options"], model
        w["options"]["history"] = True


def patch_handlers(form, c, keys):
    """ON: sc_main + forwarders, bindings, the patched v36 handlers. Returns {name: func} of every new or changed script."""
    es = form["config"]["eventScript"]
    k = by_key(form)
    for key, pin in PINS.items():
        assert sha(k[key]["func"]) == pin, "the v36 handler %s (%s) changed: re-derive the Small Cycle patch" % (k[key]["name"], key)
    names = {e["name"] for e in es}
    # RES-01: the IA's own holds added back where it reads free stock (src/res_own_patch.json), before the explode helpers are copied
    own_patch = json.load(open(os.path.join(SRC, "res_own_patch.json"), encoding="utf-8"))
    own = fill(js(own_patch["block"]), c)
    assert own.startswith(PRO_START) and own.endswith(PRO_END)

    def own_apply(key, text):
        spec = own_patch[key]
        for pair in spec["pairs"]:
            assert text.count(pair["was"]) == 1, (key, pair["was"][:60])
            text = text.replace(pair["was"], pair["now"])
        if spec["blockBefore"]:
            assert text.count(spec["blockBefore"]) == 1
            return text.replace(spec["blockBefore"], own + spec["blockBefore"])
        return own + text

    for key, pin in RULE_PINS.items():
        rule = [r for r in k[key]["rules"] if r.get("action") == "js"]
        assert len(rule) == 1 and sha(rule[0]["options"]["func"]) == pin, "the v36 rule handler %s changed" % key
    k["wv07g9xe"]["func"] = own_apply("wv07g9xe", k["wv07g9xe"]["func"])
    k["iacqty01"]["func"] = own_apply("iacqty01", k["iacqty01"]["func"])
    pick_rule = [r for r in k["evhzkk8e"]["rules"] if r.get("action") == "js"][0]
    pick_rule["options"]["func"] = own_apply("evhzkk8e", pick_rule["options"]["func"])
    explode = k["wv07g9xe"]["func"]
    assert explode.count(EXPLODE_HELPERS_END) == 1
    helpers = explode[:explode.index(EXPLODE_HELPERS_END)].rstrip()
    sc_bom = shared("sc_bom.js")
    sc_proj = shared("sc_proj.js")
    mirrors = {}
    main = fill(js("sc_main.js"), c, {"/*@@SC_BOM@@*/": sc_bom, "/*@@SC_PROJ@@*/": sc_proj, "/*@@IA_EXPLODE_HELPERS@@*/": helpers})
    new = [("sc_main", main)] + [(n, "// %s: Small Cycle (scratchpad/iasc), handled by sc_main\nthis.triggerEvent(\"sc_main\", %s);\n" % (what, op)) for n, what, op in FORWARDERS]
    keyed = {}
    for name, func in new:
        assert name not in names, name
        nk = keys.new()
        es.append({"key": nk, "name": name, "func": func, "type": "js"})
        keyed[name] = nk
        mirrors[name] = func
    for model, (ev, name) in BIND.items():
        w = find(form["list"], model)[0]
        assert w["events"].get(ev) == "", (model, w["events"])
        w["events"][ev] = keyed[name]
    for model, evs in DIALOG_BIND.items():
        d = find(form["list"], model)[0]
        for ev, name in evs.items():
            assert d["events"].get(ev) == "", (model, ev)
            d["events"][ev] = keyed[name]
    lt = find(form["list"], "sc_line_table")[0]
    pick = [x for x in lt["tableColumns"] if x["model"] == "pick"][0]
    assert pick["events"] == {"onClick": ""}
    pick["events"]["onClick"] = keyed["sc_onClick_pickLine"]

    def block(name):
        t = fill(js(name), c)
        assert t.startswith(PRO_START) and t.endswith(PRO_END) and t.count(PRO_START) == 1 and t.count(PRO_END) == 1, name
        return t

    for key, src in (("wv07g9xe", "sc_prologue_item.js"), ("iaqty01x", "sc_prologue_qty.js")):
        k[key]["func"] = block(src) + k[key]["func"]
    d = k["iasvdrft"]["func"]
    assert d.count(DRAFT_DONE) == 1
    k["iasvdrft"]["func"] = block("sc_draft_hold.js") + d.replace(DRAFT_DONE, DRAFT_HOLD)
    k["fgivan7v"]["func"] = k["fgivan7v"]["func"] + "\n" + block("sc_epilogue_plant.js")
    m = k["mounted"]["func"]
    assert m.count(MOUNT_ANCHOR) == 1 and m.count(MOUNT_CALL_AFTER) == 1
    m = m.replace(MOUNT_ANCHOR, block("sc_mount_block.js") + MOUNT_ANCHOR).replace(MOUNT_CALL_AFTER, MOUNT_CALL_AFTER + MOUNT_CALL)
    k["mounted"]["func"] = m
    variance = None
    var_block = fill(js("sc_variance.js"), c, {"/*@@SC_BOM_MIN@@*/": shared("sc_bom.js", ["scS", "scNum", "scQ8", "scParseJ", "scChain", "scRowQty", "scSnapOf", "scRecompute"])})
    assert var_block.startswith(PRO_START) and var_block.endswith(PRO_END)
    for key in VARIANCE:
        t = k[key]["func"]
        a = t.index(VARIANCE_START)
        b = t.index("\n};\n", t.index(VARIANCE_HEAD)) + 3
        v36 = t[a:b]
        assert t.count(v36) == 1 and v36.count(VARIANCE_HEAD) == 1
        if variance is None:
            variance = v36
        assert v36 == variance, "the four confirmBomVariance copies differ in v36"
        t = t.replace(v36, v36.replace(VARIANCE_HEAD, VARIANCE_RENAMED) + "\n\n" + var_block)
        if key in NOT_RECORD:
            assert t.count(NOT_RECORD_TAIL) == 1
            t = t.replace(NOT_RECORD_TAIL, '"item_assembly_tittle", ' + ", ".join('"%s"' % m_ for m_ in UI_TOP) + "];")
            for was, now in DOUBLE:
                assert t.count(was) == 1, (key, was[:60])
                t = t.replace(was, now)
        k[key]["func"] = t
    # RES-01 R4: the four completion handlers close the IA's holds once the completion answered (src/res_close_patch.json)
    close_patch = json.load(open(os.path.join(SRC, "res_close_patch.json"), encoding="utf-8"))
    close_block = fill(js(close_patch["block"]), c)
    assert close_block.startswith(PRO_START) and close_block.endswith(PRO_END)
    for key in VARIANCE:
        t = k[key]["func"]
        pairs = close_patch[key] if isinstance(close_patch[key], list) else close_patch[close_patch[key]]
        for pair in pairs:
            assert t.count(pair["was"]) == 1, (key, pair["was"][:60])
            t = t.replace(pair["was"], pair["now"])
        k[key]["func"] = close_block + t
    # a js event's func goes through the platform's replaceVariables ({{type:x}} tokens): none may be in our code
    base = by_key(json.loads(read(BASE)))
    for key in PINS:
        assert k[key]["func"].count("{{") == base[key]["func"].count("{{"), key
        mirrors["iaForm_" + k[key]["name"]] = k[key]["func"]
    for key in RULE_PINS:
        now = [r for r in k[key]["rules"] if r.get("action") == "js"][0]["options"]["func"]
        was = [r for r in base[key]["rules"] if r.get("action") == "js"][0]["options"]["func"]
        assert now.count("{{") == was.count("{{"), key
        mirrors["iaForm_" + k[key]["name"]] = now
    for name, func in new:
        assert "{{" not in func, name
    return mirrors


def build(on):
    raw = read(BASE)
    assert hashlib.md5(raw.encode("utf-8")).hexdigest() == BASE_MD5, "base/ia_form_v36.json is not the pinned v36"
    form = json.loads(raw)
    keys = Keys(raw)
    pkeys = Keys(raw, SEED + 1)
    added = build_widgets(form, keys, pkeys) + build_res_widgets(form, Keys(raw, SEED + 2))
    mirrors = {}
    if on:
        wf = ids()
        c = {"SC_ENABLED": "true", "SO_IA_PROJECTION": wf["SO_IA_PROJECTION"], "IA_SC_RELINK": wf["IA_SC_RELINK"], "IA_HOLD": wf["IA_HOLD"],
             "RES_ENABLED": "true" if RES_ENABLED else "false"}
        mirrors = patch_handlers(form, c, keys)
        regroup(form, pkeys)
        track_history(form)
    every = []

    def walk(n):
        if isinstance(n, dict):
            if isinstance(n.get("key"), str) and ("model" in n or "type" in n):
                every.append(n["key"])
            for v in n.values():
                walk(v)
        elif isinstance(n, list):
            for v in n:
                walk(v)
    walk(form["list"])
    every += [e["key"] for e in form["config"]["eventScript"]]
    assert len(every) == len(set(every)), "a key is used twice"
    return form, mirrors, added


def main():
    write = "--write" in sys.argv
    on_repo = "--on" in sys.argv
    off, _, added = build(False)
    on, mirrors, _ = build(True)
    print("OFF: %d widgets added; ON: %d events added, %d scripts written as mirrors" % (
        len(added), len(on["config"]["eventScript"]) - len(off["config"]["eventScript"]), len(mirrors)))
    if not write:
        return
    if on_repo:
        assert all(re.fullmatch(r"[1-9][0-9]{0,19}", v) for v in ids().values()), ("--on --write needs the real workflow ids in ids.json", ids())
    # the repo holds what dev runs (ON since v38): only --on writes it; the OFF build stays a preview
    for kind, doc in (("off", off), ("on", on)):
        os.makedirs(os.path.join(OUT_CLIENT, kind), exist_ok=True)
        text = render(doc, "indent")
        assert json.loads(text) == doc
        open(os.path.join(OUT_CLIENT, kind, "IAform.json"), "w", encoding="utf-8").write(text)
    for name, func in mirrors.items():
        open(os.path.join(OUT_CLIENT, "on", name + ".js"), "w", encoding="utf-8").write(func)
    if on_repo:
        os.makedirs(OUT_REPO, exist_ok=True)
        open(os.path.join(OUT_REPO, "IAform.json"), "w", encoding="utf-8").write(render(on, "indent"))
        for name, func in mirrors.items():
            open(os.path.join(OUT_REPO, name + ".js"), "w", encoding="utf-8").write(func)
    print("wrote %s/off/ + %s/on/ (IAform.json + %d mirrors)%s" % (OUT_CLIENT, OUT_CLIENT, len(mirrors), " + ON -> " + OUT_REPO if on_repo else ""))


if __name__ == "__main__":
    main()
