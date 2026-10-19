"""Package D build: the Location Transfer form (base dev v107) and list page (base dev v47) with the Stock Movement V2 client.

Reads the workflow ids from scratchpad/smv2/ids.json at build time ("0" = not created: every save stays classic) and the
handler sources in client/src/ (placeholders __LOT_V2_SUBMIT__ / __LOT_V2_WORKER__, /*@@FINGERPRINT@@*/ = code/shared/
fingerprint.js). Writes the paste files + the exact embedded .js mirrors under Stock Movement/Location Transfer/AsyncV2/,
then prints every path that differs from the base (must be only the intended ones).
  python3 build_client.py [--write]
"""
import copy
import json
import os
import random
import re
import string
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SMV2 = os.path.abspath(os.path.join(HERE, ".."))
ROOT = os.path.abspath(os.path.join(SMV2, "..", ".."))
sys.path.insert(0, os.path.join(SMV2, "lib"))
from fmt import render  # noqa: E402
import v2build as V  # noqa: E402

OUT = os.path.join(ROOT, "Stock Movement", "Location Transfer", "AsyncV2")
BASE_FORM = os.path.join(SMV2, "base", "lot_form_v107.json")
# the designing v48 row (= live v47 + designer-default display attributes on the Print button): the uploader's base guard
# sees it as current, and building on it keeps that draft
BASE_LIST = os.path.join(SMV2, "base", "lot_list_v48_designing.json")
CLASSIC = os.path.join(SMV2, "base", "SM_LOCATION_TRANSFER.v82.json")
CANCEL_JS = os.path.join(ROOT, "Bulk Actions", "Warehouse Management", "Location Transfer", "Cancel.js")
# one V2 handler per save button, made from src/lotV2_onClick_save.js with the button's saveAs and its deployed classic
# handler (base v107 binding key, name) as constants; the classic handlers stay for the fall-through
BUTTONS = {
    "button_save_as_draft": ("2wtacbjy", "onClick_draft", "Draft", "lotV2_onClick_save_draft"),
    "button_inprogress": ("7897h6dq", "onClick_inProgress", "In Progress", "lotV2_onClick_save_inprogress"),
    "button_completed": ("8tfs6pc3", "onClick_completed", "Completed", "lotV2_onClick_save_completed"),
}
NEW_FIELDS = [("lot_v2_job_id", "V2 Job ID"), ("lot_idem_key", "Idempotency Key")]
FIELD_TEMPLATE = "default_storage_location"  # hidden input (varchar 255)
BADGE = ("lot_processing_status", "Background Processing Status")
PROCESSING_DIV = """
<div
  v-if="scope.value==='Processing'"
  style="
    padding: 0 10px;
    border: 2px solid #8b5cf6;
    background-color: #ede9fe;
    color: #5b21b6;
    font-size: 14px;
    font-family: Arial, sans-serif;
    border-radius: 20px;
    cursor: default;
    transition: background-color 0.3s;
    width: max-content;
    display: flex;
    align-items: center;
    justify-content: center;
  "
>
  {{scope.value}}
</div>"""


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def ids():
    d = json.load(open(os.path.join(SMV2, "ids.json"), encoding="utf-8"))
    out = {k: str(d[k]) for k in ("LOT_V2_SUBMIT", "LOT_V2_WORKER")}
    assert all(re.fullmatch(r"[0-9]{1,20}", v) for v in out.values()), out
    return out


def src(name, wf, consts=None):
    text = read(os.path.join(HERE, "src", name))
    text = text.replace("__LOT_V2_SUBMIT__", wf["LOT_V2_SUBMIT"]).replace("__LOT_V2_WORKER__", wf["LOT_V2_WORKER"])
    for k, v in (consts or {}).items():
        assert "__%s__" % k in text, k
        text = text.replace("__%s__" % k, v)
    if "/*@@FINGERPRINT@@*/" in text:
        text = text.replace("/*@@FINGERPRINT@@*/", V.include_js(SMV2, "code/shared/fingerprint.js").rstrip("\n"))
    assert not re.search(r"__[A-Z0-9_]+__", text) and "@@" not in text, name
    return text


def new_key(taken, rng):
    while True:
        k = "".join(rng.choice(string.ascii_lowercase + string.digits) for _ in range(8))
        if k not in taken and not k.isdigit() and not k[0].isdigit():
            taken.add(k)
            return k


