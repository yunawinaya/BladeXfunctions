#!/bin/zsh
# live_test.sh: GD_BULK_PREPARE v19 on dev 000000 (user's yes 10-23). Two balance rows at bin ...2786 go PCS -> BOX for the test,
# two V2 Created saves (SO/20261020-051 P-00002, SO/20261020-050 ITM-20260600005-A batch ...538) must be refused with the new
# messages; both rows are restored to PCS on exit, whatever happened.
cd /Users/yunawinaya/Developer/BladeXfunctions || exit 1
R=scratchpad/gdc/tools/runas.mjs
ID=scratchpad/gdc/tools/id000000.json
T=scratchpad/gdc/gdcreate/deploy_prepare_unit
PCS=2018906563477008389
BOX=2018906563477008386
restore() {
  .dbtools/dbw "UPDATE item_balance SET material_uom = $PCS WHERE id = 2066342789100974081 AND tenant_id = '000000' AND material_uom = $BOX" --execute 2>&1 | tail -1
  .dbtools/dbw "UPDATE item_batch_balance SET material_uom = $PCS WHERE id = 2102287018536333313 AND tenant_id = '000000' AND material_uom = $BOX" --execute 2>&1 | tail -1
  .dbtools/db --dev "SELECT 'item_balance' t, CAST(material_uom AS CHAR) uom FROM item_balance WHERE id = 2066342789100974081 UNION ALL SELECT 'item_batch_balance', CAST(material_uom AS CHAR) FROM item_batch_balance WHERE id = 2102287018536333313" 2>&1 | tail -3
}
trap restore EXIT
.dbtools/dbw "UPDATE item_balance SET material_uom = $BOX WHERE id = 2066342789100974081 AND tenant_id = '000000' AND material_uom = $PCS" --execute 2>&1 | tail -1
.dbtools/dbw "UPDATE item_batch_balance SET material_uom = $BOX WHERE id = 2102287018536333313 AND tenant_id = '000000' AND material_uom = $PCS" --execute 2>&1 | tail -1
for c in bal batch; do
  node $R $ID 2105133540498116609 $T/live_$c.req.json $T/live_$c.out.json 2>&1 | tail -1 | cut -c1-80
  J=$(python3 -c "import json; d = json.load(open('$T/live_$c.out.json'))['data']; print(d.get('job_id') or '')")
  echo "$c: submit $(python3 -c "import json; d = json.load(open('$T/live_$c.out.json'))['data']; print(d.get('job_status'), d.get('result_code'), (d.get('result_message') or '')[:120])") job $J"
  [ -n "$J" ] || continue
  echo "{\"job_id\": \"$J\"}" > $T/kick_$c.req.json
  node $R $ID 2104840667119411201 $T/kick_$c.req.json $T/kick_$c.out.json 2>&1 | tail -1 | cut -c1-80
  .dbtools/db --dev --json "SELECT job_status, error_code, error_details FROM gd_async_job WHERE id = $J" 2>/dev/null > $T/job_$c.json
  python3 - $T/job_$c.json $c <<'EOF'
import json, sys
raw = open(sys.argv[1], encoding="utf-8").read()
r = json.loads(raw[raw.index("["):])[0]
d = json.loads(r["error_details"] or "{}")
print(sys.argv[2], "->", r["job_status"], r["error_code"], "|", [e.get("message") for e in d.get("line_errors", [])][:3])
EOF
done
