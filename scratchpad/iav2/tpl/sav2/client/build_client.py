"""Package D build: the SA form (base dev v313 = prod v313), SA list (v57), SC form (v497) and SC list (v38) with the SA V2 /
SC Review V2 client, switches OFF (CONTRACT section 12).

Reads the workflow ids from scratchpad/sav2/ids.json at build time ("0" = not created: every click stays classic) and the
sources in client/src/ (placeholders __SA_V2_SUBMIT__, __SA_V2_WORKER__, __ASYNC_SA_ENABLED__, __ASYNC_SC_REVIEW_ENABLED__,
__SA_V2_MIN_ENTRIES__, __SC_V2_MIN_LINES__ and per-handler constants). Writes the paste files + the exact embedded .js
mirrors under "Stock Adjustment/AsyncV2/" and "Stock Count/AsyncV2/", the expected SA schema and the diff report under
client/out/, and prints every JSON path that differs from each base (asserted equal to the intended list).
  python3 build_client.py [--on] [--write]     # default: switches OFF; --on: ASYNC_SA_ENABLED + ASYNC_SC_REVIEW_ENABLED true
"""
import copy
import json
import os
import random
import re
import string
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SAV2 = os.path.abspath(os.path.join(HERE, ".."))
ROOT = os.path.abspath(os.path.join(SAV2, "..", ".."))
sys.path.insert(0, os.path.join(SAV2, "lib"))
from fmt import render  # noqa: E402

OUT_SA = os.path.join(ROOT, "Stock Adjustment", "AsyncV2")
OUT_SC = os.path.join(ROOT, "Stock Count", "AsyncV2")
OUT_CLIENT = os.path.join(HERE, "out")
BASE = os.path.join(SAV2, "base")
BASE_SA_FORM = os.path.join(BASE, "sa_form_v313.json")
BASE_SA_LIST = os.path.join(BASE, "sa_list_v57.json")
BASE_SC_FORM = os.path.join(BASE, "sc_form_v497.json")
BASE_SC_LIST = os.path.join(BASE, "sc_list_v38.json")
BASE_SA_SCHEMA = os.path.join(BASE, "schema_stock_adjustment.json")
CLASSIC_SA = os.path.join(BASE, "STOCK_ADJUSTMENT.v24.json")
CLASSIC_SC = os.path.join(BASE, "STOCK_COUNT.v10.json")

# a plain run builds the switches OFF; --on builds them ON (user decision 2026-10-16: SA V2 / SC Review V2 ship ON)
SWITCHES = {"ASYNC_SA_ENABLED": "false", "SA_V2_MIN_ENTRIES": "50", "ASYNC_SC_REVIEW_ENABLED": "false", "SC_V2_MIN_LINES": "50"}
SWITCHES_ON = dict(SWITCHES, ASYNC_SA_ENABLED="true", ASYNC_SC_REVIEW_ENABLED="true")
# SA form: button model -> (the classic handler base v313 binds, its key, its type, the new V2 handler)
SA_BUTTONS = [
    ("button_completed", "onClick_completed", "9o86bjii", "rule", "saV2_onClick_completed"),
    ("button_completed_posted", "onClick_completed_post", "otmqv4xj", "js", "saV2_onClick_completed_post"),
]
SA_NEW_FIELDS = [("sa_v2_job_id", "V2 Job ID"), ("sa_idem_key", "Idempotency Key")]
SA_FIELD_TEMPLATE = "previous_status"  # hidden input, dataBind true, varchar(255) on dev and prod
# blade_dict children of 1914242988707749889 (dev and prod): Processing 1914500993831477249, Cancelled 1914500943030067202
SA_STATUS_LEAVES = [(1792160000001, "Processing"), (1792160000002, "Cancelled")]
SA_BADGES = [
    ("processing_status", "Processing Status", "Processing", "processing-button", "#8B5CF6", "#EDE9FE", "#5B21B6"),
    ("cancel_status", "Cancel Status", "Cancelled", "cancelled-button", "#F90A0A", "#FDC4C4", "#A30505"),
]
SC_REVIEW = ("button_review", "onButtonReviewClick", "ma2d8htp", "scV2_onButtonReviewClick")
SC_INSERT_ANCHOR = '    } else if (approved.length && allApproved) {\n      createAdjustment = "Yes";\n    }\n\n'
SC_INSERT_LINE = "    if (SC_V2_ON && (await scReviewV2(data, items, allApproved, approved, createAdjustment))) return;\n\n"
DRAFT_ANCHOR = '      } else if (page_status === "Edit") {\n'

