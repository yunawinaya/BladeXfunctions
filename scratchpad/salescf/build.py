"""build.py: base/<env>/ -> out/<env>/ for the sales header custom fields project
(docs/superpowers/plans/2026-10-27-sales-header-custom-fields.md). One patch function per workflow / form; every anchor is
asserted to occur exactly once, so a base that moved fails loudly instead of being patched in the wrong place.

usage: python3 scratchpad/salescf/build.py --env dev|prod [NAME ...]
"""
import argparse
import copy
import json
import os
import random
import re
import string
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "lib"))
from cf_sql import cf_names_sql  # noqa: E402,F401

CF_HEADER_JS = open(os.path.join(HERE, "lib", "cf_header.js"), encoding="utf-8").read().rstrip("\n")
PATCHES = {}
_rng = random.Random(20261027)
_taken = set()


def patch(name):
    def reg(fn):
        PATCHES[name] = fn
        return fn
    return reg


def key8():
    while True:
        k = "".join(_rng.choice(string.ascii_lowercase + string.digits) for _ in range(8))
        if k not in _taken and not k.isdigit():
            _taken.add(k)
            return k


def find(o, nid):
    if isinstance(o, dict):
        if o.get("id") == nid:
            return o
        for v in o.values():
            r = find(v, nid)
            if r is not None:
                return r
    elif isinstance(o, list):
        for v in o:
            r = find(v, nid)
            if r is not None:
                return r
    return None


def node(doc, nid):
    n = find(doc, nid)
    assert n is not None, "no node " + nid
    return n


def sub_once(text, old, new, what):
    c = text.count(old)
    assert c == 1, "%s: anchor found %d times: %r" % (what, c, old[:120])
    return text.replace(old, new)


def handler(form, name):
    hits = [e for e in form["config"]["eventScript"] if e.get("name") == name]
    assert len(hits) == 1, "%d form handlers named %s" % (len(hits), name)
    return hits[0]


def load(env, name):
    return json.loads(open(os.path.join(HERE, "base", env, name + ".json"), encoding="utf-8").read())


def parent_list(o, nid):
    if isinstance(o, list):
        if any(isinstance(x, dict) and x.get("id") == nid for x in o):
            return o
        for v in o:
            r = parent_list(v, nid)
            if r is not None:
                return r
    elif isinstance(o, dict):
        for v in o.values():
            r = parent_list(v, nid)
            if r is not None:
                return r
    return None


def reserve(doc):
    """keys and filter ids already in this workflow, so new ones never collide"""
    text = json.dumps(doc)
    _taken.update(re.findall(r'"key": "([a-z0-9]{8})"', text))
    return set(int(x) for x in re.findall(r'"(?:id|parentId)": (\d{13})\b', text))


def field(name, bson="string"):
    return {"key": key8(), "name": name, "title": name, "description": "", "bsonType": bson, "isExpand": False, "children": []}


def titled(d, title):
    d.update({"title": title, "isValidator": True, "nodeName": title, "name": title})
    return d


def code_node(nid, title, body, names):
    """names: output names (declared string) or (name, bsonType); the platform converts each output to its declared type"""
    return {"id": nid, "type": "code-node", "blocks": [],
            "data": titled({"language": "javascript", "code": "", "timeout": 30000, "script": {"type": "javascript", "code": body},
                            "response_json": [field(*n) if isinstance(n, tuple) else field(n) for n in names]}, title)}


def add_prop(write_node, like, name, value):
    lst = write_node["data"]["props"]["list"]
    assert not any(p.get("prop") == name for p in lst), write_node["id"] + " already writes " + name
    proto = [p for p in lst if p.get("prop") == like]
    assert len(proto) == 1, "%s: %d props named %s" % (write_node["id"], len(proto), like)
    p = copy.deepcopy(proto[0])
    p.update({"prop": name, "propLabel": name, "value": value})
    lst.append(p)


