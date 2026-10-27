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
SWITCH_TPL = os.path.join(HERE, "tpl", "switch_so_is_accurate.json")  # the SO form's is_accurate (v1240): a plain on / off switch, 0 / 1
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
# RES-01 raw-material holds (scratchpad/iasc/res01/RES01_PLAN.md): the client switch (the reservation after a save and on open), with
# IA_SAVE's own; ON on DEV since 10-22 (user)
RES_ENABLED = True
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
# IA V2 one stock call per run (10-27): the worker parks a job at 75 % after the components' run; src/v2_park_patch.json (also read by
# test_sc_json.js) has the two handlers' wait kick it once at the park instead of at its next 15 s kick
PARK = json.load(open(os.path.join(SRC, "v2_park_patch.json"), encoding="utf-8"))
# the classic save handlers (10-22): a double click saved twice; src/classic_double_patch.json (also read by test_sc_json.js) claims the
# click before the first await with the same form flag and frees it in a finally
CLASSIC_DOUBLE = json.load(open(os.path.join(SRC, "classic_double_patch.json"), encoding="utf-8"))
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
EXPAND_NOTE = ("Each row is one place a component is used. Tick a sub-assembly to make it there from its own components (expand: its components appear "
               "under it); leave it unticked to take it from stock there (stop here: what is under it is hidden). Rows marked Included have no choice. Stop at "
               "level N expands every sub-assembly above level N. Assembly components shows the result.")
# Flat "Stop at level" (the user, 10-27): the dialog's radio and its forwarder, each from its own key sequence so no existing key moves
LEVEL_FORWARDER = ("sc_onChange_expandLevel", "Stop at level in the Flat dialog", '{ scOp: "EXPAND_LEVEL", value: arguments[0] && arguments[0].value }')
# one tick per place (the BA, 10-27): the Expand column's onChange keeps the places above / under consistent
TICK_FORWARDER = ("sc_onChange_expandTick", "a place's Expand tick in the Flat dialog",
                  '{ scOp: "EXPAND_TICK", rowIndex: arguments[0] && arguments[0].rowIndex, value: arguments[0] && arguments[0].value }')
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

# RES-01 Created (BA, 10-22): the Created status next to Draft (src/created_patch.json: the handler, mounted, IA V2 and badge pairs)
CREATED = json.load(open(os.path.join(SRC, "created_patch.json"), encoding="utf-8"))
# IA output split (plan 10-27, code/shared/os_split.js): the Split receipt switch, the split total and the rows grid; a grid with
# generateSubTable false = one json column sm_item_assembly.output_split, no child table. OFF = hidden, nothing bound
OS_WIDGETS = ["output_split_on", "output_split_sum", "output_split"]
OS_COLS = ["os_qty", "os_storage_location_id", "os_location_id", "os_category", "os_group", "os_batch_no", "os_mfg_date", "os_exp_date"]
# the Misc Receipt split table's bin filter (table_split): the row's own storage location
OS_BIN_FORMULA = "{{value:output_split}}.map(item => item.os_storage_location_id)[arguments[0].rowIndex]"
# ON: the split's own handler (src/os_main.js) and switch; its display-only total stripped from IA V2 payloads (IA_NOT_RECORD; the switch is a column)
OS_ENABLED = True
OS_UI = ["output_split_sum"]
OS_START = "// IA output split (scratchpad/iasc os_main):"
OS_END = "// -- end output split --\n"
OS_LABELS = {"os_qty": "Qty", "os_storage_location_id": "Storage Location", "os_location_id": "Bin Location", "os_category": "Category", "os_group": "Group",
             "os_batch_no": "Batch No", "os_mfg_date": "Manufacturing Date", "os_exp_date": "Expired Date"}
