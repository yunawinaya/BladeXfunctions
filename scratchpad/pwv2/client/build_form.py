"""Phase 4 desktop Putaway form: dev-enabled transfer_order_putaway v364 + the new handlers, table settings, the V2
Completed handler and the hidden job_line_key columns (records sub-table, In Transit Detail).

Writes (repo):
  Putaway/PutawayFullJSON.json + every .js mirror of the form (exact embedded strings; unchanged handlers re-seeded
  from dev), Putaway/AsyncV2/pwV2_onClick_completed.js, In Transit Detail/InTransitDetailFullJSON.json (dev v4 +
  job_line_key), schema files under Putaway/schema/ and In Transit Detail/schema/. Then lists every path that differs
  from dev (must be only the intended ones).
  python3 build_form.py
"""
import copy
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(HERE, "..", "..", "grv2"))
from fmt import render  # noqa: E402

DEV = os.path.join(HERE, "pw_form_v364.json")
IT_DEV = os.path.join(HERE, "it_form_v4.json")
NEW = os.path.join(HERE, "new_handlers")
SCHEMA_DEV = os.path.join(HERE, "dev_schema")  # su_code_tables.schema_json on dev (saved 2026-09-22, with forms v364 / v4)
PW = os.path.join(ROOT, "Putaway")
IT = os.path.join(ROOT, "In Transit Detail")

CHANGED = {  # eventScript name -> new handler file
    "mounted": "mounted.js",
    "func_getPutawayStrategy": "func_getPutawayStrategy.js",
    "onClick_save_split": "onClick_save_split.js",
    "onClick_cancel_split": "onClick_cancel_split.js",
}
VALIDATOR = "validator_putaway_qty.js"
V2 = ("nm24acbm", "pwV2_onClick_completed", "pwV2_onClick_completed.js")  # new eventScript entry (key, name, file)
CLASSIC_COMPLETED = "7qu4ym1i"  # onClick_workflowComplete: stays, NOT_ELIGIBLE fallback
MIRRORS = {  # repo mirror -> handler (every mirror of this form is rewritten from the built form)
    "PutawayOnMounted.js": "mounted",
    "PutawayGetStrategy.js": "func_getPutawayStrategy",
    "PutawayConfirmSplitDialog.js": "onClick_save_split",
    "PutawayCancelSplit.js": "onClick_cancel_split",
    "PutawayQtyValidation.js": "<validator>",
    "AsyncV2/pwV2_onClick_completed.js": "pwV2_onClick_completed",
    "PutawayClearSplit.js": "onConfirm_edit_split",
    "PutawayConfirmSplitting.js": "onClick_confirm_split",
    "PutawayDeleteSplitRow.js": "onRowRemove_SplitTable",
    "PutawayOpenSplit.js": "onClick_split_item",
    "PutawaySaveAsCompleted.js": "onSave_Completed",
    "PutawayOnChangeGR.js": "onChange_GoodsReceiving",
    "PutawayOnChangeSN.js": "onChange_selectedSNinDialog",
    "PutawaySelectSN.js": "onChange_selectSN",
    "PutawayWorkflowCompleted.js": "onClick_workflowComplete",
}
# GD / Picking table settings (Picking v429: paging off, autoPaging on, 10 per page, 200 ms, no virtual table)
TABLE_SETTINGS = {"virtualTable": False, "autoLoadDelay": 200, "pageSize": 10, "autoPaging": True, "autoPageSize": 10}
SETTINGS_TABLES = ("table_putaway_item", "table_putaway_records")
# the column expressions the new handlers rely on (asserted unchanged) and the one changed: an absent hu_data (a stored
# line's empty column is not loaded into the row) disabled Split on every stored line
TARGET_CATEGORY_EXPR = "{{arguments[0].row.item_bundle_id && !arguments[0].row.parent_fm_key}}"
SPLIT_BUTTON = ("{{(arguments[0].row.hu_data !== '' && arguments[0].row.hu_data !== null) || arguments[0].row.item_bundle_id}}",
                "{{!!arguments[0].row.hu_data || !!arguments[0].row.item_bundle_id}}")
