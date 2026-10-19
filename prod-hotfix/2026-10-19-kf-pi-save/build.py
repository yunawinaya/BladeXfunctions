#!/usr/bin/env python3
"""PI_SAVE: write only the invoicing counters back to PO / GR lines, and refuse a save over a PI that is no longer Draft.

  python3 build.py [dev] [prod]   # re-dump the enabled PI_SAVE of each env named (default both) and patch it:
                                  #   dev  -> Purchase Invoice/PIsaveWorkflow.json (repo, prettier format)
                                  #   prod -> PI_SAVE.prod.json next to this file (paste into the prod designer)

Dev took this as v19 on 2026-10-19. Paste PI_SAVE.prod.json only BEFORE the full dev->prod deployment: it is built on
prod v15, and once the deployment has carried dev v19 over, pasting it would drop dev's custom-field nodes.

KF CORPORATE (073522), 2026-10-19: Update PO re-sent whole table_po rows, so a PO discount line's negative unit_price
failed `minimum >= 0` while Update GR (parallel branch) had already marked the GR lines Fully Invoiced. The PI was then
saved back to Draft from the stale form, and every retry hit 410.

  1. code_pi_apply emits header {id, pi_status} and changed-line {id, invoice_qty, pi_status} lists; the lines go
     through the line collections (Item Table(Purchase Order) / Item Table(Goods Receiving)) like GR_REVERT_COMPLETED
     and PURCHASE_RETURN already do on prod; each write is gated on a non-empty list.
  2. PO/GR fetches run in parallel with a fetch of the stored PI (Edit only); a PI whose stored status is set and not
     Draft ends with 409 before any write - no double apply on retry/double-click, no Completed -> Draft flip.

Dev and prod differ only in dev's custom-field nodes (cfwipe, 10-16), which this patch does not touch.
"""
import copy, glob, json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = "/Users/yunawinaya/Developer/BladeXfunctions"
REPO_FILE = os.path.join(REPO_ROOT, "Purchase Invoice/PIsaveWorkflow.json")
PROD_OUT = os.path.join(HERE, "PI_SAVE.prod.json")
WF_ID = "2066342495378059266"
BASE_VERSION = {"dev": 18, "prod": 15}


def dump(env):
    sql = ("SELECT version_number, script_json FROM su_code_workflow_history "
           f"WHERE data_id='{WF_ID}' AND status='enabled' ORDER BY version_number DESC LIMIT 1")
    r = subprocess.run([REPO_ROOT + "/.dbtools/db", f"--{env}", "--json", "--limit", "1", sql],
                       check=True, capture_output=True, text=True)
    row = json.loads(r.stdout[r.stdout.index("["):])[0]
    v = int(row["version_number"])
    print(f"{env} enabled PI_SAVE v{v}")
    if v != BASE_VERSION[env]:
        sys.exit(f"  {env} moved to v{v} (patch built on v{BASE_VERSION[env]}) - re-check before rebuilding")
    return json.loads(row["script_json"])


def walk(nodes, fn, parent=None):
    for n in nodes:
        fn(n, parent)
        for k in ("blocks", "children"):
            if n.get(k):
                walk(n[k], fn, n)


def index(doc):
    out = {}
    walk(doc["nodes"], lambda n, p: out.__setitem__(n["id"], n))
    return out


def replace_once(text, old, new, what):
    assert text.count(old) == 1, f"{what}: expected exactly one match, found {text.count(old)}"
    return text.replace(old, new)


