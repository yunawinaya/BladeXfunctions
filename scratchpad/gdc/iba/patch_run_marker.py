"""patch_run_marker.py [--write] [--out <file>]: INVENTORY_BULK_APPLY v12 on v11 (Balance Table/INVENTORY_BULK_APPLY.json): a per-operation
run marker, so a second APPLY of the same operation_key can no longer run alongside a live first one (found by bladexfunctions-8c, 10-21:
a caller's lease that ends mid-APPLY lets its worker call APPLY again; the claim reads the op's own keys as HELD and both runs write the
rows the first has not written yet -> duplicate movements / FIFO layers / balance rows; with v11 a replay could also GIVE alongside the
first run's own release).
- Marker rows: gd_publish_step IBA|RUN|nnn (one per generation), result_ref = the run's nonce, step_status RUNNING -> ENDED, heartbeat in
  finished_at. code_node_IBstate (sql_node_IBops now reads id + heartbeat) answers runGate: BUSY when the latest generation is RUNNING
  with a heartbeat younger than 20 min (another call is alive: 409 LOCK_BUSY, which every caller already retries), CLAIM otherwise (this
  call inserts the next generation: a twin insert of the same generation fails its run), SKIP for PLAN and REVIEW (they write nothing).
- Heartbeats: after the lock take (verify), before the writes (with the fence) and before the GIVE (the long phases are the TAKE and
  the GIVE: ~10 min at the 5,000-movement cap on the slowed dev, half the 20 min).
- Fence before the first write: a run whose generation is no longer the latest (a later call took over a marker it found stale)
  answers 409 and writes nothing.
- Every way out of a CLAIM run marks its own generation ENDED (busy, superseded, replay, the end), so lock-wait retries are not held up.
Exact edits on the repo JSON; every anchor must match once."""
import copy
import json
import re
import sys

R = "/Users/yunawinaya/Developer/BladeXfunctions/"
F = R + "Balance Table/INVENTORY_BULK_APPLY.json"
STEP_TABLE = {"source": "GD Publish Step:Table:2105131615547461634", "rules": {"collectionId": "2105131615547461634", "list": []}}
G = "code_node_IBguard"
ST = "code_node_IBstate"

