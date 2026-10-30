"""After the paste: is the enabled prod Picking list page the paste, and do the three workers it starts run clean?
usage: python3 verify.py"""
import datetime, json, os, subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.abspath(os.path.join(HERE, "..", "..", ".dbtools", "db"))
W = [("PICKING_ASYNC_WORKER", "2109531412499251201"), ("GD_EDIT_WORKER", "2110618789356687361"), ("GD_COMPLETE_WORKER", "2110182645714518018")]


def q(sql):
    out = subprocess.run([DB, "--prod", "--json", sql], capture_output=True, text=True, check=True).stdout
    return json.loads(out[out.find("["):])


r = q("SELECT version_number v, create_time t, page_json j FROM su_code_pages_history WHERE data_id = 1935635853539348481 AND status = 'enabled' ORDER BY version_number DESC LIMIT 1")[0]
live = json.loads(r["j"])
paste = json.load(open(os.path.join(HERE, "PickingListPageFullJSON.prod_paste.json")))
base = json.load(open(os.path.join(HERE, "PickingListPageFullJSON.prod_v77.base.json")))
state = "= the paste" if live == paste else "= v77 (not pasted)" if live == base else "DIFFERS from both: check"
print(f"Picking list page: enabled v{r['v']} ({str(r['t'])[:19]}) {state}")
bound = (int((datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(minutes=20)).timestamp() * 1000) - 1288834974657) << 22
for name, wf in W:
    runs = q(f"SELECT DATE_FORMAT(create_time, '%H:%i:%s') t, status, LEFT(IFNULL(error_msg, ''), 60) e FROM su_code_workflow_inst "
             f"WHERE workflow_id = {wf} AND id > {bound} ORDER BY id DESC LIMIT 6")
    print(f"  {name}: " + (", ".join(x["t"] + " " + x["status"] + (" (not loaded)" if "is not loaded" in x["e"] else "") for x in runs) or "no runs in 20 min"))