def keep_stored_guard(doc, tag, table, col, src, title, n=""):
    """Before an update node: did the payload leave `col` out? Only then read that one column of the stored row by id, and
    hand the update what it should write (the payload's value, else the stored one). Returns the nodes, in order, and the
    placeholder the update node's prop reads. `n` numbers the guards of a workflow with several update nodes."""
    used = reserve(doc)
    fid = max([1800000027000] + list(used)) + 1
    need, iff, read, out = ("code_node_%sCfNeed%s" % (tag, n), "if_%sCfNeed%s" % (tag, n), "sql_node_%sCfRead%s" % (tag, n),
                            "code_node_%sCfOut%s" % (tag, n))
    need_js = (
        "// Did this save leave the %s out? Only then the stored ones are read (one column), so the save keeps them\n"
        "const missing = (v) => v === undefined || v === null;\n"
        "const cf = [{{node:%s.%s}}][0];\n"
        "const rawId = [{{node:%s.id}}][0];\n"
        "const id = missing(rawId) ? \"\" : String(rawId).trim();\n"
        "const digits = /^[0-9]{1,20}$/.test(id);\n"
        "return { need: missing(cf) && digits ? \"1\" : \"0\", id: digits ? id : \"0\" };" % (title, src, col, src))
    # by field name: the platform drops definition-id keys on a header write (GD Edit V2 wiped GD/20261027/632 that way,
    # 2026-10-27), so the stored ids are turned back into names here; a NULL column stays NULL
    sql = ("SELECT CAST(t.id AS CHAR) AS row_id,\n"
           "       IF(t.%s IS NULL, NULL, %s) AS %s\n"
           "  FROM %s t\n"
           " WHERE t.id = CAST('{{node:%s.data.id}}' AS UNSIGNED)\n"
           "   AND t.tenant_id = '{{system:tenantId}}'\n"
           "   AND t.is_deleted = 0\n"
           " LIMIT 1" % (col, cf_names_sql("t." + col), col, table, need))
    out_js = (
        "// What the update writes into %s: the payload's object, or (left out) the stored one as read\n"
        "const missing = (v) => v === undefined || v === null;\n"
        "let cf = [{{node:%s.%s}}][0];\n"
        "if (String([{{node:%s.data.need}}][0]) === \"1\") {\n"
        "  const rows = [{{node:%s.data}}][0];\n"
        "  const row = Array.isArray(rows) ? rows[0] : rows;\n"
        "  let stored = row ? row.%s : undefined;\n"
        "  if (typeof stored === \"string\") {\n"
        "    try {\n"
        "      stored = JSON.parse(stored);\n"
        "    } catch (e) {\n"
        "      stored = null;\n"
        "    }\n"
        "  }\n"
        "  cf = stored;\n"
        "}\n"
        "return { cf: missing(cf) ? null : cf };" % (col, src, col, need, read, col))
    read_node = {"id": read, "type": "sql-node", "blocks": [],
                 "data": titled({"database_id": "", "sql": "", "params": {}, "script": {"type": "sql", "code": sql},
                                 "response_json": [field("row_id"), field(col, "any")]}, "Stored %s (this one column, by id)" % title)}
    if_node = {"id": iff, "type": "if",
               "data": titled({"condition_type": "Expression",
                               "filter": {"list": [{"id": fid, "parentId": fid + 1, "isTop": True, "prop": "", "operator": "", "valueType": "",
                                                    "value": "", "type": "leaf", "level": 1}]},
                               "expression": {"type": "javascript", "code": "'{{node:%s.data.need}}' == '1'" % need}},
                              "IF the save left the %s out" % title),
               "blocks": [{"id": "ifBlock_T%sCfNeed%s" % (tag, n), "type": "ifBlock", "data": {"title": "true"}, "blocks": [read_node]},
                          {"id": "ifBlock_F%sCfNeed%s" % (tag, n), "type": "ifBlock", "data": {"title": "false"}, "blocks": []}]}
    nodes = [code_node(need, "Did the save leave the %s out?" % title, need_js, ["need", "id"]), if_node,
             code_node(out, "%s%s to write (sent, else as stored)" % (title[0].upper(), title[1:]), out_js, [("cf", "any")])]
    return nodes, "{{node:%s.data.cf}}" % out