# ---------------------------------------------------------------- code_pi_apply
APPLY_EDITS = [
    ("// whether it was nested to begin with. Status flows down that link, and what is\n"
     "// written back keeps the shape it arrived in rather than being re-nested.\n",
     "// whether it was nested to begin with. Status flows down that link.\n"),
    ("  return Math.round((parseFloat(positiveValue) || 0) * 100000000) / 100000000;\n};\n",
     "  return Math.round((parseFloat(positiveValue) || 0) * 100000000) / 100000000;\n};\n"
     "const qtyStr = (value) => absRound8(value).toFixed(8);\n"),
    ('  const updated = flattenWithParent(items, "item_id").map(({ row, parent, nested }) => {\n',
     '  const source = flattenWithParent(items, "item_id");\n'
     "  const updated = source.map(({ row, parent }) => {\n"),
    ("      return { row: { ...row, invoice_qty: totalInvoicedQty }, parent, nested };\n",
     "      return { row: { ...row, invoice_qty: totalInvoicedQty }, parent };\n"),
    ("    return { row: { ...row }, parent, nested };\n",
     "    return { row: { ...row }, parent };\n"),
    ("""  // Written back as table_po / table_gr in the shape it arrived in: a bundle's
  // items go back under their bundle line only if that is where they came from,
  // and stay where they are when the document keeps them as flat rows.
  const updatedItems = [];

  for (const [index, entry] of updated.entries()) {
    if (entry.nested) continue;

    const children = updated
      .filter((candidate) => candidate.nested && candidate.parent === index)
      .map((candidate) => candidate.row);

    if (children.length > 0) {
      updatedItems.push({ ...entry.row, children });
    } else if (Array.isArray(entry.row.children)) {
      updatedItems.push({ ...entry.row, children: [] });
    } else {
      updatedItems.push(entry.row);
    }
  }
""",
     """  // Only the counters of changed lines go back: a whole-row write re-validates every other column.
  const lineUpdates = [];

  for (const [index, entry] of updated.entries()) {
    const before = source[index].row;

    if (
      absRound8(entry.row.invoice_qty) === absRound8(before.invoice_qty) &&
      String(entry.row.pi_status || "") === String(before.pi_status || "")
    ) {
      continue;
    }

    lineUpdates.push({
      id: entry.row.id,
      invoice_qty: qtyStr(entry.row.invoice_qty),
      pi_status: entry.row.pi_status || "",
    });
  }
"""),
    ("  return { updatedItems, newPIStatus };\n",
     "  return { lineUpdates, newPIStatus };\n"),
    ("""let updatedPO = [];
for (const poID of poIds) {
  const poData = poList.find((po) => po.id === poID);
  if (!poData) continue;
  const poItems = poData.table_po || [];
  const { updatedItems, newPIStatus } = processItems(poItems, data.table_pi, poData.id, "line_po_id", "po_line_id", "quantity");
  updatedPO.push({ po_id: poData.id, pi_status: newPIStatus, table_po: updatedItems });
}

let updatedGR = [];
if (data.gr_id && data.gr_id.length > 0) {
  const grIds = Array.isArray(data.gr_id) ? data.gr_id : [data.gr_id];
  for (const grID of grIds) {
    const grData = grList.find((gr) => gr.id === grID);
    if (!grData) continue;
    const grItems = grData.table_gr || [];
    const { updatedItems, newPIStatus } = processItems(grItems, data.table_pi, grData.id, "line_gr_id", "gr_line_id", "received_qty");
    updatedGR.push({ gr_id: grData.id, pi_status: newPIStatus, table_gr: updatedItems });
  }
}

return { updatedPO, updatedGR };""",
     """const poHeaders = [];
const poLines = [];
for (const poID of poIds) {
  const poData = poList.find((po) => po.id === poID);
  if (!poData) continue;
  const poItems = poData.table_po || [];
  const { lineUpdates, newPIStatus } = processItems(poItems, data.table_pi, poData.id, "line_po_id", "po_line_id", "quantity");
  poHeaders.push({ id: poData.id, pi_status: newPIStatus });
  poLines.push(...lineUpdates);
}

const grHeaders = [];
const grLines = [];
if (data.gr_id && data.gr_id.length > 0) {
  const grIds = Array.isArray(data.gr_id) ? data.gr_id : [data.gr_id];
  for (const grID of grIds) {
    const grData = grList.find((gr) => gr.id === grID);
    if (!grData) continue;
    const grItems = grData.table_gr || [];
    const { lineUpdates, newPIStatus } = processItems(grItems, data.table_pi, grData.id, "line_gr_id", "gr_line_id", "received_qty");
    grHeaders.push({ id: grData.id, pi_status: newPIStatus });
    grLines.push(...lineUpdates);
  }
}

const flag = (rows) => (rows.length > 0 ? 1 : 0);

return {
  poHeaders,
  hasPoHeaders: flag(poHeaders),
  poLines,
  hasPoLines: flag(poLines),
  grHeaders,
  hasGrHeaders: flag(grHeaders),
  grLines,
  hasGrLines: flag(grLines),
};"""),
]

GUARD_JS = """const entry = {{node:code_pi_fillback.data.entry}};
const stored = {{node:get_node_pi_stored.data.data}};

const record = (Array.isArray(stored) ? stored : [stored]).find((row) => row && String(row.id) === String(entry.id));
const storedStatus = record ? String(record.pi_status || "") : "";
const blocked = storedStatus !== "" && storedStatus !== "Draft";

return {
  blocked: blocked ? 1 : 0,
  message: blocked
    ? `Purchase Invoice ${record.purchase_invoice_no || ""} is already ${storedStatus}, so it was not saved again. Close and reopen it to see its current state.`
    : "",
};"""


def resp(key, name, bson):
    return {"key": key, "name": name, "title": name, "description": "", "bsonType": bson, "isExpand": False,
            "children": []}


class Ids:
    def __init__(self, start): self.v = start
    def next(self):
        self.v += 1
        return self.v


RULE_IDS = Ids(1792300000100)


