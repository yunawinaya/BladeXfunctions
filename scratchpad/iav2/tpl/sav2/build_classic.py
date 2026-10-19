"""Package B1 - the guarded classics (CONTRACT.md section 11): the pinned deployed bases + new FIRST nodes, nothing else.
They ship to prod at the cut, so every base node stays byte-identical and in its order (test/classic/diff_base.py proves it:
the output minus the guard nodes re-serializes to the base file's exact bytes).

STOCK_ADJUSTMENT = base/STOCK_ADJUSTMENT.v24.json (dev v24 = prod v18) + before code_node_O4tWJ5JH:
  code_node_SAguard (payload: entries, line bytes, id) > sql_node_SAguard (stored status; id 0 = none) > code_node_SAguardVerdict
  > if_SAguardRefuse > return_node_SAguardRefuse = a copy of the classic's own failure return_node_OVwXCPK5 (status 200,
  { code "400", message }): the SA form and the SC Review's SA completion read workflowResult.data.code / .message.
STOCK_COUNT = base/STOCK_COUNT.v10.json (dev v10 = prod v10) + before cond_save_as:
  code_node_SCguard (payload: would the Review build an SA of > 500 lines; id) > sql_node_SCguard (Processing SAs of this SC)
  > code_node_SCguardVerdict > if_SCguardRefuse > end_SCguardRefuse = a copy of the classic's end_review_failed with code 400
  (not 406: mobile's normalizeWorkflowResult shows only code 400 + msg) -> envelope { code 400, success false, data null, msg }.
Both read only stock_adjustment (never gd_async_job) and never answer 401. Keys come from a local seeded RNG (never wfkit's
shared stream), so the output does not depend on the build order.

usage: python3 build_classic.py [--write] [STOCK_ADJUSTMENT|STOCK_COUNT ...]
       (prints sizes; --write saves <repo>/Stock Adjustment/AsyncV2/STOCK_ADJUSTMENT.json and
        <repo>/Stock Count/AsyncV2/STOCK_COUNT.json, indent 1)
"""
import copy
import hashlib
import json
import os
import random
import string
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "lib"))
import v2build as V  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
CODE = os.path.join(HERE, "code")
INCLUDE = "//@include shared/sa_common.js\n"
BASE = {"STOCK_ADJUSTMENT": (os.path.join(HERE, "base", "STOCK_ADJUSTMENT.v24.json"), "3dfb9cda8942f005d7d1c4e5bba6a68c"),
        "STOCK_COUNT": (os.path.join(HERE, "base", "STOCK_COUNT.v10.json"), "25ff6866a69279b20244270275d03eea")}
OUT_DIRS = {"STOCK_ADJUSTMENT": os.path.join(REPO, "Stock Adjustment", "AsyncV2"), "STOCK_COUNT": os.path.join(REPO, "Stock Count", "AsyncV2")}
ANCHOR = {"STOCK_ADJUSTMENT": "code_node_O4tWJ5JH", "STOCK_COUNT": "cond_save_as"}
TOP_IDS = {"STOCK_ADJUSTMENT": ["code_node_SAguard", "sql_node_SAguard", "code_node_SAguardVerdict", "if_SAguardRefuse"],
           "STOCK_COUNT": ["code_node_SCguard", "sql_node_SCguard", "code_node_SCguardVerdict", "if_SCguardRefuse"]}
GUARD_IDS = {"STOCK_ADJUSTMENT": TOP_IDS["STOCK_ADJUSTMENT"] + ["ifBlock_TSAguardRefuse", "ifBlock_FSAguardRefuse", "return_node_SAguardRefuse"],
             "STOCK_COUNT": TOP_IDS["STOCK_COUNT"] + ["if_SCguardRefuse_true", "if_SCguardRefuse_false", "end_SCguardRefuse"]}
SEED = {"STOCK_ADJUSTMENT": 20261016, "STOCK_COUNT": 20261017}
FILTER_ID = {"STOCK_ADJUSTMENT": 1797700000000, "STOCK_COUNT": 1797800000000}


def text(name):
    with open(os.path.join(CODE, "classic", name), encoding="utf-8") as f:
        return f.read().rstrip("\n")