def insert_before(doc, nid, new_nodes):
    lst = parent_list(doc, nid)
    assert lst is not None, "no parent list for " + nid
    i = [x.get("id") for x in lst].index(nid)
    lst[i:i] = new_nodes


def inline_helper(code):
    """headerCustomFields(v) once, at the top of a code node or handler that copies"""
    assert "const headerCustomFields" not in code, "the helper is already inlined"
    return CF_HEADER_JS + "\n" + code


def si_convert(doc, sql_id, alias, col):
    """the SI converters: the header row also carries the source's header custom fields by name; the SI header takes the
    mapped record's (the first document's: a combined SI is mapped from gdList[0] / the first SO)"""
    n = node(doc, sql_id)
    anchor = "'di_vehicle_number', CAST(%s.di_vehicle_number AS CHAR)) AS j" % alias
    added = "'di_vehicle_number', CAST(%s.di_vehicle_number AS CHAR),\n'%s', %s) AS j" % (alias, col, cf_names_sql(alias + "." + col))
    n["data"]["script"]["code"] = sub_once(n["data"]["script"]["code"], anchor, added, sql_id + " header JSON_OBJECT end")
    c = node(doc, "code_node_sQX9tldw")["data"]["script"]
    ind = re.findall(r"\n([ \t]*)si_vehicle_number: record\.di_vehicle_number,", c["code"])
    assert len(ind) == 1, "code_node_sQX9tldw: %d si_vehicle_number lines" % len(ind)
    line = "\n%ssi_vehicle_number: record.di_vehicle_number," % ind[0]
    c["code"] = inline_helper(sub_once(c["code"], line, line + "\n%scustom_fields_h35azf2l: headerCustomFields(record.%s)," % (ind[0], col),
                                       "mapHeaderData si_vehicle_number line"))


def cf_box_like_so(doc, model):
    """the header custom-field box laid out like the SO's (custom_fields_m07krnod): 2 fields per row, its own label hidden"""
    hits = []

    def walk(o):
        if isinstance(o, dict):
            if o.get("type") == "custom-fields" and o.get("model") == model and not o.get("options", {}).get("tableColumn"):
                hits.append(o)
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
    walk(doc["list"])
    assert len(hits) == 1, "%d header custom-field boxes named %s" % (len(hits), model)
    hits[0]["options"].update({"col": 2, "hideLabel": True})


@patch("form_sales_invoice")
def patch_si_form(doc, env):
    """onChange_soID: a NEW invoice whose header custom fields are still empty takes its source's (the first delivery's,
    else the order's), through the reads the handler already makes; the header box is laid out like the SO's"""
    cf_box_like_so(doc, "custom_fields_h35azf2l")
    h = handler(doc, "onChange_soID")
    f = sub_once(h["func"], '.field("di_shipping_method,di_vehicle_number")', '.field("di_shipping_method,di_vehicle_number,custom_fields")',
                 "SI onChange_soID delivery projection")
    anchor = '\n    this.display("address_grid");\n'
    block = ("\n    // Header custom fields: a new invoice takes its source's once (the first delivery's, else the order's); a box that\n"
             "    // already holds values is left alone, since this runs again on every batch add\n"
             "    const cfSource = resGD?.data?.[0] ? resGD.data[0].custom_fields : resSO.data[0].custom_fields_m07krnod;\n"
             "    if ((this.isAdd || this.isCopy) && Object.keys(headerCustomFields(this.getValue(\"custom_fields_h35azf2l\"))).length === 0) {\n"
             "      this.setData({ custom_fields_h35azf2l: headerCustomFields(cfSource) });\n"
             "    }\n")
    h["func"] = inline_helper(sub_once(f, anchor, block + anchor, "SI onChange_soID address_grid line"))


