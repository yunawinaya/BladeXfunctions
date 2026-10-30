"""SM_LOCATION_TRANSFER v86 = the deployed v85 (scratchpad/smv2/build_classic.py, rendered by smv2 lib/v2build: pinned md5 of
its text) + the IA transfer request rule (ENH-20261027-001, plan top section; scratchpad/iatr/code/shared/iatr_rules.js).
The classic moves no stock for a request LOT: a request's dispatch, receipt and cancel run only through LOT V2 (atomic).
  sql_node_LOTguard       + g.transfer_purpose (the stored row's purpose) + line_ids (a request's stored line ids; NULL for
                          every ordinary LOT: the CASE never runs its subquery)
  code_node_LOTrq         NEW, after the v85 guard: iatrTransition on the STORED row -> rq NONE (an ordinary LOT: today's
                          behaviour) / SAVE (Save Picks: stored Requested + purpose, saved as Draft, on exactly the stored
                          lines: a tab opened before a refresh is refused) / REFUSE (+ message)
  if_LOTrqRefuse          NEW: rq REFUSE -> return_node_LOTrqRefuse (the classic's own 400 shape) before any write
  code_node_yPlLXIZW      + writeStatus: "Requested" when rq SAVE, else saveAs (the same value for every ordinary LOT)
  update_node_WKLUE7ka    stock_movement_status = writeStatus (was {{workflowparams:saveAs}})
Proof (test/test_lot_classic.js): removing the 5 new nodes and reverting the 4 exact changes gives v85 node for node.

usage: python3 scratchpad/iatr/classic/patch_lot_classic.py [--write]   (IATR_OUT=<dir> writes there instead of the repo)"""
import copy
import hashlib
import json
import os
import random
import string
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
IATR = os.path.dirname(HERE)
REPO = os.path.abspath(os.path.join(IATR, "..", ".."))
SMV2 = os.path.join(REPO, "scratchpad", "smv2")
sys.path.insert(0, SMV2)
sys.path.insert(0, os.path.join(SMV2, "lib"))
import build_classic as BC  # noqa: E402
import v2build as V  # noqa: E402

OUT = os.environ.get("IATR_OUT") or os.path.join(REPO, "Stock Movement", "Location Transfer", "AsyncV2")
# the deployed v85 (dev = prod = repo, 10-28) as smv2's builder renders it
BASE_MD5 = "afb6259d65b3b49aab552f3f1ad60b25"
RULES = os.path.join(IATR, "code", "shared", "iatr_rules.js")
NEW_IDS = ["code_node_LOTrq", "if_LOTrqRefuse", "ifBlock_TLOTrqRefuse", "ifBlock_FLOTrqRefuse", "return_node_LOTrqRefuse"]
SQL_OLD = "SELECT g.stock_movement_status,\n"
SQL_NEW = ("SELECT g.stock_movement_status,\n       g.transfer_purpose,\n"
           "       CASE WHEN g.transfer_purpose = 'IA_SUPPLY' THEN (SELECT JSON_ARRAYAGG(CAST(r.id AS CHAR)) FROM sm_location_transfer_d2c7o1jd_sub r\n"
           "         WHERE r.tenant_id = '{{node:code_node_LOTguard.data.tenantId}}' AND r.sm_location_transfer_id = g.id AND r.is_deleted = 0) END AS line_ids,\n")
Y_OLD = "const saveAs = {{workflowparams:saveAs}}\n"
Y_NEW = (Y_OLD + "// IA transfer request (scratchpad/iatr): Save Picks keeps a request Requested; every ordinary LOT writes saveAs as before\n"
         "const writeStatus = String([{{node:code_node_LOTrq.data.rq}}][0] || \"\") === \"SAVE\" ? \"Requested\" : saveAs;\n")
