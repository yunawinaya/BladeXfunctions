"""IA_SAVE v12 = base/IA_SAVE.v11.json (deployed dev v11 = prod v11) + the IA V2 guard as the FIRST nodes after start + ONE
body change in code_validate (a stock_control 0 line needs only a quantity; at least one stock line). CONTRACT.md section 11 and
fix wave R5; code_receipt_prep is NOT touched (user decision 2026-10-19 ~15:45). classic/diff_v11.py proves the output node by node.

Guard (copies the deployed LOT / SA guard pattern, tpl/smv2/build_classic.py + tpl/sav2/build_classic.py):
  code_node_IAguardIn   payload only: an Edit with digit allData.id (and a digit session tenant) -> check YES; picks =
                        iaPickCount(allData.stock_movement); a completion (saveAs != Draft) above IA_CLASSIC_MAX_PICKS -> big
  if_IAguardRead        check YES:
    sql_node_IAguard      CLASSIC_GUARD (code/shared/sql.py): the stored item_assembly_status, sm_item_assembly only
    code_node_IAguardStored  Processing -> 400 IA_TEXT.busy; Completed / Fully Posted + Draft -> 409 IA_TEXT.classicFinal; big -> 400
    if_IAguard400 / if_IAguard409 -> copies of the classic's return_required_400 / return_idem_409 (status 200, {code, message})
  if_IAguardBig         big without a stored read (Add / Clone / no id) -> 400 IA_TEXT.classicTooBig
It reads neither gd_async_job nor any V2 table (prod has none until the full deployment) and never answers 401.
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
IAV2 = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(IAV2, "lib"))
import v2build as V  # noqa: E402

BASE = os.path.join(IAV2, "base", "IA_SAVE.v11.json")
BASE_MD5 = "add587fca6e86fd76d68cb7e82eb24b3"
CODE = os.path.join(IAV2, "code")
SEED = 20261019
FILTER_BASE = 1798610000000
G, S, ST = "code_node_IAguardIn", "sql_node_IAguard", "code_node_IAguardStored"
TOP_IDS = [G, "if_IAguardRead", "if_IAguardBig"]
GUARD_IDS = [G, "if_IAguardRead", "if_IAguardRead_t", "if_IAguardRead_f", S, ST, "if_IAguard400", "if_IAguard400_t", "if_IAguard400_f", "return_node_IAguard400",
             "if_IAguard409", "if_IAguard409_t", "if_IAguard409_f", "return_node_IAguard409", "if_IAguardBig", "if_IAguardBig_t", "if_IAguardBig_f",
             "return_node_IAguardBig"]
IN_FIELDS = ["check", "iaId", "tenantId", "saveAs", "picks", "big", "bigNoRead", "bigMessage"]
STORED_FIELDS = ["stored", "refuse400", "refuse409", "message"]
SQL_FIELDS = ["ia_id", "item_assembly_status"]
# the one v11 node whose body changes: a line whose item has stock_control 0 (labour / overhead) needs no picks, but at least one
# line must be a stock line (fix wave R5: v11's own text when every line is non-stock); one contiguous replacement
FIXED_NODE = "code_validate"
FIX_OLD = """const lines = entry.stock_movement || [];
if (!message && lines.length === 0) {
  message = 'There are no components to consume. Add at least one component line.';
}