def js(name):
    """a guard body; its first line //@include shared/sa_common.js becomes the shared file (v2build.include_js)"""
    body = text(name)
    if body.startswith(INCLUDE):
        # include_js drops only the "if (typeof module" LINE: a multi-line export would leave a SyntaxError behind
        exp = [l for l in V.raw(CODE, "shared/sa_common.js").split("\n") if l.startswith("if (typeof module")]
        assert len(exp) == 1 and exp[0].rstrip().endswith(";"), "sa_common.js: the export must be ONE line"
        body = V.include_js(CODE, "shared/sa_common.js") + "\n" + body[len(INCLUDE):]
    assert "//@include" not in body, name
    return body


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


def load_base(name):
    path, md5 = BASE[name]
    raw = open(path, encoding="utf-8").read()
    assert hashlib.md5(raw.encode("utf-8")).hexdigest() == md5, name + ": the base is not the pinned snapshot"
    return raw, json.loads(raw)


class Kit:
    """node shapes of the base's own nodes (smv2 build_classic.py), keys unique in the file, fresh 13-digit filter ids"""

    def __init__(self, name, base_raw, base):
        for nid in GUARD_IDS[name]:
            assert '"%s"' % nid not in base_raw, nid + " already in the base"
        self.taken = keys_of(base, set())
        self.rng = random.Random(SEED[name])
        self.fid = FILTER_ID[name]
        assert str(self.fid)[:9] not in base_raw

    def key(self):
        while True:
            k = "".join(self.rng.choice(string.ascii_lowercase + string.digits) for _ in range(8))
            if k not in self.taken and not k.isdigit():
                self.taken.add(k)
                return k

    def filter_ids(self):
        self.fid += 2
        return self.fid - 1, self.fid

    @staticmethod
    def title(t):
        return {"title": t, "isValidator": True, "nodeName": t, "name": t}

    def resp(self, names):
        return [{"key": self.key(), "name": n, "title": n, "description": "", "bsonType": "string", "isExpand": False, "children": []} for n in names]

    def code(self, nid, t, body, names):
        d = {"language": "javascript", "code": "", "timeout": 30000}
        d.update(self.title(t))
        d["script"] = {"type": "javascript", "code": body}
        d["response_json"] = self.resp(names)
        return {"id": nid, "type": "code-node", "data": d, "blocks": []}

    def sql(self, nid, t, body, names):
        d = {"database_id": "", "sql": "", "params": {}}
        d.update(self.title(t))
        d["script"] = {"type": "sql", "code": body}
        d["response_json"] = self.resp(names)
        return {"id": nid, "type": "sql-node", "data": d, "blocks": []}


def build_sa():
    name = "STOCK_ADJUSTMENT"
    raw, base = load_base(name)
    old = index(base)
    k = Kit(name, raw, base)
    G, V_, S = "code_node_SAguard", "code_node_SAguardVerdict", "sql_node_SAguard"
    # the base's own failure nodes are the templates: if_G5Mqtfid (Expression if) and its return_node_OVwXCPK5
    tpl_if, tpl_ret = old["if_G5Mqtfid"], old["return_node_OVwXCPK5"]
    lst = tpl_ret["data"]["response_value"]["list"]
    assert tpl_ret["data"]["status_code"] == 200 and [p["prop"] for p in lst] == ["code", "message"]
    assert (lst[0]["valueType"], lst[0]["value"], lst[1]["valueType"]) == ("value", "400", "field")
    ret = copy.deepcopy(tpl_ret)
    ret["id"] = "return_node_SAguardRefuse"
    ret["data"].update(k.title("Return Refused (SA V2 guard)"))
    ret["data"]["response_value"]["list"][1]["value"] = "{{node:%s.data.message}}" % V_
    iff = copy.deepcopy(tpl_if)
    iff["id"] = "if_SAguardRefuse"
    iff["data"].update(k.title("IF refused (Processing / more than 500 entries / a line over 60,000 bytes)"))
    a, b = k.filter_ids()
    iff["data"]["filter"]["list"][0].update({"id": a, "parentId": b})
    iff["data"]["expression"]["code"] = "'{{node:%s.data.refuse}}' == 'YES'" % V_
    assert [x["data"]["title"] for x in iff["blocks"]] == ["true", "false"]
    iff["blocks"][0].update({"id": "ifBlock_TSAguardRefuse", "blocks": [ret]})
    iff["blocks"][1].update({"id": "ifBlock_FSAguardRefuse", "blocks": []})
    guard = [
        k.code(G, "SA V2 Guard: payload entries / line sizes, stored SA id", js("sa_guard.js"), ["saId", "tenantId", "entries", "reason", "message"]),
        k.sql(S, "SA V2 Guard: stored status (id 0 = no stored SA)", text("sa_guard.sql"), ["stock_adjustment_status"]),
        k.code(V_, "SA V2 Guard: Processing? too many entries? line too large?", js("sa_verdict.js"), ["refuse", "reason", "message"]),
        iff,
    ]
    return splice(name, base, old, guard)


