# PACKING_BULK_COMMIT (dev v9 = prod v10): the run ends right after the stock call. INVENTORY_APPLY_OPERATION's key locks
# (platform atomic-count rows) are held until the TOP-LEVEL run ends, so the box stamps, the reservations and phase B used
# to run under them (~25-30 s on a big Packing). code_node_KCp1after now answers a call that ended DONE with a hand-over
# (job due now, no lease) through its existing END branch; the next run's P1 plan reads the operation DONE -> CONTINUE.
# Usage: python3 -I patch_commit.py   (edits Packing/AsyncV2/PACKING_BULK_COMMIT.json in place, from base/PACKING_BULK_COMMIT.v9.json)
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
BASE = os.path.join(HERE, "base", "PACKING_BULK_COMMIT.v9.json")
TARGET = os.path.join(REPO, "Packing", "AsyncV2", "PACKING_BULK_COMMIT.json")

OLD_TAIL = """const res = commitP1After([{{node:code_node_KCentry.data}}][0], [{{node:code_node_KCp1plan.data}}][0], [{{node:code_node_KCp1resp.data}}][0], [{{node:sql_node_KCp1after.data}}][0]);
console.log("commit P1 after", JSON.stringify({ route: res.route, action: res.action, code: res.resultCode, status: res.opStatus, message: res.result_message }));
return res;"""
NEW_TAIL = """// the stock call is this run's last write: the platform keeps the call's key locks until the run that took them ends, so a
// call that ended DONE hands over (due now, no lease) - the box stamps, the reservations and phase B are the next run's
const handOver = function handOver(entry, res) {
  if (res.route !== "CONTINUE") return res;
  return Object.assign(res, { route: "END", action: "HANDOVER", needStepAdd: "NO", needStepUpd: "NO", needUnlock: "NO",
    jobRows: [{ id: entry.jobId, job_status: "COMMITTING_PACKING", progress_percent: 75, progress_message: "Stock moved into the handling units; finishing the Packing",
      attempt_count: entry.attempts, next_attempt_at: endNow(entry), lease_owner: null, lease_expires_at: null, row_version: (Number(entry.rowVersion) || 0) + 2,
      error_code: null, error_message: null, error_details: null, finished_at: null }],
    needJobUpd: "YES", result_code: "PK_STOCK_MOVED", result_message: res.result_message + "; the next run stamps the boxes and finishes", job_status: "COMMITTING_PACKING" });
};
const entry = [{{node:code_node_KCentry.data}}][0];
const res = handOver(entry, commitP1After(entry, [{{node:code_node_KCp1plan.data}}][0], [{{node:code_node_KCp1resp.data}}][0], [{{node:sql_node_KCp1after.data}}][0]));
console.log("commit P1 after", JSON.stringify({ route: res.route, action: res.action, code: res.resultCode, status: res.opStatus, message: res.result_message }));
return res;"""
OLD_TITLE = "P1 decision after the call: DONE -> continue; else wait / retry / clean failure / review"
NEW_TITLE = "P1 decision after the call: DONE -> hand over to the next run; else wait / retry / clean failure / review"

raw = open(BASE, encoding="utf-8").read()
doc = json.loads(raw)


def node(o, nid):
    if isinstance(o, dict):
        if o.get("id") == nid:
            return o
        for v in o.values():
            r = node(v, nid)
            if r is not None:
                return r
    elif isinstance(o, list):
        for v in o:
            r = node(v, nid)
            if r is not None:
                return r
    return None


n = node(doc, "code_node_KCp1after")
old = n["data"]["script"]["code"]
assert old.count(OLD_TAIL) == 1, "the base's KCp1after tail changed"
new = old.replace(OLD_TAIL, NEW_TAIL).replace("// P1 decision after the call: DONE -> continue;", "// P1 decision after the call: DONE -> hand over to the next run;")
keys = {k["name"] for k in n["data"].get("response_json") or [] if isinstance(k, dict) and k.get("name")} if isinstance(n["data"].get("response_json"), list) else set()
for k in ("route", "action", "jobRows", "needJobUpd", "needStepAdd", "needStepUpd", "needUnlock", "result_code", "result_message", "job_status"):
    assert not keys or k in keys, "response_json lacks " + k
enc_old, enc_new = json.dumps(old, ensure_ascii=False), json.dumps(new, ensure_ascii=False)
assert raw.count(enc_old) == 1
raw = raw.replace(enc_old, enc_new)
for t_old, t_new in ((json.dumps(OLD_TITLE), json.dumps(NEW_TITLE)),):
    raw = raw.replace(t_old, t_new)
json.loads(raw)
open(TARGET, "w", encoding="utf-8").write(raw)
print("COMMIT: code_node_KCp1after hands over after a DONE call; titles renamed", raw.count(json.dumps(NEW_TITLE)), "x")
