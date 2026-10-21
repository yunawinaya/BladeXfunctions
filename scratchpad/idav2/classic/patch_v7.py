"""IDA_SAVE v7 = base/IDA_SAVE.v6.json (deployed dev v6; IDA is not on prod) + EXACTLY two changes (CONTRACT.md section 11, user
decision 3). classic/diff_v6.py proves the output node by node; classic/README_CLASSIC.md states the changes.

1. The IDA V2 guard as the FIRST nodes after start (tpl/iav2/classic/patch_v12.py's pattern):
   code_node_IDAguardIn    payload only: an Edit with a digit allData.id (and a digit session tenant) -> check YES; moves =
                           idaMoveCount(allData, allData.stock_movement); a completion (saveAs != Draft) above IDA_CLASSIC_MAX_MOVES -> big
   if_IDAguardRead         check YES:
     sql_node_IDAguard       CLASSIC_GUARD (code/shared/sql.py): the stored item_disassembly_status, sm_item_disassembly only
     code_node_IDAguardStored  Processing -> 400 IDA_TEXT.busy; Completed / Fully Posted + Draft -> 409 IDA_TEXT.classicFinal; big -> 400
     if_IDAguard400 / if_IDAguard409 -> copies of v6's return_required_400 / return_idem_409 (status 200, {code, message})
   if_IDAguardBig          big without a stored read (Add / Clone / no id) -> 400 IDA_TEXT.classicTooBig
   It reads neither gd_async_job nor any V2 table, never a stored pick count, and never answers 401.
2. code_cost_alloc (one contiguous replacement): the receipt unit price per BASE unit, lineValue / baseQty, baseQty = ADD_INVENTORY
   v65's own conversion of the line from its search_items row (quantity_uom, else the base UOM; the table_uom_conversion row of that
   alt UOM, compared as text). The quantity share, the last-line remainder and issuedValue are unchanged.
Keys come from a local seeded RNG and filter ids from a fresh range, so the output does not depend on the build order.
"""
import copy
import hashlib
import importlib.util
import json
import os
import random
import string
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
IDAV2 = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(IDAV2, "lib"))
import v2build as V  # noqa: E402

BASE = os.path.join(IDAV2, "base", "IDA_SAVE.v6.json")
BASE_MD5 = "e79c2d2e7de55f8e232612d9e9ef6c4b"
CODE = os.path.join(IDAV2, "code")
# the reviewed (frozen 10-21) content of every code/shared file v7 inlines: the guard scripts embed ida_common.js, the guard SQL is sql.py's
SHARED_MD5 = {"ida_common.js": "b4a9d6470e981cacdacd43eeafa43ae9", "sql.py": "a2ad87f75141a8680c3827f73fd2c3a0"}
SEED = 20261021
FILTER_BASE = 1799710000000
G, S, ST = "code_node_IDAguardIn", "sql_node_IDAguard", "code_node_IDAguardStored"
TOP_IDS = [G, "if_IDAguardRead", "if_IDAguardBig"]
GUARD_IDS = [G, "if_IDAguardRead", "if_IDAguardRead_t", "if_IDAguardRead_f", S, ST, "if_IDAguard400", "if_IDAguard400_t", "if_IDAguard400_f",
             "return_node_IDAguard400", "if_IDAguard409", "if_IDAguard409_t", "if_IDAguard409_f", "return_node_IDAguard409", "if_IDAguardBig",
             "if_IDAguardBig_t", "if_IDAguardBig_f", "return_node_IDAguardBig"]
IN_FIELDS = ["check", "idaId", "tenantId", "saveAs", "moves", "big", "bigNoRead", "bigMessage"]
STORED_FIELDS = ["stored", "refuse400", "refuse409", "message"]
# the one v6 node whose body changes: the receipt price per BASE unit (ADD_INVENTORY's totalPrice = q8(unit_price x baseQty))
FIXED_NODE = "code_cost_alloc"
FIX_OLD = """  remaining -= lineValue;

  // '-' is the form's "no batch" marker, not a batch number.
  const batch = String(line.batch_number || '');

  return {
    plant_id: line.issuing_plant || entry.issuing_operation_faci,
    organization_id: line.organization_id || entry.organization_id,
    material_id: line.item_selection,
    material_uom: line.quantity_uom,
    quantity: qty,
    unit_price: qty > 0 ? q8(lineValue / qty) : 0,
"""
FIX_NEW = """  remaining -= lineValue;

  // ADD_INVENTORY prices per BASE unit: this line's quantity converted by ADD's own rule (its UOM, else the item's base UOM)
  const uomItem = itemMap[String(line.item_selection)] || {};
  const alt = line.quantity_uom || uomItem.based_uom;
  const conv = (Array.isArray(uomItem.table_uom_conversion) ? uomItem.table_uom_conversion : []).find(function (c) {
    return c && String(c.alt_uom_id) === String(alt);
  });
  const baseQty = conv ? q8(qty * Number(conv.base_qty)) : qty;

  // '-' is the form's "no batch" marker, not a batch number.
  const batch = String(line.batch_number || '');

  return {
    plant_id: line.issuing_plant || entry.issuing_operation_faci,
    organization_id: line.organization_id || entry.organization_id,
    material_id: line.item_selection,
    material_uom: line.quantity_uom,
    quantity: qty,
    unit_price: baseQty > 0 ? q8(lineValue / baseQty) : 0,
"""