def find(n, model, parent=None):
    if isinstance(n, dict):
        if n.get("model") == model:
            return n, parent
        for v in n.values():
            r = find(v, model, n)
            if r:
                return r
    elif isinstance(n, list):
        for v in n:
            r = find(v, model, n)
            if r:
                return r
    return None


def replace_once(text, old, new, what):
    assert text.count(old) == 1, (what, text.count(old))
    return text.replace(old, new)


def mounted(base, block):
    t = base
    t = replace_once(t, '    Cancelled: "cancel_status",\n  };', '    Cancelled: "cancel_status",\n    Processing: "lot_processing_status",\n  };', "badge map")
    t = replace_once(t, '        if (data.stock_movement_status === "Completed") {\n          editDisabledField();',
                     '        if (\n          data.stock_movement_status === "Completed" ||\n          data.stock_movement_status === "Processing"\n        ) {\n'
                     '          editDisabledField();', "read-only")
    t = replace_once(t, '        } else if (data.stock_movement_status === "In Progress") {\n',
                     '        } else if (data.stock_movement_status === "In Progress") {\n          rememberLines(data);\n', "fingerprint at open")
    t = replace_once(t, '        hideSerialNumberRecordTab();\n        break;\n    }\n  } catch (error) {',
                     '        hideSerialNumberRecordTab();\n        break;\n    }\n\n    lotBackgroundView(pageStatus, data);\n  } catch (error) {', "background view")
    t = replace_once(t, "(async () => {\n  try {\n    const data = this.getValues();", block + "(async () => {\n  try {\n    const data = this.getValues();", "block")
    return t


def build_form(wf, rng):
    base = json.load(open(BASE_FORM, encoding="utf-8"))
    form = copy.deepcopy(base)
    taken = set(re.findall(r"[a-z0-9]{8}", json.dumps(base)))
    es = form["config"]["eventScript"]
    by_name = {}
    for e in es:
        assert e["name"] not in by_name, e["name"]
        by_name[e["name"]] = e
    assert not any(h[3] in by_name for h in BUTTONS.values())

    # the status select already labels Processing (blade_dict dict_key filter, rule 1747862390327): asserted, not changed
    sel = find(form["list"], "stock_movement_status")[0]
    assert sel["type"] == "select" and "'Processing'" not in "" and '"value": "Processing"' in json.dumps(sel["options"]["datasource"]), "Processing option"

    m = by_name["mounted"]
    assert m["type"] == "js"
    m["func"] = mounted(m["func"], src("mounted_v2_block.js", wf))

    mirrors = {}
    for model, (key, classic, save_as, name) in BUTTONS.items():
        btn = find(form["list"], model)[0]
        assert btn["type"] == "button" and btn["events"]["onClick"] == key and by_name[classic]["key"] == key, model
        func = src("lotV2_onClick_save.js", wf, {"HANDLER_NAME": name, "BUTTON_MODEL": model, "SAVE_AS": save_as, "CLASSIC": classic})
        new = new_key(taken, rng)
        es.append({"key": new, "name": name, "func": func, "type": "js"})
        btn["events"]["onClick"] = new
        mirrors[name + ".js"] = func

    tmpl, holder = find(form["list"], FIELD_TEMPLATE)
    assert tmpl["type"] == "input" and tmpl["options"]["hidden"] is True and tmpl["options"]["dataBind"] is True
    at = holder.index(tmpl)
    for i, (model, label) in enumerate(NEW_FIELDS):
        assert find(base, model) is None, model
        key = new_key(taken, rng)
        field = copy.deepcopy(tmpl)
        field.update({"name": label, "key": key, "model": model})
        field["options"]["remoteFunc"] = "func_" + key
        field["options"]["remoteOption"] = "option_" + key
        holder.insert(at + 1 + i, field)

    badge, bholder = find(form["list"], "processing_status")
    assert badge["type"] == "html" and badge["options"]["hidden"] is True and find(base, BADGE[0]) is None
    key = new_key(taken, rng)
    nb = copy.deepcopy(badge)
    nb.update({"name": BADGE[1], "key": key, "model": BADGE[0]})
    nb["options"]["remoteFunc"] = "func_" + key
    nb["options"]["remoteOption"] = "option_" + key
    html = nb["options"]["defaultValue"]
    for old, new in (("<title>In Progress Button</title>", "<title>Processing Button</title>"), (".inprogress-button {", ".processing-button {"),
                     ("border: 2px solid #FFBB00;", "border: 2px solid #8B5CF6;"), ("background-color: #FFFCDD;", "background-color: #EDE9FE;"),
                     ("color: #8F6A04;", "color: #5B21B6;"), ('<div class="inprogress-button">In Progress</div>', '<div class="processing-button">Processing</div>')):
        html = replace_once(html, old, new, "badge " + old)
    nb["options"]["defaultValue"] = html
    bholder.insert(bholder.index(badge) + 1, nb)
    mirrors["lotV2_mounted.js"] = m["func"]
    return base, form, mirrors