YR_OLD = "  stock_movement_status: allData.stock_movement_status,\n"
YR_NEW = YR_OLD + "  writeStatus: writeStatus,\n"
W_OLD = "{{workflowparams:saveAs}}"
W_NEW = "{{node:code_node_yPlLXIZW.data.writeStatus}}"


def render(doc):
    return json.dumps(doc, ensure_ascii=False, indent=1) + "\n"


def rules_js():
    text = open(RULES, encoding="utf-8").read()
    body = "\n".join(l for l in text.split("\n") if not l.startswith("if (typeof module")).rstrip("\n")
    assert "{{" not in body, "a shared file must not hold a platform token"
    return body


RQ_JS = """// IA transfer request (ENH-20261027-001, scratchpad/iatr): the allowed moves of a request LOT, decided by the STORED row.
// NONE = an ordinary Location Transfer (today's behaviour, untouched); SAVE = Save Picks (the Draft path keeps the status Requested);
// a request's dispatch, receipt and cancel run only through the background save (LOT V2), so the classic refuses them
/*@@IATR_RULES@@*/
const a = [{{workflowparams:allData}}][0] || {};
const saveAs = String([{{workflowparams:saveAs}}][0] || "");
const g = [{{node:code_node_LOTguard.data}}][0] || {};
const rows = [{{node:sql_node_LOTguard.data}}][0];
const row = (Array.isArray(rows) ? rows[0] : rows) || null;
const hasStored = String(g.check || "") === "YES" && !!row && typeof row === "object";
const t = iatrTransition({ stored: hasStored ? row.stock_movement_status : "", storedPurpose: hasStored ? row.transfer_purpose : "", saveAs: saveAs,
  hasStored: hasStored, payloadPurpose: a && a.transfer_purpose, payloadStatus: a && a.stock_movement_status });
// Save Picks only on the lines as stored: a refresh from the Item Assembly replaces them, so a tab opened before it is refused
const ids = (rows) => rows.map((x) => iatrId(x && x.id)).sort();
const sent = [];
for (const r of Array.isArray(a.stock_movement) ? a.stock_movement : []) {
  if (!r || typeof r !== "object") continue;
  sent.push(r);
  for (const c of Array.isArray(r.children) ? r.children : []) if (c && typeof c === "object") sent.push(c);
}
const stale = t.decision === "SAVE" && JSON.stringify(ids(sent)) !== JSON.stringify(iatrParse(row.line_ids).map(iatrId).sort());
const rq = stale ? "REFUSE" : t.decision === "NONE" || t.decision === "SAVE" ? t.decision : "REFUSE";
const rqMessage = stale ? "This transfer request was refreshed from its Item Assembly after you opened it: close it, open it again and pick again."
  : t.decision === "REFUSE" ? t.message : rq === "REFUSE" ? "A transfer request is dispatched, received and cancelled from the web form (Location Transfer)." : "";
return { rq: rq, rqMessage: rqMessage };"""


