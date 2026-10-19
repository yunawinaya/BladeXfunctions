"""PO form + Excel line import: dev-enabled purchase_order v852 + an Import Lines upload above table_po (the platform's
su-fm-excel-parse, as the GR form's split import) -> onUpload_poLines -> PO_LINE_IMPORT; hidden in View like the save buttons.
The live base carries the import already (since v850), so its handler comes from the repo mirror; a base without it gets it added.
Writes the repo `Purchase Order/POfullJSON.json` (Prettier form recipe) + POonMounted.js, lists every path that differs from dev.
  python3 build_form.py [--write]
"""
import copy
import json
import os
import random
import re
import string
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "scratchpad", "grv2"))
from fmt import render  # noqa: E402

DEV = os.path.join(HERE, "po_form_v852.json")
GR_FORM = os.path.join(ROOT, "Goods Receiving", "GRfullJSON.json")
REPO_FORM = os.path.join(ROOT, "Purchase Order", "POfullJSON.json")
HANDLER = os.path.join(ROOT, "Purchase Order", "LineImport", "onUpload_poLines.js")
MOUNTED_MIRROR = os.path.join(ROOT, "Purchase Order", "POonMounted.js")
MODEL = "import_po_lines"


def find(n, pred, path=()):
    if isinstance(n, dict):
        if pred(n):
            return n, path
        for k, v in n.items():
            r = find(v, pred, path + (k,))
            if r:
                return r
    elif isinstance(n, list):
        for i, v in enumerate(n):
            r = find(v, pred, path + (i,))
            if r:
                return r
    return None


def new_key(doc, rng):
    taken = set(re.findall(r'"([a-z0-9]{8})"', json.dumps(doc)))
    while True:
        k = "".join(rng.choice(string.ascii_lowercase + string.digits) for _ in range(8))
        if k not in taken and not k.isdigit():
            return k


def build():
    rng = random.Random(20261015)
    dev = json.load(open(DEV, encoding="utf-8"))
    form = copy.deepcopy(dev)
    names = {e["name"]: e for e in form["config"]["eventScript"]}
    with open(HANDLER, encoding="utf-8") as f:
        func = f.read()
    assert func.endswith("\n") and not func.endswith("\n\n")
    if "onUpload_poLines" in names:  # the live base carries the import: the repo mirror is the handler's source
        col, path = find(form, lambda n: isinstance(n.get("list"), list) and any(isinstance(c, dict) and c.get("model") == MODEL for c in n["list"]))
        up = [c for c in col["list"] if c.get("model") == MODEL][0]
        assert up["events"]["onUploadSuccess"] == names["onUpload_poLines"]["key"], up["events"]
        assert '"%s",' % MODEL in names["mounted"]["func"], "mounted's View case no longer hides " + MODEL
        names["onUpload_poLines"]["func"] = func
        return dev, form, {MOUNTED_MIRROR: names["mounted"]["func"]}, path
    assert MODEL not in json.dumps(form), "the form already has " + MODEL

    # the upload: the GR form's visible Excel import (split dialog) as the template
    tmpl, _ = find(json.load(open(GR_FORM, encoding="utf-8")), lambda n: n.get("model") == "import_data" and n.get("el") == "su-fm-excel-parse")
    up = copy.deepcopy(tmpl)
    hkey, ckey = new_key(form, rng), None
    while ckey is None or ckey == hkey:
        ckey = new_key(form, rng)
    up.update({"name": "Import Lines", "key": ckey, "model": MODEL})
    up["options"].update({"placeholder": "Import Lines (Excel)", "remoteFunc": "func_" + ckey, "remoteOption": "option_" + ckey, "hidden": False, "disabled": False,
                         "hideLabel": True})
    up["options"]["customProps"] = dict(up["options"]["customProps"], buttonText="Import Lines (Excel)", uploadingText="Reading...")
    up["events"] = dict(up["events"], onUploadSuccess=hkey)

    col, path = find(form, lambda n: isinstance(n.get("list"), list) and any(isinstance(c, dict) and c.get("model") == "table_po" for c in n["list"]))
    i = [c.get("model") for c in col["list"]].index("table_po")
    col["list"].insert(i, up)

    form["config"]["eventScript"].append({"key": hkey, "name": "onUpload_poLines", "func": func, "type": "js"})

    # View: hidden with the save buttons
    m = names["mounted"]
    old = '      case "View":\n        this.hide([\n          "link_billing_address",\n          "link_shipping_address",\n          "button_save_as_draft",\n          "button_save_as_issue",\n        ]);\n'
    assert m["func"].count(old) == 1, "mounted's View case moved"
    m["func"] = m["func"].replace(old, old.replace('          "button_save_as_issue",\n', '          "button_save_as_issue",\n          "%s",\n' % MODEL))
    return dev, form, {MOUNTED_MIRROR: m["func"]}, path


def diffs(a, b, path="", out=None):
    out = [] if out is None else out
    if type(a) != type(b):
        out.append(path)
    elif isinstance(a, dict):
        for k in sorted(set(a) | set(b), key=str):
            if k not in a or k not in b:
                out.append(path + "/" + str(k))
            else:
                diffs(a[k], b[k], path + "/" + str(k), out)
    elif isinstance(a, list):
        if len(a) != len(b):
            out.append(path + " (length %d -> %d)" % (len(a), len(b)))
        for i, (x, y) in enumerate(zip(a, b)):
            diffs(x, y, path + "/" + str(i), out)
    elif a != b:
        out.append(path)
    return out


if __name__ == "__main__":
    dev, form, mirrors, path = build()
    print("Import Lines placed in", "/".join(map(str, path)), "before table_po")
    if "onUpload_poLines" in json.dumps(dev):
        print("  differs from dev:", diffs(dev, form) or "nothing")
    else:
        # the three intended changes undone must give dev back exactly
        chk = copy.deepcopy(form)
        col, _ = find(chk, lambda n: isinstance(n.get("list"), list) and any(isinstance(c, dict) and c.get("model") == MODEL for c in n["list"]))
        col["list"] = [c for c in col["list"] if c.get("model") != MODEL]
        chk["config"]["eventScript"] = [e for e in chk["config"]["eventScript"] if e["name"] != "onUpload_poLines"]
        dm = [e for e in dev["config"]["eventScript"] if e["name"] == "mounted"][0]["func"]
        [e for e in chk["config"]["eventScript"] if e["name"] == "mounted"][0]["func"] = dm
        left = diffs(dev, chk)
        print("  everything else identical to dev:", not left, left[:5])
        nm = [e for e in form["config"]["eventScript"] if e["name"] == "mounted"][0]["func"]
        print("  mounted: +", [l for l in nm.splitlines() if l not in dm.splitlines()])
    if "--write" in sys.argv:
        open(REPO_FORM, "w", encoding="utf-8").write(render(form, "indent"))
        for p, text in mirrors.items():
            open(p, "w", encoding="utf-8").write(text)
        print("  wrote", os.path.relpath(REPO_FORM, ROOT), "+", [os.path.relpath(p, ROOT) for p in mirrors])