def build_list(wf):
    base = json.load(open(BASE_LIST, encoding="utf-8"))
    page = copy.deepcopy(base)
    h = {e["name"]: e for e in page["config"]["eventScript"]}
    kick = src("lotV2_list_mounted_kick.js", wf)
    h["mounted"]["func"] = h["mounted"]["func"].rstrip("\n") + "\n\n" + kick
    tabs = page["list"][0]["tabs"]
    cols = [(tabs[0]["list"][0], 2, "stock_movement_status"), (tabs[1]["list"][0], 1, "sm_location_transfer_id.stock_movement_status")]
    for comp, i, name in cols:
        col = comp["options"]["customProps"]["columns"][i]
        assert col["name"] == name and "'Processing'" not in col["configCustom"]["content"], name
        col["configCustom"]["content"] = col["configCustom"]["content"].rstrip("\n") + "\n" + PROCESSING_DIV
    # a Processing transfer opens read-only from View; Edit is hidden as for Completed / Cancelled
    e0 = tabs[0]["list"][0]["options"]["customProps"]["rowActions"][1]
    assert e0["title"] == "Edit"
    e0["hidden"] = replace_once(e0["hidden"], "arguments[0].row.stock_movement_status === 'Cancelled')",
                                "arguments[0].row.stock_movement_status === 'Cancelled'||arguments[0].row.stock_movement_status === 'Processing')", "edit hidden 0")
    e1 = tabs[1]["list"][0]["options"]["customProps"]["rowActions"][0]
    assert e1["title"] == "Edit"
    e1["hidden"] = replace_once(e1["hidden"], "arguments[0].row.sm_location_transfer_id.stock_movement_status === 'Cancelled')",
                                "arguments[0].row.sm_location_transfer_id.stock_movement_status === 'Cancelled'||"
                                "arguments[0].row.sm_location_transfer_id.stock_movement_status === 'Processing')", "edit hidden 1")
    mirrors = {"lotV2_list_mounted_kick.js": kick}
    h["bulkCancel_LOT"]["func"] = mirrors["Cancel.js"] = cancel_v2(h["bulkCancel_LOT"]["func"], wf)
    return base, page, mirrors


def cancel_v2(base, wf):
    """the deployed bulkCancel_LOT (v47 == the repo Cancel.js before this package) + the V2 route"""
    head = "// Bulk Cancel In Progress LOTs - Reverses PO quantity reservations\n"
    t = replace_once(base, head + "(async () => {", head + src("cancel_v2_block.js", wf) + "(async () => {", "cancel block")
    t = replace_once(t, "    for (const lot of inProgressLOTs) {\n      try {\n        let workflowResult;",
                     "    for (const lot of inProgressLOTs) {\n      try {\n        const v2 = await lotV2Cancel(lot);\n"
                     "        if (v2.kind === \"QUEUED\" || v2.kind === \"DONE\") {\n          successCount++;\n          continue;\n        }\n"
                     "        if (v2.kind === \"FAILED\") {\n          failCount++;\n          failedLOTs.push(`${lot.stock_movement_no} (${v2.reason})`);\n          continue;\n        }\n"
                     "        let workflowResult;", "cancel route")
    t = replace_once(t, "    this.hideLoading();\n    this.refresh();\n\n    if (failCount > 0) {",
                     "    this.hideLoading();\n    this.refresh();\n    if (lotV2Queued.length > 0) {\n      this.$message.info(\n"
                     "        `${lotV2Queued.length} location transfer(s) are being cancelled in the background: ${lotV2Queued.map((q) => q.no).join(\", \")}`,\n"
                     "      );\n      lotV2Kick();\n    }\n\n    if (failCount > 0) {", "cancel kick")
    return t


