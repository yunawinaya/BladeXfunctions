"""SM_PLANT_TRANSFER duplicate guard (prod-hotfix 2026-10-23), built on the LIVE v104 (dev == prod, md5 f2f93cf6...).

    python3 scratchpad/ptguard/build_guard.py            # writes prod-hotfix/2026-10-23-pt-duplicate-guard/SM_PLANT_TRANSFER.json

Changes, all additive:
  1. new Draft / Issued transfers: pt_idem_key (app) + fingerprint (Issued, 15 min) stored in pt_uuid as key|fp|state;
     entry check (REPLAY / WAIT / STOP) before the stock check, twin read-back after both header inserts, SAVED at the end
  2. Draft on a stored non-Draft transfer refused (PT_DRAFT_NOT_ALLOWED)
  3. per-run cache keys instead of per-user (generatedBatches_ / newSubFormData_ / finalSubFormData_ + issued_by)
  4. In Progress: twin read-back after the receiving child insert
"""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(REPO, "scratchpad", "smv2", "lib"))
import wfkit as K  # noqa: E402

BASE = os.path.join(HERE, "base", "SM_PLANT_TRANSFER.v104.pretty.json")
OUT = os.path.join(REPO, "prod-hotfix", "2026-10-23-pt-duplicate-guard", "SM_PLANT_TRANSFER.json")
PT = "Plant Transfer:Table:2025846960482627586"
PREP = "code_node_PTdupPrep"
OLD_CACHE = "{{workflowparams:allData.issued_by}}"
NEW_CACHE = "{{node:%s.data.runKey}}" % PREP


def N(node, path):
    return "{{node:%s.%s}}" % (node, path)


def body(name, **subst):
    shared = open(os.path.join(HERE, "code", "shared.js"), encoding="utf-8").read()
    shared = "\n".join(l for l in shared.rstrip("\n").split("\n") if not l.startswith("if (typeof module"))
    text = open(os.path.join(HERE, "code", name), encoding="utf-8").read().rstrip("\n")
    for k, v in subst.items():
        text = text.replace("@" + k, v)
    assert not re.search(r"@(ADD|SQL)\b", text), name
    return shared + "\n" + text


def is_(node, field, value, op="=="):
    return "'%s' %s '%s'" % (N(node, "data." + field), op, value)


DUP_SQL = """SELECT CAST(p.id AS CHAR) AS id, p.stock_movement_no, p.stock_movement_status,
       SUBSTRING_INDEX(p.pt_uuid, '|', -1) AS save_state,
       CASE WHEN SUBSTRING_INDEX(p.pt_uuid, '|', 1) = '{{node:code_node_PTdupPrep.data.keySql}}' THEN 'KEY' ELSE 'FP' END AS match_by,
       TIMESTAMPDIFF(SECOND, p.create_time, CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')) AS age_s
  FROM plant_transfer p
 WHERE p.tenant_id = '{{node:code_node_PTdupPrep.data.tenantId}}'
   AND p.is_deleted = 0
   AND p.movement_type = 'Plant Transfer'
   AND p.stock_movement_status <> 'Cancelled'
   AND p.pt_uuid LIKE '%|%|%'
   AND (SUBSTRING_INDEX(p.pt_uuid, '|', 1) = '{{node:code_node_PTdupPrep.data.keySql}}'
        OR (SUBSTRING_INDEX(SUBSTRING_INDEX(p.pt_uuid, '|', 2), '|', -1) = '{{node:code_node_PTdupPrep.data.fpSql}}'
            AND p.create_time >= CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00') - INTERVAL 15 MINUTE))
 ORDER BY p.id"""
DUP_COLS = ["id", "stock_movement_no", "stock_movement_status", "save_state", "match_by", "age_s"]

