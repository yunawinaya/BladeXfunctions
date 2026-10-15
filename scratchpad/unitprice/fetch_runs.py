"""Pulls recorded GET_ITEM_UNIT_PRICE runs (v52 onwards) READ-ONLY into the fixtures dir (customer data: never in the repo).
Per run: params, response, config + item-list node outputs, the org of the session, and the executed node-id sequence.
usage: python3 fetch_runs.py --prod|--dev [batch]"""
import json, os, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "grv2"))
from dbq import q

FX = "/private/tmp/claude-501/-Users-yunawinaya-Developer-BladeXfunctions/3184bace-c1a2-43fd-9910-40a12d531785/scratchpad/unitprice_fx"
WF = "2067818102244966401"
V52 = 2102249372644278272
env = "--prod" if "--prod" in sys.argv else "--dev"
batch = int(([a for a in sys.argv[1:] if a.isdigit()] or ["150"])[0])
out = os.path.join(FX, "runs_%s.jsonl" % env.strip("-"))

SQL = """SELECT CAST(w.id AS CHAR) AS id, w.status, w.tenant_id, CAST(w.create_time AS CHAR) AS ct, w.run_time, w.current_node_id AS cur,
       LEFT(w.error_msg, 400) AS err,
       IF(JSON_VALID(w.request_json_data), CAST(JSON_EXTRACT(w.request_json_data, '$.request_json') AS CHAR), NULL) AS req,
       w.response_json_data AS resp,
       (SELECT CAST(JSON_OBJECTAGG(t.node_id, t.r) AS CHAR)
          FROM JSON_TABLE(IF(JSON_VALID(w.nodes_data), w.nodes_data, '[]'), '$[*]' COLUMNS (node_id VARCHAR(64) PATH '$.node_id', r LONGTEXT PATH '$.response_json_data')) t
         WHERE t.node_id IN ('get_node_eYdZ327G', 'sql_node_ItemUomPrices', 'code_node_kaS0Zdzg')) AS nd,
       (SELECT JSON_UNQUOTE(JSON_EXTRACT(t.r, '$.variableMap."global:firstLvDeptId"'))
          FROM JSON_TABLE(IF(JSON_VALID(w.nodes_data), w.nodes_data, '[]'), '$[*]' COLUMNS (node_id VARCHAR(64) PATH '$.node_id', r LONGTEXT PATH '$.request_json_data')) t
         WHERE t.node_id = 'code_node_BMyh49Gb' LIMIT 1) AS org,
       (SELECT CAST(JSON_ARRAYAGG(t.node_id) AS CHAR)
          FROM JSON_TABLE(IF(JSON_VALID(w.nodes), w.nodes, '[]'), '$[*]' COLUMNS (node_id VARCHAR(64) PATH '$.node_id')) t) AS trace
  FROM su_code_workflow_inst w
 WHERE w.workflow_id = %s AND w.id > %s AND w.id >= %d
 ORDER BY w.id
 LIMIT %d"""

done = set()
last = "0"
if os.path.exists(out):
    for line in open(out):
        r = json.loads(line)
        done.add(r["id"])
        last = max(last, r["id"], key=int)
t0 = time.time()
n = 0
with open(out, "a") as f:
    while True:
        for attempt in range(6):
            try:
                rows = q(env, SQL % (WF, last, V52, max(10, batch >> attempt)))
                break
            except RuntimeError as e:
                print("retry", attempt, str(e)[-200:], flush=True)
                time.sleep(3)
        else:
            raise SystemExit("gave up at " + last)
        if not rows:
            break
        for r in rows:
            if r["id"] not in done:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
                n += 1
        last = rows[-1]["id"]
        f.flush()
        print("%d runs, last %s, %.0fs" % (n, last, time.time() - t0), flush=True)
        if len(rows) < 10:
            break
print("done", n, "new runs ->", out)