def diffs(a, b, path="", out=None):
    out = [] if out is None else out
    if type(a) != type(b):
        out.append(path + " (type)")
    elif isinstance(a, dict):
        for k in list(a.keys()) + [k for k in b if k not in a]:
            if k not in a or k not in b:
                out.append(path + "/" + str(k) + (" (added)" if k not in a else " (removed)"))
            else:
                diffs(a[k], b[k], path + "/" + str(k), out)
    elif isinstance(a, list):
        keyed = all(isinstance(x, dict) and "key" in x for x in a + b)
        if keyed and len({x["key"] for x in a}) == len(a) and len({x["key"] for x in b}) == len(b):
            ka, kb = [x["key"] for x in a], [x["key"] for x in b]
            for k in kb:
                if k not in ka:
                    out.append(path + "/[key=%s] (added at %d: %s)" % (k, kb.index(k), b[kb.index(k)].get("model") or b[kb.index(k)].get("name")))
            for k in ka:
                if k not in kb:
                    out.append(path + "/[key=%s] (removed)" % k)
            if [k for k in kb if k in ka] != ka:
                out.append(path + " (order of existing items changed)")
            for x in a:
                if x["key"] in kb:
                    diffs(x, b[kb.index(x["key"])], path + "/[key=%s]" % x["key"], out)
            return out
        if len(a) != len(b):
            out.append(path + " (length %d -> %d)" % (len(a), len(b)))
            return out
        for i, (x, y) in enumerate(zip(a, b)):
            diffs(x, y, path + "/" + str(i), out)
    elif a != b:
        out.append(path)
    return out


def check_not_record(save_js):
    """no key the client strips from the record is read by the classic save"""
    names = json.loads(re.search(r"const NOT_RECORD = (\[[^\]]*\])", save_js, re.S).group(1).replace("\n", " "))
    classic = read(CLASSIC)
    used = [n for n in names if re.search(r"[^A-Za-z0-9_]" + re.escape(n) + r"[^A-Za-z0-9_]", classic)]
    assert not used, used
    return names


def main():
    write = "--write" in sys.argv
    wf = ids()
    rng = random.Random(20261016)
    fb, form, fm = build_form(wf, rng)
    lb, page, lm = build_list(wf)
    print("workflow ids:", wf)
    print("NOT_RECORD keys (none read by SM_LOCATION_TRANSFER v82):", check_not_record(fm["lotV2_onClick_save_completed.js"]))
    funcs = [fm[h[3] + ".js"] for h in BUTTONS.values()]
    strip = lambda f: re.sub(r'^// lotV2_onClick_save_\w+ - .*\n|const button = \{[^}]*\};', "", f, flags=re.M)
    assert len({strip(f) for f in funcs}) == 1, "the three handlers differ beyond their button constants"
    for name, (a, b) in (("LOTform.json vs base v107", (fb, form)), ("LOTlistPage.json vs base designing v48", (lb, page))):
        print("==", name)
        for p in diffs(a, b):
            print("   ", p)
    if write:
        os.makedirs(OUT, exist_ok=True)
        for fname, obj in (("LOTform.json", form), ("LOTlistPage.json", page)):
            text = render(obj, "indent")
            assert json.loads(text) == obj
            open(os.path.join(OUT, fname), "w", encoding="utf-8").write(text)
        for fname, text in list(fm.items()) + [(k, v) for k, v in lm.items() if k != "Cancel.js"]:
            open(os.path.join(OUT, fname), "w", encoding="utf-8").write(text)
        if "Cancel.js" in lm:
            open(CANCEL_JS, "w", encoding="utf-8").write(lm["Cancel.js"])
        stale = os.path.join(OUT, "lotV2_onClick_save.js")  # the single-handler mirror this build replaced with three
        if os.path.exists(stale):
            os.remove(stale)
        print("wrote", sorted(["LOTform.json", "LOTlistPage.json"] + list(fm) + list(lm)))


if __name__ == "__main__":
    main()