@patch("SO_SAVE")
def patch_so_save(doc, env):
    """the automatic SI: its header takes the SO's header custom fields (the SO from a get-node, so already by name)"""
    c = node(doc, "code_node_CVVyuAj3")["data"]["script"]
    ind = re.findall(r"\n([ \t]*)si_vehicle_number: record\.di_vehicle_number,", c["code"])
    assert len(ind) == 1, "code_node_CVVyuAj3: %d si_vehicle_number lines" % len(ind)
    line = "\n%ssi_vehicle_number: record.di_vehicle_number," % ind[0]
    c["code"] = inline_helper(sub_once(c["code"], line, line + "\n%scustom_fields_h35azf2l: headerCustomFields(record.custom_fields_m07krnod)," % ind[0],
                                       "Map SI Data si_vehicle_number line"))


@patch("SO_Convert_SI")
def patch_so_convert_si(doc, env):
    si_convert(doc, "sql_node_socvDone", "s", "custom_fields_m07krnod")


@patch("GD_Convert_SI")
def patch_gd_convert_si(doc, env):
    si_convert(doc, "sql_node_gdcvDone", "g", "custom_fields")


def gdc_header_custom_fields(doc, nid):
    """custom_fields joins GDC.header_fields (the list a V2 header row is copied through, value as-is)"""
    c = node(doc, nid)["data"]["script"]
    c["code"] = sub_once(c["code"], '"project_id","sales_person"]', '"project_id","sales_person","custom_fields"]', nid + " GDC.header_fields end")


@patch("SO_AUTO_GD")
def patch_so_auto_gd(doc, env):
    """V2 route: the payload's header list (UXC.header_fields, this copy written with spaces) gains custom_fields; both
    routes: buildHeader takes the first SO's header custom fields (search_so is a read node, so already by name)"""
    plan = node(doc, "code_v2plan")["data"]["script"]
    plan["code"] = sub_once(plan["code"], '"project_id", "sales_person"]', '"project_id", "sales_person", "custom_fields"]', "code_v2plan UXC.header_fields end")
    cb = node(doc, "code_build")["data"]["script"]
    anchor = 'document_description: carryDescription(primary.so_description, "Goods Delivery"),'
    ind = re.findall(r"\n([ \t]*)" + re.escape(anchor), cb["code"])
    assert len(ind) == 1, "code_build: %d document_description lines" % len(ind)
    cb["code"] = inline_helper(sub_once(cb["code"], "\n" + ind[0] + anchor, "\n%s%s\n%s// the first SO's header custom fields, by field name\n%scustom_fields: headerCustomFields(primary.custom_fields_m07krnod),"
                                        % (ind[0], anchor, ind[0], ind[0]), "buildHeader document_description"))


GS_CF_KEY = '''// header custom fields as compared by gsFormDiff: by field name (stored definition ids through cf_defs; a numeric key with no
// definition is ignored), null / "" values left out as gcStrip leaves them out, keys sorted
const gsCfKey = function gsCfKey(v, defs) {
  let o = v;
  if (typeof o === "string") {
    try {
      o = JSON.parse(o);
    } catch (e) {
      o = null;
    }
  }
  const d = defs && typeof defs === "object" ? defs : {};
  const out = {};
  if (o && typeof o === "object" && !Array.isArray(o)) {
    for (const k of Object.keys(o)) {
      const x = o[k];
      if (x === null || x === undefined || x === "") continue;
      if (!/^[0-9]+$/.test(k)) out[k] = x;
      else if (d[k]) out[d[k]] = x;
    }
  }
  return JSON.stringify(Object.keys(out).sort().reduce((a, k) => ((a[k] = out[k]), a), {}));
};
'''

GS_HEADER_LOOP = '''  for (const c of GC_GD_WRITE_COLS) {
    if (!H[c] || !Object.prototype.hasOwnProperty.call(form, c)) continue;
    if (!eq(norm(form[c], H[c]), norm(stored[c], H[c]))) changed.push(c);
  }
'''