LIST_PROCESSING_DIV_INLINE = ("<div v-if=\"scope.value==='Processing'\" style=\" padding: 0 10px; border: 2px solid #8B5CF6; background-color: #EDE9FE; "
                              "color: #5B21B6; font-size: 14px; font-family: Arial, sans-serif; border-radius: 20px; cursor: default; transition: "
                              "background-color 0.3s; width: max-content; display: flex; align-items: center; justify-content: center;\">"
                              "{{scope.value}}</div>")
LIST_CANCELLED_DIV_INLINE = ("<div v-if=\"scope.value==='Cancelled'\" style=\" padding: 0 10px; border: 2px solid #F90A0A; background-color: #FDC4C4; "
                             "color: #A30505; font-size: 14px; font-family: Arial, sans-serif; border-radius: 20px; cursor: default; transition: "
                             "background-color 0.3s; width: max-content; display: flex; align-items: center; justify-content: center;\">"
                             "{{scope.value}}</div>")
LIST_PROCESSING_DIV_BLOCK = """
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


def load(path):
    return json.load(open(path, encoding="utf-8"))


def ids():
    d = load(os.path.join(SAV2, "ids.json"))
    out = {k: str(d[k]) for k in ("SA_V2_SUBMIT", "SA_V2_WORKER")}
    assert all(re.fullmatch(r"[0-9]{1,20}", v) for v in out.values()), out
    return out


def consts(wf, on):
    # ON with a workflow id not set would ship a switch that does nothing: refused
    assert not on or all(re.fullmatch(r"[1-9][0-9]{0,19}", v) for v in wf.values()), ("--on needs the workflow ids", wf)
    return dict(SWITCHES_ON if on else SWITCHES, **wf)


def src(name, c, extra=None):
    text = read(os.path.join(HERE, "src", name))
    for k, v in dict(c, **(extra or {})).items():
        text = text.replace("__%s__" % k, v)
    left = re.findall(r"__[A-Z][A-Z0-9_]*__", text)
    assert not left, (name, left)
    # a js event's func goes through the platform's replaceVariables ({{type:x}} tokens): none may be in our code
    assert "{{" not in text, name
    return text


def new_key(taken, rng):
    while True:
        k = "".join(rng.choice(string.ascii_lowercase + string.digits) for _ in range(8))
        if k not in taken and not k.isdigit() and not k[0].isdigit():
            taken.add(k)
            return k


def find(n, model, parent=None):
    """(the widget with this model, the list holding it)"""
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


def by_name(doc):
    out = {}
    for e in doc["config"]["eventScript"]:
        assert e["name"] not in out, e["name"]
        out[e["name"]] = e
    return out


def badge_html(base_html, label, cls, border, bg, color):
    t = base_html
    for old, new in (("<title>Completed Button</title>", "<title>%s Button</title>" % label), (".completed-button {", ".%s {" % cls),
                     ("border: 2px solid #00AE00;", "border: 2px solid %s;" % border), ("background-color: #C5F5C5;", "background-color: %s;" % bg),
                     ("color: #016701;", "color: %s;" % color), ('<div class="completed-button">Completed</div>', '<div class="%s">%s</div>' % (cls, label))):
        t = replace_once(t, old, new, "badge " + old)
    return t


def sa_mounted(base, block):
    t = base
    t = replace_once(t, '    case "Fully Posted":\n      this.display(["fullyposted_status"]);\n      break;\n    default:\n',
                     '    case "Fully Posted":\n      this.display(["fullyposted_status"]);\n      break;\n    case "Processing":\n'
                     '      this.display(["processing_status"]);\n      break;\n    case "Cancelled":\n      this.display(["cancel_status"]);\n'
                     '      break;\n    default:\n', "badge cases")
    t = replace_once(t, '    if (stockAdjustmentStatus === "Fully Posted") {\n',
                     '    if (\n      stockAdjustmentStatus === "Fully Posted" ||\n      stockAdjustmentStatus === "Processing" ||\n'
                     '      stockAdjustmentStatus === "Cancelled"\n    ) {\n', "Post button hidden")
    t = replace_once(t, '(async () => {\n  try {\n    let pageStatus = "";\n', block + '(async () => {\n  try {\n    let pageStatus = "";\n', "block")
    t = replace_once(t, '    }\n  } catch (error) {\n    console.error(error);\n    this.$message.error(error.message || "An error occurred");\n  }\n})();',
                     '    }\n\n    saBackgroundView(pageStatus, data);\n  } catch (error) {\n    console.error(error);\n'
                     '    this.$message.error(error.message || "An error occurred");\n  }\n})();', "background view")
    return t


def build_sa_form(c, rng, taken):
    base = load(BASE_SA_FORM)
    form = copy.deepcopy(base)
    es = form["config"]["eventScript"]
    h = by_name(form)
    mirrors, added = {}, {"events": [], "fields": [], "badges": []}

    for model, classic, key, typ, name in SA_BUTTONS:
        btn = find(form["list"], model)[0]
        assert btn["type"] == "button" and btn["events"] == {"onClick": key}, model
        assert h[classic]["key"] == key and h[classic].get("type") == typ and name not in h, classic
        func = src("saV2_onClick_completed.js", c, {"HANDLER_NAME": name, "BUTTON_MODEL": model, "CLASSIC": classic})
        k = new_key(taken, rng)
        es.append({"key": k, "name": name, "func": func, "type": "js"})
        btn["events"]["onClick"] = k
        added["events"].append((k, name, model, classic))
        if name == "saV2_onClick_completed":
            mirrors["saV2_onClick_completed.js"] = func

    d = h["onClick_draft"]
    assert d["key"] == "uk4w8v1h" and d["type"] == "rule" and [r["key"] for r in d["rules"]] == ["q6qdaerx"] and d["rules"][0]["action"] == "js"
    d["rules"][0]["options"]["func"] = replace_once(d["rules"][0]["options"]["func"], DRAFT_ANCHOR, DRAFT_ANCHOR + src("sa_draft_reread.js", c), "draft re-read")

    sel = find(form["list"], "stock_adjustment_status")[0]
    assert sel["type"] == "select" and sel["options"]["hidden"] is True
    top = sel["options"]["datasource"]["rules"]["list"][0]
    parent, anyb = top["children"]
    assert parent["prop"] == "parent_id" and parent["value"] == "1914242988707749889" and anyb["operator"] == "any"
    assert [x["value"] for x in anyb["children"]] == ["Draft", "Completed", "Fully Posted"]
    text = json.dumps(base)
    for leaf_id, value in SA_STATUS_LEAVES:
        assert str(leaf_id) not in text
        leaf = copy.deepcopy(anyb["children"][1])
        leaf.update({"id": leaf_id, "value": value})
        anyb["children"].append(leaf)

    tmpl, holder = find(form["list"], "completed_status")
    assert tmpl["type"] == "html" and tmpl["options"]["hidden"] is True and tmpl["options"]["dataBind"] is False
    at = holder.index(find(form["list"], "fullyposted_status")[0])
    assert holder is find(form["list"], "fullyposted_status")[1]
    for i, (model, label, text_, cls, border, bg, color) in enumerate(SA_BADGES):
        assert find(base, model) is None, model
        k = new_key(taken, rng)
        nb = copy.deepcopy(tmpl)
        nb.update({"name": label, "key": k, "model": model})
        nb["options"]["remoteFunc"] = "func_" + k
        nb["options"]["remoteOption"] = "option_" + k
        nb["options"]["defaultValue"] = badge_html(tmpl["options"]["defaultValue"], text_, cls, border, bg, color)
        holder.insert(at + 1 + i, nb)
        added["badges"].append((k, model))

    tmpl, holder = find(form["list"], SA_FIELD_TEMPLATE)
    assert tmpl["type"] == "input" and tmpl["options"]["hidden"] is True and tmpl["options"]["dataBind"] is True
    assert not any(tmpl["events"].values()) and tmpl["rules"] == []
    at = holder.index(tmpl)
    for i, (model, label) in enumerate(SA_NEW_FIELDS):
        assert find(base, model) is None, model
        k = new_key(taken, rng)
        field = copy.deepcopy(tmpl)
        field.update({"name": label, "key": k, "model": model})
        field["options"]["remoteFunc"] = "func_" + k
        field["options"]["remoteOption"] = "option_" + k
        holder.insert(at + 1 + i, field)
        added["fields"].append((k, model, label))

    m = h["mounted"]
    assert m["type"] == "js"
    block = src("saV2_mounted_block.js", c)
    m["func"] = sa_mounted(m["func"], block)
    mirrors["saV2_mounted_block.js"] = block
    return base, form, mirrors, added


def build_sa_list(c):
    base = load(BASE_SA_LIST)
    page = copy.deepcopy(base)
    h = by_name(page)
    assert h["mounted"] == {"key": "mounted", "name": "mounted", "func": ""}, h["mounted"]
    kick = src("saV2_list_mounted_kick.js", c)
    h["mounted"]["func"] = kick
    h["mounted"]["type"] = "js"
    tabs = page["list"][0]["tabs"]
    c0 = tabs[0]["list"][0]["options"]["customProps"]["columns"][4]
    assert c0["name"] == "stock_adjustment_status" and re.findall(r"scope\.value==='([^']+)'", c0["configCustom"]["content"]) == ["Draft", "Completed", "Fully Posted"]
    c0["configCustom"]["content"] = c0["configCustom"]["content"] + "\n" + LIST_PROCESSING_DIV_INLINE + "\n" + LIST_CANCELLED_DIV_INLINE
    c1 = tabs[1]["list"][0]["options"]["customProps"]["columns"][1]
    assert c1["name"] == "stock_adjustment_id.stock_adjustment_status"
    assert re.findall(r"scope\.value==='([^']+)'", c1["configCustom"]["content"]) == ["Created", "In Progress", "Cancelled", "Draft", "Completed"]
    c1["configCustom"]["content"] = c1["configCustom"]["content"].rstrip("\n") + "\n" + LIST_PROCESSING_DIV_BLOCK
    # bulk Post (Completed only) and bulk Delete (Draft / Cancelled only) already skip a Processing adjustment: asserted, not changed
    post, bulk_delete, edit = h["func_post"]["func"], h["func_bulkDelete"]["func"], h["func_edit"]["func"]
    assert 'item.stock_adjustment_status === "Completed" &&' in post
    assert bulk_delete.count('item.stock_adjustment_status === "Draft" ||\n            item.stock_adjustment_status === "Cancelled"') == 2
    assert "if(status !== 'Draft'){" in edit
    return base, page, {"saV2_list_mounted_kick.js": kick}


def build_sc_form(c, rng, taken):
    base = load(BASE_SC_FORM)
    form = copy.deepcopy(base)
    es = form["config"]["eventScript"]
    h = by_name(form)
    model, classic, key, name = SC_REVIEW
    btn = find(form["list"], model)[0]
    assert btn["type"] == "button" and btn["events"] == {"onClick": key} and h[classic]["key"] == key and h[classic]["type"] == "js" and name not in h
    body = h[classic]["func"]
    func = src("scV2_review_block.js", c) + replace_once(body, SC_INSERT_ANCHOR, SC_INSERT_ANCHOR + SC_INSERT_LINE, "review branch")
    k = new_key(taken, rng)
    es.append({"key": k, "name": name, "func": func, "type": "js"})
    btn["events"]["onClick"] = k
    m = h["mounted"]
    assert m["type"] == "js"
    block = src("scV2_mounted_block.js", c)
    t = replace_once(m["func"], '(async () => {\n  let pageStatus = "";\n', block + '(async () => {\n  let pageStatus = "";\n', "sc block")
    m["func"] = replace_once(t, '      break;\n  }\n})();\n', '      break;\n  }\n\n  scBackgroundView(pageStatus);\n})();\n', "sc view call")
    return base, form, {"scV2_onButtonReviewClick.js": func, "scV2_mounted_block.js": block}, (k, name)


def build_sc_list(c):
    base = load(BASE_SC_LIST)
    page = copy.deepcopy(base)
    h = by_name(page)
    assert h["mounted"] == {"key": "mounted", "name": "mounted", "func": ""}, h["mounted"]
    kick = src("scV2_list_mounted_kick.js", c)
    h["mounted"]["func"] = kick
    h["mounted"]["type"] = "js"
    return base, page, {"scV2_list_mounted_kick.js": kick}


def build_schema(form, added):
    """the schema_json the backend derives from the form (a publish re-derives it): the two hidden fields (varchar 255, cloned
    from previous_status), the two badges (cloned from completed_status, not persisted) and the status select's rules"""
    base = load(BASE_SA_SCHEMA)
    props = base["properties"]
    assert all(m not in props for _, m, _ in added["fields"]) and all(m not in props for _, m in added["badges"])
    out = {}
    for name, entry in props.items():
        out[name] = entry
        if name == "fullyposted_status":
            for (k, model), (_, label, text_, cls, border, bg, color) in zip(added["badges"], SA_BADGES):
                e = copy.deepcopy(props["completed_status"])
                e.update({"key": k, "name": model, "title": label, "description": label,
                          "defaultValue": badge_html(props["completed_status"]["defaultValue"], text_, cls, border, bg, color)})
                out[model] = e
        if name == SA_FIELD_TEMPLATE:
            for k, model, label in added["fields"]:
                e = copy.deepcopy(entry)
                e.update({"key": k, "name": model, "title": label, "description": label})
                out[model] = e
    new = dict(base, properties=out)
    rules = copy.deepcopy(find(form["list"], "stock_adjustment_status")[0]["options"]["datasource"]["rules"]["list"])
    old_rules = base["properties"]["stock_adjustment_status"]["component"]["rules"]
    assert [x["value"] for x in old_rules[0]["children"][1]["children"]] == ["Draft", "Completed", "Fully Posted"]
    new["properties"]["stock_adjustment_status"] = dict(new["properties"]["stock_adjustment_status"])
    new["properties"]["stock_adjustment_status"]["component"] = dict(new["properties"]["stock_adjustment_status"]["component"], rules=rules)
    return base, new


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
        if [k for k in a if k in b] != [k for k in b if k in a]:
            out.append(path + " (key order)")
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


