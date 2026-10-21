"""live_pk_lock.py <picking_id>: one line - the Picking's update_time, is_processing and to_status on DEV 496474 (read-only;
live_follow.mjs --watch prints it after every worker call: does each drive call refresh update_time?)."""
import sys

sys.path.insert(0, "/Users/yunawinaya/Developer/BladeXfunctions/scratchpad/gdc/pkv2tools")
from dbq import q  # noqa: E402

pick = sys.argv[1]
assert pick.isdigit()
r = q("--dev", f"SELECT update_time, is_processing, to_status FROM transfer_order WHERE tenant_id = '496474' AND id = {pick}")[0]
print(f"update_time {r['update_time']} is_processing {r['is_processing']} {r['to_status']}")