@patch("GD_COMPLETE_SUBMIT")
def patch_gd_complete_submit(doc, env):
    """an edited header custom field is an unsaved change (the completion goes classic, which stores it): the stored header
    read also returns cf_defs {definition id: field name} and gsFormDiff compares stored ids with the form's names by name"""
    q = node(doc, "sql_node_GShdr")["data"]["script"]
    q["code"] = sub_once(q["code"], "'sub_tenant_id', g.`sub_tenant_id`) AS j",
                         "'sub_tenant_id', g.`sub_tenant_id`,\n\t\t'cf_defs', (SELECT JSON_OBJECTAGG(CAST(d.id AS CHAR), d.field_name)\n"
                         "\t\t   FROM su_code_custom_field d\n"
                         "\t\t  WHERE d.tenant_id = g.tenant_id AND d.table_id = '1902054888473481218' AND d.sub_table_key IS NULL\n"
                         "\t\t    AND d.is_deleted = 0)) AS j", "sql_node_GShdr JSON_OBJECT end")
    g = node(doc, "code_node_GSgate")["data"]["script"]
    g["code"] = sub_once(g["code"], "const gsFormDiff = function gsFormDiff(", GS_CF_KEY + "const gsFormDiff = function gsFormDiff(", "gsFormDiff definition")
    g["code"] = sub_once(g["code"], GS_HEADER_LOOP, GS_HEADER_LOOP +
                         "  // header custom fields, by name (not a GC_GD_WRITE_COLS column): an edit sends the completion to the classic save\n"
                         "  if (Object.prototype.hasOwnProperty.call(form, \"custom_fields\") && gsCfKey(form.custom_fields, null) !== gsCfKey(stored.custom_fields, stored.cf_defs))\n"
                         "    changed.push(\"custom_fields\");\n", "gsFormDiff header loop")


@patch("SO_Convert_GD")
def patch_so_convert_gd(doc, env):
    """the SO list's Draft / form convert: each mapped GD takes its first SO's header custom fields (search node, so by name);
    the node declares custom_fields, so Add Data's existing binding and the form it opens receive it"""
    n = node(doc, "code_node_HOWEZH5S")
    c = n["data"]["script"]
    anchor = 'document_description: carryDescription(record.so_description, "Goods Delivery"),'
    ind = re.findall(r"\n([ \t]*)" + re.escape(anchor), c["code"])
    assert len(ind) == 1, "code_node_HOWEZH5S: %d document_description lines" % len(ind)
    c["code"] = inline_helper(sub_once(c["code"], "\n" + ind[0] + anchor, "\n%s%s\n%scustom_fields: headerCustomFields(record.custom_fields_m07krnod),"
                                       % (ind[0], anchor, ind[0]), "mapHeaderData document_description"))
    rj = n["data"]["response_json"]
    assert not any(f.get("name") == "custom_fields" for f in rj), "custom_fields already declared"
    reserve(doc)
    proto = [f for f in rj if f.get("name") == "all_item"]
    assert len(proto) == 1, "no all_item declaration to copy"
    f = copy.deepcopy(proto[0])
    f.update({"key": key8(), "name": "custom_fields", "title": "custom_fields"})
    for k in ("label", "model"):
        if k in f and f[k]:
            f[k] = "custom_fields"
    rj.append(f)


@patch("form_goods_delivery")
def patch_gd_form(doc, env):
    """the GD form: both V2 payload header lists gain custom_fields (Task 8); onChange_soID fills a new GD's header custom
    fields from its first SO (Task 10); the header box is laid out like the SO's"""
    cf_box_like_so(doc, "custom_fields")
    for name in ("gdV2_onClick_save_as_created", "gdV2_func_processGDLineItem"):
        h = handler(doc, name)
        h["func"] = sub_once(h["func"], '"project_id","sales_person"]', '"project_id","sales_person","custom_fields"]', name + " UXC.header_fields end")
    h = handler(doc, "onChange_soID")
    anchor = '\n  } else {\n    await this.triggerEvent("func_reset_delivery_method");'
    block = ("\n    // Header custom fields: a new delivery takes its first order's once; a box that already holds values is left alone,\n"
             "    // since picking more orders runs this again\n"
             "    if ((this.isAdd || this.isCopy) && Object.keys(headerCustomFields(this.getValue(\"custom_fields\"))).length === 0) {\n"
             "      await this.setData({ custom_fields: headerCustomFields(soData.custom_fields_m07krnod) });\n"
             "    }")
    h["func"] = inline_helper(sub_once(h["func"], anchor, block + anchor, "GD onChange_soID else branch"))


