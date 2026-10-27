"""Package D build: the Item Assembly form (base dev v34; re-seeded from v32 on 2026-10-19 after the dev admin's v33 / v34 edits)
and list (base dev v20) with the IA V2 client (CONTRACT section 12, RV8). Template: tpl/sav2/client/build_client.py.

Reads the workflow ids from scratchpad/iav2/ids.json ("0" = not created: every click and every list action stays classic),
the sources in client/src/ (placeholders __NAME__) and the shared helpers in code/shared/ia_common.js. Builds the OFF variant
(the cut's first publish) and the ON variant, asserts that each differs from its base only at the intended JSON paths, and
prints the paths. --write writes the OFF build to "Item Assembly & BOM/AsyncV2/" (IAform.json, IAlistPage.json + the .js
mirrors of every new or changed script) and the ON build to client/out/on/ (a preview while the ids are "0").
  python3 build_client.py [--write]                    # OFF to the repo, ON preview to client/out/on
  python3 build_client.py --on[=COMPLETE,COMPLETE_POST,REVERT] --write   # that ON build to the repo (needs the real ids;
                                                       # COMPLETE / COMPLETE_POST only with REVERT, CONTRACT ruling 9)
  IA_IDS=<ids.json> IA_OUT_DIR=<dir> python3 build_client.py --on --write  # a dry run of the integration build elsewhere
Then: node check_all.js (IA_EXPECT_ON=1 once the repo build is ON).
"""
import copy
import difflib
import hashlib
import json
import os
import random
import re
import string
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
IAV2 = os.path.abspath(os.path.join(HERE, ".."))
ROOT = os.path.abspath(os.path.join(IAV2, "..", ".."))
sys.path.insert(0, os.path.join(IAV2, "lib"))
from fmt import render  # noqa: E402

# IA_OUT_DIR / IA_IDS: a dry run of the integration build (another ids file, another output folder)
OUT_REPO = os.environ.get("IA_OUT_DIR") or os.path.join(ROOT, "Item Assembly & BOM", "AsyncV2")
OUT_CLIENT = os.path.join(os.environ["IA_OUT_DIR"], "client_out") if os.environ.get("IA_OUT_DIR") else os.path.join(HERE, "out")
IDS_FILE = os.environ.get("IA_IDS") or os.path.join(IAV2, "ids.json")
SRC = os.path.join(HERE, "src")
BASE = os.path.join(IAV2, "base")
BASE_FORM = os.path.join(BASE, "ia_form_v34.json")
BASE_LIST = os.path.join(BASE, "ia_list_v20.json")
BASE_COLUMNS = os.path.join(BASE, "columns.json")
CLASSIC_SAVE = os.path.join(BASE, "IA_SAVE.v11.json")
SHARED = os.path.join(IAV2, "code", "shared", "ia_common.js")
PAYLOADS = os.path.join(HERE, "fixtures", "payload_keys.json")
ACTIONS = ("COMPLETE", "COMPLETE_POST", "REVERT")
# RES-01 raw-material holds (scratchpad/iasc/res01/RES01_PLAN.md): the list Delete releases them first (by the stored hold status)
IASC_IDS = os.path.join(IAV2, "..", "iasc", "ids.json")
# RES-01 MIN-03 (BA 10-22): the list's reservation worklist - its Reservation column (the IA form's material_hold_status, key wsldpopa),
# Retry Reservation (toolbar, after Revert Completed; the Edit permission), the pending ones finished on open (shipped ON)
RES_ENABLED = "true"
RES_KEY = "wsldpopa"
RETRY_EVENT = ("iarsrv01", "onItemAssemblyRetryReservation")
# RES-01 Cancel from the list (user 10-22, like the GD list): the selected Created IAs cancelled (toolbar, after Retry Reservation, the
# form Cancel's permission)
CANCEL_EVENT = ("iacncl01", "onItemAssemblyCancel")
DESIGNER_BUTTON_DEFAULTS = {"styleType": "Link", "btnIcon": "", "hidden": "", "disabled": "", "eventsPrint": [], "segmented_fzl86zm3": "center", "dialog_top": ""}
RES_BADGES = [("RESERVING", "Pending", "#FFBB00", "#FFFCDD", "#8F6A04"), ("FULL", "Fully reserved", "#00AE00", "#C5F5C5", "#016701"),
              ("PARTIAL", "Partially reserved", "#ea580c", "#ffedd5", "#9a3412"), ("SHORT", "Nothing reserved", "#ea580c", "#ffedd5", "#9a3412"),
              ("NONE", "None", "#8C95A4", "#D0D5DD", "#4D5A74"), ("REVIEW", "Needs review", "#F90A0A", "#FDC4C4", "#A30505"),
              ("CLOSED", "Closed", "#8C95A4", "#D0D5DD", "#4D5A74")]

