"""patch_submit_so_guard.py: GD_ASYNC_SUBMIT refuses a new save (CREATE) or a confirmation (CONFIRM) while another
unfinished CREATE_GD_FROM_FORM save delivers one of its sales orders (user, 2026-10-19: converting an SO again while its
first delivery is still saving in the background must not double it).

Structure: after the invalid-input return, a plan node builds the digits-only source_so_ids filter; the existing job read
and the new same-SO read then run in parallel (one round trip); after the IDEMPOTENCY_KEY_REUSED return, a decision node and
an if-node answer the refusal. The repo file is rendered the way it is kept: Prettier --parser json of the compact dump.

usage: python3 patch_submit_so_guard.py [--write]
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "pkv2tools"))
import wfkit as K  # noqa: E402

R = "/Users/yunawinaya/Developer/BladeXfunctions/"
P = R + "Goods Delivery/AsyncV2/GD_ASYNC_SUBMIT.json"
PRETTIER = os.path.expanduser("~/.npm/_npx/b388654678d519d9/node_modules/prettier/bin/prettier.cjs")
RES = ["result_code", "result_message", "job_id", "job_status", "created", "idempotency_key", "payload_hash", "gd_id", "gd_no",
       "progress_message", "line_errors", "evidence"]


def render(doc):
    compact = json.dumps(doc, ensure_ascii=False, separators=(",", ":"))
    return subprocess.run(["node", PRETTIER, "--parser", "json"], input=compact, capture_output=True, text=True, check=True).stdout


raw = open(P, encoding="utf-8").read()
doc = json.loads(raw)
assert render(doc) == raw, "the repo file does not round-trip: refusing to re-render it"
ids_in_doc = json.dumps(doc)
for nid in ("code_node_GSsoPlan", "condition_all_GSread", "sql_node_GSsoBusy", "code_node_GSsoBusy", "if_GSsoBusy"):
    assert '"%s"' % nid not in ids_in_doc, nid + " already present"

nodes = doc["nodes"]
pos = {n.get("id"): i for i, n in enumerate(nodes)}
for nid in ("if_zzJqDH2R", "sql_node_GZBo7WZi", "code_node_iJTFTwP3", "if_bvSzR8Mu", "condition_or_node_t7FDaGor"):
    assert nid in pos, nid + " not at the top level"
assert pos["if_zzJqDH2R"] + 1 == pos["sql_node_GZBo7WZi"] and pos["sql_node_GZBo7WZi"] + 1 == pos["code_node_iJTFTwP3"]
assert pos["if_bvSzR8Mu"] + 1 == pos["condition_or_node_t7FDaGor"]

code = lambda f: open(os.path.join(HERE, "code", f), encoding="utf-8").read().rstrip("\n")
SQL = """SELECT CAST(j.id AS CHAR) AS job_id,
       j.job_status,
       j.source_so_no
  FROM gd_async_job j
 WHERE j.tenant_id = '{{node:code_node_EluyWNR5.data.tenantId}}'
   AND j.organization_id = '{{node:code_node_EluyWNR5.data.organizationId}}'
   AND j.command = 'CREATE_GD_FROM_FORM'
   AND j.is_deleted = 0
   AND j.job_status IN ('QUEUED', 'VALIDATING', 'CALCULATING', 'READY_TO_COMMIT', 'COMMITTING_GD', 'RECONCILING_GD', 'REQUIRES_REVIEW')
   AND j.idempotency_key <> '{{node:code_node_EluyWNR5.data.idempotencyKey}}'
   AND {{node:code_node_GSsoPlan.data.soLikeSql}}
 ORDER BY j.id
 LIMIT 5"""

ids = K.Ids(1798300000000)
plan = K.code("code_node_GSsoPlan", "Same sales order guard (plan): this save's sales orders as a digits-only filter", code("so_plan.js"),
              ["soCount", "soLikeSql"])
same_so = K.sql("sql_node_GSsoBusy", "Other unfinished saves (CREATE_GD_FROM_FORM) delivering one of its sales orders", SQL,
                ["job_id", "job_status", "source_so_no"])
read = K.parallel("condition_all_GSread", "Reads in parallel: this save's job by key + other unfinished saves of its sales orders", [
    ("condition_all_GSread_item_0", "This save's job", [nodes[pos["sql_node_GZBo7WZi"]]]),
    ("condition_all_GSread_item_1", "Same sales orders", [same_so]),
])
busy = K.code("code_node_GSsoBusy", "Same sales order guard (decision): CREATE / CONFIRM while another save delivers its order -> refuse",
              code("so_busy.js"), ["route"] + RES)
refuse = K.if_(ids, "if_GSsoBusy", "IF another unfinished save delivers the same sales order: answer, write nothing",
               "'{{node:code_node_GSsoBusy.data.route}}' == 'BUSY'",
               [K.ret("return_node_GSsoBusy", "Return (same sales order still saving, nothing written)",
                      [(f, "{{node:code_node_GSsoBusy.data.%s}}" % f) for f in RES])])

new_nodes = nodes[:pos["sql_node_GZBo7WZi"]] + [plan, read] + nodes[pos["code_node_iJTFTwP3"]:pos["if_bvSzR8Mu"] + 1] + [busy, refuse] + nodes[pos["condition_or_node_t7FDaGor"]:]
assert len(new_nodes) == len(nodes) - 1 + 4
doc["nodes"] = new_nodes
out = render(doc)
json.loads(out)
if "--write" in sys.argv:
    open(P, "w", encoding="utf-8").write(out)
    print("patched", P)
else:
    print("ok (dry): pass --write")