DRAFT_SQL = """SELECT CAST(p.id AS CHAR) AS id, p.stock_movement_no, p.stock_movement_status
  FROM plant_transfer p
 WHERE p.id = CAST('{{node:code_node_PTdupPrep.data.editId}}' AS UNSIGNED)
   AND p.tenant_id = '{{node:code_node_PTdupPrep.data.tenantId}}'
   AND p.is_deleted = 0"""

CHILD_SQL = """SELECT CAST(p.id AS CHAR) AS id, p.stock_movement_status
  FROM plant_transfer p
 WHERE p.tenant_id = '{{node:code_node_PTdupPrep.data.tenantId}}'
   AND p.parent_id = CAST('{{node:code_node_PTdupPrep.data.parentId}}' AS UNSIGNED)
   AND p.movement_type = 'Plant Transfer (Receiving)'
   AND p.is_deleted = 0
 ORDER BY p.id"""

PREP_FIELDS = ["route", "code", "message", "result_code", "guardOn", "isIssuedAdd", "tenantId", "keySql", "fpSql", "uuidSaving", "uuidSaved",
               "draftCheck", "editId", "childCheck", "parentId", "runKey"]
ANSWER = ["route", "code", "message", "result_code", "id", "stock_movement_no", "stock_movement_status", "replayed"]
RET_FIELDS = ["code", "message", "result_code", "id", "stock_movement_no", "stock_movement_status", "replayed"]


def answer_return(nid, title, src, fields=RET_FIELDS):
    return K.ret(nid, title, [(f, N(src, "data." + f)) for f in fields])


def lose_update(ids, nid, title, src):
    u = K.update(ids, nid, title, PT, ("id", "in", N(src, "data.mine")), [("is_deleted", 1)], labels={"is_deleted": "删除状态"})
    u["data"]["props"]["list"][0]["valueType"] = "value"
    return u


def twin(ids, tag, add_id):
    sql_id, code_id = "sql_node_PTdupTwin" + tag, "code_node_PTdupTwin" + tag
    return K.if_(ids, "if_PTdupTwin" + tag, "Duplicate guard: twin read-back after the header insert", is_(PREP, "guardOn", "YES"), [
        K.sql(sql_id, "Saves of this key / content (oldest first, this run's own row included)", DUP_SQL, DUP_COLS),
        K.code(code_id, "Twin? the oldest wins; this run's header goes when it lost", body("twin.js", ADD=add_id, SQL=sql_id), ANSWER + ["lose", "mine"]),
        K.if_(ids, "if_PTdupLose" + tag, "IF an older save won: remove this header, answer with the winner", is_(code_id, "lose", "YES"), [
            lose_update(ids, "update_node_PTdupLose" + tag, "Remove this twin's header (an older save of the same key / content won)", code_id),
            answer_return("return_node_PTdupLose" + tag, "Return the winner", code_id),
        ]),
    ])


def index(doc):
    """id -> (node, parent list)"""
    out = {}

    def walk(n, parent):
        if isinstance(n, dict):
            if isinstance(n.get("id"), str) and n.get("type"):
                out[n["id"]] = (n, parent)
            for k, v in n.items():
                if k == "data":
                    continue
                if isinstance(v, list):
                    for x in v:
                        walk(x, v)
                else:
                    walk(v, parent)
        elif isinstance(n, list):
            for x in n:
                walk(x, n)
    walk(doc, None)
    return out


def insert_after(idx, anchor, nodes):
    parent = idx[anchor][1]
    i = next(i for i, x in enumerate(parent) if x is idx[anchor][0])
    parent[i + 1:i + 1] = nodes


def insert_before(idx, anchor, nodes):
    parent = idx[anchor][1]
    i = next(i for i, x in enumerate(parent) if x is idx[anchor][0])
    parent[i:i] = nodes


def numeric_ids(doc):
    found = []

    def walk(n):
        if isinstance(n, dict):
            for k in ("id", "parentId"):
                if isinstance(n.get(k), int):
                    found.append(n[k])
            for v in n.values():
                walk(v)
        elif isinstance(n, list):
            for v in n:
                walk(v)
    walk(doc)
    return found


