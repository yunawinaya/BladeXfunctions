"""Phase 1a client: the PO form's two save handlers send a slim payload and validate the quantities in one pass.

Built on the DEV-enabled form (v847, pulled with `.dbtools/form --dev pull purchase_order -o <file>`; the repo copy is behind):
  - onClick_save_issued: one this.validate(...) over every line's quantity (was one awaited call per line, each of which
    re-walked and deep-copied the whole table); the payload is poSlimPayload(values), re-sent as-is by every prompt
  - onClick_save_draft: the same slim payload
Writes "Purchase Order/POfullJSON.json" (repo format) and the mirrors POsaveAsIssued.js / POsaveAsDraft.js (raw strings).
Usage: python3 patch_po_form.py <dev v847 form json>"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(HERE, ".."))
from fmt import render  # noqa: E402

FORM_OUT = os.path.join(ROOT, "Purchase Order", "POfullJSON.json")
MIRRORS = {"onClick_save_issued": os.path.join(ROOT, "Purchase Order", "POsaveAsIssued.js"),
           "onClick_save_draft": os.path.join(ROOT, "Purchase Order", "POsaveAsDraft.js")}

with open(os.path.join(HERE, "client", "slim_payload.js"), encoding="utf-8") as f:
    SLIM = f.read()


def rep(src, old, new):
    assert src.count(old) == 1, "expected one match of %r, found %d" % (old[:80], src.count(old))
    return src.replace(old, new)


def issued(src):
    src = rep(src, "const saveWorkflow = async (data) => {", SLIM + "\nconst saveWorkflow = async (data) => {")
    src = rep(src, """    for (const [index, lineItem] of data.table_po.entries()) {
      // Unit price is not validated here: min/max price is checked by the save workflow,
      // which either routes it to approval or rejects it with 402.
      await this.validate([`table_po.${index}.quantity`]);
    }
""", """    // Unit price is not validated here: min/max price is checked by the save workflow,
    // which either routes it to approval or rejects it with 402. Every line's quantity in
    // one pass: a call per line re-walked (and deep-copied) the whole table each time.
    if (data.table_po.length > 0) {
      await this.validate(data.table_po.map((lineItem, index) => `table_po.${index}.quantity`));
    }
""")
    src = rep(src, """    const {
      draft_status,
      issued_status,
      processing_status,
      completed_status,
      cancelled_status,
      ...cleanData
    } = entry;

    await saveWorkflow(cleanData);""", """    const cleanData = poSlimPayload(entry);

    await saveWorkflow(cleanData);""")
    return src


def draft(src):
    src = rep(src, "(async () => {", SLIM + "\n(async () => {")
    src = rep(src, """  const {
    draft_status,
    issued_status,
    processing_status,
    completed_status,
    cancelled_status,
    ...cleanData
  } = this.models;
""", """  const cleanData = poSlimPayload(this.models);
""")
    return src


def diff_paths(a, b, path="", out=None):
    out = [] if out is None else out
    if type(a) is not type(b):
        out.append(path)
    elif isinstance(a, dict):
        for k in set(a) | set(b):
            if k not in a or k not in b:
                out.append(path + "." + k)
            else:
                diff_paths(a[k], b[k], path + "." + k, out)
    elif isinstance(a, list):
        if len(a) != len(b):
            out.append(path)
        else:
            for i, (x, y) in enumerate(zip(a, b)):
                diff_paths(x, y, "%s[%d]" % (path, i), out)
    elif a != b:
        out.append(path)
    return out


def main(dev_file):
    with open(dev_file, encoding="utf-8") as f:
        dev = json.load(f)
    form = json.loads(json.dumps(dev))
    es = form["config"]["eventScript"]
    done = {}
    for e in es:
        if e.get("name") == "onClick_save_issued":
            assert e.get("type") == "js"
            e["func"] = issued(e["func"])
            done["onClick_save_issued"] = e["func"]
        elif e.get("name") == "onClick_save_draft":
            assert e.get("type") == "js"
            e["func"] = draft(e["func"])
            done["onClick_save_draft"] = e["func"]
    assert set(done) == set(MIRRORS), done.keys()
    changed = diff_paths(dev, form)
    assert all(p.endswith(".func") for p in changed) and len(changed) == 2, changed
    with open(FORM_OUT, "w", encoding="utf-8") as f:
        f.write(render(form, "indent"))
    for name, path in MIRRORS.items():
        with open(path, "w", encoding="utf-8") as f:
            f.write(done[name])
    print("form paths changed vs dev v847:", changed)
    print("wrote", FORM_OUT, "and", ", ".join(os.path.basename(p) for p in MIRRORS.values()))


if __name__ == "__main__":
    main(sys.argv[1])
