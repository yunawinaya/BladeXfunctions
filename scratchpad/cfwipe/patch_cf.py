"""Custom fields an edit leaves out are kept, not blanked (user 2026-10-16: "every save").

A save's update node writes its custom-field column from the payload; a caller that leaves the key out (mobile, imports,
workflow-to-workflow calls) wrote NULL over the stored value, and a line array rewritten without the line keys lost them
too (mobile Goods Receiving edits send no line ids, so their lines are re-inserted). Before each such update node:
  code_node_CfNeed<n>   did this payload leave the header key, or any line's key, out?  (no read on the common path)
  if_CfNeed<n>          only then: get_node_CfStored<n> (the stored record, read by id - a read node gives the custom
                        fields by field name) -> code_node_CfFill<n> (the header as stored; each line by its id, else by
                        its natural key in order, every custom_fields* key the line lacks)
  code_node_CfOut<n>    what the update writes: the payload's values, or the filled ones
and the update node's custom-field prop and line-array prop read code_node_CfOut<n>.

  python3 patch_cf.py fetch [NAME ...]    the enabled DEV version of each workflow -> base/<NAME>.json (+ version)
  python3 patch_cf.py build [NAME ...]    base/<NAME>.json -> out/<NAME>.json
"""
import copy
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "grv2"))
import wfkit as K  # noqa: E402
from dbq import q  # noqa: E402

# workflow: (update nodes, header key, line-array prop or None, line keys, natural line key or None)
CFG = {
    "CUSTOMER_SAVE": (["update_customer"], "custom_fields_5v598pdl", None, [], None),
    "SUPPLIER_SAVE": (["update_supplier"], "custom_fields_csihktvh", None, [], None),
    "ITEM_SAVE": (["update_item"], "custom_fields", None, [], None),
    "PO_SAVE": (["update_po"], "custom_fields_b3w85tmv", "table_po", ["custom_fields_va4w0xz3"], None),
    "GOODS_RECEIVING": (["update_node_a31whzYI", "update_node_bUR4vc0L"], "custom_fields_e9609s2l", "table_gr", ["custom_fields_d7o7rdkd"],
                        "po_line_item_id"),
    "GR_CREATED": (["update_gr"], "custom_fields_e9609s2l", "table_gr", ["custom_fields_d7o7rdkd"], "po_line_item_id"),
    "GR_COMPLETE_SUBMIT": (["update_node_RSgr"], "custom_fields_e9609s2l", "table_gr", ["custom_fields_d7o7rdkd"], "po_line_item_id"),
    "PI_SAVE": (["update_node_pi"], "custom_fields_d10wd6ob", "table_pi", ["custom_fields_y78jfz24"], None),
    "PREQ_SAVE": (["update_node_hv0acfFd"], "custom_fields_8k2wxzce", "table_pr", ["custom_fields_v2a8l69e"], None),
    "SO_SAVE": (["update_node_Bw4VsiNH"], "custom_fields_m07krnod", "table_so", ["custom_fields"], None),
    "SM_MISC_ISSUE": (["update_node_SPHzcj8Y", "update_node_v5trWrpH"], "custom_fields_56oh0ovf", "stock_movement", ["custom_fields_qz1is2tj"], None),
}

COMMON = """const missing = (v) => v === undefined || v === null;
const flat = (rows) => {
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r !== "object") continue;
    out.push(r);
    for (const c of Array.isArray(r.children) ? r.children : []) if (c && typeof c === "object") out.push(c);
  }
  return out;
};"""

NEED = """// Custom fields this edit would blank: the payload left the header object, or a line's, out
__COMMON__
const cf = [__CF__][0];
const lines = __LINES_OR_NULL__;
const rawId = [__ID__][0];
const id = missing(rawId) ? "" : String(rawId).trim();
const lineKeys = __LINEKEYS__;
const lineMiss = flat(lines).some((r) => lineKeys.some((k) => missing(r[k])));
return { need: /^[0-9]{1,20}$/.test(id) && (missing(cf) || lineMiss) ? "YES" : "NO", id: id };"""

