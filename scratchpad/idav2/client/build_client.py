"""Package D build: the Item Disassembly form (base dev v35) and list (base: the designing v17 of dev v16) with the IDA V2 client
(CONTRACT section 12).
Template: tpl/iav2/client/build_client.py, with IDA's own anchors, router and patches.

Reads the workflow ids from scratchpad/idav2/ids.json ("0" = not created: every click and every list action stays classic), the
sources in client/src/ (placeholders __NAME__, markers /*@@NAME@@*/) and patches the base scripts by exact anchors (each found
once; the bases are md5-pinned). Builds the OFF variant (the first publish) and the ON variant, asserts that each differs from
its base only at the intended JSON paths, and prints the paths. --write writes the OFF build to "Item Disassembly/AsyncV2/"
(IDAform.json, IDAlistPage.json + the .js mirrors of every new or changed script) and the ON build to client/out/on/.
  python3 build_client.py [--write]                                # OFF to the repo, ON preview to client/out/on
  python3 build_client.py --on[=COMPLETE,COMPLETE_POST] --write    # that ON build to the repo (refused while an id is "0")
  IDA_IDS=<ids.json> IDA_OUT_DIR=<dir> python3 build_client.py --on --write   # a dry run of the integration build elsewhere
Then: node check_all.js (IDA_EXPECT_ON=1 once the repo build is ON).
"""
import copy
import difflib
import glob
import hashlib
import json
import os
import random
import re
import string
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
IDAV2 = os.path.abspath(os.path.join(HERE, ".."))
ROOT = os.path.abspath(os.path.join(IDAV2, "..", ".."))
sys.path.insert(0, os.path.join(IDAV2, "lib"))
sys.dont_write_bytecode = True  # lib/ belongs to WP0: no __pycache__ written there from this build
from fmt import render  # noqa: E402

OUT_REPO = os.environ.get("IDA_OUT_DIR") or os.path.join(ROOT, "Item Disassembly", "AsyncV2")
OUT_CLIENT = os.path.join(os.environ["IDA_OUT_DIR"], "client_out") if os.environ.get("IDA_OUT_DIR") else os.path.join(HERE, "out")
IDS_FILE = os.environ.get("IDA_IDS") or os.path.join(IDAV2, "ids.json")
SRC = os.path.join(HERE, "src")
BASE = os.path.join(IDAV2, "base")
BASE_FORM = os.path.join(BASE, "ida_form_v35.json")
# the list's current dev row: zhenxiang's designing v17 = enabled v16 + two designer defaults (wf_upload's base guard compares to it)
BASE_LIST = os.path.join(BASE, "ida_list_v17d.json")
# the live dev form v35 (CONTRACT header) and the designing list v17 (base/MANIFEST.json)
BASE_MD5 = {BASE_FORM: "861002407efae6a2f0c2c9e5c464c761", BASE_LIST: "0f244e67a0cd56255015b01448458d32"}
BASE_COLUMNS = os.path.join(BASE, "columns.json")
CLASSIC_SAVE = os.path.join(BASE, "IDA_SAVE.v6.json")
CLASSIC_CODE = os.path.join(BASE, "ida_code")
PAYLOADS = os.path.join(HERE, "fixtures", "payload_keys.json")
ACTIONS = ("COMPLETE", "COMPLETE_POST")