for (let i = 0; i < lines.length && !message; i++) {
  const line = lines[i];
  const label = line.item_name || line.item_selection;
  const allocated = q8(line.total_quantity);

  let picks = [];
"""
FIX_NEW = """const lines = entry.stock_movement || [];
if (!message && lines.length === 0) {
  message = 'There are no components to consume. Add at least one component line.';
}
// A stock_control 0 item (labour / overhead) moves no stock: it needs a quantity, not picks, and cannot be the only kind of line.
const isNonStock = function (line) {
  const it = itemMap[String(line.item_selection)];
  return Boolean(it) && it.stock_control === 0;
};
if (!message && lines.every(isNonStock)) {
  message = 'There are no components to consume. Add at least one component line.';
}

for (let i = 0; i < lines.length && !message; i++) {
  const line = lines[i];
  const label = line.item_name || line.item_selection;
  const allocated = q8(line.total_quantity);
  if (isNonStock(line)) {
    if (allocated <= 0) {
      message = 'Line ' + (i + 1) + ' (' + label + '): quantity must be greater than zero.';
    }
    continue;
  }

  let picks = [];
"""


def _shared_sql():
    spec = importlib.util.spec_from_file_location("ia_shared_sql_classic", os.path.join(CODE, "shared", "sql.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def body(name):
    """a guard body: code/shared/ia_common.js (v2build.include_js) + classic/<name>"""
    with open(os.path.join(HERE, name), encoding="utf-8") as f:
        own = f.read().rstrip("\n")
    assert "//@include" not in own and "require(" not in own, name
    exp = [line for line in V.raw(CODE, "shared/ia_common.js").split("\n") if line.startswith("if (typeof module")]
    assert len(exp) == 1 and exp[0].rstrip().endswith(";"), "ia_common.js: the export must be ONE line"
    return V.include_js(CODE, "shared/ia_common.js") + "\n" + own


def guard_sql():
    return V.sub(_shared_sql().CLASSIC_GUARD, T=V.N(G, "data.tenantId"), IA=V.N(G, "data.iaId"))


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
    assert hashlib.md5(raw.encode("utf-8")).hexdigest() == BASE_MD5, "base/IA_SAVE.v11.json is not the pinned dev / prod v11"
    return raw, json.loads(raw)


def canon(x):
    return json.dumps(x, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def build():
    raw, base = load_base()
    old = index(base)
    for nid in GUARD_IDS:
        assert '"%s"' % nid not in raw, nid + " already in v11"
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
        code(G, "IA V2 Guard: stored Item Assembly to check (Edit, id digits)? picks of a completion", body("guard_in.js"), IN_FIELDS),
        if_("if_IAguardRead", "IF an Edit of a stored Item Assembly (id digits)", "'%s' == 'YES'" % V.N(G, "data.check"), [
            sql(S, "IA V2 Guard: the stored status (sm_item_assembly only)", guard_sql(), SQL_FIELDS),
            code(ST, "IA V2 Guard: Processing? Completed / Fully Posted saved as Draft? too many picks?", body("guard_stored.js"), STORED_FIELDS),
            if_("if_IAguard400", "IF refused with 400 (being processed in the background / too many picks)", "'%s' == 'YES'" % V.N(ST, "data.refuse400"), [
                ret("return_required_400", "400", "return_node_IAguard400", "Return Refused 400 (IA V2 guard)", V.N(ST, "data.message"))]),
            if_("if_IAguard409", "IF refused with 409 (already Completed / Fully Posted, saved as Draft)", "'%s' == 'YES'" % V.N(ST, "data.refuse409"), [
                ret("return_idem_409", "409", "return_node_IAguard409", "Return Refused 409 (IA V2 guard)", V.N(ST, "data.message"))]),
        ]),
        if_("if_IAguardBig", "IF a completion of more than 250 picks (no stored read)", "'%s' == 'YES'" % V.N(G, "data.bigNoRead"), [
            ret("return_required_400", "400", "return_node_IAguardBig", "Return Too Many Picks (IA V2 guard)", V.N(G, "data.bigMessage"))]),
    ]
    doc = copy.deepcopy(base)
    top = [n["id"] for n in doc["nodes"]]
    assert top[0] == "start" and doc["nodes"][0]["type"] == "start-node" and top[1] == "code_fillback", top[:3]
    assert [n["id"] for n in guard] == TOP_IDS
    doc["nodes"] = doc["nodes"][:1] + guard + doc["nodes"][1:]
    fixed = index(doc)[FIXED_NODE]["data"]["script"]
    assert fixed["code"].count(FIX_OLD) == 1 and "stock_control" not in fixed["code"], FIXED_NODE + ": v11 body not as expected"
    fixed["code"] = fixed["code"].replace(FIX_OLD, FIX_NEW)
    got = index(doc)
    assert sorted(set(got) - set(old)) == sorted(GUARD_IDS), sorted(set(got) - set(old))
    # every v11 node byte-identical, code_validate's body reverted (its containers change only through it)
    rev = copy.deepcopy(doc)
    ri = index(rev)
    ri[FIXED_NODE]["data"]["script"]["code"] = ri[FIXED_NODE]["data"]["script"]["code"].replace(FIX_NEW, FIX_OLD)
    for nid, n in old.items():
        assert canon(ri[nid]) == canon(n), "v11 node changed: " + nid
    new_keys = [k for g in guard for k in _all_keys(g)]
    assert len(new_keys) == len(set(new_keys)) and not set(new_keys) & keys_of(base, set()), "a guard key repeats or collides with v11's"
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


BUILDERS = [("IA_SAVE", build)]
