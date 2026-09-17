#!/usr/bin/env python3
"""Add the "Import Item" toolbar button + dialog to Item/ItemListPageJSON.json.

Idempotent: re-running replaces the block it added rather than duplicating it.
The dialog is cloned from the existing `dialog_update` components so it carries
exactly the platform options that are known to work on this page.

    python3 scratchpad/patch_item_list_import_dialog.py
"""
import copy, json, os, random, string, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE = os.path.join(ROOT, "Item", "ItemListPageJSON.json")
HANDLER = os.path.join(ROOT, "Item", "ItemBulkImportConfirm.js")

DIALOG_MODEL = "dialog_item_import"

raw = open(PAGE).read()
page = json.loads(raw)

# ------------------------------------------------------- strip a previous run
# Done before the keys are collected so a re-run mints the SAME seeded keys
# instead of skipping over the ones it added last time.
OWNED_PREFIXES = ("onImportFileUploadSuccess_", "onImportFileUploadError_",
                  "onDialogItemImportConfirm_", "onDialogItemImportCancel_")

_toolbar = page["list"][0]["options"]["customProps"]["toolbar"]
_stale_keys = set()
for b in _toolbar:
    if b.get("title") == "Import Item":
        for ev in b.get("events") or []:
            if ev.get("key"):
                _stale_keys.add(ev["key"])
_toolbar[:] = [b for b in _toolbar if b.get("title") != "Import Item"]
page["list"] = [c for c in page["list"] if c.get("model") != DIALOG_MODEL]
page["config"]["eventScript"][:] = [
    s for s in page["config"]["eventScript"]
    if s.get("key") not in _stale_keys
    and not str(s.get("name", "")).startswith(OWNED_PREFIXES)
]

# ------------------------------------------------------------------ key minting
used = set()
def collect(n):
    if isinstance(n, dict):
        for f in ("key", "remoteFunc", "remoteOption"):
            v = n.get(f)
            if isinstance(v, str) and v:
                used.add(v.replace("func_", "").replace("option_", ""))
        for v in n.values():
            collect(v)
    elif isinstance(n, list):
        for i in n:
            collect(i)
collect(page)

# Seeded so a re-run mints the same keys and the diff stays stable.
rng = random.Random(20260917)
def mint():
    while True:
        k = "".join(rng.choice(string.ascii_lowercase + string.digits) for _ in range(8))
        if k not in used:
            used.add(k)
            return k

K_DIALOG, K_HELP, K_FILE, K_OK, K_FAIL = (mint() for _ in range(5))
E_OPEN, E_UP_OK, E_UP_ERR, E_CONFIRM, E_CANCEL = (mint() for _ in range(5))

# ------------------------------------------------------------- source templates
src_dialog = next(c for c in page["list"] if c.get("model") == "dialog_update")
src_file = next(c for c in src_dialog["list"] if c.get("model") == "update_file")
src_text = next(c for c in src_dialog["list"] if c.get("model") == "upload_successfully_text")

def retag(node, key, model, name):
    n = copy.deepcopy(node)
    n["key"] = key
    n["model"] = model
    n["name"] = name
    n["options"]["remoteFunc"] = "func_" + key
    n["options"]["remoteOption"] = "option_" + key
    return n

HELP_HTML = (
    "<b>Columns:</b> Item Code · <b>Item Name</b> · Description · "
    "<b>Item Category</b> · <b>Base UOM</b> · Item Properties · Item Type · "
    "Stock Control · Active · Barcode · Item Group · Batch Management · "
    "Batch Number Generation<br>"
    "Bold = required. Blank Item Code → auto-numbered. One row = one item. "
    "Up to 1000 rows per file. Any invalid row blocks the whole file."
)

help_text = retag(src_text, K_HELP, "import_help_text", "Text")
help_text["options"].update({
    "defaultValue": HELP_HTML,
    "hidden": False,
    "isRich": True,
    "color": "#8C8C8C",
    "fontSize": "13px",
    "fontWeight": "400",
    "lineHeight": "20px",
    "margin": ["", "", "12px", ""],
})

file_field = retag(src_file, K_FILE, "import_file", "Excel")
file_field["events"] = {
    "onUploadSuccess": E_UP_OK,
    "onUploadError": E_UP_ERR,
    "onFocus": "",
    "onBlur": "",
    "change": "",
}

ok_text = retag(src_text, K_OK, "import_ok_text", "Text")
ok_text["options"]["defaultValue"] = "Upload successfully"

fail_text = retag(src_text, K_FAIL, "import_fail_text", "Text")
fail_text["options"].update({"defaultValue": "Upload failed", "color": "#FF4D4F"})