FILL = """// The stored custom fields for what this edit left out: the header as stored; each line by its id__NATDOC__
__COMMON__
const cf = [__CF__][0];
const lines = __LINES_OR_NULL__;
const got = [{{node:__GET__.data.data}}][0];
const stored = (Array.isArray(got) ? got[0] : got) || {};
const natKey = __NATKEY__;
const storedRows = flat(stored[__LINEPROP__]);
const sentIds = new Set(flat(lines).map((r) => (missing(r.id) ? "" : String(r.id))).filter((x) => x));
const byId = new Map(storedRows.filter((r) => !missing(r.id) && r.id !== "").map((r) => [String(r.id), r]));
const byKey = new Map();
if (natKey) {
  for (const r of storedRows) {
    if (sentIds.has(String(r.id))) continue;
    const k = missing(r[natKey]) ? "" : String(r[natKey]);
    if (!k) continue;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(r);
  }
}
const fill = (row) => {
  if (!row || typeof row !== "object") return row;
  let src = !missing(row.id) && row.id !== "" ? byId.get(String(row.id)) : undefined;
  if (!src && natKey) {
    const queue = byKey.get(missing(row[natKey]) ? "" : String(row[natKey]));
    if (queue && queue.length) src = queue.shift();
  }
  const add = {};
  if (src) for (const k of Object.keys(src)) if (k.indexOf("custom_fields") === 0 && missing(row[k]) && !missing(src[k])) add[k] = src[k];
  let next = Object.keys(add).length ? Object.assign({}, row, add) : row;
  if (Array.isArray(row.children)) next = Object.assign({}, next, { children: row.children.map(fill) });
  return next;
};
return { ok: "YES", cf: missing(cf) ? (missing(stored[__HEAD__]) ? null : stored[__HEAD__]) : cf, lines: Array.isArray(lines) ? lines.map(fill) : lines };"""

OUT = """// What the update writes: the payload's custom fields, or the stored ones where this edit left them out
const filled = [{{node:__FILLID__.data}}][0];
if (filled && filled.ok === "YES") return { cf: filled.cf__OUTLINES_FILLED__ };
const cf = [__CF__][0];
return { cf: cf === undefined ? null : cf__OUTLINES_PAYLOAD__ };"""


def nodes_of(doc):
    out = {}

    def walk(n, parent_list):
        if isinstance(n, dict):
            if "id" in n and "type" in n and isinstance(n.get("data"), dict):
                out[n["id"]] = (n, parent_list)
            for v in n.values():
                if isinstance(v, list):
                    walk(v, v)
                else:
                    walk(v, parent_list)
        elif isinstance(n, list):
            for v in n:
                walk(v, n)
    walk(doc, None)
    return out


def keys_in(doc):
    found = set()

    def walk(n):
        if isinstance(n, dict):
            if isinstance(n.get("key"), str):
                found.add(n["key"])
            for v in n.values():
                walk(v)
        elif isinstance(n, list):
            for v in n:
                walk(v)
    walk(doc)
    return found


def fill_template(t, **kw):
    for k, v in kw.items():
        t = t.replace("__%s__" % k, v)
    assert "__" not in t.replace("__COMMON__", "").replace("const __", ""), t[:200]
    return t


