"""patch_so_save_commit.py [--write]: GD Edit V2 final fixes I1 + I2 - SO_SAVE (Sales Order/SOsaveWorkflow.json, dev v169 base).
I1: the final release loop commits each released GD edit in this save (GD_EDIT_WORKER on the job, as loop_node_GdeCommitA
    does before pass B), so a released edit never waits for a client to start the worker (mobile, the SQT cascade);
I2: after the loop, only when the save released any, the jobs' outcome is read once (sql_node_GdeOutcome) and every edit
    that did not complete becomes a note (code_node_GdeNotes); the answer hands them to the form as data.gdEditNotes.
Prints what changes; writes only with --write. The file round-trips json.dumps(indent=2)."""
import json
import sys

R = "/Users/yunawinaya/Developer/BladeXfunctions/"
PATH = R + "Sales Order/SOsaveWorkflow.json"


def find(lst, nid):
    for n in lst or []:
        if n.get("id") == nid:
            return n
        r = find(n.get("blocks"), nid)
        if r:
            return r
    return None


def clone(o):
    return json.loads(json.dumps(o))


def once(text, old, new, what):
    assert text.count(old) == 1, "%s: %d matches" % (what, text.count(old))
    return text.replace(old, new)


def field(key, name, bson="any"):
    return {"key": key, "name": name, "title": name, "description": "", "bsonType": bson, "isExpand": False, "children": []}


def titled(n, title):
    n["data"].update({"title": title, "nodeName": title, "name": title})
    return n


OUTCOME_SQL = """SELECT CAST(j.id AS CHAR) AS id, j.job_status, j.error_code, j.error_message
  FROM gd_async_job j
 WHERE j.tenant_id = '{{system:tenantId}}'
   AND j.id IN ({{node:code_node_GdeRelease.data.jobIdsSql}})
   AND j.is_deleted = 0"""

NOTES_JS = """// GD Edit V2: each released edit was committed in this save; one that did not complete is reported (the sales order is saved)
const s = (v) => (v === undefined || v === null ? "" : String(v));
const jobs = [{{node:code_node_GdeRelease.data.jobs}}][0] || [];
const rows = [{{node:sql_node_GdeOutcome.data}}][0] || [];
const byId = {};
for (const r of Array.isArray(rows) ? rows : [rows]) if (r) byId[s(r.id)] = r;
const notes = [];
for (const j of Array.isArray(jobs) ? jobs : []) {
  const r = byId[s(j.job_id)] || {};
  const no = s(j.gd_no) || s(j.gd_id);
  const st = s(r.job_status);
  if (st === "COMPLETED") continue;
  if (st === "FAILED" || st === "CANCELLED") notes.push("Goods Delivery " + no + " was not updated: " + (s(r.error_message) || s(r.error_code) || st) + ". Change the delivery itself.");
  else if (st === "REQUIRES_REVIEW") notes.push("Goods Delivery " + no + " stopped half-way and is under review: please contact support.");
  else notes.push("Goods Delivery " + no + " is still being updated in the background.");
}
return { notes: notes };
"""