dialog = copy.deepcopy(src_dialog)
dialog["key"] = K_DIALOG
dialog["model"] = DIALOG_MODEL
dialog["name"] = "Import Item"
dialog["options"].update({
    "title": "Import Item",
    "okText": "Import",
    "cancelText": "Cancel",
    "width": "50%",
    "top": "15vh",
    "remoteFunc": "func_" + K_DIALOG,
    "remoteOption": "option_" + K_DIALOG,
})
dialog["events"] = {"onConfirm": E_CONFIRM, "onCancel": E_CANCEL}
dialog["list"] = [help_text, file_field, ok_text, fail_text]

# ------------------------------------------------------------------- page edits
# 1. the dialog itself
page["list"].append(dialog)

# 2. toolbar button, right after "Update"
toolbar = _toolbar
button = {
    "title": "Import Item",
    "permission": "item_bulk_import",
    "icon": "upload",
    "type": "custom",
    "showBottomBar": 1,
    "dialogPosition": "center",
    "dialogWidth": "",
    "close_on_click_modal": 1,
    "events": [{"key": E_OPEN, "name": "onCustom7rq6zmn4func_" + E_OPEN}],
    "collapse": 1,
}
at = next((i for i, b in enumerate(toolbar) if b.get("title") == "Update"), len(toolbar) - 1)
toolbar.insert(at + 1, button)

# 3. event scripts
confirm_src = open(HANDLER).read()
scripts = [
    {"key": E_OPEN, "name": "onCustom7rq6zmn4func_" + E_OPEN, "func": "", "type": "rule",
     "rules": [
         {"key": mint(), "action": "openDialog",
          "options": {"condition": "", "isCondition": False, "field": DIALOG_MODEL}},
         {"key": mint(), "action": "js",
          "options": {"func": "this.setData({ '%s.import_file': '' });\n"
                              "this.hide(['%s.import_ok_text', '%s.import_fail_text']);"
                              % (DIALOG_MODEL, DIALOG_MODEL, DIALOG_MODEL)}},
     ]},
    {"key": E_UP_OK, "name": "onImportFileUploadSuccess_" + E_UP_OK, "func": "", "type": "rule",
     "rules": [
         {"key": mint(), "action": "display",
          "options": {"fields": [DIALOG_MODEL + ".import_ok_text"],
                      "condition": "", "isCondition": False}},
         {"key": mint(), "action": "hide",
          "options": {"fields": [DIALOG_MODEL + ".import_fail_text"],
                      "condition": "", "isCondition": False}},
     ]},
    {"key": E_UP_ERR, "name": "onImportFileUploadError_" + E_UP_ERR, "func": "", "type": "rule",
     "rules": [
         {"key": mint(), "action": "hide",
          "options": {"fields": [DIALOG_MODEL + ".import_ok_text"],
                      "condition": "", "isCondition": False}},
         {"key": mint(), "action": "display",
          "options": {"fields": [DIALOG_MODEL + ".import_fail_text"],
                      "condition": "", "isCondition": False}},
     ]},
    {"key": E_CONFIRM, "name": "onDialogItemImportConfirm_" + E_CONFIRM,
     "func": confirm_src, "type": "js"},
    {"key": E_CANCEL, "name": "onDialogItemImportCancel_" + E_CANCEL, "func": "", "type": "rule",
     "rules": [
         {"key": mint(), "action": "closeDialog",
          "options": {"condition": "", "isCondition": False, "field": DIALOG_MODEL}},
     ]},
]
page["config"]["eventScript"].extend(scripts)

# The file is Prettier-formatted: short ARRAYS collapse, short OBJECTS keep the
# wrapping they were given. indent=2 + `--object-wrap preserve` reproduces it
# byte for byte, so the diff shows only what this script added.
pretty = subprocess.run(
    ["npx", "--yes", "prettier", "--parser", "json", "--object-wrap", "preserve"],
    input=json.dumps(page, ensure_ascii=False, indent=2),
    capture_output=True, text=True)
if pretty.returncode:
    sys.exit(pretty.stderr.strip() or "prettier failed")

with open(PAGE, "w") as fh:
    fh.write(pretty.stdout)

with open(PAGE) as fh:
    assert json.load(fh) == page

print("dialog   %s (%s)" % (DIALOG_MODEL, K_DIALOG))
print("file     %s.import_file (%s)" % (DIALOG_MODEL, K_FILE))
print("events   open=%s uploadOk=%s uploadErr=%s confirm=%s cancel=%s"
      % (E_OPEN, E_UP_OK, E_UP_ERR, E_CONFIRM, E_CANCEL))
