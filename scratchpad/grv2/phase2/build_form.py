"""Phase 2 GR form: dev-enabled goods_receiving v1472 + the new handlers + table_gr settings.

Writes the repo `Goods Receiving/GRfullJSON.json` (Prettier form recipe, as the repo file is) and the .js mirrors as
the exact embedded strings, then lists every path that differs from dev (must be only the intended ones).
  python3 build_form.py            # build + verify
"""
import copy
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(HERE, ".."))
from fmt import render  # noqa: E402

DEV = os.path.join(HERE, "gr_form_v1472.json")
REPO_FORM = os.path.join(ROOT, "Goods Receiving", "GRfullJSON.json")
NEW = os.path.join(HERE, "new_handlers")
# su_code_tables.schema_json of goods_receiving on dev (saved 2026-09-22 20:03, with form v1472), read-only pull
DEV_SCHEMA = sys.argv[1] if len(sys.argv) > 1 else None
REPO_SCHEMA = os.path.join(ROOT, "Goods Receiving", "schema", "goods_receiving.schema_json.json")

HANDLERS = {  # eventScript name -> (new handler file, repo .js mirror)
    "func_processGRLineItem": ("func_processGRLineItem.js", "GRprocessGRLineItem.js"),
    "mounted": ("mounted.js", "GRonMounted.js"),
    "onChange_received_qty": ("onChange_received_qty.js", "GRreceivedQty.js"),
    "onChange_base_received_qty": ("onChange_base_received_qty.js", "GRbaseReceivedQty.js"),
    "onRowRemove_item": ("onRowRemove_item.js", "GRdeleteSubFormRow.js"),
    "onClick_save_as_draft": ("onClick_save_as_draft.js", None),
    "onClick_save_as_created": ("onClick_save_as_created.js", "GRworkflowCreated.js"),
}
# hidden header fields for the background workflows, cloned from grn_uuid (hidden input, varchar 255)
NEW_FIELDS = [("gr_v2_job_id", "gv2jb8k4", "V2 Job ID"), ("gr_idem_key", "gidm5q8w", "Idempotency Key")]
TEMPLATE_MODEL = "grn_uuid"
VALIDATOR = ("validator_received_qty.js", "GRquantityValidation.js")
TABLE_SETTINGS = {"virtualTable": False, "autoLoadDelay": 200, "pageSize": 10}  # as GD / Picking
# per-line button states as column expressions instead of one runtime state per line
COLUMN_DISABLED = {
    "select_serial_number": (False, "{{arguments[0].row.is_serialized_item !== 1}}"),
    "button_formula": (False, "{{arguments[0].row.has_formula !== 1}}"),
}


def read(name):
    with open(os.path.join(NEW, name), encoding="utf-8") as f:
        text = f.read()
    assert text.endswith("\n") and not text.endswith("\n\n"), name + ": one trailing newline, as the dev strings"
    return text


def table_gr(form):
    t = form["list"][9]["tabs"][0]["list"][0]
    assert t["type"] == "table" and t["model"] == "table_gr", "table_gr moved"
    return t


def build():
    dev = json.load(open(DEV, encoding="utf-8"))
    form = copy.deepcopy(dev)
    by_name = {}
    for e in form["config"]["eventScript"]:
        by_name.setdefault(e["name"], []).append(e)
    mirrors = {}
    for name, (src, mirror) in HANDLERS.items():
        entries = by_name[name]
        assert len(entries) == 1 and entries[0].get("type") == "js" and not entries[0].get("rules"), name
        entries[0]["func"] = read(src)
        if mirror:
            mirrors[mirror] = entries[0]["func"]

    t = table_gr(form)
    col = t["tableColumns"][11]
    assert col["model"] == "received_qty" and col["options"]["validator"] == col["rules"][0]["func"]
    validator = read(VALIDATOR[0])
    col["options"]["validator"] = validator
    col["rules"][0]["func"] = validator
    mirrors[VALIDATOR[1]] = validator

    for k, v in TABLE_SETTINGS.items():
        assert k in t["options"], k
        t["options"][k] = v
    for model, (was, expr) in COLUMN_DISABLED.items():
        cols = [c for c in t["tableColumns"] if c["model"] == model]
        assert len(cols) == 1 and cols[0]["options"]["disabled"] is was, model
        cols[0]["options"]["disabled"] = expr

    header = form["list"][6]["columns"][0]["list"]
    template = [c for c in header if c.get("model") == TEMPLATE_MODEL]
    assert len(template) == 1 and template[0]["options"]["hidden"] is True and template[0]["type"] == "input"
    text = json.dumps(dev, ensure_ascii=False)
    for model, key, label in NEW_FIELDS:
        assert key not in text and ('"model": "%s"' % model) not in json.dumps(dev, ensure_ascii=False, indent=1), model
        field = copy.deepcopy(template[0])
        field.update({"name": label, "key": key, "model": model})
        field["options"]["remoteFunc"] = "func_" + key
        field["options"]["remoteOption"] = "option_" + key
        header.append(field)
    return dev, form, mirrors


def build_schema(path):
    schema = json.load(open(path, encoding="utf-8"))
    props = schema["properties"]
    assert TEMPLATE_MODEL in props and all(m not in props for m, _, _ in NEW_FIELDS)
    out = {}
    for name, entry in props.items():
        out[name] = entry
        if name == TEMPLATE_MODEL:
            for model, key, label in NEW_FIELDS:
                field = copy.deepcopy(entry)
                field.update({"key": key, "name": model, "title": label, "description": label})
                out[model] = field
    new = dict(schema, properties=out)
    return schema, new


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
            out.append(path + " (length)")
        for i, (x, y) in enumerate(zip(a, b)):
            out += diff_paths(x, y, "%s[%d]" % (path, i))
    elif a != b or type(a) is not type(b):
        out.append(path)
    return out


if __name__ == "__main__":
    dev, form, mirrors = build()
    text = render(form, "indent")
    assert json.loads(text) == form
    with open(REPO_FORM, "w", encoding="utf-8") as f:
        f.write(text)
    for mirror, code in mirrors.items():
        with open(os.path.join(ROOT, "Goods Receiving", mirror), "w", encoding="utf-8") as f:
            f.write(code)
    written = json.load(open(REPO_FORM, encoding="utf-8"))
    print("repo form == built form:", written == form)
    print("paths differing from dev v1472:")
    for p in diff_paths(dev, written):
        print("  ", p)
    for mirror, code in mirrors.items():
        same = open(os.path.join(ROOT, "Goods Receiving", mirror), encoding="utf-8").read() == code
        print("mirror %-26s == embedded: %s" % (mirror, same))
    if DEV_SCHEMA:
        old_schema, new_schema = build_schema(DEV_SCHEMA)
        os.makedirs(os.path.dirname(REPO_SCHEMA), exist_ok=True)
        with open(REPO_SCHEMA, "w", encoding="utf-8") as f:
            f.write(json.dumps(new_schema, ensure_ascii=False, indent=1))
        print("schema paths differing from dev:", diff_paths(old_schema, json.load(open(REPO_SCHEMA, encoding="utf-8"))))
