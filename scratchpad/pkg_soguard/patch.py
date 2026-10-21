# Packing refuses while a background SO save (SO Save V2: command SAVE_SO, correlation SO|<so>) is open on an SO of the
# delivery. Reads gd_async_job only, not sales_order.is_processing, so it cannot break where that column is missing.
# Raw-text edits keep the repo files' own format. Usage: python3 patch.py <out dir>
import json, os, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "out")
os.makedirs(OUT, exist_ok=True)


def sub1(text, old, new, what):
    n = text.count(old)
    if n != 1:
        sys.exit(f"{what}: expected 1 match, found {n}")
    return text.replace(old, new)


def esc(s):
    return json.dumps(s)[1:-1]


# --- PACKING_ASYNC_SUBMIT ---
src = os.path.join(ROOT, "Packing/AsyncV2/PACKING_ASYNC_SUBMIT.json")
t = open(src).read()
T = "{{node:code_node_KSguard.data.tenantId}}"
so_sql = f"""       (SELECT CONCAT(CAST(j.id AS CHAR), '|', j.job_status, '|',
                      COALESCE((SELECT l.line_so_no
                                  FROM goods_delivery_fwii8mvb_sub l
                                 WHERE l.tenant_id = '{T}'
                                   AND l.goods_delivery_id = g.id
                                   AND (CONCAT('SO|', l.line_so_id) COLLATE utf8mb4_general_ci) = j.correlation_id
                                 LIMIT 1), ''))
          FROM gd_async_job j
         WHERE j.tenant_id = '{T}'
           AND j.command = 'SAVE_SO'
           AND j.correlation_id IN (SELECT CONCAT('SO|', l.line_so_id) COLLATE utf8mb4_general_ci
                                      FROM goods_delivery_fwii8mvb_sub l
                                     WHERE l.tenant_id = '{T}'
                                       AND l.goods_delivery_id = g.id
                                       AND l.is_deleted = 0
                                       AND COALESCE(l.line_so_id, '') <> '')
           AND j.is_deleted = 0
           AND j.job_status NOT IN ('COMPLETED', 'FAILED', 'CANCELLED')
         ORDER BY j.id DESC
         LIMIT 1) AS so_job,
"""
t = sub1(t, esc("         LIMIT 1) AS other_job,\n"), esc("         LIMIT 1) AS other_job,\n" + so_sql), "SUBMIT sql")
t = sub1(t, '''            "name": "other_job",
            "title": "other_job",
            "description": "",
            "bsonType": "string",
            "isExpand": false,
            "children": []
          },
''', '''            "name": "other_job",
            "title": "other_job",
            "description": "",
            "bsonType": "string",
            "isExpand": false,
            "children": []
          },
          {
            "key": "sj7qv2nd",
            "name": "so_job",
            "title": "so_job",
            "description": "",
            "bsonType": "string",
            "isExpand": false,
            "children": []
          },
''', "SUBMIT response_json")
old_js = '''  if (otherJob[0]) return reject("Goods Delivery " + s(f.delivery_no) + " is being saved in the background (" + (otherJob[1] || "job") + " " + otherJob[0] + "). Wait a moment, then try again.");
'''
new_js = old_js + '''  const soJob = s(f.so_job).split("|");
  if (soJob[0]) {
    const soNo = soJob.slice(2).join("|") || "of this Goods Delivery";
    if (soJob[1] === "REQUIRES_REVIEW") return reject("The background save of Sales Order " + soNo + " stopped half-way and is under review (job " + soJob[0] + "). Please contact support before completing the Packing.");
    return reject("Sales Order " + soNo + " is being saved in the background (job " + soJob[0] + "). Wait a moment, then try again.");
  }
'''
t = sub1(t, esc(old_js), esc(new_js), "SUBMIT decide")
open(os.path.join(OUT, "PACKING_ASYNC_SUBMIT.json"), "w").write(t)

# --- PACKING_SAVE ---
src = os.path.join(ROOT, "Packing/PackingSaveWorkflowJSON.json")
t = open(src).read()
T = "{{node:code_node_PkPickId.data.tenantId}}"
G = "{{node:code_node_PkPickId.data.gdDigits}}"
old_sql = f"""   AND j.correlation_id = (CONCAT('GD|', '{G}') COLLATE utf8mb4_general_ci)
   AND j.command IN ('EDIT_GD', 'COMPLETE_GD', 'COMPLETE_PACKING')
"""
new_sql = f"""   AND ((j.correlation_id = (CONCAT('GD|', '{G}') COLLATE utf8mb4_general_ci)
         AND j.command IN ('EDIT_GD', 'COMPLETE_GD', 'COMPLETE_PACKING'))
     OR (j.command = 'SAVE_SO'
         AND j.correlation_id IN (SELECT CONCAT('SO|', l.line_so_id) COLLATE utf8mb4_general_ci
                                    FROM goods_delivery_fwii8mvb_sub l
                                   WHERE l.tenant_id = '{T}'
                                     AND l.goods_delivery_id = CAST(NULLIF('{G}', '') AS UNSIGNED)
                                     AND l.is_deleted = 0
                                     AND COALESCE(l.line_so_id, '') <> '')))
"""
t = sub1(t, esc(old_sql), esc(new_sql), "PACKING_SAVE sql")
old_js = '''// a background save (Packing V2, GD Edit V2, GD Completed V2) owns this delivery until its job ends
const jobRows = [{{node:sql_node_PkJobChk.data}}][0];
const openJob = String(((Array.isArray(jobRows) ? jobRows[0] : jobRows) || {}).open_job || "").split("|");
if (openJob[0]) {
  return {
    notPicked: 1,
    pickedMessage: openJob[2] === "REQUIRES_REVIEW"
      ? "The background save of this Goods Delivery stopped half-way and is under review (" + openJob[1] + " job " + openJob[0] + "): please contact support. Nothing was saved."
      : "This Goods Delivery is being saved in the background (" + openJob[1] + " job " + openJob[0] + "). Wait a moment, then try again. Nothing was saved.",
  };
}
'''
new_js = '''// a background save (Packing V2, GD Edit V2, GD Completed V2, SO Save V2) owns this delivery until its job ends
const jobRows = [{{node:sql_node_PkJobChk.data}}][0];
const openJob = String(((Array.isArray(jobRows) ? jobRows[0] : jobRows) || {}).open_job || "").split("|");
if (openJob[0]) {
  const whose = openJob[1] === "SAVE_SO" ? "a Sales Order of this Goods Delivery" : "this Goods Delivery";
  return {
    notPicked: 1,
    pickedMessage: openJob[2] === "REQUIRES_REVIEW"
      ? "The background save of " + whose + " stopped half-way and is under review (" + openJob[1] + " job " + openJob[0] + "): please contact support. Nothing was saved."
      : whose.charAt(0).toUpperCase() + whose.slice(1) + " is being saved in the background (" + openJob[1] + " job " + openJob[0] + "). Wait a moment, then try again. Nothing was saved.",
  };
}
'''
t = sub1(t, esc(old_js), esc(new_js), "PACKING_SAVE PkPickChk")
open(os.path.join(OUT, "PackingSaveWorkflowJSON.json"), "w").write(t)
print("ok", OUT)
