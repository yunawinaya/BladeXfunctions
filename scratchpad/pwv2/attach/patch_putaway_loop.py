"""PUTAWAY_LOOP: a Completed confirmation keeps the attachments it carries. The classic writes ref_doc only on a non-Completed
save (update_node_YJRu1B3c); for Completed, PUTAWAY writes status / lines / records, so the attachments mobile and desktop send
with Completed were dropped (prod: 10 confirmations with photos since 2026-09-17, 0 putaways with ref_doc). Before PUTAWAY runs for
an existing putaway, the files the confirmation carries are ADDED to the putaway's stored list (an empty or absent list keeps it:
the released mobile app sends [] whenever no photo was taken, and it never loads the stored list).

  python3 patch_putaway_loop.py <in.json> <out.json>     (dev: the repo file, IDENTICAL to dev v16; prod: the deployed prod JSON)
"""
import copy
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "grv2"))
import wfkit as K  # noqa: E402

DECIDE = """// The attachments of this confirmation: a Completed save adds the files it carries to the putaway's (an empty list adds nothing)
const data = [{{node:code_node_kku8SAT9.data.data}}][0] || {};
const pageStatus = [{{workflowparams:pageStatus}}][0];
const sent = Array.isArray(data.ref_doc) ? data.ref_doc.filter((f) => f && typeof f === "object" && !Array.isArray(f)) : [];
const write = pageStatus === "Edit" && /^[0-9]+$/.test(String(data.id || "")) && sent.length > 0 ? "YES" : "NO";
return { write };"""

STORED = """SELECT CAST(p.ref_doc AS CHAR) AS ref_doc
  FROM transfer_order_putaway p
 WHERE p.tenant_id = '{{system:tenantId}}'
   AND p.id = {{node:code_node_kku8SAT9.data.lockId}}
   AND p.is_deleted = 0"""

MERGE = """// The putaway's attachments after this confirmation: what it has, then the files the confirmation carries (once each)
const data = [{{node:code_node_kku8SAT9.data.data}}][0] || {};
const rows = [{{node:sql_node_PwRefDocStored.data}}][0];
const row = (Array.isArray(rows) ? rows[0] : rows) || {};
let stored = [];
try {
  const x = typeof row.ref_doc === "string" ? JSON.parse(row.ref_doc) : row.ref_doc;
  stored = Array.isArray(x) ? x : [];
} catch (e) {
  stored = [];
}
const idOf = (f) => String(f.url || f.link || f.key || f.name || JSON.stringify(f));
const files = stored.filter((f) => f && typeof f === "object" && !Array.isArray(f));
const seen = new Set(files.map(idOf));
for (const f of Array.isArray(data.ref_doc) ? data.ref_doc : []) {
  if (!f || typeof f !== "object" || Array.isArray(f) || seen.has(idOf(f))) continue;
  seen.add(idOf(f));
  files.push(f);
}
return { entry: { ref_doc: files } };"""


def find(n, nid):
    if isinstance(n, dict):
        if n.get("id") == nid and "type" in n:
            return n
        for v in n.values():
            r = find(v, nid)
            if r:
                return r
    elif isinstance(n, list):
        for v in n:
            r = find(v, nid)
            if r:
                return r
    return None


def patch(doc):
    assert find(doc, "code_node_PwRefDoc") is None, "already patched"
    item = find(doc, "condition_or_node_item_iXJ6ZN1A")
    assert item["data"]["title"] == "Completed" and [b["id"] for b in item["blocks"]] == ["code_node_XZtMB79F", "workflow_node_tCxXH6MO", "if_sd8ItdWl"], \
        [b["id"] for b in item["blocks"]]
    tmpl = find(doc, "update_node_EecM8ibA")  # this file's own header update (by the putaway id), as the template
    assert [p["prop"] for p in tmpl["data"]["props"]["list"]] == ["is_processing"]
    upd = copy.deepcopy(tmpl)
    upd["id"] = "update_node_PwRefDoc"
    for k in ("title", "nodeName", "name"):
        upd["data"][k] = "Save the confirmation's attachments (ref_doc)"
    p = upd["data"]["props"]["list"][0]
    # as update_node_YJRu1B3c writes it: a field reference (a "value" prop would store the placeholder text)
    p.update({"prop": "ref_doc", "valueType": "field", "value": "{{node:code_node_PwRefDocMerge.data.entry.ref_doc}}", "propLabel": "Reference Document"})
    upd["data"]["table_id"]["rules"]["list"][0]["id"] = 1797800000011
    upd["data"]["table_id"]["rules"]["list"][0]["parentId"] = 1797800000012
    ids = K.Ids(1797800000000)
    # before PUTAWAY: should the write ever fail, it fails before any stock moves
    item["blocks"][0:0] = [
        K.code("code_node_PwRefDoc", "Attachments of this confirmation to keep?", DECIDE, ["write"]),
        K.if_(ids, "if_PwRefDoc", "IF the confirmation carries attachments", "'{{node:code_node_PwRefDoc.data.write}}' == 'YES'", [
            K.sql("sql_node_PwRefDocStored", "The putaway's stored attachments", STORED, ["ref_doc"]),
            K.code("code_node_PwRefDocMerge", "Stored attachments + this confirmation's files", MERGE, ["entry"], objects=("entry",)),
            upd]),
    ]
    return doc


if __name__ == "__main__":
    src, out = sys.argv[1], sys.argv[2]
    doc = patch(json.load(open(src, encoding="utf-8")))
    raw = open(src, encoding="utf-8").read()
    indent = 2 if raw.startswith("{\n  \"") else 1 if raw.startswith("{\n \"") else None
    open(out, "w", encoding="utf-8").write(json.dumps(doc, ensure_ascii=False, indent=indent) + ("\n" if raw.endswith("\n") else ""))
    print("patched", out)