def leaf_in(value):
    parent = RULE_IDS.next()
    return {"id": RULE_IDS.next(), "parentId": parent, "isTop": True, "prop": "id", "operator": "in",
            "valueType": "field", "value": value, "type": "leaf", "level": 1, "propLabel": "主键ID",
            "valueLabel": "", "operatorLabel": "In"}


def prop(name, value, label):
    return {"prop": name, "valueType": "field", "value": value, "operator": "", "valueLabel": "", "propLabel": label}


def if_node(nid, title, code, true_blocks):
    return {"id": nid, "type": "if",
            "data": {"title": title, "isValidator": True, "nodeName": title, "name": title,
                     "condition_type": "Expression", "expression": {"type": "javascript", "code": code}},
            "blocks": [{"id": f"ifBlock_{nid[3:]}_true", "type": "ifBlock", "data": {"title": "true"}, "blocks": true_blocks},
                       {"id": f"ifBlock_{nid[3:]}_false", "type": "ifBlock", "data": {"title": "false"}, "blocks": []}]}


def line_update(nid, title, source, coll, ref):
    return {"id": nid, "type": "update-node",
            "data": {"table_id": {"source": source, "rules": {"collectionId": coll, "list": [leaf_in(f"{{{{node:{ref}.id}}}}")]}},
                     "fields": [], "condition": {}, "title": title, "isValidator": True, "nodeName": title, "name": title,
                     "props": {"modelName": "", "list": [
                         prop("id", f"{{{{node:{ref}.id}}}}", "主键ID"),
                         prop("invoice_qty", f"{{{{node:{ref}.invoice_qty}}}}", "Invoice Qty"),
                         prop("pi_status", f"{{{{node:{ref}.pi_status}}}}", "Line PI Status")]}},
            "blocks": []}


def branch(template, nid, title, blocks):
    b = copy.deepcopy(template)
    b["id"] = nid
    b["data"]["title"] = b["data"]["nodeName"] = b["data"]["name"] = title
    for leaf in b["data"]["filter"]["list"]:
        leaf["parentId"] = RULE_IDS.next()
        leaf["id"] = RULE_IDS.next()
    b["blocks"] = blocks
    return b