OS_FORWARDERS = ([("os_onChange_switch", "Split receipt switched", 'this.triggerEvent("os_main", { osOp: "SWITCH", value: arguments[0] && arguments[0].value });'),
                  ("os_onRowAdd", "a split row added", 'this.triggerEvent("os_main", { osOp: "ADD", rowIndex: arguments[0] && arguments[0].rowIndex });'),
                  # read once the row is gone (the components table's onRowRemove waits the same way)
                  ("os_onRowRemove", "a split row removed", 'setTimeout(() => this.triggerEvent("os_main", { osOp: "REMOVE" }), 50);')] +
                 [("os_onChange_" + c[3:], "a split row's " + OS_LABELS[c] + " changed",
                   'this.triggerEvent("os_main", { osOp: "CELL", field: "%s", rowIndex: arguments[0] && arguments[0].rowIndex, value: arguments[0] && arguments[0].value });' % c)
                  for c in OS_COLS])
# where the patched handlers tell os_main (blocks marked OS_START ... OS_END; the field list is the mount read's, widened)
OS_ITEM_AT = "const applyBatchFields = (item) => {\n"
OS_MOUNT_FIELDS = ('.field("item_batch_management,batch_number_genaration")\n    .get();\n  const item = res.data?.[0];\n',
                   '.field("item_batch_management,batch_number_genaration,serial_number_management,stock_control")\n    .get();\n  const item = res.data?.[0];\n')
OS_VIEW_AT = "const showFilledBatchFields = () => {\n"