STATE = """// INVENTORY_BULK_APPLY state: DONE -> replay its stored answer; REVIEW -> stop; intent rows -> resume; else fresh. Run marker
// IBA|RUN|nnn (heartbeat in finished_at): the latest generation RUNNING with a heartbeat under 20 min = another call of this operation
// is alive -> BUSY; else this APPLY call takes the next generation (CLAIM); PLAN and REVIEW write nothing (SKIP)
const s = (v) => (v === undefined || v === null ? "" : String(v));
const RUN_STALE_S = 1200;
const rows = [{{node:sql_node_IBops.data}}][0];
const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
const mode = s([{{node:code_node_IBguard.data.mode}}][0]);
let done = null;
let review = null;
let mark = null;
const intent = [];
let dbNow = "";
for (const r of list) {
  if (!r) continue;
  if (!dbNow && r.db_now) dbNow = s(r.db_now);
  const name = s(r.step_name);
  if (name === "IBA|DONE") done = r;
  else if (name === "IBA|REVIEW") review = r;
  else if (name.indexOf("IBA|I|") === 0) intent.push(r);
  else if (name.indexOf("IBA|RUN|") === 0) {
    const g = parseInt(name.slice(8), 10) || 0;
    if (!mark || g > mark.gen) mark = { gen: g, status: s(r.step_status), hb: s(r.heartbeat) };
  }
}
intent.sort((a, b) => (s(a.step_name) < s(b.step_name) ? -1 : 1));
let route = "FRESH";
if (mode === "PLAN") route = "PLAN";
else if (done) route = "REPLAY";
else if (review) route = "REVIEW";
else if (intent.length) route = "RESUME";
let stored = {};
if (done) {
  try {
    stored = JSON.parse(s(done.result_ref) || "{}");
  } catch (e) {
    stored = {};
  }
}
const at = (v) => Date.parse(s(v).replace(" ", "T"));
const age = mark && mark.hb && dbNow ? (at(dbNow) - at(mark.hb)) / 1000 : Infinity;
const live = !!mark && mark.status === "RUNNING" && age < RUN_STALE_S;
const runGate = mode !== "APPLY" || route === "REVIEW" ? "SKIP" : live ? "BUSY" : "CLAIM";
const gen = (mark ? mark.gen : 0) + 1;
return {
  route: route,
  dbNow: dbNow,
  intentText: intent.map((r) => s(r.result_ref)).join(""),
  intentParts: String(intent.length),
  storedResults: stored.results || [],
  storedSummary: stored.summary || {},
  reviewReason: review ? s(review.error_message) : "",
  runGate: runGate,
  runGen: String(gen),
  runStep: "IBA|RUN|" + String(gen).padStart(3, "0"),
  runMessage: live ? "the same operation is still running (run " + mark.gen + ", last heartbeat " + mark.hb + "); try again later" : "",
};
"""
RUN_ROW = """// INVENTORY_BULK_APPLY run marker: this call's generation (unique job / step: a twin call inserting the same generation fails its run)
const s = (v) => (v === undefined || v === null ? "" : String(v));
const st = [{{node:code_node_IBstate.data}}][0] || {};
return { rows: [{ job_id: s([{{node:code_node_IBguard.data.operationKey}}][0]), organization_id: s([{{node:code_node_IBguard.data.organizationId}}][0]),
  step_name: s(st.runStep), step_status: "RUNNING", attempt_count: 0, result_ref: s([{{node:code_node_IBguard.data.nonce}}][0]), started_at: s(st.dbNow),
  finished_at: s(st.dbNow), error_code: "", error_message: "" }] };
"""
RUN_ME = """// INVENTORY_BULK_APPLY run marker read back: the row id the heartbeats and the end update, and that it carries this run's nonce
const s = (v) => (v === undefined || v === null ? "" : String(v));
const rows = [{{node:sql_node_IBrunMe.data}}][0];
const r = (Array.isArray(rows) ? rows : rows ? [rows] : [])[0] || {};
const own = s(r.result_ref) !== "" && s(r.result_ref) === s([{{node:code_node_IBguard.data.nonce}}][0]) && /^[0-9]{1,20}$/.test(s(r.id));
return { own: own ? "YES" : "NO", runId: own ? s(r.id) : "", dbNow: s(r.db_now) };
"""
FENCE = """// INVENTORY_BULK_APPLY fence before the first write: this run's generation must still be the latest; a later call that found its
// heartbeat stale took over -> write nothing. If that later run already ENDED with the operation DONE, every key this operation
// still holds was taken by this run after that run gave its keys back -> this run gives them back; else they are the later run's
const s = (v) => (v === undefined || v === null ? "" : String(v));
const rows = [{{node:sql_node_IBfence.data}}][0];
const r = (Array.isArray(rows) ? rows : rows ? [rows] : [])[0] || {};
const mine = s([{{node:code_node_IBstate.data.runGen}}][0]);
const latest = s(r.latest_gen);
const superseded = latest !== mine;
return { route: superseded ? "SUPERSEDED" : "OK", dbNow: s(r.db_now),
  release: superseded && s(r.latest_status) === "ENDED" && Number(r.done) > 0 ? "YES" : "NO",
  message: "superseded by a later call of the same operation (run " + latest + " after this run " + mine + "): nothing written" };
"""
SQL_ME = ("SELECT CAST(id AS CHAR) AS id, result_ref, DATE_FORMAT(NOW(3), '%Y-%m-%d %H:%i:%s') AS db_now\n"
          "  FROM gd_publish_step\n"
          " WHERE tenant_id = '{{node:code_node_IBguard.data.tenantId}}'\n"
          "   AND job_id = '{{node:code_node_IBguard.data.operationKey}}'\n"
          "   AND step_name = '{{node:code_node_IBstate.data.runStep}}'\n"
          "   AND is_deleted = 0")