def build():
    base = BC.build()
    base_text = render(V.wrap_doc_sql(copy.deepcopy(base)))
    assert hashlib.md5(base_text.encode("utf-8")).hexdigest() == BASE_MD5, "smv2's build is no longer the deployed v85"
    for nid in NEW_IDS:
        assert '"%s"' % nid not in base_text, nid + " already in v85"
    doc = copy.deepcopy(base)
    at = BC.index(doc)
    taken = BC.keys_of(doc, set())
    rng = random.Random(20261028)

    def key():
        while True:
            k = "".join(rng.choice(string.ascii_lowercase + string.digits) for _ in range(8))
            if k not in taken and not k.isdigit():
                taken.add(k)
                return k

    def title(t):
        return {"title": t, "isValidator": True, "nodeName": t, "name": t}

    def resp(names):
        return [{"key": key(), "name": n, "title": n, "description": "", "bsonType": "string", "isExpand": False, "children": []} for n in names]

    # the stored row's purpose
    sq = at["sql_node_LOTguard"]["data"]
    assert sq["script"]["code"].count(SQL_OLD) == 1
    sq["script"]["code"] = sq["script"]["code"].replace(SQL_OLD, SQL_NEW)
    sq["response_json"] = sq["response_json"] + resp(["transfer_purpose", "line_ids"])
    # the decision + its refusal, right after the v85 guard (busy / In Progress to Draft / size answer first)
    rq = {"language": "javascript", "code": "", "timeout": 30000}
    rq.update(title("IA transfer request: the allowed moves of a request transfer"))
    rq["script"] = {"type": "javascript", "code": RQ_JS.replace("/*@@IATR_RULES@@*/", rules_js())}
    rq["response_json"] = resp(["rq", "rqMessage"])
    fid = 1797700000001
    assert str(fid)[:11] not in base_text
    ifd = title("IF a request transfer's move is refused here")
    ifd.update({"condition_type": "Expression",
                "filter": {"list": [{"id": fid, "parentId": fid + 1, "isTop": True, "prop": "", "operator": "", "valueType": "", "value": "", "type": "leaf", "level": 1}]},
                "expression": {"type": "javascript", "code": "'{{node:code_node_LOTrq.data.rq}}' == 'REFUSE'"}})
    r = copy.deepcopy(at["return_node_LOTreconShort"])
    r["id"] = "return_node_LOTrqRefuse"
    r["data"].update(title("Return Request Move Refused"))
    lst = r["data"]["response_value"]["list"]
    assert [p["prop"] for p in lst] == ["code", "message"] and lst[0]["value"] == "400"
    lst[1]["valueType"] = "field"
    lst[1]["value"] = "{{node:code_node_LOTrq.data.rqMessage}}"
    new_nodes = [{"id": "code_node_LOTrq", "type": "code-node", "data": rq, "blocks": []},
                 {"id": "if_LOTrqRefuse", "type": "if", "data": ifd,
                  "blocks": [{"id": "ifBlock_TLOTrqRefuse", "type": "ifBlock", "data": {"title": "true"}, "blocks": [r]},
                             {"id": "ifBlock_FLOTrqRefuse", "type": "ifBlock", "data": {"title": "false"}, "blocks": []}]}]
    top = [n["id"] for n in doc["nodes"]]
    assert top[1:5] == ["code_node_LOTguard", "if_LOTguardRead", "if_LOTguardBigNew", "if_UCLsQLO6"], top[:6]
    doc["nodes"][4:4] = new_nodes
    # Save Picks keeps the status: writeStatus in yPlLXIZW, written by the Draft update
    y = BC.index(doc)["code_node_yPlLXIZW"]["data"]
    for old, new in ((Y_OLD, Y_NEW), (YR_OLD, YR_NEW)):
        assert y["script"]["code"].count(old) == 1, old
        y["script"]["code"] = y["script"]["code"].replace(old, new)
    y["response_json"] = y["response_json"] + resp(["writeStatus"])
    w = BC.index(doc)["update_node_WKLUE7ka"]["data"]["props"]["list"]
    st = [p for p in w if p["prop"] == "stock_movement_status"]
    assert len(st) == 1 and st[0]["value"] == W_OLD and st[0]["valueType"] == "field"
    st[0]["value"] = W_NEW
    got = BC.index(doc)
    assert sorted(set(got) - set(BC.index(base))) == sorted(NEW_IDS), sorted(set(got) - set(BC.index(base)))
    return doc


if __name__ == "__main__":
    doc = V.wrap_doc_sql(build())
    text = render(doc)
    path = os.path.join(OUT, "SM_LOCATION_TRANSFER.json")
    print("SM_LOCATION_TRANSFER v86: %d chars, md5 %s%s" % (len(text), hashlib.md5(text.encode("utf-8")).hexdigest(), " -> " + path if "--write" in sys.argv else " (dry)"))
    if "--write" in sys.argv:
        os.makedirs(OUT, exist_ok=True)
        open(path, "w", encoding="utf-8").write(text)