# the classic handlers this build replaces in place, pinned to their base v34 / v20 text (the build stops if dev moved)
FORM_PATCHED = {  # event key -> (name, patched source, sha256 of the base func)
    "wv07g9xe": ("onChange_assembledItem", "ia_onChange_assembledItem.js", "52c4527773c6a79a4f95badc3536181f205612796fc1c755962936d37291f898"),
    "iacqty01": ("onChange_componentQty", "ia_onChange_componentQty.js", "91b9609f7f9a4ed5dd95e556d8204e177035cad0aa459a6655b58eca381977c2"),
    "iaitem01": ("onAfterUpdate_item", "ia_onAfterUpdate_item.js", "ed57fa028c06cbf1a429042bdb9d87e3f6e37366acf8bdd3379c5c5705ffbe8e"),
    "iabcnf01": ("onConfirm_batchAddItem", "ia_onConfirm_batchAddItem.js", "57b7f0b31f43402c1aa92520efb0b9ddc32de0e10c0164764bcf8c1e98d7c0ca"),
    "e9ib2r8i": ("onClick_post", "ia_onClick_post.js", "8290f02013414e027e8d15396309c984b052399d2b17a3141610397c8d693654"),
}
LIST_PATCHED = {
    "oh26x9gl": ("delete", "ia_list_delete.js", "ccc7d3bdf7024073ec39d6ba4d3ef5d6c99bfd434091db5b316d2e905f0bf357"),
    "8r9xuzc4": ("IArevertCompleted", "ia_list_revertCompleted.js", "b4bf9a3af5ce8d620cdb714bd5bdc16c5154fd3ae333375305ce25bddbe3b990"),
    "z4qy8mae": ("onItemAssemblyPostfunc_z4qy8mae", "ia_list_post.js", "f09db8a2564ab4b8f82fcb6b2bee52f32eb2f36d676ac24f7c6ded50e49eb0b6"),
    # IA output split (plan 10-27): a split receipt's label lines, one per row with a batch
    "iaprcf01": ("onItemAssemblyPrintTemplateConfirm", "ia_list_printConfirm.js", "cf75d2921ed26936dfe6fee62132b7335dba57057d375c7605dd053414def14f"),
}
# the button models -> (the classic handler base v34 binds, its key, the new handler, does the button post)
BUTTONS = [
    ("button_completed", "onClick_saveAsCompleted", "iasvcomp", "iaV2_onClick_completed", False),
    ("comp_post_button", "onClick_saveAsCompletedPost", "aymq6q8z", "iaV2_onClick_completed_post", True),
]
NEW_FIELDS = [("ia_v2_job_id", "V2 Job ID"), ("ia_idem_key", "Idempotency Key")]
FIELD_TEMPLATE = "page_status"  # hidden input, dataBind, varchar(255), no events / rules
# blade_dict child of 1914242988707749889 (dev and prod): Processing 1914500993831477249
STATUS_LEAF = (1792170000001, "Processing")
# the IA list's own Processing badge colours (base v20 status column)
BADGE = ("processing_status", "Processing Status", "Processing", "processing-button", "#FFBB00", "#FFFCDD", "#8F6A04")
SHARED_NAMES = ["iaS", "iaParseJ", "iaList", "iaJsonList", "iaPicks", "iaPickCount", "iaLineHasHu", "IA_V2_MIN_PICKS", "IA_TEXT"]
EDIT_HIDDEN_OLD = "{{arguments[0].row.posted_status.dict_key == 'Pending Post'}}"
EDIT_HIDDEN_NEW = "{{arguments[0].row.posted_status.dict_key == 'Pending Post' || arguments[0].row.item_assembly_status === 'Processing' || arguments[0].row.item_assembly_status === 'Cancelled'}}"
GUARD_ANCHOR = "    if (!itemData) return;\n"
GUARD = (
    "    // a non-stock (labour / overhead) line takes its quantity as typed: nothing to pick\n"
    "    if (itemData.stock_control === 0 || itemData.stock_control === \"0\") {\n"
    "      this.closeDialog(\"sm_item_balance\");\n"
    "      this.$message.warning(\n"
    "        `${lineItemData.item_name || itemData.material_name || \"This component\"} is not stock-controlled: enter its quantity on the line.`,\n"
    "      );\n"
    "      return;\n"
    "    }\n"
)


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def load(path):
    return json.load(open(path, encoding="utf-8"))