def check_not_record(js_text, classic_path, const_name):
    """no key a client strips from the record is read from the record by the classic workflow"""
    names = json.loads(re.search(r"const %s = (\[[^\]]*\])" % const_name, js_text, re.S).group(1).replace("\n", " "))
    classic = read(classic_path)
    used = []
    for n in names:
        for p in (r"allData\.%s(?![A-Za-z0-9_])", r"allData\[\\?[\"']%s\\?[\"']\]", r"entry\.%s(?![A-Za-z0-9_])", r"data\.allData\.%s(?![A-Za-z0-9_])"):
            if re.search(p % re.escape(n), classic):
                used.append(n)
    assert not used, (classic_path, used)
    return names


def expected_paths(fa, fb, la, lb, sca, scb, scla, sclb, sa_added, sc_added):
    """the intended changes, per artifact (anything else fails the build)"""
    e_sa = set()
    for k, name, model, classic in sa_added["events"]:
        e_sa.add("/config/eventScript/[key=%s] (added at %d: %s)" % (k, [x["key"] for x in fb["config"]["eventScript"]].index(k), name))
        btn = find(fb["list"], model)[0]
        e_sa.add("/list/[key=shjmh0gq]/list/[key=%s]/events/onClick" % btn["key"])
    e_sa |= {"/config/eventScript/[key=mounted]/func", "/config/eventScript/[key=uk4w8v1h]/rules/[key=q6qdaerx]/options/func",
             "/list/[key=v442g7n3]/options/datasource/rules/list/0/children/1/children (length 3 -> 5)"}
    flex = find(fb["list"], "completed_status")[1]
    for k, model in sa_added["badges"]:
        e_sa.add("/list/[key=tp9swgvv]/list/[key=%s] (added at %d: %s)" % (k, [x["key"] for x in flex].index(k), model))
    col = find(fb["list"], SA_FIELD_TEMPLATE)[1]
    grid = find(fb["list"], "grid_ww47eo29")[0]
    assert grid["columns"][0]["list"] is col
    for k, model, label in sa_added["fields"]:
        e_sa.add("/list/[key=ww47eo29]/columns/[key=%s]/list/[key=%s] (added at %d: %s)" % (grid["columns"][0]["key"], k, [x["key"] for x in col].index(k), model))
    e_sal = {"/config/eventScript/[key=mounted]/func", "/config/eventScript/[key=mounted]/type (added)",
             "/list/[key=xrzk87y6]/tabs/[key=6xnviupb]/list/[key=y5ewf6w9]/options/customProps/columns/[key=txqcfxzs]/configCustom/content",
             "/list/[key=xrzk87y6]/tabs/[key=63erc1n4]/list/[key=jczaii1t]/options/customProps/columns/[key=v442g7n3]/configCustom/content"}
    k, name = sc_added
    e_sc = {"/config/eventScript/[key=%s] (added at %d: %s)" % (k, [x["key"] for x in scb["config"]["eventScript"]].index(k), name),
            "/config/eventScript/[key=mounted]/func",
            "/list/[key=w8jlcjrd]/list/[key=fdevqgfp]/events/onClick"}
    e_scl = {"/config/eventScript/[key=mounted]/func", "/config/eventScript/[key=mounted]/type (added)"}
    return e_sa, e_sal, e_sc, e_scl