def patch(name, doc):
    updates, head, line_prop, line_keys, nat = CFG[name]
    doc = json.loads(json.dumps(doc))  # a generator's doc can share prop objects between its add and update nodes
    idx = nodes_of(doc)
    K._taken.update(keys_in(doc))
    ids = K.Ids(1799100000000 + 1000 * sorted(CFG).index(name))
    for n, uid in enumerate(updates, 1):
        assert "code_node_CfNeed%d" % n not in idx, "already patched"
        u, parent = idx[uid]
        assert u["type"] == "update-node" and isinstance(parent, list), uid
        props = u["data"]["props"]["list"]
        cfp = [p for p in props if p.get("prop") == head]
        assert len(cfp) == 1 and cfp[0]["valueType"] == "field", (uid, head, len(cfp))
        cf_expr = cfp[0]["value"]
        lp = [p for p in props if p.get("prop") == line_prop] if line_prop else []
        assert (len(lp) == 1 and lp[0]["valueType"] == "field") if line_prop else not lp, (uid, line_prop)
        lines_expr = lp[0]["value"] if lp else None
        leaf = [r for r in u["data"]["table_id"]["rules"]["list"] if r.get("type") == "leaf"]
        assert len(leaf) == 1 and leaf[0]["prop"] == "id" and leaf[0]["valueType"] == "field", (uid, leaf)
        id_expr, source = leaf[0]["value"], u["data"]["table_id"]["source"]
        sfx = str(n)
        need_id, if_id, get_id, fill_id, out_id = ("code_node_CfNeed" + sfx, "if_CfNeed" + sfx, "get_node_CfStored" + sfx,
                                                    "code_node_CfFill" + sfx, "code_node_CfOut" + sfx)
        assert not {need_id, if_id, get_id, fill_id, out_id} & set(idx), "node id taken"
        lines_or_null = "[%s][0]" % lines_expr if lines_expr else "null"
        common = dict(COMMON=COMMON, CF=cf_expr, LINES_OR_NULL=lines_or_null)
        need = fill_template(NEED, ID=id_expr, LINEKEYS=json.dumps(line_keys), **common)
        fill = fill_template(FILL, GET=get_id, NATKEY=json.dumps(nat), NATDOC=(", else by %s in order" % nat) if nat else "",
                             LINEPROP=json.dumps(line_prop), HEAD=json.dumps(head), **common)
        out = fill_template(OUT, FILLID=fill_id, CF=cf_expr,
                            OUTLINES_FILLED=", lines: filled.lines" if lines_expr else "",
                            OUTLINES_PAYLOAD=(", lines: [%s][0]" % lines_expr) if lines_expr else "")
        what = "header + lines" if lines_expr else "header"
        chain = [
            K.code(need_id, "Custom fields this edit leaves out? (%s)" % what, need, ["need", "id"]),
            K.if_(ids, if_id, "IF the edit leaves custom fields out", "'{{node:%s.data.need}}' == 'YES'" % need_id, [
                K.get_node(ids, get_id, "The stored record (custom fields by name)", source, ("id", "equal", "{{node:%s.data.id}}" % need_id)),
                K.code(fill_id, "Stored custom fields for what the edit left out", fill, ["ok", "cf", "lines"], arrays=("lines",), objects=("cf",)),
            ]),
            K.code(out_id, "Custom fields to write (payload, or stored where left out)", out, ["cf", "lines"] if lines_expr else ["cf"],
                   arrays=("lines",), objects=("cf",)),
        ]
        at = next(i for i, x in enumerate(parent) if x is u)
        parent[at:at] = chain
        cfp[0]["value"] = "{{node:%s.data.cf}}" % out_id
        if lp:
            lp[0]["value"] = "{{node:%s.data.lines}}" % out_id
    return doc


def base_path(name):
    return os.path.join(HERE, "base", name + ".json")


def patch_exact(name, doc):
    """patch() with the response keys the published build drew (dev 2026-10-16): wfkit's key generator replayed through the
    workflows built before this one, from base/ - for the generators that emit these workflows (keep base/ as published)"""
    import random
    saved = K._rng, set(K._taken)
    K._rng = random.Random(20261012)
    K._taken.clear()
    try:
        for prior in sorted(CFG):
            if prior == name:
                return patch(name, doc)
            patch(prior, json.load(open(base_path(prior), encoding="utf-8")))
        raise KeyError(name)
    finally:
        K._rng = saved[0]
        K._taken.clear()
        K._taken.update(saved[1])


def fetch(name):
    r = q("--dev", f"""SELECT h.version_number v, CAST(h.data_id AS CHAR) wid, h.script_json s FROM su_code_workflow_history h
        JOIN su_code_workflow w ON w.id = h.data_id AND w.is_deleted = 0
        WHERE w.name = '{name}' AND h.status = 'enabled' ORDER BY h.version_number DESC LIMIT 1""")[0]
    os.makedirs(os.path.join(HERE, "base"), exist_ok=True)
    json.dump(json.loads(r["s"]), open(base_path(name), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    meta = json.load(open(os.path.join(HERE, "base", "versions.json"))) if os.path.exists(os.path.join(HERE, "base", "versions.json")) else {}
    meta[name] = {"version": r["v"], "dataId": r["wid"]}
    json.dump(meta, open(os.path.join(HERE, "base", "versions.json"), "w"), indent=1, sort_keys=True)
    print("fetched %s v%s (%s)" % (name, r["v"], r["wid"]))


def build(name):
    doc = patch(name, json.load(open(base_path(name), encoding="utf-8")))
    os.makedirs(os.path.join(HERE, "out"), exist_ok=True)
    json.dump(doc, open(os.path.join(HERE, "out", name + ".json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("built out/%s.json (%d update node(s))" % (name, len(CFG[name][0])))


if __name__ == "__main__":
    cmd, names = sys.argv[1], sys.argv[2:] or sorted(CFG)
    for nm in names:
        {"fetch": fetch, "build": build}[cmd](nm)