@patch("GD_BULK_PREPARE")
def patch_gd_bulk_prepare(doc, env):
    for nid in ("code_node_J5T1G2s9", "code_node_egoCivrm"):
        gdc_header_custom_fields(doc, nid)


@patch("GD_BULK_COMMIT")
def patch_gd_bulk_commit(doc, env):
    gdc_header_custom_fields(doc, "code_node_KBrubvGI")
    add_prop(node(doc, "add_node_7uwrPwCt"), "sales_person", "custom_fields", "{{node:code_node_KBrubvGI.data.headerRows.custom_fields}}")


@patch("GOODS_DELIVERY")
def patch_goods_delivery(doc, env):
    """the classic GD save: both add nodes write allData.custom_fields; the three header updates write it through a guard,
    so a re-save that leaves the key out (Picking / Packing re-save a GD from a read node, which drops a NULL column) keeps it"""
    src = "code_node_IyJHrBst.data.allData"
    for nid in ("add_node_ROqbYEI6", "add_node_2r51lmua"):
        add_prop(node(doc, nid), "plant_id", "custom_fields", "{{node:%s.custom_fields}}" % src)
    for i, nid in enumerate(("update_node_elLmtlLm", "update_node_aJCo6wbf", "update_node_wq10Ecg3"), 1):
        nodes, value = keep_stored_guard(doc, "Gd", "goods_delivery", "custom_fields", src, "header custom fields", str(i))
        insert_before(doc, nid, nodes)
        add_prop(node(doc, nid), "plant_id", "custom_fields", value)


@patch("SI_SAVE")
def patch_si_save(doc, env):
    col = "custom_fields_h35azf2l"
    add_prop(node(doc, "add_node_adYeQB4a"), "si_vehicle_number", col, "{{node:code_si_prep.data.entry.%s}}" % col)
    nodes, value = keep_stored_guard(doc, "Si", "sales_invoice", col, "code_si_prep.data.entry", "header custom fields")
    insert_before(doc, "update_node_I7KGszOE", nodes)
    add_prop(node(doc, "update_node_I7KGszOE"), "si_vehicle_number", col, value)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--env", choices=["dev", "prod"], required=True)
    ap.add_argument("names", nargs="*")
    a = ap.parse_args()
    names = a.names or sorted(PATCHES)
    os.makedirs(os.path.join(HERE, "out", a.env), exist_ok=True)
    # dev == prod parity of the bases (content, not text: dev and prod store the same JSON with different layout)
    for name in sorted(json.load(open(os.path.join(HERE, "base", "dev", "versions.json")))):
        try:
            same = load("dev", name) == load("prod", name)
        except FileNotFoundError:
            same = None
        print("parity %-20s %s" % (name, {True: "dev == prod", False: "DIFFERS", None: "(no prod base)"}[same]))
    for name in names:
        if name not in PATCHES:
            raise SystemExit("no patch for " + name)
        doc = load(a.env, name)
        # new field keys depend only on the workflow, not on what else this run built
        _rng.seed("salescf:" + name)
        _taken.clear()
        before = copy.deepcopy(doc)
        PATCHES[name](doc, a.env)
        assert doc != before, name + ": the patch changed nothing"
        out = os.path.join(HERE, "out", a.env, name + ".json")
        json.dump(doc, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print("built %s -> %s" % (name, out))


if __name__ == "__main__":
    main()