SQL_FENCE = ("SELECT CAST(MAX(CASE WHEN p.step_name LIKE 'IBA|RUN|%' THEN CAST(SUBSTRING(p.step_name, 9) AS UNSIGNED) END) AS CHAR) AS latest_gen,\n"
             "       SUBSTRING_INDEX(GROUP_CONCAT(CASE WHEN p.step_name LIKE 'IBA|RUN|%' THEN p.step_status END ORDER BY p.step_name DESC SEPARATOR ','), ',', 1) AS latest_status,\n"
             "       CAST(SUM(p.step_name = 'IBA|DONE') AS CHAR) AS done,\n"
             "       DATE_FORMAT(n.t, '%Y-%m-%d %H:%i:%s') AS db_now\n"
             "  FROM (SELECT NOW(3) AS t) n\n"
             "  LEFT JOIN gd_publish_step p\n"
             "    ON p.tenant_id = '{{node:code_node_IBguard.data.tenantId}}'\n"
             "   AND p.job_id = '{{node:code_node_IBguard.data.operationKey}}'\n"
             "   AND p.step_name LIKE 'IBA|%'\n"
             "   AND p.is_deleted = 0\n"
             " GROUP BY n.t")


def find(n, nid):
    if isinstance(n, dict):
        if n.get("id") == nid:
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


def parent_list(n, nid):
    """the blocks list that holds node nid"""
    if isinstance(n, dict):
        for k in ("nodes", "blocks"):
            if isinstance(n.get(k), list):
                if any(isinstance(x, dict) and x.get("id") == nid for x in n[k]):
                    return n[k]
                for x in n[k]:
                    r = parent_list(x, nid)
                    if r is not None:
                        return r
    return None


def once(text, old, new, what):
    assert text.count(old) == 1, "%s: anchor matches %d times" % (what, text.count(old))
    return text.replace(old, new)


def titled(n, title):
    for k in ("title", "nodeName", "name"):
        n["data"][k] = title
    return n


def rj(name, t="string"):
    return {"key": ("r" + name.lower().replace("_", ""))[:8].ljust(8, "0"), "name": name, "title": name, "description": "", "bsonType": t, "isExpand": False, "children": []}


def code_node(nid, title, code, outs, like):
    n = copy.deepcopy(like)
    n["id"] = nid
    n["data"]["script"]["code"] = code
    n["data"]["response_json"] = [o if isinstance(o, dict) else rj(o) for o in outs]
    return titled(n, title)


def sql_node(nid, title, code, outs, like, table=None):
    n = copy.deepcopy(like)
    n["id"] = nid
    n["data"]["script"]["code"] = code
    n["data"]["response_json"] = [rj(o) for o in outs]
    if table:
        n["data"]["table_id"] = copy.deepcopy(table)
        n["data"]["tableId"] = table["rules"]["collectionId"]
    return titled(n, title)


def if_node(nid, title, prop, value, blocks):
    return {"id": nid, "type": "if", "data": {"condition_type": "ConditionRule", "filter": {"list": [{"id": 1, "parentId": 0, "isTop": True, "type": "leaf", "prop": prop,
            "operator": "equal", "valueType": "value", "value": value, "level": 1}]}, "expression": {"type": "javascript", "code": ""},
            "javaExpression": {"type": "java", "code": ""}, "title": title, "nodeName": title, "name": title},
            "blocks": [{"type": "ifBlock", "data": {"title": "true"}, "blocks": blocks, "id": nid + "_ifBlock_0"},
                       {"type": "ifBlock", "data": {"title": "false"}, "blocks": [], "id": nid + "_ifBlock_1"}]}


def ret409(nid, message_ref):
    return {"id": nid, "type": "return-node", "data": {"title": "返回数据", "response_value": {"list": [
        {"prop": "code", "operator": "", "valueType": "value", "value": "409"},
        {"prop": "result_code", "operator": "", "valueType": "value", "value": "LOCK_BUSY"},
        {"prop": "message", "operator": "", "valueType": "field", "value": message_ref}]}, "return_raw_data": 0, "return_data": {}, "status_code": 200}}