def patch(doc):
    global RULE_IDS
    RULE_IDS = Ids(1792300000100)
    doc = copy.deepcopy(doc)
    n = index(doc)

    # 1. code_pi_apply -> narrow outputs
    apply = n["code_pi_apply"]["data"]
    code = apply["script"]["code"]
    for i, (old, new) in enumerate(APPLY_EDITS):
        code = replace_once(code, old, new, f"code_pi_apply edit {i}")
    apply["script"]["code"] = code
    assert [r["name"] for r in apply["response_json"]] == ["updatedPO", "updatedGR"]
    apply["response_json"] = [
        resp("pohdrs01", "poHeaders", "array"), resp("haspohd1", "hasPoHeaders", "int"),
        resp("polines1", "poLines", "array"), resp("haspoln1", "hasPoLines", "int"),
        resp("grhdrs01", "grHeaders", "array"), resp("hasgrhd1", "hasGrHeaders", "int"),
        resp("grlines1", "grLines", "array"), resp("hasgrln1", "hasGrLines", "int"),
    ]

    # 2. header updates: pi_status only, gated; line updates through the line collections, gated
    for hdr, key, table_prop in (("update_node_po", "poHeaders", "table_po"), ("update_node_gr", "grHeaders", "table_gr")):
        d = n[hdr]["data"]
        props = d["props"]["list"]
        assert [p["prop"] for p in props] == ["id", "pi_status", table_prop], [p["prop"] for p in props]
        d["props"]["list"] = [dict(props[0], value=f"{{{{node:code_pi_apply.data.{key}.id}}}}"),
                              dict(props[1], value=f"{{{{node:code_pi_apply.data.{key}.pi_status}}}}")]
        rules = d["table_id"]["rules"]["list"]
        assert len(rules) == 1 and rules[0]["prop"] == "id", rules
        rules[0]["value"] = f"{{{{node:code_pi_apply.data.{key}.id}}}}"

    par = n["condition_all_pi_update"]
    po_item, gr_item = par["blocks"]
    assert [b["id"] for b in po_item["blocks"]] == ["update_node_po"]
    assert [b["id"] for b in gr_item["blocks"]] == ["update_node_gr"]
    po_item["blocks"] = [
        if_node("if_pi_po_lines", "Has PO Lines?", "'{{node:code_pi_apply.data.hasPoLines}}' == '1'", [
            line_update("update_node_po_lines", "Update PO Lines",
                        "Item Table(Purchase Order):Table:1939901372270747649", "1939901372270747649",
                        "code_pi_apply.data.poLines")]),
        if_node("if_pi_po_header", "Has PO?", "'{{node:code_pi_apply.data.hasPoHeaders}}' == '1'", [n["update_node_po"]]),
    ]
    gr_item["blocks"] = [
        if_node("if_pi_gr_lines", "Has GR Lines?", "'{{node:code_pi_apply.data.hasGrLines}}' == '1'", [
            line_update("update_node_gr_lines", "Update GR Lines",
                        "Item Table(Goods Receiving):Table:1939901512083677186", "1939901512083677186",
                        "code_pi_apply.data.grLines")]),
        if_node("if_pi_gr_header", "Has GR?", "'{{node:code_pi_apply.data.hasGrHeaders}}' == '1'", [n["update_node_gr"]]),
    ]

    # 3. parallel fetch (PO, GR, stored PI) + stale-save guard before any write
    top = doc["nodes"]
    ids = [x["id"] for x in top]
    i = ids.index("search_node_po")
    assert ids[i - 1:i + 3] == ["code_pi_fillback", "search_node_po", "search_node_gr", "if_pi_completed_validate"], ids

    stored = copy.deepcopy(n["get_node_pi"])
    stored["id"] = "get_node_pi_stored"
    sd = stored["data"]
    sd["title"] = sd["nodeName"] = sd["name"] = "Fetch Stored PI"
    assert sd["table_id"]["rules"]["list"][0]["value"] == "{{node:code_pi_fillback.data.entry.id}}"
    sd["table_id"]["rules"]["list"] = [leaf_in("{{node:code_pi_fillback.data.entry.id}}")]

    fetch = copy.deepcopy(par)
    fetch["id"] = "condition_all_pi_fetch"
    fetch["data"]["title"] = "Parallel Fetch"
    fetch["blocks"] = [
        branch(po_item, "condition_all_pi_fetch_item_po", "Branch 1", [top[i]]),
        branch(po_item, "condition_all_pi_fetch_item_gr", "Branch 2", [top[i + 1]]),
        branch(po_item, "condition_all_pi_fetch_item_pi", "Branch 3", [
            if_node("if_pi_edit", "Edit?", "'{{workflowparams:data.page_status}}' == 'Edit'", [stored])]),
    ]

    end410 = n["end_pi_410"]
    end409 = copy.deepcopy(end410)
    end409["id"] = "end_pi_409"
    assert end409["data"]["code"] == 410
    end409["data"]["code"] = 409
    end409["data"]["msg"]["code"] = "{{node:code_pi_guard.data.message}}"

    guard = copy.deepcopy(n["code_pi_410"])
    guard["id"] = "code_pi_guard"
    gd = guard["data"]
    gd["title"] = gd["nodeName"] = gd["name"] = "Stored PI Still Draft?"
    gd["script"]["code"] = GUARD_JS
    gd["response_json"] = [resp("guardblk", "blocked", "int"), resp("guardmsg", "message", "string")]

    top[i:i + 2] = [
        fetch,
        guard,
        if_node("if_pi_guard_failed", "Already Saved?", "'{{node:code_pi_guard.data.blocked}}' == '1'", [end409]),
    ]

    seen = []
    walk(doc["nodes"], lambda x, p: seen.append(x["id"]))
    assert len(seen) == len(set(seen)), "duplicate node id"
    return doc


def prettier(text):
    found = glob.glob(os.path.expanduser("~/.npm/_npx/*/node_modules/prettier/bin/prettier.cjs"))
    cmd = ["node", found[0]] if found else ["npx", "--yes", "prettier@3.9.8"]
    out = subprocess.run(cmd + ["--parser", "json"], input=text, capture_output=True, text=True)
    if out.returncode:
        sys.exit("prettier failed: " + out.stderr[:300])
    return out.stdout


def main():
    targets = sys.argv[1:] or ["dev", "prod"]

    if "dev" in targets:
        dev = dump("dev")
        raw = open(REPO_FILE, encoding="utf-8").read()
        repo = json.loads(raw)
        if prettier(json.dumps(repo, ensure_ascii=False, separators=(",", ":"))) != raw:
            sys.exit("repo file is not prettier-formatted - refusing to rewrite it")
        if repo != dev:
            sys.exit("repo file is not dev's enabled v18 - pull it first")

        open(REPO_FILE, "w", encoding="utf-8").write(prettier(json.dumps(patch(repo), ensure_ascii=False, separators=(",", ":"))))
        print(f"wrote {os.path.relpath(REPO_FILE, REPO_ROOT)} (dev)")

    if "prod" in targets:
        open(PROD_OUT, "w", encoding="utf-8").write(json.dumps(patch(dump("prod")), ensure_ascii=False, indent=2) + "\n")
        print(f"wrote {os.path.relpath(PROD_OUT, REPO_ROOT)} (prod paste)")


if __name__ == "__main__":
    main()