def sha(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def ids():
    d = load(IDS_FILE)
    out = {k: str(d[k]) for k in ("IA_V2_SUBMIT", "IA_V2_WORKER", "IA_REVERT_V2_SUBMIT", "IA_REVERT_V2_WORKER")}
    assert all(re.fullmatch(r"[0-9]{1,20}", v) for v in out.values()), out
    return out


def switches(on):
    """on: None (OFF) or the set of actions switched on"""
    on = set(on or ())
    complete = "COMPLETE" in on or "COMPLETE_POST" in on
    return {"ASYNC_IA_ENABLED": "true" if complete else "false",
            "IA_V2_COMPLETE": "true" if (not on or "COMPLETE" in on) else "false",
            "IA_V2_COMPLETE_POST": "true" if (not on or "COMPLETE_POST" in on) else "false",
            "ASYNC_IA_REVERT_ENABLED": "true" if "REVERT" in on else "false"}


def shared_subset(names):
    """the named top-level statements of code/shared/ia_common.js, verbatim (with the comment lines just above them), in file
    order; every name must be found and must only use helpers in the subset"""
    lines = read(SHARED).split("\n")
    units, cur, comments = {}, None, []
    for line in lines:
        m = re.match(r"^const (\w+)\s*=", line)
        if m:
            cur = m.group(1)
            units[cur] = comments + [line]
            comments = []
        elif line.startswith("//") or line.startswith("if (typeof module"):
            cur = None
            comments = [line] if line.startswith("//") else []
        elif cur:
            units[cur].append(line)
    missing = [n for n in names if n not in units]
    assert not missing, ("shared helpers not found", missing)
    order = [n for n in units if n in names]
    text = "\n".join("\n".join(units[n]).rstrip() for n in order)
    used = set(re.findall(r"\b(ia[A-Z]\w*|IA_[A-Z0-9_]+)\b", text))
    assert used <= set(names), ("shared subset uses helpers outside it", sorted(used - set(names)))
    return text


def piece(text, start, end, what):
    """the verbatim text from `start` up to (not including) `end`, each found exactly once"""
    assert text.count(start) == 1, (what, "start", text.count(start))
    a = text.index(start)
    b = text.index(end, a)
    assert text.count(end) >= 1 and b > a, (what, "end")
    return text[a:b].rstrip()


def classic_pieces(form):
    h = by_name(form)
    comp = h["onClick_saveAsCompleted"]["func"]
    post = h["onClick_saveAsCompletedPost"]["func"]
    bom = piece(comp, "// The BOM seeds the component table", "\n(async () => {", "confirmBomVariance")
    assert bom == piece(post, "// The BOM seeds the component table", "\n(async () => {", "confirmBomVariance (post)")
    agent = piece(post, "// The accounting agent task queue", "\nconst closeDialog", "AGENT_TASK_WORKFLOW_ID")
    close = piece(post, "const closeDialog = () => {", "\nconst findFieldMessage", "closeDialog (post)")
    posting = piece(post, "const postToAccounting = async", "\n// The BOM seeds", "postToAccounting")
    assert posting.endswith("\n};") and close.endswith("\n};") and agent.endswith('"2013511169625042946";'), "classic pieces"
    post_block = ("// the classic Complete & Post's posting code, verbatim (base onClick_saveAsCompletedPost): run on a COMPLETED job only\n"
                  "const iaClassicPost = (() => {\n" + agent + "\n\n" + close + "\n\n" + posting + "\n\nreturn postToAccounting;\n})();")
    return bom, post_block, (agent, close, posting)


def src(name, c, extra=None):
    text = read(os.path.join(SRC, name))
    for k, v in dict(c, **(extra or {})).items():
        text = text.replace("__%s__" % k, v)
    left = re.findall(r"__[A-Z][A-Z0-9_]*__", text)
    assert not left, (name, left)
    return text


def fill(text, markers):
    for marker, body in markers.items():
        assert text.count(marker) == 1, (marker, text.count(marker))
        text = text.replace(marker, body)
    assert "/*@@" not in text, "a marker left"
    # a js event's func goes through the platform's replaceVariables ({{type:x}} tokens): none may be in our code
    assert "{{" not in text, "platform token"
    return text


def new_key(taken, rng):
    while True:
        k = "".join(rng.choice(string.ascii_lowercase + string.digits) for _ in range(8))
        if k not in taken and not k[0].isdigit():
            taken.add(k)
            return k


def find(n, model, parent=None, key=None):
    """(the widget with this model [and key], the list holding it)"""
    if isinstance(n, dict):
        if n.get("model") == model and (key is None or n.get("key") == key):
            return n, parent
        for v in n.values():
            r = find(v, model, n, key)
            if r:
                return r
    elif isinstance(n, list):
        for v in n:
            r = find(v, model, n, key)
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


def by_key(doc):
    return {e["key"]: e for e in doc["config"]["eventScript"]}


def badge_html(base_html, label, cls, border, bg, color):
    t = base_html
    for old, new in (("<title>Completed Button</title>", "<title>%s Button</title>" % label), (".completed-button {", ".%s {" % cls),
                     ("border: 2px solid #00AE00;", "border: 2px solid %s;" % border), ("background-color: #C5F5C5;", "background-color: %s;" % bg),
                     ("color: #016701;", "color: %s;" % color), ('<div class="completed-button">Completed</div>', '<div class="%s">%s</div>' % (cls, label))):
        t = replace_once(t, old, new, "badge " + old)
    return t


def markers_for(text):
    """the helper files a source asks for with its /*@@...@@*/ markers"""
    files = {"/*@@IA_READS@@*/": "ia_reads.js", "/*@@IA_NONSTOCK@@*/": "ia_nonstock.js"}
    return {m: read(os.path.join(SRC, f)).rstrip() for m, f in files.items() if m in text}


def patched(base_func, name, file, pin, c=None):
    got = sha(base_func)
    assert got == pin, ("the base %s changed (sha256 %s, pinned %s): re-derive client/src/%s" % (name, got, pin, file))
    text = src(file, c) if c is not None else read(os.path.join(SRC, file))
    return fill(text, markers_for(text))


def form_mounted(base, block):
    t = base
    t = replace_once(t, '    "Fully Posted": "fullyposted_status",\n  };', '    "Fully Posted": "fullyposted_status",\n    Processing: "processing_status",\n  };', "badge map")
    t = replace_once(t, "        } else {\n          // Fully Posted and anything else past Draft: the stock has already\n",
                     "        } else if (status === \"Processing\") {\n          // a background job holds it: read-only, no save or post button\n"
                     "          this.hide([\"button_draft\", \"button_completed\", \"comp_post_button\", \"button_post\"]);\n"
                     "          lockComponentsTable();\n"
                     "        } else {\n          // Fully Posted and anything else past Draft: the stock has already\n", "Processing branch")
    t = replace_once(t, '(async () => {\n  try {\n    let pageStatus = "";\n', block + '(async () => {\n  try {\n    let pageStatus = "";\n', "block")
    t = replace_once(t, "        break;\n    }\n  } catch (error) {\n    console.error(error);\n",
                     "        break;\n    }\n\n    iaBackgroundView(pageStatus, status);\n  } catch (error) {\n    console.error(error);\n", "background view")
    return t


def build_form(c, wf, rng, taken):
    base = load(BASE_FORM)
    form = copy.deepcopy(base)
    es = form["config"]["eventScript"]
    h = by_name(form)
    k = by_key(form)
    mirrors, added = {}, {"events": [], "fields": [], "badge": None}
    bom, post_block, _ = classic_pieces(base)
    shared = shared_subset(SHARED_NAMES)

    for model, classic, key, name, posts in BUTTONS:
        btn = find(form["list"], model)[0]
        assert btn["type"] == "button" and btn["events"] == {"onClick": key}, model
        assert h[classic]["key"] == key and h[classic].get("type") == "js" and name not in h, classic
        func = src("iaV2_onClick_completed.js", c, {"HANDLER_NAME": name, "BUTTON_MODEL": model, "CLASSIC": classic,
                                                     "BUTTON_POSTS": "true" if posts else "false"})
        func = fill(func, {"/*@@IA_SHARED@@*/": shared, "/*@@CONFIRM_BOM_VARIANCE@@*/": bom, "/*@@CLASSIC_POST@@*/": post_block})
        nk = new_key(taken, rng)
        es.append({"key": nk, "name": name, "func": func, "type": "js"})
        btn["events"]["onClick"] = nk
        added["events"].append((nk, name, model))
        mirrors[name + ".js"] = func

    m = h["mounted"]
    assert m["type"] == "js"
    block = fill(src("iaV2_mounted_block.js", c), {})
    m["func"] = form_mounted(m["func"], block)
    mirrors["iaForm_mounted.js"] = m["func"]

    for key, (name, file, pin) in FORM_PATCHED.items():
        e = k[key]
        assert e["name"] == name and e.get("type") == "js", (key, name)
        e["func"] = patched(e["func"], name, file, pin)
        mirrors["iaForm_%s.js" % name] = e["func"]

    sel_stock = k["evhzkk8e"]
    assert sel_stock["name"] == "onClick_select_stock" and sel_stock["type"] == "rule"
    assert [r["key"] for r in sel_stock["rules"]] == ["lrosryqy", "mr8f903u"] and sel_stock["rules"][1]["action"] == "js"
    rule = sel_stock["rules"][1]["options"]
    rule["func"] = replace_once(rule["func"], GUARD_ANCHOR, GUARD_ANCHOR + GUARD, "Transfer Stock guard")
    mirrors["iaForm_onClick_select_stock.js"] = rule["func"]

    table, _holder = find(form["list"], "stock_movement", key="tlm8ve69")
    assert table["type"] == "table" and table["events"]["onRowRemove"] == "", table["events"]
    rk = new_key(taken, rng)
    remove = fill(read(os.path.join(SRC, "ia_onRowRemove_item.js")), {})
    es.append({"key": rk, "name": "onRowRemove_item", "func": remove, "type": "js"})
    assert "onRowRemove_item" not in h
    table["events"]["onRowRemove"] = rk
    added["events"].append((rk, "onRowRemove_item", "stock_movement"))
    mirrors["iaForm_onRowRemove_item.js"] = remove

    sel = find(form["list"], "item_assembly_status", key="4cjp73ay")[0]
    assert sel["type"] == "select" and sel["options"]["hidden"] is True
    top = sel["options"]["datasource"]["rules"]["list"][0]
    parent, anyb = top["children"]
    assert parent["prop"] == "parent_id" and parent["value"] == "1914242988707749889" and anyb["operator"] == "any"
    assert [x["value"] for x in anyb["children"]] == ["Draft", "Issued", "Completed", "Fully Posted"]
    assert str(STATUS_LEAF[0]) not in json.dumps(base)
    leaf = copy.deepcopy(anyb["children"][2])
    leaf.update({"id": STATUS_LEAF[0], "value": STATUS_LEAF[1]})
    anyb["children"].append(leaf)

    tmpl, holder = find(form["list"], "completed_status")
    assert tmpl["type"] == "html" and tmpl["options"]["hidden"] is True
    fp = find(form["list"], "fullyposted_status")
    assert fp[1] is holder
    model, label, text_, cls, border, bg, color = BADGE
    assert find(base, model) is None, model
    bk = new_key(taken, rng)
    nb = copy.deepcopy(tmpl)
    nb.update({"name": label, "key": bk, "model": model})
    # display only: not a column (the other badges are, and the classic never writes them)
    nb["options"]["dataBind"] = False
    nb["options"]["remoteFunc"] = "func_" + bk
    nb["options"]["remoteOption"] = "option_" + bk
    nb["options"]["defaultValue"] = badge_html(tmpl["options"]["defaultValue"], text_, cls, border, bg, color)
    holder.insert(holder.index(fp[0]) + 1, nb)
    added["badge"] = (bk, model)

    tmpl, holder = find(form["list"], FIELD_TEMPLATE)
    assert holder is form["list"] and tmpl["type"] == "input" and tmpl["options"]["hidden"] is True and tmpl["options"]["dataBind"] is True
    assert not any(tmpl["events"].values()) and tmpl["rules"] == []
    at = holder.index(tmpl)
    for i, (fmodel, flabel) in enumerate(NEW_FIELDS):
        assert find(base, fmodel) is None, fmodel
        fk = new_key(taken, rng)
        field = copy.deepcopy(tmpl)
        field.update({"name": flabel, "key": fk, "model": fmodel})
        field["options"]["remoteFunc"] = "func_" + fk
        field["options"]["remoteOption"] = "option_" + fk
        holder.insert(at + 1 + i, field)
        added["fields"].append((fk, fmodel, flabel))
    return base, form, mirrors, added


def build_list(c):
    base = load(BASE_LIST)
    page = copy.deepcopy(base)
    h = by_name(page)
    k = by_key(page)
    mirrors = {}
    assert h["mounted"] == {"key": "mounted", "name": "mounted", "func": ""}, h["mounted"]
    kick = fill(src("ia_list_mounted_kick.js", c), {})
    h["mounted"]["func"] = kick
    h["mounted"]["type"] = "js"
    mirrors["iaList_mounted.js"] = kick
    for key, (name, file, pin) in LIST_PATCHED.items():
        e = k[key]
        assert e["name"] == name and e.get("type") == "js", (key, name)
        e["func"] = patched(e["func"], name, file, pin, c)
        mirrors["iaList_%s.js" % name] = e["func"]
    cp = page["list"][0]["options"]["customProps"]
    edit = cp["rowActions"][1]
    assert edit["type"] == "editBtn" and edit["hidden"] == EDIT_HIDDEN_OLD, edit["hidden"]
    edit["hidden"] = EDIT_HIDDEN_NEW
    status = cp["columns"][1]
    assert status["name"] == "item_assembly_status"
    # the status column already renders a Processing badge in v20: asserted, not changed
    assert re.findall(r"scope\.value==='([^']+)'", status["configCustom"]["content"]) == ["Pending Approval", "Fully Posted", "Issued", "Draft", "Completed", "Processing", "Cancelled"]
    # RES-01 Created (BA, 10-22): a Created badge right after the Draft one, in the Purchase Order's Created colours
    content = status["configCustom"]["content"]
    draft = re.findall(r"<div v-if=\"scope\.value==='Draft'\"[^>]*>\{\{scope\.value\}\}</div>", content)
    assert len(draft) == 1 and content.count(draft[0]) == 1, draft
    created = draft[0].replace("scope.value==='Draft'", "scope.value==='Created'").replace("border: 2px solid #8C95A4;", "border: 2px solid #036DF8;") \
        .replace("background-color: #D0D5DD;", "background-color: #C6DFFF;")
    assert created.count("#036DF8") == 1 and created.count("#C6DFFF") == 1, created
    status["configCustom"]["content"] = content.replace(draft[0], draft[0] + " " + created)
    # RES-01 MIN-03 (BA 10-22): the Reservation column right after Status, a copy of it on the hold status with its own badges
    assert all(col["name"] != "material_hold_status" and col["key"] != RES_KEY for col in cp["columns"])
    res = copy.deepcopy(status)
    res.update({"name": "material_hold_status", "key": RES_KEY, "title": "Reservation", "description": "Reservation"})
    res["configCustom"] = {"content": "".join(
        '<div v-if="scope.value===\'%s\'" style=" padding: 0 10px; border: 2px solid %s; background-color: %s; color: %s; font-size: 14px; font-family: Arial, sans-serif; '
        'border-radius: 20px; cursor: default; transition: background-color 0.3s; width: max-content; display: flex; align-items: center; justify-content: center;">%s</div>'
        % (code, border, bg, color, label) for code, label, border, bg, color in RES_BADGES)}
    cp["columns"].insert(2, res)
    # Retry Reservation: a toolbar button after Revert Completed (its copy, the Edit permission), its handler added at the end
    tb = cp["toolbar"]
    at = [x.get("title") for x in tb].index("Revert Completed")
    retry = copy.deepcopy(tb[at])
    retry.update({"title": "Retry Reservation", "permission": "ia_edit", "icon": "arrow-repeat", "events": [{"key": RETRY_EVENT[0], "name": RETRY_EVENT[1]}]})
    tb.insert(at + 1, retry)
    events = page["config"]["eventScript"]
    assert RETRY_EVENT[0] not in [x["key"] for x in events]
    func = fill(src("ia_list_retryReservation.js", c), {})
    events.append({"key": RETRY_EVENT[0], "name": RETRY_EVENT[1], "func": func, "type": "js"})
    mirrors["iaList_%s.js" % RETRY_EVENT[1]] = func
    cancel = copy.deepcopy(tb[at])
    cancel.update({"title": "Cancel", "permission": "ia_cancel", "icon": "x-circle", "events": [{"key": CANCEL_EVENT[0], "name": CANCEL_EVENT[1]}]})
    tb.insert(at + 2, cancel)
    # the product owner's designer save of 10-22 20:22 (live list v29): its own permission on Cancel, the designer's defaults on Cancel + Post
    assert tb[at + 3]["title"] == "Post"
    for b in (cancel, tb[at + 3]):
        assert not set(DESIGNER_BUTTON_DEFAULTS) & set(b), b
        b.update(DESIGNER_BUTTON_DEFAULTS)
    assert "is_no_drag" not in cp and "is_no_copy" not in cp
    cp.update({"is_no_drag": False, "is_no_copy": False})
    assert CANCEL_EVENT[0] not in [x["key"] for x in events]
    func = fill(src("ia_list_cancel.js", c), {})
    events.append({"key": CANCEL_EVENT[0], "name": CANCEL_EVENT[1], "func": func, "type": "js"})
    mirrors["iaList_%s.js" % CANCEL_EVENT[1]] = func
    return base, page, mirrors


def diffs(a, b, path="", out=None):
    out = [] if out is None else out
    if type(a) != type(b):
        out.append(path + " (type)")
    elif isinstance(a, dict):
        for kk in list(a.keys()) + [kk for kk in b if kk not in a]:
            if kk not in a or kk not in b:
                out.append(path + "/" + str(kk) + (" (added)" if kk not in a else " (removed)"))
            else:
                diffs(a[kk], b[kk], path + "/" + str(kk), out)
        if [kk for kk in a if kk in b] != [kk for kk in b if kk in a]:
            out.append(path + " (key order)")
    elif isinstance(a, list):
        keyed = all(isinstance(x, dict) and "key" in x for x in a + b)
        if keyed and len({x["key"] for x in a}) == len(a) and len({x["key"] for x in b}) == len(b):
            ka, kb = [x["key"] for x in a], [x["key"] for x in b]
            for kk in kb:
                if kk not in ka:
                    out.append(path + "/[key=%s] (added at %d: %s)" % (kk, kb.index(kk), b[kb.index(kk)].get("model") or b[kb.index(kk)].get("name")))
            for kk in ka:
                if kk not in kb:
                    out.append(path + "/[key=%s] (removed)" % kk)
            if [kk for kk in kb if kk in ka] != ka:
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


def key_path(doc, key):
    """the diff path prefix of the widget with this key"""
    def walk(n, path):
        if isinstance(n, dict):
            if n.get("key") == key and ("model" in n or "type" in n):
                return path
            for kk, v in n.items():
                if isinstance(v, list):
                    keyed = all(isinstance(x, dict) and "key" in x for x in v)
                    for i, x in enumerate(v):
                        r = walk(x, path + "/" + kk + ("/[key=%s]" % x["key"] if keyed else "/" + str(i)))
                        if r:
                            return r
                elif isinstance(v, dict):
                    r = walk(v, path + "/" + kk)
                    if r:
                        return r
        return None
    for i, x in enumerate(doc["list"]):
        r = walk(x, "/list/[key=%s]" % x["key"])
        if r:
            return r
    raise AssertionError(key)


def expected_paths(fa, fb, la, lb, added):
    e_form = set()
    kb = [x["key"] for x in fb["config"]["eventScript"]]
    for k, name, model in added["events"]:
        e_form.add("/config/eventScript/[key=%s] (added at %d: %s)" % (k, kb.index(k), name))
    for model, _classic, key, _name, _posts in BUTTONS:
        e_form.add(key_path(fb, find(fb["list"], model)[0]["key"]) + "/events/onClick")
    e_form.add(key_path(fb, "tlm8ve69") + "/events/onRowRemove")
    e_form |= {"/config/eventScript/[key=mounted]/func", "/config/eventScript/[key=evhzkk8e]/rules/[key=mr8f903u]/options/func"}
    e_form |= {"/config/eventScript/[key=%s]/func" % key for key in FORM_PATCHED}
    e_form.add(key_path(fb, "4cjp73ay") + "/options/datasource/rules/list/0/children/1/children (length 4 -> 5)")
    bk, model = added["badge"]
    flex = find(fb["list"], "completed_status")[1]
    e_form.add(key_path(fb, "2det1nd2") + "/list/[key=%s] (added at %d: %s)" % (bk, [x["key"] for x in flex].index(bk), model))
    top = [x["key"] for x in fb["list"]]
    for k, model, _label in added["fields"]:
        e_form.add("/list/[key=%s] (added at %d: %s)" % (k, top.index(k), model))
    e_list = {"/config/eventScript/[key=mounted]/func", "/config/eventScript/[key=mounted]/type (added)",
              "/list/[key=s6wz5vvo]/options/customProps/rowActions/1/hidden",
              "/list/[key=s6wz5vvo]/options/customProps/columns/[key=%s]/configCustom/content" % lb["list"][0]["options"]["customProps"]["columns"][1]["key"]}
    e_list |= {"/config/eventScript/[key=%s]/func" % key for key in LIST_PATCHED}
    # RES-01 MIN-03: the Reservation column, the Retry Reservation button and its handler
    cpb = lb["list"][0]["options"]["customProps"]
    e_list.add("/list/[key=s6wz5vvo]/options/customProps/columns/[key=%s] (added at %d: material_hold_status)" % (RES_KEY, [x["key"] for x in cpb["columns"]].index(RES_KEY)))
    e_list.add("/list/[key=s6wz5vvo]/options/customProps/toolbar (length %d -> %d)" % (len(la["list"][0]["options"]["customProps"]["toolbar"]), len(cpb["toolbar"])))
    kb_list = [x["key"] for x in lb["config"]["eventScript"]]
    e_list.add("/config/eventScript/[key=%s] (added at %d: %s)" % (RETRY_EVENT[0], kb_list.index(RETRY_EVENT[0]), RETRY_EVENT[1]))
    e_list.add("/config/eventScript/[key=%s] (added at %d: %s)" % (CANCEL_EVENT[0], kb_list.index(CANCEL_EVENT[0]), CANCEL_EVENT[1]))
    e_list |= {"/list/[key=s6wz5vvo]/options/customProps/is_no_drag (added)", "/list/[key=s6wz5vvo]/options/customProps/is_no_copy (added)"}
    return e_form, e_list


def check_not_record(js_text):
    """NOT_RECORD against the recorded payloads, the table's columns and the classic IA_SAVE v11"""
    names = json.loads(re.search(r"const IA_NOT_RECORD = (\[[^\]]*\])", js_text, re.S).group(1).replace("\n", " "))
    cols = {c["name"] for c in load(BASE_COLUMNS)["columns"]["sm_item_assembly"]}
    for run in load(PAYLOADS)["runs"]:
        stray = [k for k in run["keys"] if k not in cols and k not in names]
        assert not stray, ("payload keys that are neither columns nor stripped", run["run_id"], stray)
    classic = read(CLASSIC_SAVE)
    for n in names:
        for p in (r"allData\.%s(?![A-Za-z0-9_])", r"allData\[\\?[\"']%s\\?[\"']\]", r"code_fillback\.data\.allData\.%s(?![A-Za-z0-9_])"):
            assert not re.search(p % re.escape(n), classic), ("the classic reads a stripped key", n)
    stripped_cols = sorted(n for n in names if n in cols)
    return names, stripped_cols


def handler_diff(name, a, b):
    return "".join(difflib.unified_diff(a.splitlines(True), b.splitlines(True), "base/" + name, "built/" + name, n=2))


def build(on):
    wf = ids()
    c = dict(switches(on), **wf)
    c["IA_RV_MIN_ROWS"] = re.search(r"^const IA_RV_MIN_ROWS = (\d+);", read(SHARED), re.M).group(1)
    c["IA_HOLD"] = str(load(IASC_IDS)["IA_HOLD"])
    c["RES_ENABLED"] = RES_ENABLED
    taken = set()
    for p in (BASE_FORM, BASE_LIST):
        taken |= set(re.findall(r"[a-z0-9]{8}", read(p)))
    rng = random.Random(20261019)
    fa, fb, fm, added = build_form(c, wf, rng, taken)
    la, lb, lm = build_list(c)
    return wf, c, fa, fb, fm, added, la, lb, lm


def main():
    write = "--write" in sys.argv
    arg = [a for a in sys.argv[1:] if a.startswith("--on")]
    on_actions = None
    if arg:
        on_actions = set(arg[0].split("=", 1)[1].split(",")) if "=" in arg[0] else set(ACTIONS)
        assert on_actions <= set(ACTIONS) and on_actions, on_actions
        # CONTRACT ruling 9: an IA completed in the background with more than 250 picks can only be reverted by Revert V2
        assert "REVERT" in on_actions or not on_actions & {"COMPLETE", "COMPLETE_POST"}, ("COMPLETE / COMPLETE_POST may be ON only with REVERT ON", sorted(on_actions))
    variants = [("OFF", None)] + ([("ON", on_actions)] if on_actions else [("ON", set(ACTIONS))])
    built = {}
    for label, on in variants:
        wf, c, fa, fb, fm, added, la, lb, lm = build(on)
        names, stripped_cols = check_not_record(fm["iaV2_onClick_completed.js"])
        e_form, e_list = expected_paths(fa, fb, la, lb, added)
        report = ["== %s build (switches %s, ids %s)" % (label, {k: c[k] for k in ("ASYNC_IA_ENABLED", "IA_V2_COMPLETE", "IA_V2_COMPLETE_POST", "ASYNC_IA_REVERT_ENABLED")}, wf)]
        for name, (a, b), expected in (("IAform.json vs base ia_form_v34", (fa, fb), e_form), ("IAlistPage.json vs base ia_list_v20", (la, lb), e_list)):
            got = diffs(a, b)
            report.append("-- " + name)
            report += ["    " + p for p in sorted(got)]
            assert set(got) == expected and len(got) == len(expected), (label, name, sorted(set(got) ^ expected))
        strip = lambda f: re.sub(r'^// iaV2_onClick_completed\w* - Item Assembly form, onClick of \w+\.|const IA_CLASSIC = "\w+";|const IA_BUTTON_POSTS = \w+;', "", f, flags=re.M)
        assert strip(fm["iaV2_onClick_completed.js"]) == strip(fm["iaV2_onClick_completed_post.js"]), "the two handlers differ beyond their constants"
        report.append("-- NOT_RECORD: %d keys; none read by IA_SAVE v11; every recorded payload key is a column or stripped; stripped columns "
                      "(display-only badges, never written by the classic): %s" % (len(names), stripped_cols))
        report.append("-- new keys: events %s, badge %s, fields %s" % (added["events"], added["badge"], added["fields"]))
        built[label] = (wf, c, fa, fb, fm, added, la, lb, lm, report)
        print("\n".join(report))

    if write:
        repo_label = "ON" if on_actions else "OFF"
        if repo_label == "ON":
            # an ON build without its workflows would ship a switch that does nothing: refused before anything is written
            assert all(re.fullmatch(r"[1-9][0-9]{0,19}", v) for v in built["ON"][0].values()), ("--on --write needs the real workflow ids", built["ON"][0])
        os.makedirs(OUT_REPO, exist_ok=True)
        os.makedirs(os.path.join(OUT_CLIENT, "on"), exist_ok=True)
        wf, c, fa, fb, fm, added, la, lb, lm, report = built[repo_label]
        for fname, obj in (("IAform.json", fb), ("IAlistPage.json", lb)):
            text = render(obj, "indent")
            assert json.loads(text) == obj
            open(os.path.join(OUT_REPO, fname), "w", encoding="utf-8").write(text)
        for fname, text in list(fm.items()) + list(lm.items()):
            open(os.path.join(OUT_REPO, fname), "w", encoding="utf-8").write(text)
        for fname, obj in (("IAform.json", built["ON"][3]), ("IAlistPage.json", built["ON"][7])):
            open(os.path.join(OUT_CLIENT, "on", fname), "w", encoding="utf-8").write(render(obj, "indent"))
        hd = []
        base_form, base_list = by_key(fa), by_key(la)
        for key, (name, _f, _p) in FORM_PATCHED.items():
            hd.append(handler_diff(name + ".js", base_form[key]["func"], by_key(fb)[key]["func"]))
        hd.append(handler_diff("onClick_select_stock.rule_mr8f903u.js", base_form["evhzkk8e"]["rules"][1]["options"]["func"], by_key(fb)["evhzkk8e"]["rules"][1]["options"]["func"]))
        hd.append(handler_diff("mounted.js", base_form["mounted"]["func"], by_key(fb)["mounted"]["func"]))
        for key, (name, _f, _p) in LIST_PATCHED.items():
            hd.append(handler_diff("list_" + name + ".js", base_list[key]["func"], by_key(lb)[key]["func"]))
        open(os.path.join(OUT_CLIENT, "handler_diffs.txt"), "w", encoding="utf-8").write("\n".join(hd))
        open(os.path.join(OUT_CLIENT, "diff_report.txt"), "w", encoding="utf-8").write("\n".join(built["OFF"][9] + built["ON"][9]) + "\n")
        print("wrote the %s build to %s:" % (repo_label, OUT_REPO), sorted(["IAform.json", "IAlistPage.json"] + list(fm) + list(lm)),
              "+ %s/{diff_report.txt,handler_diffs.txt,on/IAform.json,on/IAlistPage.json}" % OUT_CLIENT)


if __name__ == "__main__":
    main()