def mark_update(nid, title, props):
    """gd_publish_step update of this run's own marker row (by id: update-node WHERE is not enforced, the id prop decides)"""
    ref = "{{node:code_node_IBrunMe.data.runId}}"
    lst = [{"prop": "id", "operator": "", "valueType": "field", "value": ref}] + [
        {"prop": p, "operator": "", "valueType": "value" if not v.startswith("{{") else "field", "value": v} for p, v in props]
    return {"id": nid, "type": "update-node", "data": {"table_id": {"source": STEP_TABLE["source"], "rules": {"collectionId": STEP_TABLE["rules"]["collectionId"], "list": [
        {"id": 1, "parentId": 0, "isTop": True, "type": "leaf", "prop": "id", "operator": "in", "valueType": "field", "value": ref, "level": 1}]}},
        "props": {"list": lst}, "title": title, "nodeName": title, "name": title}}


raw = open(F, encoding="utf-8").read()
doc = json.loads(raw)
assert find(doc, "sql_node_IBrunMe") is None, "already patched"
assert find(doc, "sql_node_IBrpRel") is not None, "not v11"
top = doc["nodes"]
ids_top = [n["id"] for n in top]

# 1. IBops reads each row's id and heartbeat; IBstate decides the run gate
ops = find(doc, "sql_node_IBops")
ops["data"]["script"]["code"] = once(ops["data"]["script"]["code"], "SELECT p.step_name, p.step_status, p.result_ref, p.error_message,\n",
                                     "SELECT p.step_name, p.step_status, p.result_ref, p.error_message, CAST(p.id AS CHAR) AS id,\n"
                                     "       DATE_FORMAT(p.finished_at, '%Y-%m-%d %H:%i:%s') AS heartbeat,\n", "IBops")
ops["data"]["response_json"] += [rj("id"), rj("heartbeat")]
st = find(doc, ST)
assert "else if (intent.length) route = \"RESUME\";" in st["data"]["script"]["code"], "IBstate is not v11's"
st["data"]["script"]["code"] = STATE
st["data"]["response_json"] += [rj("runGate"), rj("runGen"), rj("runStep"), rj("runMessage")]

# 2. the gate, right after IBstate: BUSY answers 409; CLAIM inserts this run's generation and reads its id back
like_code, like_sql, like_add = find(doc, "code_node_IBdone"), find(doc, "sql_node_IBops"), find(doc, "add_node_IBdone")
row = code_node("code_node_IBrunRow", "Run marker: this call's generation IBA|RUN|nnn (RUNNING, heartbeat = now)", RUN_ROW, [find(doc, "code_node_IBdone")["data"]["response_json"][0]], like_code)
add = copy.deepcopy(like_add)
add["id"] = "add_node_IBrun"
add["data"]["props"]["list"] = [{"prop": p, "operator": "", "valueType": "field", "value": "{{node:code_node_IBrunRow.data.rows.%s}}" % p}
                                for p in ("job_id", "organization_id", "step_name", "step_status", "attempt_count", "result_ref", "started_at", "finished_at", "error_code", "error_message")]
titled(add, "Run marker insert (unique job / step: a twin call of the same generation fails here)")
me_sql = sql_node("sql_node_IBrunMe", "Run marker read-back: its id and nonce", SQL_ME, ["id", "result_ref", "db_now"], like_sql)
me = code_node("code_node_IBrunMe", "Run marker: own it (nonce) -> the id the heartbeats update", RUN_ME, ["own", "runId", "dbNow"], like_code)
gate_busy = if_node("if_IBrunBusy", "IF another call of this operation is alive (run marker heartbeat < 20 min): answer 409, write nothing",
                    "node.%s.data.runGate" % ST, "BUSY", [ret409("return_node_IBrunBusy", "{{node:%s.data.runMessage}}" % ST)])
gate_lost = if_node("if_IBrunLost", "IF the marker read back is not this run's: answer 409, write nothing", "node.code_node_IBrunMe.data.own", "NO",
                    [ret409("return_node_IBrunLost", "another call of the same operation started at the same time; try again later")])
gate_claim = if_node("if_IBrunClaim", "IF APPLY (not REVIEW): take the next run generation", "node.%s.data.runGate" % ST, "CLAIM", [row, add, me_sql, me, gate_lost])
at = ids_top.index(ST) + 1
top[at:at] = [gate_busy, gate_claim]