# the button models -> (the classic handler base v35 binds, its key, the new handler, does the button post)
BUTTONS = [
    ("button_completed", "onClick_saveAsCompleted", "iasvcomp", "idaV2_onClick_completed", False),
    ("comp_post_button", "onClick_saveAsCompletedPost", "aymq6q8z", "idaV2_onClick_completed_post", True),
]
NEW_FIELDS = [("ida_v2_job_id", "V2 Job ID"), ("ida_idem_key", "Idempotency Key")]
FIELD_TEMPLATE = ("page_status", "n8hu0kme")  # hidden input, dataBind, varchar(255), no events / rules
# blade_dict child of 1914242988707749889: Processing 1914500993831477249 (FACTS "Client")
STATUS_SELECT = ("item_disassembly_status", "4cjp73ay")
STATUS_LEAF = (1792540000001, "Processing")
# the list's own Processing badge colours (base v16 status column)
BADGE = ("processing_status", "Processing Status", "Processing", "processing-button", "#FFBB00", "#FFFCDD", "#8F6A04")
BADGE_TEMPLATE = ("completed_status", "cgsksd6l")
BADGE_FLEX = "2det1nd2"
EDIT_HIDDEN_OLD = "{{arguments[0].row.posted_status.dict_key == 'Pending Post'}}"
# the Processing test first: a NULL posted_status (every Draft, so every V2 Processing row) cannot throw before it runs
EDIT_HIDDEN_NEW = "{{arguments[0].row.item_disassembly_status.dict_key == 'Processing' || arguments[0].row.posted_status.dict_key == 'Pending Post'}}"
# every Item column onChange_idaSourceItem reads (.field() also prunes the Item subform joins)
ITEM_FIELDS = ("material_code,material_name,material_desc,based_uom,serial_number_management,item_batch_management,"
               "batch_number_genaration,table_uom_conversion,table_default_bin")
# the base scripts this build patches, by event key (name, the repo mirror's name)
FORM_PATCHED = {"mounted": ("mounted", "idaForm_mounted.js"), "ida_src_item": ("onChange_idaSourceItem", "idaForm_onChange_idaSourceItem.js"),
                "e9ib2r8i": ("onClick_post", "idaForm_onClick_post.js")}
LIST_PATCHED = {"q82pv0wg": ("delete", "idaList_delete.js"), "ee9v0c1h": ("onItemDisassemblyPostfunc_ee9v0c1h", "idaList_onItemDisassemblyPostfunc_ee9v0c1h.js")}


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def load(path):
    return json.load(open(path, encoding="utf-8"))


