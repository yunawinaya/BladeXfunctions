"""Phase 1b PO form: dev-enabled purchase_order v848 (= v847 + the Phase 1a save handlers) + the Phase 1a handlers as
the repo holds them at build time (onClick_save_issued / onClick_save_draft, owned by Phase 1a) + the Phase 1b handlers.

Writes the repo `Purchase Order/POfullJSON.json` (Prettier form recipe, as the repo file is) and the .js mirrors of the
changed handlers as the exact embedded strings, then lists every path that differs from dev (must be only the
intended ones).
  python3 build_form.py
"""
import copy
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(HERE, "..", "grv2"))
from fmt import render  # noqa: E402

DEV = os.path.join(HERE, "po_form_v848.json")
REPO_FORM = os.path.join(ROOT, "Purchase Order", "POfullJSON.json")
NEW = os.path.join(HERE, "new_handlers")
PHASE_1A = ("onClick_save_issued", "onClick_save_draft")  # taken from the repo file as it is, never rebuilt here

HANDLERS = {  # eventScript name -> (new handler file, repo .js mirror)
    "mounted": ("mounted.js", "POonMounted.js"),
    "POcalculation": ("POcalculation.js", "POcalculation.js"),
    "onConfirm_batchAddItem": ("onConfirm_batchAddItem.js", "PObatchAddLineItem.js"),
    "onConfirm_batchAddItemBundle": ("onConfirm_batchAddItemBundle.js", None),
    "POnumber_onChange_fillback_currency": ("POnumber_onChange_fillback_currency.js", "POonChangeSupplier.js"),
    "onChange_plant": ("onChange_plant.js", "POonChangePlant.js"),
    "onClick_2jyomatr": ("onClick_2jyomatr.js", None),  # legacy Issue save: HTML dialog values escaped, no mirror
    # the repo mirror's 4-dp rounding (never deployed) + the currency code escaped in the HTML confirm
    "onClick_refreshExchangeRate": ("onClick_refreshExchangeRate.js", "POrefreshExchangeRate.js"),
}
# rule-type handlers: (name, rule index) -> new js action; a refresh of the whole column becomes a js action on the row
RULE_JS = {
    ("onChange_tax_percent", 0): ("onChange_tax_percent.rule0.js", "f7tpr0w1", "refreshFieldOptionData"),
    ("onChange_taxInclusive", 0): ("onChange_taxInclusive.rule0.js", None, "js"),
}
QUANTITY_ON_READY = "73i6eolq"  # POcalculation on every quantity cell's ready event


def read(name, trailing_newline=None):
    with open(os.path.join(NEW, name), encoding="utf-8") as f:
        text = f.read()
    assert text.endswith("\n") and not text.endswith("\n\n"), name + ": one trailing newline"
    return text if trailing_newline is not False else text[:-1]


def entries_by_name(form):
    out = {}
    for e in form["config"]["eventScript"]:
        assert e["name"] not in out, "duplicate handler name " + e["name"]
        out[e["name"]] = e
    return out


def table_po(form):
    t = form["list"][13]["tabs"][0]["list"][0]["columns"][0]["list"][0]
    assert t["type"] == "table" and t["model"] == "table_po" and t["key"] == "2ukyuanr", "table_po moved"
    return t


def column(form, model):
    cols = [c for c in table_po(form)["tableColumns"] if c["model"] == model]
    assert len(cols) == 1, model
    return cols[0]


def diff_paths(a, b, path=""):
    out = []
    if isinstance(a, dict) and isinstance(b, dict):
        for k in list(a.keys()) + [k for k in b if k not in a]:
            if k not in a or k not in b:
                out.append(path + "." + k + " (added/removed)")
            else:
                out += diff_paths(a[k], b[k], path + "." + k)
        if list(a.keys()) != [k for k in b.keys() if k in a]:
            out.append(path + " (key order)")
    elif isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            out.append(path + " (length %d -> %d)" % (len(a), len(b)))
        for i, (x, y) in enumerate(zip(a, b)):
            out += diff_paths(x, y, "%s[%d]" % (path, i))
    elif a != b or type(a) is not type(b):
        out.append(path)
    return out


def base_form():
    dev = json.load(open(DEV, encoding="utf-8"))
    repo = json.load(open(REPO_FORM, encoding="utf-8"))
    base = copy.deepcopy(dev)
    dev_by, repo_by, base_by = entries_by_name(dev), entries_by_name(repo), entries_by_name(base)
    for name in PHASE_1A:
        base_by[name]["func"] = repo_by[name]["func"]
    return dev, repo, base


def build(base):
    form = copy.deepcopy(base)
    by_name = entries_by_name(form)
    mirrors = {}
    for name, (src, mirror) in HANDLERS.items():
        e = by_name[name]
        assert e.get("type") == "js", name
        old = e["func"]
        e["func"] = read(src, trailing_newline=old.endswith("\n"))
        if mirror:
            mirrors[mirror] = e["func"]

    keys = {e["key"] for e in form["config"]["eventScript"]}
    text = json.dumps(form, ensure_ascii=False)
    for (name, i), (src, new_key, was) in RULE_JS.items():
        e = by_name[name]
        assert e.get("type") == "rule" and e["rules"][i]["action"] == was, (name, i)
        code = read(src, trailing_newline=False)
        if was == "js":
            e["rules"][i]["options"]["func"] = code
        else:
            assert new_key not in text and new_key not in keys
            e["rules"][i] = {"key": new_key, "action": "js", "options": {"func": code}}

    qty = column(form, "quantity")
    assert qty["events"].get("onReady") == QUANTITY_ON_READY and qty["events"].get("onChange") == QUANTITY_ON_READY
    qty["events"]["onReady"] = ""
    return form, mirrors


if __name__ == "__main__":
    dev, repo, base = base_form()
    form, mirrors = build(base)
    text = render(form, "indent")
    assert json.loads(text) == form
    with open(REPO_FORM, "w", encoding="utf-8") as f:
        f.write(text)
    for mirror, code in mirrors.items():
        with open(os.path.join(ROOT, "Purchase Order", mirror), "w", encoding="utf-8") as f:
            f.write(code)
    written = json.load(open(REPO_FORM, encoding="utf-8"))
    print("repo form == built form:", written == form)
    print("Phase 1a handlers kept from the repo file:", all(
        entries_by_name(written)[n]["func"] == entries_by_name(repo)[n]["func"] for n in PHASE_1A))
    print("paths differing from dev v848:")
    for p in diff_paths(dev, written):
        print("   ", p)
    for mirror, code in mirrors.items():
        same = open(os.path.join(ROOT, "Purchase Order", mirror), encoding="utf-8").read() == code
        print("mirror %-24s == embedded: %s" % (mirror, same))
