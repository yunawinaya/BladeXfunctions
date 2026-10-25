# P4 (sales orders) decides "every delivery of the SO is packed" at COMMIT time, after this delivery's P3, instead of using
# PREPARE's frozen flip_ids: two deliveries of one SO completed together otherwise each see the other unpacked and neither
# flips. PREPARE now also stores the candidates (so_ids, so_ids_json as text: 19-digit ids, so_lines); a payload without
# so_ids (prepared before this change) keeps the frozen decision. Raw-text edits keep the repo files' format.
# Usage: python3 patch.py [out dir]
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


# --- PACKING_BULK_PREPARE: the candidates next to the frozen decision ---
t = open(os.path.join(ROOT, "Packing/AsyncV2/PACKING_BULK_PREPARE.json")).read()
t = sub1(t, esc("    so: { flip_ids: flip, line_ids: soLines },\n"),
         esc("    so: { flip_ids: flip, line_ids: soLines, so_ids: list(w.soIds), so_ids_json: s(p1.soIdsJson) || \"[0]\", so_lines: list(w.soLineIds).map((id) => [id, lineSo[id] || \"\"]) },\n"),
         "PREPARE payload so")
open(os.path.join(OUT, "PACKING_BULK_PREPARE.json"), "w").write(t)

# --- PACKING_BULK_COMMIT: the sibling deliveries read at commit time, the flip decided from them ---
t = open(os.path.join(ROOT, "Packing/AsyncV2/PACKING_BULK_COMMIT.json")).read()
T = "{{node:code_node_KCguard.data.tenantId}}"
J = "{{node:code_node_KCguard.data.jobId}}"
O = "{{node:code_node_KCentry.data.organizationId}}"
old_sql = f"""SELECT CAST(JSON_EXTRACT(j.prepared_payload, '$.so') AS CHAR) AS so
  FROM gd_async_job j
 WHERE j.tenant_id = '{T}'
   AND j.id = {J}"""
new_sql = f"""SELECT CAST(JSON_EXTRACT(j.prepared_payload, '$.so') AS CHAR) AS so,
       (SELECT CAST(JSON_ARRAYAGG(JSON_OBJECT('id', CAST(g.id AS CHAR), 'gd_status', g.gd_status, 'packing_status', g.packing_status, 'so_id_json', CAST(g.so_id AS CHAR))) AS CHAR)
          FROM goods_delivery g
         WHERE g.tenant_id = '{T}'
           AND g.organization_id = '{O}'
           AND g.is_deleted = 0
           AND JSON_OVERLAPS(g.so_id, CAST(JSON_UNQUOTE(JSON_EXTRACT(j.prepared_payload, '$.so.so_ids_json')) AS JSON))) AS sibs
  FROM gd_async_job j
 WHERE j.tenant_id = '{T}'
   AND j.id = {J}"""
t = sub1(t, esc(old_sql) + '"', esc(new_sql) + '"', "COMMIT P4 sql")
t = sub1(t, '''                    "key": "p5094yg9",
                    "name": "so",
                    "title": "so",
                    "description": "",
                    "bsonType": "string",
                    "isExpand": false,
                    "children": []
                  }
                ]''', '''                    "key": "p5094yg9",
                    "name": "so",
                    "title": "so",
                    "description": "",
                    "bsonType": "string",
                    "isExpand": false,
                    "children": []
                  },
                  {
                    "key": "q7vn3s2k",
                    "name": "sibs",
                    "title": "sibs",
                    "description": "",
                    "bsonType": "string",
                    "isExpand": false,
                    "children": []
                  }
                ]''', "COMMIT P4 sql response_json")
old_js = '''const commitP4Plan = function commitP4Plan(entry, dataRows) {
  const so = parseJson((list(dataRows)[0] || {}).so, {}) || {};
  const ids = list(so.flip_ids).map(s).filter((x) => /^[0-9]{1,20}$/.test(x));
  const lines = list(so.line_ids).map(s).filter((x) => /^[0-9]{1,20}$/.test(x));
'''
new_js = '''const commitP4Plan = function commitP4Plan(entry, dataRows) {
  const row = list(dataRows)[0] || {};
  const so = parseJson(row.so, {}) || {};
  const idsOf = (v) => (Array.isArray(v) ? v.join(",") : s(v)).match(/[0-9]+/g) || [];
  let flipIds = so.flip_ids;
  let lineIds = so.line_ids;
  // decided now, after this delivery's P3: a sibling delivery packed meanwhile by another job counts (a payload without so_ids keeps PREPARE's decision)
  if (Array.isArray(so.so_ids)) {
    const sibs = list(parseJson(row.sibs, []));
    const soIds = list(so.so_ids).map(s);
    flipIds = soIds.filter((x) => !sibs.some((g) => idsOf(g.so_id_json).indexOf(x) >= 0 && s(g.gd_status) !== "Cancelled" && s(g.id) !== s(entry.gdId) && s(g.packing_status) !== "Completed"));
    const lineSo = {};
    for (const p of list(so.so_lines)) if (Array.isArray(p) && s(p[1])) lineSo[s(p[0])] = s(p[1]);
    const allFlip = flipIds.length > 0 && flipIds.length === soIds.length;
    lineIds = list(so.so_lines).map((p) => s(Array.isArray(p) ? p[0] : p)).filter((id) => (lineSo[id] ? flipIds.indexOf(lineSo[id]) >= 0 : allFlip));
  }
  const ids = list(flipIds).map(s).filter((x) => /^[0-9]{1,20}$/.test(x));
  const lines = list(lineIds).map(s).filter((x) => /^[0-9]{1,20}$/.test(x));
'''
t = sub1(t, esc(old_js), esc(new_js), "COMMIT P4 plan")
open(os.path.join(OUT, "PACKING_BULK_COMMIT.json"), "w").write(t)
print("ok", OUT)