# 3. replay: the run ends after its release
rp = find(doc, "if_IBreplay")["blocks"][0]["blocks"]
assert rp[-1]["id"] == "return_node_IBreplay"
rp.insert(len(rp) - 1, mark_update("update_node_IBrunEndRp", "Run marker: ENDED (replay)", [("step_status", "ENDED")]))

# 4. the take: heartbeat once the keys are held (IBlk3 reads the clock); a busy claim ends the run
lk3 = find(doc, "sql_node_IBlk3")
lk3["data"]["script"]["code"] = once(lk3["data"]["script"]["code"], "free_token, owner_operation_id, last_owner_operation_id\n",
                                     "free_token, owner_operation_id, last_owner_operation_id,\n       DATE_FORMAT(NOW(3), '%Y-%m-%d %H:%i:%s') AS db_now\n", "IBlk3")
lk3["data"]["response_json"].append(rj("db_now"))
lkv = find(doc, "code_node_IBlkv")
lkv["data"]["script"]["code"] = once(lkv["data"]["script"]["code"], 'return { route: lost.length ? "LOST" : "HELD", lost: lost.slice(0, 20).join(","), lostCount: String(lost.length) };',
                                     'const first = list.find((r) => r && r.db_now) || {};\n'
                                     'return { route: lost.length ? "LOST" : "HELD", lost: lost.slice(0, 20).join(","), lostCount: String(lost.length), dbNow: s(first.db_now) };', "IBlkv")
lkv["data"]["response_json"].append(rj("dbNow"))
lock_blocks = parent_list(doc, "code_node_IBlkv")
lock_blocks.insert(lock_blocks.index(lkv) + 1, mark_update("update_node_IBrunHb1", "Run marker heartbeat: the keys are held", [("finished_at", "{{node:code_node_IBlkv.data.dbNow}}")]))
busy = find(doc, "if_IBbusy")["blocks"][0]["blocks"]
assert busy[-1]["id"] == "return_node_IBbusy"
busy.insert(len(busy) - 1, mark_update("update_node_IBrunEndBusy", "Run marker: ENDED (busy)", [("step_status", "ENDED")]))

# 5. the fence + heartbeat before the first write; a run superseded by a later run that ENDED with the operation DONE gives back the
# keys it took after that run's release (a copy of v11's release block, taken before step 6 adds the GIVE heartbeat)
fence_sql = sql_node("sql_node_IBfence", "Fence: the latest run generation of this operation, its status, DONE, the clock", SQL_FENCE,
                     ["latest_gen", "latest_status", "done", "db_now"], like_sql)
fence = code_node("code_node_IBfence", "Fence: still the latest generation -> OK, else SUPERSEDED (release YES when the later run ENDED with DONE)", FENCE,
                  ["route", "dbNow", "release", "message"], like_code)
FZ = {"sql_node_IBrel": "sql_node_IBfzRel", "code_node_IBrelease": "code_node_IBfzRelease", "cor_IBrel2": "cor_IBfzRel2", "set_cache_IBrlIdx0": "set_cache_IBfzIdx0",
      "loop_IBrel": "loop_IBfzRel", "get_cache_IBrlIdx": "get_cache_IBfzIdx", "code_node_IBrlSlice": "code_node_IBfzSlice", "update_node_IBrel": "update_node_IBfzRel",
      "set_cache_IBrlIdxN": "set_cache_IBfzIdxN", "workflow_node_IBgive": "workflow_node_IBfzGive"}
fz_text = json.dumps([copy.deepcopy(find(doc, i)) for i in ("sql_node_IBrel", "code_node_IBrelease", "cor_IBrel2")], ensure_ascii=False)
for old, new in FZ.items():
    fz_text = re.sub(r"(?<![A-Za-z0-9_])%s(?![A-Za-z0-9])" % re.escape(old), new, fz_text)
fz_blocks = json.loads(fz_text.replace("iba_rl_", "iba_fz_"))
for n in fz_blocks:
    titled(n, "Superseded: " + n["data"]["title"])
