"""After the paste / the repair (read-only): is prod's enabled GD_BULK_PREPARE the paste; Kenhin lines created since the paste
whose delivery summary shows a bin id (expect 0) out of all lines created since; old lines still showing an id, per GD status.
usage: python3 verify.py"""
import json, os, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.abspath(os.path.join(HERE, "..", "..", ".dbtools", "db"))
HAS_ID = "l.view_stock REGEXP '[0-9]\\\\. [0-9]{18,20}:'"


def q(sql):
    out = subprocess.run([DB, "--prod", "--json", sql], capture_output=True, text=True, check=True).stdout
    return json.loads(out[out.find("["):])


canon = lambda o: json.dumps(o, sort_keys=True, ensure_ascii=False)
r = q("SELECT CAST(id AS CHAR) id, version_number v, create_time t, script_json s FROM su_code_workflow_history "
      "WHERE data_id = 2104840044642754561 AND status = 'enabled' ORDER BY version_number DESC LIMIT 1")[0]
live = canon(json.loads(r["s"]))
paste = canon(json.load(open(os.path.join(HERE, "GD_BULK_PREPARE.prod_paste.json"), encoding="utf-8")))
base = canon(json.load(open(os.path.join(HERE, "GD_BULK_PREPARE.prod_v22.base.json"), encoding="utf-8")))
print(f"GD_BULK_PREPARE: enabled v{r['v']} ({str(r['t'])[:19]})", "= the paste" if live == paste else "= v22 (not pasted)" if live == base else "DIFFERS from both: check")
if live == paste:
    n = q(f"SELECT COUNT(*) n, SUM({HAS_ID}) with_id FROM goods_delivery_fwii8mvb_sub l WHERE l.tenant_id = '528521' AND l.is_deleted = 0 AND l.id > {r['id']}")[0]
    print(f"  Kenhin GD lines created since the paste: {n['n']}, showing a bin id: {n['with_id'] or 0} (expect 0)")
for x in q("SELECT g.gd_status st, COUNT(DISTINCT g.id) gds, COUNT(*) n FROM goods_delivery_fwii8mvb_sub l JOIN goods_delivery g ON g.id = l.goods_delivery_id "
           f"WHERE l.tenant_id = '528521' AND l.is_deleted = 0 AND {HAS_ID} GROUP BY g.gd_status"):
    print(f"  still showing a bin id: {x['st']} {x['n']} lines on {x['gds']} GDs")