def patch(doc):
    nodes = doc["nodes"]
    top = [n["id"] for n in nodes]

    rel = find(nodes, "code_node_GdeRelease")
    c = rel["data"]["script"]
    c["code"] = once(c["code"], """return { jobs: jobs, jobIds: jobs.map((j) => String(j.job_id)) };""",
                     """const ids = jobs.map((j) => String(j.job_id));
return { jobs: jobs, jobIds: ids, jobIdsSql: ids.length ? ids.join(",") : "0", any: ids.length ? "YES" : "NO" };""", "release list: ids for the read")
    rel["data"]["response_json"] += [field("so_gde_rel_sql", "jobIdsSql", "string"), field("so_gde_rel_any", "any", "string")]

    loop = find(nodes, "loop_node_GdeRelease")
    assert [b["id"] for b in loop["blocks"]] == ["wf_GdeRelease"], [b["id"] for b in loop["blocks"]]
    commit = titled(clone(find(nodes, "wf_GdeCommitA")), "GD Edit V2: commit it now (GD_EDIT_WORKER on the job)")
    commit["id"] = "wf_GdeCommit"
    bp = commit["data"]["body_params"]["list"]
    assert len(bp) == 1 and bp[0]["prop"] == "job_id" and bp[0]["value"] == "{{node:wf_GdeReleaseA.data.job_id}}", bp
    bp[0]["value"] = "{{node:wf_GdeRelease.data.job_id}}"
    ifr = titled(clone(find(nodes, "if_GdeReleasedA")), "IF released")
    ifr["id"] = "if_GdeReleased"
    leaf = ifr["data"]["filter"]["list"]
    assert len(leaf) == 1 and leaf[0]["prop"] == "node.wf_GdeReleaseA.data.route", leaf
    leaf[0].update({"id": 195000000010, "parentId": 195000000011, "prop": "node.wf_GdeRelease.data.route"})
    ifr["blocks"][0].update({"id": "if_GdeReleased_t", "blocks": [commit]})
    ifr["blocks"][1].update({"id": "if_GdeReleased_f", "blocks": []})
    loop["blocks"].append(ifr)

    sql = titled(clone(find(nodes, "sql_node_CascadeDocs")), "GD Edit V2: the released edits' outcome")
    sql["id"] = "sql_node_GdeOutcome"
    sql["data"]["script"] = {"type": "sql", "code": OUTCOME_SQL}
    sql["data"]["response_json"] = [field("so_gde_out_id", "id", "string"), field("so_gde_out_st", "job_status", "string"), field("so_gde_out_ec", "error_code", "string"),
                                    field("so_gde_out_em", "error_message", "string")]
    notes = titled(clone(rel), "GD Edit V2: the released edits that did not complete, as notes for the form")
    notes["id"] = "code_node_GdeNotes"
    notes["data"]["script"] = {"type": "javascript", "code": NOTES_JS}
    notes["data"]["response_json"] = [field("so_gde_notes", "notes", "array")]
    ifo = titled(clone(find(nodes, "if_GdeReleasedA")), "IF this save released any GD edit")
    ifo["id"] = "if_GdeOutcome"
    leaf = ifo["data"]["filter"]["list"]
    leaf[0].update({"id": 195000000020, "parentId": 195000000021, "prop": "node.code_node_GdeRelease.data.any", "value": "YES", "propLabel": "any"})
    ifo["blocks"][0].update({"id": "if_GdeOutcome_t", "blocks": [sql, notes]})
    ifo["blocks"][1].update({"id": "if_GdeOutcome_f", "blocks": []})
    nodes.insert(top.index("loop_node_GdeRelease") + 1, ifo)

    ans = find(nodes, "code_node_xtWJshxF")
    a = ans["data"]["script"]
    a["code"] = once(a["code"], """gdEditJobs: [{{node:code_node_GdeRelease.data.jobIds}}][0] || []""",
                     """gdEditJobs: [{{node:code_node_GdeRelease.data.jobIds}}][0] || [],
    // GD Edit V2: the released edits that did not complete
    gdEditNotes: [{{node:code_node_GdeNotes.data.notes}}][0] || []""", "answer: notes")
    return ["code_node_GdeRelease (+ jobIdsSql, any)", "loop_node_GdeRelease (+ if_GdeReleased -> wf_GdeCommit)",
            "if_GdeOutcome -> sql_node_GdeOutcome, code_node_GdeNotes (new, after the loop)", "code_node_xtWJshxF (data.gdEditNotes)"]


if __name__ == "__main__":
    raw = open(PATH, encoding="utf-8").read()
    doc = json.loads(raw)
    assert json.dumps(doc, ensure_ascii=False, indent=2) + "\n" == raw, "the file does not round-trip json.dumps(indent=2)"
    changed = patch(doc)
    out = json.dumps(doc, ensure_ascii=False, indent=2) + "\n"
    print("SO_SAVE ->", ", ".join(changed), "| %d -> %d chars" % (len(raw), len(out)))
    if "--write" in sys.argv:
        open(PATH, "w", encoding="utf-8").write(out)
        print("written")
    else:
        print("dry run (--write to save)")