def check_shared(pins, who):
    """every pinned code/shared file must hold its reviewed content: an edit stops the build (review it, then re-pin)"""
    for name, want in sorted(pins.items()):
        with open(os.path.join(CODE, "shared", name), "rb") as f:
            got = hashlib.md5(f.read()).hexdigest()
        if got != want:
            raise AssertionError("%s: code/shared/%s changed (md5 %s, pinned %s); it is inlined into the build - review the change, then update SHARED_MD5"
                                 % (who, name, got, want))


def _shared_sql():
    spec = importlib.util.spec_from_file_location("ida_shared_sql_classic", os.path.join(CODE, "shared", "sql.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def body(name):
    """a guard body: code/shared/ida_common.js (v2build.include_js) + classic/<name>"""
    with open(os.path.join(HERE, name), encoding="utf-8") as f:
        own = f.read().rstrip("\n")
    assert "//@include" not in own and "require(" not in own, name
    exp = [line for line in V.raw(CODE, "shared/ida_common.js").split("\n") if line.startswith("if (typeof module")]
    assert len(exp) == 1 and exp[0].rstrip().endswith(";"), "ida_common.js: the export must be ONE line"
    return V.include_js(CODE, "shared/ida_common.js") + "\n" + own


def guard_sql():
    return V.sub(_shared_sql().CLASSIC_GUARD, T=V.N(G, "data.tenantId"), IDA=V.N(G, "data.idaId"))


def guard_cols():
    return list(_shared_sql().CLASSIC_GUARD_COLS)


def index(doc):
    out = {}

    def walk(n):
        if isinstance(n, dict):
            if isinstance(n.get("id"), str) and "type" in n:
                out[n["id"]] = n
            for v in n.values():
                walk(v)
        elif isinstance(n, list):
            for v in n:
                walk(v)
    walk(doc)
    return out


def keys_of(n, out):
    if isinstance(n, dict):
        if isinstance(n.get("key"), str):
            out.add(n["key"])
        for v in n.values():
            keys_of(v, out)
    elif isinstance(n, list):
        for v in n:
            keys_of(v, out)
    return out


def load_base():
    raw = open(BASE, encoding="utf-8").read()
    assert hashlib.md5(raw.encode("utf-8")).hexdigest() == BASE_MD5, "base/IDA_SAVE.v6.json is not the pinned dev v6"
    return raw, json.loads(raw)


def canon(x):
    return json.dumps(x, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def build():
    check_shared(SHARED_MD5, "classic/patch_v7.py")
    raw, base = load_base()
    old = index(base)
    for nid in GUARD_IDS:
        assert '"%s"' % nid not in raw, nid + " already in v6"
    assert str(FILTER_BASE)[:7] not in raw
    taken = keys_of(base, set())
    rng = random.Random(SEED)
    fid = [FILTER_BASE]

    def key():
        while True:
            k = "".join(rng.choice(string.ascii_lowercase + string.digits) for _ in range(8))
            if k not in taken and not k.isdigit():
                taken.add(k)
                return k

    def title(t):
        return {"title": t, "isValidator": True, "nodeName": t, "name": t}

    def resp(names):
        return [{"key": key(), "name": n, "title": "", "description": "", "bsonType": "string", "isExpand": False, "children": []} for n in names]

    def code(nid, t, text, names):
        d = {"language": "javascript", "code": "", "timeout": 30000}
        d.update(title(t))
        d["script"] = {"type": "javascript", "code": text}
        d["response_json"] = resp(names)
        return {"id": nid, "type": "code-node", "data": d, "blocks": []}

    def sql(nid, t, text, names):
        d = {"database_id": "", "sql": "", "params": {}}
        d.update(title(t))
        d["script"] = {"type": "sql", "code": text}
        d["response_json"] = resp(names)
        return {"id": nid, "type": "sql-node", "data": d, "blocks": []}

    # the base's own failure nodes are the templates: if_idem_blocked (Expression if) and its return nodes
    tpl_if = old["if_idem_blocked"]
    assert tpl_if["data"]["condition_type"] == "Expression" and [b["data"]["title"] for b in tpl_if["blocks"]] == ["true", "false"]

    def if_(nid, t, expr, yes):
        assert yes, "an if node's true block must not be empty"
        n = copy.deepcopy(tpl_if)
        n["id"] = nid
        n["data"].update(title(t))
        fid[0] += 2
        n["data"]["filter"]["list"][0].update({"id": fid[0] - 1, "parentId": fid[0]})
        n["data"]["expression"]["code"] = expr
        n["blocks"][0].update({"id": nid + "_t", "blocks": list(yes)})
        n["blocks"][1].update({"id": nid + "_f", "blocks": []})
        return n

    def ret(tpl_id, code_value, nid, t, message_ref):
        r = copy.deepcopy(old[tpl_id])
        lst = r["data"]["response_value"]["list"]
        assert r["data"]["status_code"] == 200 and [p["prop"] for p in lst] == ["code", "message"]
        assert (lst[0]["valueType"], lst[0]["value"], lst[1]["valueType"]) == ("value", code_value, "field")
        r["id"] = nid
        r["data"].update(title(t))
        lst[1]["value"] = message_ref
        return r

    guard = [
        code(G, "IDA V2 Guard: stored Item Disassembly to check (Edit, id digits)? moves of a completion", body("guard_in.js"), IN_FIELDS),
        if_("if_IDAguardRead", "IF an Edit of a stored Item Disassembly (id digits)", "'%s' == 'YES'" % V.N(G, "data.check"), [
            sql(S, "IDA V2 Guard: the stored status (sm_item_disassembly only)", guard_sql(), guard_cols()),
            code(ST, "IDA V2 Guard: Processing? Completed / Fully Posted saved as Draft? too many moves?", body("guard_stored.js"), STORED_FIELDS),
            if_("if_IDAguard400", "IF refused with 400 (being processed in the background / too many moves)", "'%s' == 'YES'" % V.N(ST, "data.refuse400"), [
                ret("return_required_400", "400", "return_node_IDAguard400", "Return Refused 400 (IDA V2 guard)", V.N(ST, "data.message"))]),
            if_("if_IDAguard409", "IF refused with 409 (already Completed / Fully Posted, saved as Draft)", "'%s' == 'YES'" % V.N(ST, "data.refuse409"), [
                ret("return_idem_409", "409", "return_node_IDAguard409", "Return Refused 409 (IDA V2 guard)", V.N(ST, "data.message"))]),
        ]),
        if_("if_IDAguardBig", "IF a completion of more than 250 moves (no stored read)", "'%s' == 'YES'" % V.N(G, "data.bigNoRead"), [
            ret("return_required_400", "400", "return_node_IDAguardBig", "Return Too Many Moves (IDA V2 guard)", V.N(G, "data.bigMessage"))]),
    ]
    doc = copy.deepcopy(base)
    top = [n["id"] for n in doc["nodes"]]
    assert top[0] == "start" and doc["nodes"][0]["type"] == "start-node" and top[1] == "code_fillback", top[:3]
    assert [n["id"] for n in guard] == TOP_IDS
    doc["nodes"] = doc["nodes"][:1] + guard + doc["nodes"][1:]
    fixed = index(doc)[FIXED_NODE]["data"]["script"]
    assert fixed["code"].count(FIX_OLD) == 1 and "baseQty" not in fixed["code"], FIXED_NODE + ": v6 body not as expected"
    fixed["code"] = fixed["code"].replace(FIX_OLD, FIX_NEW)
    got = index(doc)
    assert sorted(set(got) - set(old)) == sorted(GUARD_IDS), sorted(set(got) - set(old))
    # every v6 node byte-identical, code_cost_alloc's body reverted (its containers if_persist / if_persist_t change only through it)
    rev = copy.deepcopy(doc)
    ri = index(rev)
    ri[FIXED_NODE]["data"]["script"]["code"] = ri[FIXED_NODE]["data"]["script"]["code"].replace(FIX_NEW, FIX_OLD)
    for nid, n in old.items():
        assert canon(ri[nid]) == canon(n), "v6 node changed: " + nid
    new_keys = [k for g in guard for k in _all_keys(g)]
    assert len(new_keys) == len(set(new_keys)) and not set(new_keys) & keys_of(base, set()), "a guard key repeats or collides with v6's"
    return doc


def _all_keys(n):
    if isinstance(n, dict):
        if isinstance(n.get("key"), str):
            yield n["key"]
        for v in n.values():
            yield from _all_keys(v)
    elif isinstance(n, list):
        for v in n:
            yield from _all_keys(v)


BUILDERS = [("IDA_SAVE", build)]