def build_sc():
    name = "STOCK_COUNT"
    raw, base = load_base(name)
    old = index(base)
    k = Kit(name, raw, base)
    G, V_, S = "code_node_SCguard", "code_node_SCguardVerdict", "sql_node_SCguard"
    # the base's own failure nodes are the templates: if_review_failed (ConditionRule if) and its end_review_failed
    tpl_if, tpl_end = old["if_review_failed"], old["end_review_failed"]
    assert (tpl_end["data"]["back_data_type"], tpl_end["data"]["code"], tpl_end["data"]["msg"]["type"]) == ("Default", 406, "javascript")
    end = copy.deepcopy(tpl_end)
    end["id"] = "end_SCguardRefuse"
    end["data"].update(k.title("End: refused (SA V2 guard)"))
    end["data"]["code"] = 400
    end["data"]["msg"]["code"] = "{{node:%s.data.message}}" % V_
    iff = copy.deepcopy(tpl_if)
    iff["id"] = "if_SCguardRefuse"
    iff["data"].update(k.title("IF refused (a Processing SA of this Stock Count / a Review of more than 500 lines)"))
    leaf = iff["data"]["filter"]["list"][0]
    assert (leaf["operator"], leaf["valueType"], len(iff["data"]["filter"]["list"])) == ("equal", "value", 1)
    a, b = k.filter_ids()
    leaf.update({"id": a, "parentId": b, "prop": "node.%s.data.refuse" % V_, "value": "YES", "propLabel": "refuse"})
    assert [x["data"]["title"] for x in iff["blocks"]] == ["true", "false"]
    iff["blocks"][0].update({"id": "if_SCguardRefuse_true", "blocks": [end]})
    iff["blocks"][1].update({"id": "if_SCguardRefuse_false", "blocks": []})
    guard = [
        k.code(G, "SC Guard: a Review building an SA of > 500 lines? stored SC id", js("sc_guard.js"),
               ["scId", "tenantId", "reviewLines", "buildsSa", "reason", "message"]),
        k.sql(S, "SC Guard: Processing SAs of this Stock Count (id 0 = no stored SC)", text("sc_guard.sql"), ["busy_count"]),
        k.code(V_, "SC Guard: SA processing? Review too large?", js("sc_verdict.js"), ["refuse", "reason", "message"]),
        iff,
    ]
    return splice(name, base, old, guard)


def splice(name, base, old, guard):
    doc = copy.deepcopy(base)
    top = [n["id"] for n in doc["nodes"]]
    at = top.index(ANCHOR[name])
    assert at == 1 and doc["nodes"][0]["type"] == "start-node", (name, top[:3])
    assert [n["id"] for n in guard] == TOP_IDS[name]
    doc["nodes"] = doc["nodes"][:at] + guard + doc["nodes"][at:]
    got = index(doc)
    assert sorted(set(got) - set(old)) == sorted(GUARD_IDS[name]), sorted(set(got) - set(old))
    canon = lambda x: json.dumps(x, ensure_ascii=False, separators=(",", ":"))
    for nid, n in old.items():
        assert canon(got[nid]) == canon(n), name + ": base node changed " + nid
    return doc


BUILDERS = [("STOCK_ADJUSTMENT", build_sa), ("STOCK_COUNT", build_sc)]

if __name__ == "__main__":
    want = [a for a in sys.argv[1:] if not a.startswith("--")]
    for nm, fn in BUILDERS:
        if not want or nm in want:
            V.build([(nm, fn)], OUT_DIRS[nm], "--write" in sys.argv)