def main():
    write = "--write" in sys.argv
    on = "--on" in sys.argv
    wf = ids()
    c = consts(wf, on)
    taken = set()
    for p in (BASE_SA_FORM, BASE_SA_LIST, BASE_SC_FORM, BASE_SC_LIST, BASE_SA_SCHEMA):
        taken |= set(re.findall(r"[a-z0-9]{8}", read(p)))
    rng = random.Random(20261016)
    fa, fb, fm, sa_added = build_sa_form(c, rng, taken)
    la, lb, lm = build_sa_list(c)
    sca, scb, scm, sc_added = build_sc_form(c, rng, taken)
    scla, sclb, sclm = build_sc_list(c)
    sa_schema_old, sa_schema = build_schema(fb, sa_added)

    print("workflow ids:", wf, "| switches:", {k: c[k] for k in SWITCHES})
    print("SA NOT_RECORD (none read from the record by STOCK_ADJUSTMENT v24):", len(check_not_record(fm["saV2_onClick_completed.js"], CLASSIC_SA, "SA_NOT_RECORD")), "keys")
    print("SC NOT_RECORD (none read from the record by STOCK_COUNT v10):", len(check_not_record(scm["scV2_onButtonReviewClick.js"], CLASSIC_SC, "SCR_NOT_RECORD")), "keys")
    funcs = {e["name"]: e["func"] for e in fb["config"]["eventScript"] if e["name"].startswith("saV2_")}
    strip = lambda f: re.sub(r'^// saV2_onClick_completed\w* - Stock Adjustment form, onClick of \w+\.|const SA_CLASSIC = "\w+";', "", f, flags=re.M)
    assert len({strip(f) for f in funcs.values()}) == 1, "the two SA handlers differ beyond their constants"

    e_sa, e_sal, e_sc, e_scl = expected_paths(fa, fb, la, lb, sca, scb, scla, sclb, sa_added, sc_added)
    report = []
    for name, (a, b), expected in (("SAform.json vs base sa_form_v313", (fa, fb), e_sa), ("SAlistPage.json vs base sa_list_v57", (la, lb), e_sal),
                                   ("SCform.json vs base sc_form_v497", (sca, scb), e_sc), ("SClistPage.json vs base sc_list_v38", (scla, sclb), e_scl),
                                   ("schema_stock_adjustment.json vs base schema", (sa_schema_old, sa_schema), None)):
        got = diffs(a, b)
        report.append("== " + name)
        report += ["    " + p for p in got]
        if expected is not None:
            assert set(got) == expected and len(got) == len(expected), (name, sorted(set(got) ^ expected))
    print("\n".join(report))
    print("new keys:", {"SA events": sa_added["events"], "SA badges": sa_added["badges"], "SA fields": sa_added["fields"], "SC event": sc_added})

    if write:
        os.makedirs(OUT_SA, exist_ok=True)
        os.makedirs(OUT_SC, exist_ok=True)
        os.makedirs(OUT_CLIENT, exist_ok=True)
        for out, fname, obj in ((OUT_SA, "SAform.json", fb), (OUT_SA, "SAlistPage.json", lb), (OUT_SC, "SCform.json", scb), (OUT_SC, "SClistPage.json", sclb)):
            text = render(obj, "indent")
            assert json.loads(text) == obj
            open(os.path.join(out, fname), "w", encoding="utf-8").write(text)
        for out, mirrors in ((OUT_SA, fm), (OUT_SA, lm), (OUT_SC, scm), (OUT_SC, sclm)):
            for fname, text in mirrors.items():
                open(os.path.join(out, fname), "w", encoding="utf-8").write(text)
        open(os.path.join(OUT_CLIENT, "schema_stock_adjustment.json"), "w", encoding="utf-8").write(json.dumps(sa_schema, ensure_ascii=False, indent=1) + "\n")
        open(os.path.join(OUT_CLIENT, "diff_report.txt"), "w", encoding="utf-8").write("\n".join(report) + "\n")
        print("wrote", sorted(["Stock Adjustment/AsyncV2/" + f for f in ["SAform.json", "SAlistPage.json"] + list(fm) + list(lm)] +
                              ["Stock Count/AsyncV2/" + f for f in ["SCform.json", "SClistPage.json"] + list(scm) + list(sclm)] +
                              ["client/out/schema_stock_adjustment.json", "client/out/diff_report.txt"]))


if __name__ == "__main__":
    main()