# hidden job_line_key (varchar 255) for the background completion's re-runs, cloned from a varchar input of the same table
RECORD_FIELD = ("job_line_key", "71zzo5do", "Job Line Key", "confirmed_by")
IT_FIELD = ("job_line_key", "9ldrewpr", "Job Line Key", "source_transit_id")


def read(name):
    with open(os.path.join(NEW, name), encoding="utf-8") as f:
        text = f.read()
    assert text.endswith("\n") and not text.endswith("\n\n"), name + ": one trailing newline"
    return text


def tables(form):
    t = form["list"][2]["tabs"][0]["list"][0]
    r = form["list"][2]["tabs"][1]["list"][0]
    assert t["model"] == "table_putaway_item" and t["key"] == "jz8m9w3h", "table_putaway_item moved"
    assert r["model"] == "table_putaway_records" and r["key"] == "vrqs3cmr", "table_putaway_records moved"
    return t, r


def column(table, model):
    cols = [c for c in table["tableColumns"] if c["model"] == model]
    assert len(cols) == 1, model
    return cols[0]


def clone_field(template, model, key, label, hidden=True):
    field = copy.deepcopy(template)
    field.update({"name": label, "key": key, "model": model})
    field["options"]["remoteFunc"] = "func_" + key
    field["options"]["remoteOption"] = "option_" + key
    field["options"]["hidden"] = hidden
    field["options"]["disabled"] = True
    return field


def build():
    dev = json.load(open(DEV, encoding="utf-8"))
    form = copy.deepcopy(dev)
    text = json.dumps(dev, ensure_ascii=False)
    es = form["config"]["eventScript"]
    by_name = {}
    for e in es:
        by_name.setdefault(e["name"], []).append(e)
    for name, src in CHANGED.items():
        entries = by_name[name]
        assert len(entries) == 1 and entries[0].get("type") == "js" and not entries[0].get("rules"), name
        entries[0]["func"] = read(src)

    key, name, src = V2
    assert key not in text and name not in by_name
    es.append({"key": key, "name": name, "func": read(src), "type": "js"})
    buttons = form["list"][5]["list"]
    btn = [b for b in buttons if b.get("model") == "button_completed"]
    assert len(btn) == 1 and btn[0]["events"]["onClick"] == CLASSIC_COMPLETED
    assert by_name["onClick_workflowComplete"][0]["key"] == CLASSIC_COMPLETED
    btn[0]["events"]["onClick"] = key

    items, records = tables(form)
    qty = column(items, "putaway_qty")
    assert qty["options"]["validator"] == qty["rules"][0]["func"] and len(qty["rules"]) == 1
    validator = read(VALIDATOR)
    qty["options"]["validator"] = validator
    qty["rules"][0]["func"] = validator

    for t in (items, records):
        for k, v in TABLE_SETTINGS.items():
            assert k in t["options"], k
            t["options"][k] = v
    assert column(items, "target_inv_category")["options"]["disabled"] == TARGET_CATEGORY_EXPR
    split = column(items, "button_split")
    assert split["options"]["disabled"] == SPLIT_BUTTON[0]
    split["options"]["disabled"] = SPLIT_BUTTON[1]

    model, fkey, label, template = RECORD_FIELD
    assert fkey not in text and model not in [c["model"] for c in records["tableColumns"]]
    records["tableColumns"].append(clone_field(column(records, template), model, fkey, label))

    it_dev = json.load(open(IT_DEV, encoding="utf-8"))
    it_form = copy.deepcopy(it_dev)
    lst = it_form["list"][0]["columns"][0]["list"]
    model, fkey, label, template = IT_FIELD
    tmpl = [c for c in lst if c.get("model") == template]
    assert len(tmpl) == 1 and fkey not in json.dumps(it_dev) and model not in [c.get("model") for c in lst]
    lst.insert(lst.index(tmpl[0]) + 1, clone_field(tmpl[0], model, fkey, label))
    return dev, form, it_dev, it_form