def os_block(why, op, indent=""):
    return "%s%s %s\n%sthis.triggerEvent(\"os_main\", { osOp: \"%s\"%s });\n%s%s" % (indent, OS_START, why, indent, op, ", item: item || null" if op in ("ITEM", "MOUNT") else "",
                                                                                    indent, OS_END)


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
    # Standard by default: the user's designer edit (dev v55, 22 October); no snapshot = not enhanced, so a plain IA stays legacy
    mode = widget(mode, keys, "bom_consumption_mode", "BOM Mode", hidden=True, disabled=False, defaultValue="STANDARD",
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


def build_level_widget(form, lkeys):
    """Flat "Stop at level" (the user, 10-27, both builds): a radio 1-6 in the Flat dialog before Expand All"""
    radio = copy.deepcopy(json.load(open(RADIO_TPL, encoding="utf-8")))
    radio.pop("version", None)
    radio = widget(radio, lkeys, "sc_expand_level", "Stop at level", hidden=False, disabled=False, defaultValue=None,
                   options=[{"value": n, "label": str(n), "explain": ""} for n in range(1, 7)])
    d = find(form["list"], "sc_expand_dialog")[0]
    d["list"].insert([w.get("model") for w in d["list"]].index("sc_expand_all"), radio)
    # one row per place (the BA, 10-27): the place's key (hidden); Used is always 1 per place
    cols = find(form["list"], "sc_expand_table")[0]["tableColumns"]
    item_col = [c for c in cols if c["model"] == "item_id"][0]
    cols.insert(cols.index(item_col) + 1, widget(item_col, lkeys, "path", "Place", hidden=True))
    # SFG = a sub-assembly to choose, IN = a component included as it is (the BA: Expand shows every immediate child)
    cols.insert(cols.index(item_col) + 2, widget(item_col, lkeys, "kind", "Kind", hidden=True))
    [c for c in cols if c["model"] == "uses"][0]["options"]["hidden"] = True
    # the Assembly components preview (the BA, 10-27): what the choices give, with the required quantities; read-only
    pk = Keys(json.dumps(form), SEED + 14)
    th = find(form["list"], "table_hu")[0]
    tc = {c["model"]: c for c in th["tableColumns"]}
    preview = widget(th, pk, "sc_expand_preview", "Assembly components", isAdd=False, isDelete=False, paging=True, pageSize=10)
    preview["tableColumns"] = [widget(tc["handling_no"], pk, "component", "Component", disabled=True),
                               widget(tc["item_quantity"], pk, "qty", "Required Qty", disabled=True),
                               widget(tc["handling_no"], pk, "uom", "UOM", disabled=True)]
    d["list"].insert([w.get("model") for w in d["list"]].index("sc_expand_table") + 1, preview)
    return ["sc_expand_level", "sc_expand_preview"]


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
    # MIN-06 (BA 10-22): Reserved for this IA / Unreserved (with its reason, sc_main's resCells)
    sm["tableColumns"] += [widget(txt_tpl, rkeys, "res_reserved", "Reserved for this IA", disabled=True, defaultValue=""),
                           widget(txt_tpl, rkeys, "res_short", "Unreserved", disabled=True, defaultValue="")]
    text_tpl = json.load(open(TEXT_TPL, encoding="utf-8"))
    at = [w.get("model") for w in top].index("bom_tab")
    top.insert(at, widget(text_tpl, rkeys, "res_summary", "Raw material reservation", hidden=True, defaultValue="", customClass="", hideLabel=True, color=""))
    # RF-09 (BA 10-22): the line's manual-Required flag (bound, hidden; Required's onChange sets it). Keyed LAST from the stream, so every
    # earlier widget keeps its key (the IA list's Reservation column references material_hold_status's), placed right after Required
    manual = widget(txt_tpl, rkeys, "required_manual", "Required set by hand", defaultValue="")
    cols = sm["tableColumns"]
    cols.insert([c["model"] for c in cols].index("required_qty") + 1, manual)
    # BA rev 1.2 C2: how a completed IA's completion ended (sc_main's resCheck, IA_HOLD CHECK), right before the reservation row; keyed
    # after required_manual, so every earlier widget keeps its key
    check = widget(text_tpl, rkeys, "completion_check", "Completion check", hidden=True, defaultValue="", customClass="error-msg", hideLabel=True, color="")
    top.insert([w.get("model") for w in top].index("res_summary"), check)
    return ["material_hold_status", "material_hold_at", "required_qty", "res_reserved", "res_short", "res_summary", "required_manual", "completion_check"]


def build_created_widgets(form, ckeys):
    """RES-01 Created (BA, 10-22): the Created button after the Draft one, the Created badge after the Draft one, the Created option"""
    def place(model):
        hits = []

        def walk(n):
            if isinstance(n, list):
                for i, x in enumerate(n):
                    if isinstance(x, dict) and x.get("model") == model:
                        hits.append((n, i, x))
                    walk(x)
            elif isinstance(n, dict):
                for v in n.values():
                    walk(v)
        walk(form["list"])
        assert len(hits) == 1, (model, len(hits))
        return hits[0]
    lst, i, draft = place("button_draft")
    # primary: the user's designer edit (dev v55, 22 October)
    lst.insert(i + 1, widget(draft, ckeys, "button_created", "Created", buttonName="Created", buttonType="primary"))
    # RES-01 Cancel: no Cancel button on the form (user 10-22: Cancel is the list's bulk action); its key is still drawn, so every later
    # key of this stream stays the same
    ckeys.new()
    lst, i, badge = place("draft_status")
    nb = widget(badge, ckeys, "created_status", "Created Status")
    for d in CREATED["badge"]:
        assert nb["options"]["defaultValue"].count(d["was"]) == 1, d["was"]
        nb["options"]["defaultValue"] = nb["options"]["defaultValue"].replace(d["was"], d["now"])
    lst.insert(i + 1, nb)
    cb = widget(badge, ckeys, "cancelled_status", "Cancelled Status")
    for d in CREATED["cancel"]["badge"]:
        assert cb["options"]["defaultValue"].count(d["was"]) == 1, d["was"]
        cb["options"]["defaultValue"] = cb["options"]["defaultValue"].replace(d["was"], d["now"])
    lst.insert(i + 2, cb)
    st = find(form["list"], "item_assembly_status")[0]
    leaves = st["options"]["datasource"]["rules"]["list"][0]["children"][1]["children"]
    d = [x for x in leaves if x.get("value") == "Draft"]
    assert len(d) == 1 and not [x for x in leaves if x.get("value") == "Created"], [x.get("value") for x in leaves]
    leaf = copy.deepcopy(d[0])
    leaf.update({"id": CREATED["statusLeafId"], "value": "Created"})
    assert str(leaf["id"]) not in json.dumps(form)
    leaves.insert(leaves.index(d[0]) + 1, leaf)
    assert not [x for x in leaves if x.get("value") == "Cancelled"]
    cleaf = copy.deepcopy(d[0])
    cleaf.update({"id": CREATED["cancel"]["statusLeafId"], "value": "Cancelled"})
    assert str(cleaf["id"]) not in json.dumps(form)
    leaves.insert(leaves.index(leaf) + 1, cleaf)
    return ["button_created", "created_status", "cancelled_status"]


def build_os_widgets(form, okeys):
    """IA output split (both builds): the switch, the total line and the output_split grid, hidden and unbound, top level right after
    sc_section; the grid's columns cloned from this form's own tables, its selects filtered as the header's Output Location fields (the
    bin also by the row's storage location, as Misc Receipt's table_split). Keys from their own stream, so every earlier key stays"""
    top = form["list"]
    H = {m: find(top, m, k)[0] for m, k in (("storage_location_id", "37cazpwp"), ("location_id", "06a87twh"), ("inventory_category", "iainvcat"))}
    th = find(top, "table_hu")[0]
    col = {c["model"]: c for c in th["tableColumns"]}
    bal = {c["model"]: c for c in find(top, "table_item_balance")[0]["tableColumns"]}
    switch_tpl = json.load(open(SWITCH_TPL, encoding="utf-8"))
    text_tpl = json.load(open(TEXT_TPL, encoding="utf-8"))
    assert (switch_tpl["type"], switch_tpl["options"]["checkboxMode"], switch_tpl["options"]["tableColumn"], switch_tpl["options"]["defaultValue"]) == ("switch", False, False, 0)
    assert (th["type"], th["options"]["generateSubTable"], th["options"]["dataBind"]) == ("table", False, True)
    for c, want in ((col["item_quantity"], "number"), (col["handling_no"], "input"), (col["storage_location_id"], "select"), (col["location_id"], "select"),
                    (bal["dialog_manufacturing_date"], "date"), (bal["dialog_expired_date"], "date")):
        assert c["type"] == want and c["options"]["tableColumn"] is True, (c["model"], c["type"])
    assert (H["inventory_category"]["options"]["remote"], [o["value"] for o in H["inventory_category"]["options"]["options"]]) == (False, ["Unrestricted", "Blocked"])
    switch = widget(switch_tpl, okeys, "output_split_on", "Split receipt", hidden=True, defaultValue=0)
    total = widget(text_tpl, okeys, "output_split_sum", "Split total", hidden=True, defaultValue="", customClass="", hideLabel=True, color="")
    grid = widget(th, okeys, "output_split", "Output Split", hidden=True, isAdd=True, isDelete=True, paging=False, defaultValue=[])
    # the rows' Add Row and per-row Delete (the browser pass, 10-27): table_hu, the grid's template, has neither; the components
    # table's own toolbar addBtn and delBtn row action
    sm = find(top, "stock_movement")[0]["options"]
    add = [x for x in sm["customProps"]["toolbar"] if x.get("type") == "addBtn"]
    dele = [x for x in sm["rowActions"] if x.get("type") == "delBtn"]
    assert len(add) == 1 and len(dele) == 1, "the components table's Add / Delete buttons moved"
    go = grid["options"]
    assert not [x for x in go["customProps"]["toolbar"] if x.get("type") == "addBtn"] and go["rowActions"] == []
    go["customProps"]["toolbar"].insert(0, dict(copy.deepcopy(add[0]), title="Add Row"))
    go["rowActions"] = [copy.deepcopy(dele[0])]

    def column(tpl, model, name, **opts):
        return widget(tpl, okeys, model, name, hidden=False, disabled=False, required=False, **opts)

    def ds(model):
        return copy.deepcopy(H[model]["options"]["datasource"])

    bins = ds("location_id")
    leaf = [x for x in bins["rules"]["list"][0]["children"] if x["prop"] == "storage_location_id"]
    assert len(leaf) == 1 and (leaf[0]["valueType"], leaf[0]["value"]) == ("field", "{{value:storage_location_id}}"), leaf
    leaf[0].update({"valueType": "formula", "value": OS_BIN_FORMULA})
    cat = H["inventory_category"]["options"]
    grid["tableColumns"] = [
        column(col["item_quantity"], "os_qty", "Qty", precision=8, defaultValue=None),
        column(col["storage_location_id"], "os_storage_location_id", "Storage Location", defaultValue="", datasource=ds("storage_location_id"),
               props=copy.deepcopy(H["storage_location_id"]["options"]["props"])),
        column(col["location_id"], "os_location_id", "Bin Location", defaultValue="", datasource=bins, props=copy.deepcopy(H["location_id"]["options"]["props"])),
        column(col["location_id"], "os_category", "Category", defaultValue="", auto_refresh=0, remote=False, remoteType=cat["remoteType"],
               datasource=copy.deepcopy(cat["datasource"]), options=copy.deepcopy(cat["options"]), props=copy.deepcopy(cat["props"])),
        column(col["item_quantity"], "os_group", "Group", precision=0, defaultValue=None),
        column(col["handling_no"], "os_batch_no", "Batch No", defaultValue=""),
        column(bal["dialog_manufacturing_date"], "os_mfg_date", "Manufacturing Date", defaultValue=""),
        column(bal["dialog_expired_date"], "os_exp_date", "Expired Date", defaultValue="")]
    assert [c["model"] for c in grid["tableColumns"]] == OS_COLS
    at = [w.get("model") for w in top].index("sc_section")
    top[at + 1:at + 1] = [switch, total, grid]
    return OS_WIDGETS


def os_place(form):
    """ON: the split widgets into the Output Location section, a full-width first column (the switch on top, the total, the rows);
    its key from a fresh stream drawn after every other key"""
    top = form["list"]
    moved = []
    for m in OS_WIDGETS:
        w, holder = find(top, m)
        assert holder is top, m
        top.remove(w)
        moved.append(w)
    grid = find(top, "sc_output_grid")[0]
    assert len(grid["columns"]) == 2
    c = {k: copy.deepcopy(v) for k, v in grid["columns"][0].items() if k != "list"}
    c["key"] = Keys(json.dumps(form), SEED + 8).new()
    c["options"].update({"span": 24, "xs": 24, "sm": 24, "md": 24, "lg": 24, "xl": 24})
    c["list"] = moved
    grid["columns"].insert(0, c)


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
    # IA output split: an item change tells os_main (inside applyBatchFields, before the explode helpers are copied: sc_main's copy too)
    w = k["wv07g9xe"]["func"]
    assert w.count(OS_ITEM_AT) == 1, "applyBatchFields moved"
    k["wv07g9xe"]["func"] = w.replace(OS_ITEM_AT, OS_ITEM_AT + os_block("the item changed: its split is cleared, the switch shown for its kind", "ITEM", "  "))
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
    main = fill(js("sc_main.js"), c, {"/*@@SC_BOM@@*/": sc_bom, "/*@@SC_PROJ@@*/": sc_proj, "/*@@IA_EXPLODE_HELPERS@@*/": helpers, "/*@@RES_FP@@*/": js("res_fp.js").rstrip("\n")})
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
    name, what, op = LEVEL_FORWARDER
    assert name not in names, name
    func = "// %s: Small Cycle (scratchpad/iasc), handled by sc_main\nthis.triggerEvent(\"sc_main\", %s);\n" % (what, op)
    lk = Keys(json.dumps(form), SEED + 11).new()
    es.append({"key": lk, "name": name, "func": func, "type": "js"})
    mirrors[name] = func
    lv = find(form["list"], "sc_expand_level")[0]
    assert lv["events"].get("onChange") == "", lv["events"]
    lv["events"]["onChange"] = lk
    name, what, op = TICK_FORWARDER
    assert name not in names, name
    func = "// %s: Small Cycle (scratchpad/iasc), handled by sc_main\nthis.triggerEvent(\"sc_main\", %s);\n" % (what, op)
    tk = Keys(json.dumps(form), SEED + 13).new()
    es.append({"key": tk, "name": name, "func": func, "type": "js"})
    mirrors[name] = func
    tick = [c for c in find(form["list"], "sc_expand_table")[0]["tableColumns"] if c["model"] == "expand"][0]
    assert tick["events"].get("onChange") == "", tick["events"]
    tick["events"]["onChange"] = tk
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
            t = t.replace(NOT_RECORD_TAIL, '"item_assembly_tittle", ' + ", ".join('"%s"' % m_ for m_ in UI_TOP + OS_UI) + "];")
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
    for key in CLASSIC_DOUBLE["handlers"]:
        t = k[key]["func"]
        for pair in CLASSIC_DOUBLE["patch"]:
            assert t.count(pair["was"]) == 1, (key, pair["was"][:60])
            t = t.replace(pair["was"], pair["now"])
        k[key]["func"] = t
    for key in PARK["handlers"]:
        t = k[key]["func"]
        for pair in PARK["patch"]:
            assert t.count(pair["was"]) == 1, (key, pair["was"][:60])
            t = t.replace(pair["was"], pair["now"])
        k[key]["func"] = t
    # RES-01 Created (BA, 10-22): the Created button's handler (from the final Draft handler), the mounted and IA V2 patches
    m = k["mounted"]["func"]
    for d in CREATED["mount"]:
        assert m.count(d["was"]) == 1, ("mounted", d["was"][:70])
        m = m.replace(d["was"], d["now"])
    for d in CREATED["cancel"]["mount"]:
        assert m.count(d["was"]) == 1, ("mounted cancel", d["was"][:70])
        m = m.replace(d["was"], d["now"])
    # IA output split: the mount's item read (Clone, an editable Edit) also tells os_main, with the flags its kind needs; a read-only view too
    assert m.count(OS_MOUNT_FIELDS[0]) == 1 and m.count(OS_VIEW_AT) == 1, "the mount's batch-field reads moved"
    m = m.replace(OS_MOUNT_FIELDS[0], OS_MOUNT_FIELDS[1] + os_block("the rows, the switch and the columns for this item", "MOUNT", "  "))
    m = m.replace(OS_VIEW_AT, OS_VIEW_AT + os_block("a read-only view shows the split's rows", "VIEW", "  "))
    k["mounted"]["func"] = m
    for key in CREATED["v2Keys"]:
        for d in CREATED["v2"]:
            assert k[key]["func"].count(d["was"]) == 1, (key, d["was"][:60])
            k[key]["func"] = k[key]["func"].replace(d["was"], d["now"])
    created = k["iasvdrft"]["func"]
    for d in CREATED["handler"]:
        assert created.count(d["was"]) == 1, ("created", d["was"][:60])
        created = created.replace(d["was"], d["now"])
    assert "onClick_saveAsCreated" not in names
    ck = Keys(json.dumps(form), SEED + 4).new()
    es.append({"key": ck, "name": "onClick_saveAsCreated", "func": created, "type": k["iasvdrft"].get("type", "js")})
    bc = find(form["list"], "button_created")[0]
    assert bc["events"].get("onClick") == "", bc["events"]
    bc["events"]["onClick"] = ck
    assert created.count("{{") == k["iasvdrft"]["func"].count("{{")
    mirrors["iaForm_onClick_saveAsCreated"] = created
    # RF-09 (BA 10-22): Required's onChange flags a hand-typed value (required_manual)
    rq = fill(js("sc_required_manual.js"), c)
    assert "onChange_requiredQty" not in names and "{{" not in rq
    rk = Keys(json.dumps(form), SEED + 6).new()
    es.append({"key": rk, "name": "onChange_requiredQty", "func": rq, "type": "js"})
    rcol = [x for x in find(form["list"], "stock_movement", "tlm8ve69")[0]["tableColumns"] if x["model"] == "required_qty"][0]
    assert rcol["events"].get("onChange") == "", rcol["events"]
    rcol["events"]["onChange"] = rk
    mirrors["iaForm_onChange_requiredQty"] = rq
    # RES-01 MIN-06 (BA 10-22): the form's own change hook (empty in the base) carries the unsaved-changes marker
    fc = k["onFormChange"]
    assert fc.get("func", "") == "" and not fc.get("rules"), ("onFormChange is no longer empty", fc.get("type"))
    dirty = fill(js("sc_res_dirty.js"), c, {"/*@@RES_FP@@*/": js("res_fp.js").rstrip("\n")})
    assert "{{" not in dirty
    fc["type"] = "js"
    fc["func"] = dirty
    mirrors["iaForm_onFormChange"] = dirty
    # IA output split: the output quantity (before the Small Cycle prologue, which may end the handler) and the plant (after it) tell os_main;
    # os_main and its forwarders bound to the switch, the rows table and every column
    k["iaqty01x"]["func"] = os_block("the output quantity changed: the split's rows follow it", "QTY") + k["iaqty01x"]["func"]
    assert k["fgivan7v"]["func"].endswith("\n")
    k["fgivan7v"]["func"] = k["fgivan7v"]["func"] + os_block("the plant changed: its bins belong to the old plant, so the split is cleared", "PLANT")
    okeys = Keys(json.dumps(form), SEED + 9)
    osm = fill(js("os_main.js"), {"OS_ENABLED": "true" if OS_ENABLED else "false"},
               {"/*@@OS_SPLIT@@*/": shared("os_split.js", ["OS_MAX_ROWS", "OS_EPS", "osS", "osQ8", "osDigits", "osKind", "osSum"])})
    assert osm.count("{{") == 0
    os_keys = {}
    for name, what, body in [("os_main", None, osm)] + OS_FORWARDERS:
        assert name not in names, name
        func = body if what is None else "// %s: IA output split (scratchpad/iasc), handled by os_main\n%s\n" % (what, body)
        os_keys[name] = okeys.new()
        es.append({"key": os_keys[name], "name": name, "func": func, "type": "js"})
        mirrors[name] = func
    sw = find(form["list"], "output_split_on")[0]
    tb = find(form["list"], "output_split")[0]
    for widget_, ev, name in [(sw, "onChange", "os_onChange_switch"), (tb, "onRowAdd", "os_onRowAdd"), (tb, "onRowRemove", "os_onRowRemove")] + \
            [(c, "onChange", "os_onChange_" + c["model"][3:]) for c in tb["tableColumns"]]:
        assert widget_["events"].get(ev) == "", (widget_["model"], ev)
        widget_["events"][ev] = os_keys[name]
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


def user_v55(form):
    """the designer's own option defaults the user's v55 edit (22 October) stored on the title and the header grid, kept by every build"""
    find(form["list"], "item_assembly_tittle")[0]["options"].update({"left": 3, "right": 4, "pad": "*", "desensitization_pattern": "",
                                                                     "desensitization_replace": "", "select-card_n7ge7fmb": []})
    find(form["list"], "grid_x46134mc")[0]["options"]["dataIdentifier"] = False


def sink_hidden(form):
    """the hidden fields between the title row and the header grid (v36's data fields and Small Cycle's) moved right after the action
    bar: under the title they left a ~125 px gap (the user, v55). Hidden inputs take no space (the GD form keeps 11 under its title); the
    two hidden textareas and the hidden fields with change history are what is new there. Keys, models and values are unchanged"""
    top = form["list"]
    order = [w.get("model") for w in top]
    title, grid = order.index("flex_2det1nd2"), order.index("grid_x46134mc")
    strip = top[title + 1:grid]
    assert strip and all(w["options"].get("hidden") is True for w in strip), [w.get("model") for w in strip]
    del top[title + 1:grid]
    bar = [w.get("model") for w in top].index("flex_t6y2yh5r")
    assert "button_draft" in [c.get("model") for c in top[bar].get("list") or []]
    top[bar + 1:bar + 1] = strip


def build(on):
    raw = read(BASE)
    assert hashlib.md5(raw.encode("utf-8")).hexdigest() == BASE_MD5, "base/ia_form_v36.json is not the pinned v36"
    form = json.loads(raw)
    keys = Keys(raw)
    pkeys = Keys(raw, SEED + 1)
    added = build_widgets(form, keys, pkeys) + build_res_widgets(form, Keys(raw, SEED + 2))
    added += build_created_widgets(form, Keys(json.dumps(form), SEED + 3))
    added += build_os_widgets(form, Keys(json.dumps(form), SEED + 7))
    added += build_level_widget(form, Keys(json.dumps(form), SEED + 10))
    mirrors = {}
    if on:
        wf = ids()
        c = {"SC_ENABLED": "true", "SO_IA_PROJECTION": wf["SO_IA_PROJECTION"], "IA_SC_RELINK": wf["IA_SC_RELINK"], "IA_HOLD": wf["IA_HOLD"],
             "RES_ENABLED": "true" if RES_ENABLED else "false"}
        mirrors = patch_handlers(form, c, keys)
        regroup(form, pkeys)
        track_history(form)
        os_place(form)
    user_v55(form)
    sink_hidden(form)
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