def resp_keys(doc):
    found = []

    def walk(n):
        if isinstance(n, dict):
            if "bsonType" in n and isinstance(n.get("key"), str):
                found.append(n["key"])
            for v in n.values():
                walk(v)
        elif isinstance(n, list):
            for v in n:
                walk(v)
    walk(doc)
    return found


def build():
    doc = json.load(open(BASE, encoding="utf-8"))
    base_nums = set(numeric_ids(doc))
    base_keys = resp_keys(doc)
    K._taken.update(base_keys)
    ids = K.Ids(1810000000000)
    idx = index(doc)
    for need in ("code_node_37LA0tgq", "add_node_5Wstw9z2", "add_node_QyZ0Zyck", "update_node_aY15G0bP", "add_node_u455hdU9",
                 "update_node_BHkVzxmD", "return_node_tTXARceR"):
        assert need in idx, need

    # 1. entry: after fillbackHeaderFields, before the required-field check and the stock check
    insert_after(idx, "code_node_37LA0tgq", [
        K.code(PREP, "Duplicate guard: key + fingerprint of a new Draft / Issued transfer; edit-time flags; per-run cache key",
               body("prep.js"), PREP_FIELDS),
        K.if_(ids, "if_PTdupInvalid", "IF the app sent a malformed pt_idem_key: refuse, write nothing", is_(PREP, "route", "INVALID"), [
            answer_return("return_node_PTdupInvalid", "Return Invalid Key", PREP, ["code", "message", "result_code"]),
        ]),
        K.if_(ids, "if_PTdupOn", "IF a new transfer to guard: look for an earlier save of the same key / content", is_(PREP, "guardOn", "YES"), [
            K.sql("sql_node_PTdupFind", "Earlier saves of this key, or of this content within 15 minutes (oldest first)", DUP_SQL, DUP_COLS),
            K.code("code_node_PTdupDecide", "REPLAY / WAIT / STOP, or GO", body("decide.js"), ANSWER),
            K.if_(ids, "if_PTdupAnswer", "IF it was saved before: answer with it, write nothing", is_("code_node_PTdupDecide", "route", "GO", "!="), [
                answer_return("return_node_PTdupAnswer", "Return the earlier save", "code_node_PTdupDecide"),
            ]),
        ]),
    ])
    idx = index(doc)

    # 1. twin read-backs after the two header inserts (Issued; Draft)
    insert_after(idx, "add_node_5Wstw9z2", [twin(ids, "Iss", "add_node_5Wstw9z2")])
    idx = index(doc)
    insert_after(idx, "add_node_QyZ0Zyck", [twin(ids, "Dr", "add_node_QyZ0Zyck")])
    idx = index(doc)

    # 1. pt_uuid on both header inserts (Issued: SAVING until the end; Draft: SAVED, nothing after it matters)
    for nid, field in (("add_node_5Wstw9z2", "uuidSaving"), ("add_node_QyZ0Zyck", "uuidSaved")):
        props = idx[nid][0]["data"]["props"]["list"]
        assert not any(p["prop"] == "pt_uuid" for p in props)
        props.append({"prop": "pt_uuid", "operator": "", "valueType": "field", "value": N(PREP, "data." + field), "valueLabel": "", "propLabel": "UUID"})

    # 2. Draft on a stored transfer: before update_node_aY15G0bP (Draft + Edit Mode)
    insert_before(idx, "update_node_aY15G0bP", [
        K.if_(ids, "if_PTdupDraftChk", "IF a stored transfer is saved as Draft: read its stored status", is_(PREP, "draftCheck", "YES"), [
            K.sql("sql_node_PTdupDraftSt", "The stored transfer's status", DRAFT_SQL, ["id", "stock_movement_no", "stock_movement_status"]),
            K.code("code_node_PTdupDraftSt", "Only a Draft may be saved as Draft", body("draftst.js"),
                   ["route", "code", "message", "result_code", "id", "stock_movement_no", "stock_movement_status"]),
            K.if_(ids, "if_PTdupDraftNo", "IF it isn't a Draft: refuse, write nothing", is_("code_node_PTdupDraftSt", "route", "REFUSE"), [
                answer_return("return_node_PTdupDraftNo", "Return Draft Not Allowed", "code_node_PTdupDraftSt",
                              ["code", "message", "result_code", "id", "stock_movement_no", "stock_movement_status"]),
            ]),
        ]),
    ])
    idx = index(doc)

    # 4. In Progress: twin read-back after the receiving child insert
    insert_after(idx, "add_node_u455hdU9", [
        K.if_(ids, "if_PTdupChildChk", "IF In Progress inserted the receiving child: twin read-back", is_(PREP, "childCheck", "YES"), [
            K.sql("sql_node_PTdupChild", "This transfer's receiving children (oldest first)", CHILD_SQL, ["id", "stock_movement_status"]),
            K.code("code_node_PTdupChild", "Twin child? the oldest stays", body("child.js"), ["lose", "mine", "winner"]),
            K.if_(ids, "if_PTdupChildLose", "IF an older child exists: remove this run's child", is_("code_node_PTdupChild", "lose", "YES"), [
                lose_update(ids, "update_node_PTdupLoseChild", "Remove this run's twin receiving child (an older one stays)", "code_node_PTdupChild"),
            ]),
        ]),
    ])
    idx = index(doc)

    # 1. SAVED stamp, last thing before the success return
    stamp = K.update(ids, "update_node_PTdupSaved", "Mark the new Issued transfer saved (pt_uuid ...|SAVED)", PT,
                     ("id", "in", N("code_node_PTdupSaved", "data.id")), [("pt_uuid", N("code_node_PTdupSaved", "data.uuidSaved"))],
                     labels={"pt_uuid": "UUID"})
    insert_before(idx, "return_node_tTXARceR", [
        K.code("code_node_PTdupSaved", "Duplicate guard: the new Issued transfer to mark saved", body("saved.js"), ["stamp", "id", "uuidSaved"]),
        K.if_(ids, "if_PTdupSaved", "IF a new Issued transfer was saved: mark it SAVED", is_("code_node_PTdupSaved", "stamp", "YES"), [stamp]),
    ])

    # 3. per-run cache keys (generatedBatches_ x4, newSubFormData_ x4, finalSubFormData_ x6)
    n_cache = 0
    for node, _ in index(doc).values():
        if node.get("type") in ("set-cache-node", "get-cache-node") and OLD_CACHE in node["data"].get("redis_key", ""):
            node["data"]["redis_key"] = node["data"]["redis_key"].replace(OLD_CACHE, NEW_CACHE)
            n_cache += 1
    assert n_cache == 14, n_cache
    assert OLD_CACHE not in json.dumps(doc, ensure_ascii=False)

    seen = K.check_ids(doc)
    new_nums = numeric_ids(doc)
    assert len([x for x in new_nums if x >= 1810000000000]) == len(set(x for x in new_nums if x >= 1810000000000)), "filter id clash"
    assert not (set(x for x in new_nums if x >= 1810000000000) & base_nums), "filter id clash with base"
    import collections
    added_keys = collections.Counter(resp_keys(doc)) - collections.Counter(base_keys)
    assert all(v == 1 for v in added_keys.values()), "new response keys repeat"
    assert not (set(added_keys) & set(base_keys)), "new response key reuses a base key"
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(json.dumps(doc, ensure_ascii=False, separators=(",", ":")))
    added = sorted(k for k in seen if "PTdup" in k)
    print("wrote", os.path.relpath(OUT, REPO), "| nodes", len(seen), "| new", len(added), "| cache keys replaced", n_cache)
    print(" ", ", ".join(added))


if __name__ == "__main__":
    build()