def handler_strings(form):
    out = {e["name"]: e.get("func") or "" for e in form["config"]["eventScript"]}
    out["<validator>"] = column(tables(form)[0], "putaway_qty")["options"]["validator"]
    return out


def schema_with(schema, field, template_name, nested=None):
    """field (model, key, label, template) cloned from the template property, inserted after it."""
    model, key, label, _ = field
    holder = schema["properties"] if nested is None else schema["properties"][nested]["properties"]
    assert template_name in holder and model not in holder
    out = {}
    for name, entry in holder.items():
        out[name] = entry
        if name == template_name:
            prop = copy.deepcopy(entry)
            prop.update({"key": key, "name": model, "title": label, "description": label})
            out[model] = prop
    new = copy.deepcopy(schema)
    if nested is None:
        new["properties"] = out
    else:
        new["properties"][nested]["properties"] = out
    return new


def schemas():
    load = lambda n: json.load(open(os.path.join(SCHEMA_DEV, n + ".schema_json.dev.json"), encoding="utf-8"))
    to = load("transfer_order_putaway")
    sub = load("transfer_order_putaway_vrqs3cmr_sub")
    it = load("in_transit_detail")
    assert to["properties"]["table_putaway_records"]["key"] == "vrqs3cmr"
    assert to["properties"]["table_putaway_records"]["properties"]["confirmed_by"] == sub["properties"]["confirmed_by"]
    return [
        (os.path.join(PW, "schema", "transfer_order_putaway.schema_json.json"), to,
         schema_with(to, RECORD_FIELD, "confirmed_by", nested="table_putaway_records")),
        (os.path.join(PW, "schema", "transfer_order_putaway_vrqs3cmr_sub.schema_json.json"), sub,
         schema_with(sub, RECORD_FIELD, "confirmed_by")),
        (os.path.join(IT, "schema", "in_transit_detail.schema_json.json"), it,
         schema_with(it, IT_FIELD, "source_transit_id")),
    ]


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


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


if __name__ == "__main__":
    sys.exit("Superseded: its v364 / v4 bases would undo the live Putaway (v367) and In Transit Detail (v5) forms; "
             "scratchpad/grv2/switchon/build_switchon.py builds the Putaway form now - re-seed on the live versions before reusing this.")
    dev, form, it_dev, it_form = build()
    for path, obj in ((os.path.join(PW, "PutawayFullJSON.json"), form), (os.path.join(IT, "InTransitDetailFullJSON.json"), it_form)):
        text = render(obj, "indent")
        assert json.loads(text) == obj
        write(path, text)
        print("wrote", os.path.relpath(path, ROOT), "== built:", json.load(open(path, encoding="utf-8")) == obj)
    built, seeded = handler_strings(form), handler_strings(dev)
    for mirror, handler in MIRRORS.items():
        path = os.path.join(PW, mirror)
        before = open(path, encoding="utf-8").read() if os.path.exists(path) else None
        write(path, built[handler])
        state = "new" if before is None else ("unchanged" if before == built[handler] else "rewritten")
        origin = "dev" if seeded.get(handler) == built[handler] else "new handler"
        print("mirror %-36s %-9s (%s)" % (mirror, state, origin))
    print("Putaway form paths differing from dev v364:")
    for p in diff_paths(dev, form):
        print("   ", p)
    print("In Transit Detail form paths differing from dev v4:")
    for p in diff_paths(it_dev, it_form):
        print("   ", p)
    for path, old, new in schemas():
        write(path, json.dumps(new, ensure_ascii=False, indent=1))
        print("schema", os.path.relpath(path, ROOT), "differs from dev at:", diff_paths(old, json.load(open(path, encoding="utf-8"))))