def sha(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def md5_file(path):
    return hashlib.md5(open(path, "rb").read()).hexdigest()


def ids():
    d = load(IDS_FILE)
    out = {k: str(d[k]) for k in ("IDA_V2_SUBMIT", "IDA_V2_WORKER")}
    assert all(re.fullmatch(r"[0-9]{1,20}", v) for v in out.values()), out
    return out


def switches(on):
    """on: None (OFF) or the set of actions switched on; OFF keeps both actions on (the master switch decides)"""
    on = set(on or ())
    return {"ASYNC_IDA_ENABLED": "true" if on else "false",
            "IDA_V2_COMPLETE": "true" if (not on or "COMPLETE" in on) else "false",
            "IDA_V2_COMPLETE_POST": "true" if (not on or "COMPLETE_POST" in on) else "false"}


def piece(text, start, end, what):
    """the verbatim text from `start` up to (not including) `end`, `start` found exactly once"""
    assert text.count(start) == 1, (what, "start", text.count(start))
    a = text.index(start)
    b = text.index(end, a)
    return text[a:b].rstrip()


def src(name, c=None, extra=None):
    text = read(os.path.join(SRC, name))
    for k, v in dict(c or {}, **(extra or {})).items():
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


def patch(text, edits, what):
    """apply (label, old, new) edits in order, each old text found exactly once"""
    for label, old, new in edits:
        assert text.count(old) == 1, (what, label, text.count(old))
        text = text.replace(old, new)
    assert "{{" not in text and "/*@@" not in text and not re.findall(r"__[A-Z][A-Z0-9_]*__", text), (what, "token / marker left")
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
        assert t.count(old) == 1, ("badge", old)
        t = t.replace(old, new)
    return t


# the names the lifted BOM-variance dialog puts into its HTML message, escaped in our copy only (idaEscHtml is in src/)
BOM_ESCAPES = [
    ("const label = line.item_name || line.item_selection;", "const label = idaEscHtml(line.item_name || line.item_selection);"),
    ("`Removed: ${sub.sub_material_name || sub.bom_material_code}`", "`Removed: ${idaEscHtml(sub.sub_material_name || sub.bom_material_code)}`"),
    ("`These components differ from BOM ${bom.parent_mat_bom_version}:<br><br>`",
     "`These components differ from BOM ${idaEscHtml(bom.parent_mat_bom_version)}:<br><br>`"),
]


def classic_pieces(form):
    """the verbatim lifts from the classic handlers (CONTRACT section 12): validateForSave and confirmBomVariance (identical in both),
    and the Complete & Post posting code (AGENT id, its closeDialog, postToAccounting) wrapped so its closeDialog stays its own"""
    h = by_name(form)
    comp = h["onClick_saveAsCompleted"]["func"]
    post = h["onClick_saveAsCompletedPost"]["func"]
    vfs = piece(comp, "// sm_item_balance is the Select Stock dialog: it is not saved", "\n\n// The BOM seeds", "validateForSave")
    assert vfs == piece(post, "// sm_item_balance is the Select Stock dialog: it is not saved", "\n\n// The BOM seeds", "validateForSave (post)")
    assert vfs.endswith("\n};") and "const validateForSave = async () => {" in vfs, "validateForSave"
    bom = piece(comp, "// The BOM seeds the component table", "\n\n(async () => {", "confirmBomVariance")
    assert bom == piece(post, "// The BOM seeds the component table", "\n\n(async () => {", "confirmBomVariance (post)")
    assert bom.endswith("\n};") and "const confirmBomVariance = async (data) => {" in bom, "confirmBomVariance"
    for old, new in BOM_ESCAPES:
        assert bom.count(old) == 1, "confirmBomVariance escape: " + old
        bom = bom.replace(old, new)
    agent = piece(post, "// The accounting agent task queue", "\n\nconst closeDialog", "AGENT_TASK_WORKFLOW_ID")
    close = piece(post, "const closeDialog = () => {", "\n\n// this.validate() rejects", "closeDialog (post)")
    posting = piece(post, "const postToAccounting = async", "\n\n// sm_item_balance is the Select Stock dialog", "postToAccounting")
    assert agent.endswith('"2013511169625042946";') and close.endswith("\n};") and posting.endswith("\n};"), "classic post pieces"
    post_block = ("// the classic Complete & Post's posting code, verbatim (base onClick_saveAsCompletedPost): run on a COMPLETED job only\n"
                  "const idaClassicPost = (() => {\n" + agent + "\n\n" + close + "\n\n" + posting + "\n\nreturn postToAccounting;\n})();")
    return vfs, bom, post_block


def mounted_edits(block):
    return [
        ("badge map", '    "Fully Posted": "fullyposted_status",\n  };', '    "Fully Posted": "fullyposted_status",\n    Processing: "processing_status",\n  };'),
        ("Processing branch", "        } else {\n          // Fully Posted and anything else past Draft: the stock has already\n",
         "        } else if (status === \"Processing\") {\n          // a background job holds it: read-only, no save or post button\n"
         "          this.hide([\"button_draft\", \"button_completed\", \"comp_post_button\", \"button_post\"]);\n"
         "          lockComponentsTable();\n"
         "        } else {\n          // Fully Posted and anything else past Draft: the stock has already\n"),
        ("block", '(async () => {\n  try {\n    let pageStatus = "";\n', block + '(async () => {\n  try {\n    let pageStatus = "";\n'),
        ("background view", "        break;\n    }\n  } catch (error) {\n    console.error(error);\n",
         "        break;\n    }\n\n    idaBackgroundView(pageStatus, status);\n  } catch (error) {\n    console.error(error);\n"),
    ]


def explode_edits(base_func, reads):
    head = "(async () => {\n  const idaHeaderSelectionVisibility"
    fetch_old = piece(base_func, "    const fetchByIds = async (collection, ids) => {", "\n\n    const [parentRes, bomRes]", "fetchByIds") + "\n"
    assert fetch_old.endswith("        .get();\n    };\n") and "operator: \"in\", value: ids" in fetch_old, "fetchByIds"
    limit1 = lambda ind: "\n" + " " * ind + ".limit(1)\n" + " " * ind + ".get()\n"
    return [
        ("reads helper", head, reads + "\n// every Item column this handler reads (.field() also prunes the Item subform joins)\n"
         "const IDA_ITEM_FIELDS = \"" + ITEM_FIELDS + "\";\n\n" + head),
        ("chunked id reads", fetch_old, "    const fetchByIds = (collection, ids, fields) => idaReadIds(collection, ids, fields);\n"),
        ("BOM item read", 'fetchByIds("item", [itemId]),', 'fetchByIds("item", [itemId], IDA_ITEM_FIELDS),'),
        ("component item read", 'await fetchByIds("item", componentIds);', 'await fetchByIds("item", componentIds, IDA_ITEM_FIELDS);'),
        ("default storage", '          location_type: "Common",\n        })\n        .get()\n', '          location_type: "Common",\n        })' + limit1(8)),
        ("default bin", "            bin_status: 1,\n          })\n          .get()\n", "            bin_status: 1,\n          })" + limit1(10)),
        ("source balances", "            organization_id: organizationId,\n            is_deleted: 0,\n          })\n          .get()\n",
         "            organization_id: organizationId,\n            is_deleted: 0,\n          })\n          .limit(IDA_READ_MAX)\n          .get()\n"),
        ("source HU rows", "          .where({ material_id: itemId, is_deleted: 0 })\n          .get()\n",
         "          .where({ material_id: itemId, is_deleted: 0 })\n          .limit(IDA_READ_MAX)\n          .get()\n"),
        ("source HUs at the plant", "            ])\n            .get()\n            .catch(() => ({ data: [] }))\n        : { data: [] };\n",
         "            ])\n            .field(\"plant_id\")\n            .limit(IDA_READ_MAX)\n            .get()\n            .catch(() => ({ data: [] }))\n        : { data: [] };\n"),
        ("pick bin", "              .where({ id: balance.location_id, is_deleted: 0 })\n              .get()\n",
         "              .where({ id: balance.location_id, is_deleted: 0 })" + limit1(14)),
        ("pick batch", "              .where({ id: balance.batch_id, is_deleted: 0 })\n              .get()\n",
         "              .where({ id: balance.batch_id, is_deleted: 0 })" + limit1(14)),
        ("pick UOM", "                is_deleted: 0,\n              })\n              .get()\n", "                is_deleted: 0,\n              })" + limit1(14)),
    ]


def onclick_post_edits():
    old = ("    const resAI = await db\n      .collection(\"accounting_integration\")\n      .where({ organization_id: organizationId })\n      .get();\n"
           "    const aiData = resAI.data[0];\n")
    return [("stored status", old, read(os.path.join(SRC, "ida_onClick_post_stored.js")))]


def list_delete_edits():
    guard_old = ("    // Once a disassembly is completed the source item has left stock and the\n    // recovered components have been received; deleting the document would\n"
                 "    // strand both.\n    if (status === \"Completed\" || status === \"Fully Posted\") {\n")
    guard_new = ("    // Once a disassembly is completed the source item has left stock and the\n    // recovered components have been received; deleting the document would\n"
                 "    // strand both. A Processing one is being completed in the background.\n    const UNDELETABLE = [\"Completed\", \"Fully Posted\", \"Processing\"];\n"
                 "    if (UNDELETABLE.includes(status)) {\n")
    write = "    await db\n      .collection(\"sm_item_disassembly\")\n      .doc(row.id)\n      .update({ is_deleted: 1 });\n"
    return [("Processing refused", guard_old, guard_new), ("stored status", write, read(os.path.join(SRC, "ida_list_delete_stored.js")) + write)]


def list_post_edits(reads):
    head = "const callPostItemDisassemblyWorkflow = async (selectedRecords, aiData) => {\n"
    old = ("    const resAI = await db\n      .collection(\"accounting_integration\")\n      .where({ organization_id: organizationID })\n      .get();\n\n"
           "    if (resAI && resAI.data && resAI.data.length > 0) {\n")
    new = read(os.path.join(SRC, "ida_list_post_stored.js")) + "    if (resAI && resAI.data && resAI.data.length > 0) {\n"
    return [("reads helper", head, reads + "\n\n" + head), ("stored status", old, new)]


def build_form(c, rng, taken):
    base = load(BASE_FORM)
    form = copy.deepcopy(base)
    es = form["config"]["eventScript"]
    h = by_name(form)
    k = by_key(form)
    mirrors, added = {}, {"events": [], "fields": [], "badge": None}
    vfs, bom, post_block = classic_pieces(base)
    shared = read(os.path.join(SRC, "ida_shared_client.js")).rstrip()
    reads = read(os.path.join(SRC, "ida_reads.js")).rstrip()

    for model, classic, key, name, posts in BUTTONS:
        btn = find(form["list"], model)[0]
        assert btn["type"] == "button" and btn["events"] == {"onClick": key}, model
        assert h[classic]["key"] == key and h[classic].get("type") == "js" and name not in h, classic
        func = src("idaV2_onClick_completed.js", c, {"HANDLER_NAME": name, "BUTTON_MODEL": model, "CLASSIC": classic,
                                                      "BUTTON_POSTS": "true" if posts else "false"})
        func = fill(func, {"/*@@IDA_SHARED@@*/": shared, "/*@@VALIDATE_FOR_SAVE@@*/": vfs, "/*@@CONFIRM_BOM_VARIANCE@@*/": bom,
                           "/*@@CLASSIC_POST@@*/": post_block})
        nk = new_key(taken, rng)
        es.append({"key": nk, "name": name, "func": func, "type": "js"})
        btn["events"]["onClick"] = nk
        added["events"].append((nk, name, model))
        mirrors[name + ".js"] = func

    block = fill(src("idaV2_mounted_block.js", c), {})
    edits = {"mounted": mounted_edits(block), "ida_src_item": explode_edits(k["ida_src_item"]["func"], reads), "e9ib2r8i": onclick_post_edits()}
    for key, (name, mirror) in FORM_PATCHED.items():
        e = k[key]
        assert e["name"] == name and e.get("type") == "js", (key, name)
        e["func"] = patch(e["func"], edits[key], name)
        mirrors[mirror] = e["func"]

    sel = find(form["list"], STATUS_SELECT[0], key=STATUS_SELECT[1])[0]
    assert sel["type"] == "select" and sel["options"]["hidden"] is True
    top = sel["options"]["datasource"]["rules"]["list"][0]
    parent, anyb = top["children"]
    assert parent["prop"] == "parent_id" and parent["value"] == "1914242988707749889" and anyb["operator"] == "any" and anyb["id"] == 1747862390323
    assert [x["value"] for x in anyb["children"]] == ["Draft", "Issued", "Completed", "Fully Posted"]
    assert str(STATUS_LEAF[0]) not in json.dumps(base)
    leaf = copy.deepcopy(anyb["children"][2])
    assert leaf["prop"] == "dict_key" and leaf["operator"] == "equal" and leaf["parentId"] == anyb["id"]
    leaf.update({"id": STATUS_LEAF[0], "value": STATUS_LEAF[1]})
    anyb["children"].append(leaf)

    tmpl, holder = find(form["list"], BADGE_TEMPLATE[0], key=BADGE_TEMPLATE[1])
    assert tmpl["type"] == "html" and tmpl["options"]["hidden"] is True
    flex = find(form["list"], "flex_" + BADGE_FLEX, key=BADGE_FLEX)[0]
    assert holder is flex["list"]
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

    tmpl, holder = find(form["list"], FIELD_TEMPLATE[0], key=FIELD_TEMPLATE[1])
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
    reads = read(os.path.join(SRC, "ida_reads.js")).rstrip()
    assert h["mounted"] == {"key": "mounted", "name": "mounted", "func": ""}, h["mounted"]
    kick = fill(src("ida_list_mounted_kick.js", c), {})
    h["mounted"]["func"] = kick
    h["mounted"]["type"] = "js"
    mirrors["idaList_mounted.js"] = kick
    edits = {"q82pv0wg": list_delete_edits(), "ee9v0c1h": list_post_edits(reads)}
    for key, (name, mirror) in LIST_PATCHED.items():
        e = k[key]
        assert e["name"] == name and e.get("type") == "js", (key, name)
        e["func"] = patch(e["func"], edits[key], name)
        mirrors[mirror] = e["func"]
    cp = page["list"][0]["options"]["customProps"]
    edit = cp["rowActions"][1]
    assert edit["type"] == "editBtn" and edit["title"] == "Edit" and edit["hidden"] == EDIT_HIDDEN_OLD, edit["hidden"]
    edit["hidden"] = EDIT_HIDDEN_NEW
    assert cp["rowActions"][2]["events"] == [{"key": "q82pv0wg", "name": "delete"}]
    assert [t.get("events") for t in cp["toolbar"] if t.get("title") == "Post"] == [[{"key": "ee9v0c1h", "name": "onItemDisassemblyPostfunc_ee9v0c1h"}]]
    status = cp["columns"][1]
    assert status["name"] == "item_disassembly_status.dict_key"
    # the status column already renders a Processing badge in v16 / v17: asserted, not changed
    assert "Processing" in re.findall(r"scope\.value==='([^']+)'", status["configCustom"]["content"])
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
    for x in doc["list"]:
        r = walk(x, "/list/[key=%s]" % x["key"])
        if r:
            return r
    raise AssertionError(key)


def expected_paths(fb, added):
    e_form = set()
    kb = [x["key"] for x in fb["config"]["eventScript"]]
    for k, name, _model in added["events"]:
        e_form.add("/config/eventScript/[key=%s] (added at %d: %s)" % (k, kb.index(k), name))
    for model, _classic, _key, _name, _posts in BUTTONS:
        e_form.add(key_path(fb, find(fb["list"], model)[0]["key"]) + "/events/onClick")
    e_form |= {"/config/eventScript/[key=%s]/func" % key for key in FORM_PATCHED}
    e_form.add(key_path(fb, STATUS_SELECT[1]) + "/options/datasource/rules/list/0/children/1/children (length 4 -> 5)")
    bk, model = added["badge"]
    flex = find(fb["list"], BADGE_TEMPLATE[0])[1]
    e_form.add(key_path(fb, BADGE_FLEX) + "/list/[key=%s] (added at %d: %s)" % (bk, [x["key"] for x in flex].index(bk), model))
    top = [x["key"] for x in fb["list"]]
    for k, model, _label in added["fields"]:
        e_form.add("/list/[key=%s] (added at %d: %s)" % (k, top.index(k), model))
    e_list = {"/config/eventScript/[key=mounted]/func", "/config/eventScript/[key=mounted]/type (added)",
              "/list/[key=s6wz5vvo]/options/customProps/rowActions/1/hidden"}
    e_list |= {"/config/eventScript/[key=%s]/func" % key for key in LIST_PATCHED}
    return e_form, e_list


def check_not_record(js_text, form):
    """NOT_RECORD against the recorded form payloads, the table's columns, the v35 widgets and the classic IDA_SAVE v6"""
    names = json.loads(re.search(r"const IDA_NOT_RECORD = (\[[^\]]*\])", js_text, re.S).group(1).replace("\n", " "))
    cols = {c["name"] for c in load(BASE_COLUMNS)["columns"]["sm_item_disassembly"]}
    models = set()

    def walk(n, inside):
        # the top-level models: a table's or a dialog's own fields are not top-level record keys
        if isinstance(n, dict):
            if isinstance(n.get("model"), str) and not inside:
                models.add(n["model"])
            nested = inside or n.get("type") in ("table", "dialog")
            for v in n.values():
                walk(v, nested)
        elif isinstance(n, list):
            for v in n:
                walk(v, inside)
    walk(form["list"], False)
    gone = {}
    for run in load(PAYLOADS)["runs"]:
        stray = [k for k in run["keys"] if k not in cols and k not in names and not k.startswith("dialog_")]
        # a key of an older form version: v35 has no such widget, so no v35 payload carries it
        assert not [k for k in stray if k in models], ("payload keys that are neither columns nor stripped", run["run_id"], stray)
        for k in stray:
            gone.setdefault(k, []).append(run["run_id"])
    classic = read(CLASSIC_SAVE) + "".join(read(p) for p in sorted(glob.glob(os.path.join(CLASSIC_CODE, "*.js"))))
    for n in names:
        for p in (r"allData\.%s(?![A-Za-z0-9_])", r"allData\[\\?[\"']%s\\?[\"']\]", r"code_fillback\.data\.allData\.%s(?![A-Za-z0-9_])", r"entry\.%s(?![A-Za-z0-9_])"):
            assert not re.search(p % re.escape(n), classic), ("the classic reads a stripped key", n)
    stripped_cols = sorted(n for n in names if n in cols)
    return names, stripped_cols, gone


def handler_diff(name, a, b):
    return "".join(difflib.unified_diff(a.splitlines(True), b.splitlines(True), "base/" + name, "built/" + name, n=2))


def build(on):
    for p, m in BASE_MD5.items():
        assert md5_file(p) == m, ("the pinned base changed", p, md5_file(p), m)
    wf = ids()
    c = dict(switches(on), **wf)
    taken = set()
    for p in (BASE_FORM, BASE_LIST):
        taken |= set(re.findall(r"[a-z0-9]{8}", read(p)))
    rng = random.Random(20261021)
    fa, fb, fm, added = build_form(c, rng, taken)
    la, lb, lm = build_list(c)
    return wf, c, fa, fb, fm, added, la, lb, lm


def main():
    write = "--write" in sys.argv
    arg = [a for a in sys.argv[1:] if a.startswith("--on")]
    on_actions = None
    if arg:
        on_actions = set(arg[0].split("=", 1)[1].split(",")) if "=" in arg[0] else set(ACTIONS)
        assert on_actions <= set(ACTIONS) and on_actions, on_actions
    variants = [("OFF", None), ("ON", on_actions or set(ACTIONS))]
    built = {}
    for label, on in variants:
        wf, c, fa, fb, fm, added, la, lb, lm = build(on)
        names, stripped_cols, gone = check_not_record(fm["idaV2_onClick_completed.js"], fa)
        e_form, e_list = expected_paths(fb, added)
        report = ["== %s build (switches %s, ids %s)" % (label, {k: c[k] for k in ("ASYNC_IDA_ENABLED", "IDA_V2_COMPLETE", "IDA_V2_COMPLETE_POST")}, wf)]
        for name, (a, b), expected in (("IDAform.json vs base ida_form_v35", (fa, fb), e_form), ("IDAlistPage.json vs base ida_list_v17d", (la, lb), e_list)):
            got = diffs(a, b)
            report.append("-- " + name)
            report += ["    " + p for p in sorted(got)]
            assert set(got) == expected and len(got) == len(expected), (label, name, sorted(set(got) ^ expected))
        strip = lambda f: re.sub(r'^// idaV2_onClick_completed\w* - Item Disassembly form, onClick of \w+ |const IDA_CLASSIC = "\w+";|const IDA_BUTTON_POSTS = \w+;', "", f, flags=re.M)
        assert strip(fm["idaV2_onClick_completed.js"]) == strip(fm["idaV2_onClick_completed_post.js"]), "the two handlers differ beyond their constants"
        report.append("-- NOT_RECORD: %d keys (+ every dialog_* key); none read by IDA_SAVE v6; every recorded payload key is a column, stripped "
                      "or a field v35 no longer has %s; stripped columns (display-only badges, never written by the classic): %s"
                      % (len(names), sorted(gone), stripped_cols))
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
        for fname, obj in (("IDAform.json", fb), ("IDAlistPage.json", lb)):
            text = render(obj, "indent")
            assert json.loads(text) == obj
            open(os.path.join(OUT_REPO, fname), "w", encoding="utf-8").write(text)
        for fname, text in list(fm.items()) + list(lm.items()):
            open(os.path.join(OUT_REPO, fname), "w", encoding="utf-8").write(text)
        for fname, obj in (("IDAform.json", built["ON"][3]), ("IDAlistPage.json", built["ON"][7])):
            text = render(obj, "indent")
            assert json.loads(text) == obj
            open(os.path.join(OUT_CLIENT, "on", fname), "w", encoding="utf-8").write(text)
        hd = []
        base_form, base_list = by_key(fa), by_key(la)
        for key, (name, _m) in FORM_PATCHED.items():
            hd.append(handler_diff(name + ".js", base_form[key]["func"], by_key(fb)[key]["func"]))
        for key, (name, _m) in LIST_PATCHED.items():
            hd.append(handler_diff("list_" + name + ".js", base_list[key]["func"], by_key(lb)[key]["func"]))
        open(os.path.join(OUT_CLIENT, "handler_diffs.txt"), "w", encoding="utf-8").write("\n".join(hd))
        open(os.path.join(OUT_CLIENT, "diff_report.txt"), "w", encoding="utf-8").write("\n".join(built["OFF"][9] + built["ON"][9]) + "\n")
        print("wrote the %s build to %s:" % (repo_label, OUT_REPO), sorted(["IDAform.json", "IDAlistPage.json"] + list(fm) + list(lm)),
              "+ %s/{diff_report.txt,handler_diffs.txt,on/IDAform.json,on/IDAlistPage.json}" % OUT_CLIENT)


if __name__ == "__main__":
    main()