fz_gate = copy.deepcopy(find(doc, "cor_IBrelease"))
fz_gate["id"] = "cor_IBfzRelease"
titled(fz_gate, "Superseded: keys this run took after the later run's release to give back?")
fz_yes, fz_no = fz_gate["blocks"]
fz_yes["id"], fz_no["id"] = "cor_IBfzRelease_condition-or-node-item_0", "cor_IBfzRelease_condition-or-node-item_1"
fz_yes["data"]["filter"]["list"][0]["prop"] = "node.code_node_IBfence.data.release"
fz_yes["blocks"], fz_no["blocks"] = fz_blocks, []
fenced = if_node("if_IBfenced", "IF a later call took this operation over: answer 409, write nothing", "node.code_node_IBfence.data.route", "SUPERSEDED",
                 [fz_gate, mark_update("update_node_IBrunEndFence", "Run marker: ENDED (superseded)", [("step_status", "ENDED")]),
                  ret409("return_node_IBfenced", "{{node:code_node_IBfence.data.message}}")])
hb2 = mark_update("update_node_IBrunHb2", "Run marker heartbeat: before the writes", [("finished_at", "{{node:code_node_IBfence.data.dbNow}}")])
ids_top = [n["id"] for n in top]
at = ids_top.index("if_IBplanOk") + 1
assert ids_top[at] == "cor_IBwrite", ids_top[at]
top[at:at] = [fence_sql, fence, fenced, hb2]

# 6. heartbeat before the GIVE; the end
rel = find(doc, "code_node_IBrelease")
rel["data"]["script"]["code"] = once(rel["data"]["script"]["code"], 'return { clearRows: clearRows, batches: batches, plusIds: plusIds, needRelease: plusIds.length ? "YES" : "NO" };',
                                     'return { clearRows: clearRows, batches: batches, plusIds: plusIds, needRelease: plusIds.length ? "YES" : "NO", dbNow: dbNow };', "IBrelease")
rel["data"]["response_json"].append(rj("dbNow"))
rel2 = find(doc, "cor_IBrel2")["blocks"][0]["blocks"]
assert rel2[0]["id"] == "set_cache_IBrlIdx0"
rel2.insert(0, mark_update("update_node_IBrunHb3", "Run marker heartbeat: before the GIVE", [("finished_at", "{{node:code_node_IBrelease.data.dbNow}}")]))
ids_top = [n["id"] for n in top]
assert ids_top[-2:] == ["return_node_IBend", "end"], ids_top[-3:]
end_gate = copy.deepcopy(find(doc, "cor_IBrelease"))
end_gate["id"] = "cor_IBrunEnd"
titled(end_gate, "Run marker to end?")
yes_item, no_item = end_gate["blocks"]
assert yes_item["key"] == "YES" and no_item["key"] == "default" and no_item["data"].get("isDefault")
yes_item["id"], no_item["id"] = "cor_IBrunEnd_condition-or-node-item_0", "cor_IBrunEnd_condition-or-node-item_1"
yes_item["data"]["filter"]["list"][0]["prop"] = "node.%s.data.runGate" % ST
yes_item["data"]["filter"]["list"][0]["value"] = "CLAIM"
yes_item["blocks"] = [mark_update("update_node_IBrunEnd", "Run marker: ENDED", [("step_status", "ENDED")])]
no_item["blocks"] = []
top.insert(len(top) - 2, end_gate)

# the copied release block of v11's replay is untouched; every node id stays unique
ids = []


def walk(n):
    if isinstance(n, dict):
        if isinstance(n.get("id"), str):
            ids.append(n["id"])
        for v in n.values():
            walk(v)
    elif isinstance(n, list):
        for v in n:
            walk(v)


walk(doc)
dup = sorted({i for i in ids if ids.count(i) > 1})
assert not dup, "duplicate node ids: %s" % dup
print("INVENTORY_BULK_APPLY v12: run marker (gate %s, claim %s, fence, 3 heartbeats, 5 ends)" % (gate_busy["id"], gate_claim["id"]))
out = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else (F if "--write" in sys.argv else None)
if out:
    open(out, "w", encoding="utf-8").write(json.dumps(doc, ensure_ascii=False, indent=1) + ("\n" if raw.endswith("\n") else ""))
    print("wrote", out)
