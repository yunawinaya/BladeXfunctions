"""FIXED BIN window for the mobile Putaway V2 2,000-line test (user yes 2026-10-16): dev tenant 000000, plant ...202.

  python3 fixedbin.py status
  python3 fixedbin.py bins <po_id>     a default bin in plant ...202 (A1-B3, storage location ...1265793) for every item of that
                                       PO that has none (staged ahead; the added row ids go to state.json)
  python3 fixedbin.py apply <po_id>    the missing default bins, THEN putaway setup RANDOM -> FIXED BIN: the phone starts
                                       auto-location the moment it reads FIXED BIN, so every bin must be there first
  python3 fixedbin.py restore          FIXED BIN -> RANDOM; every added default-bin row logically deleted (data del)

The strategy is one UPDATE (.dbtools/dbw); the default bins go through the platform's own data API (sudu-lowcode data add /
del, dev-write), since the dev DB account can only UPDATE.
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
APP = os.path.expanduser("~/Documents/ASC-dev/sudu-lowcode-apps/dev/1901532458164277249")
sys.path.insert(0, os.path.join(ROOT, "scratchpad", "grv2"))
from dbq import q  # noqa: E402

STATE = os.path.join(HERE, "state.json")
SETUP_ID, TENANT, PLANT = "1937713836157042690", "000000", "1123598813738675202"
BIN, SLOC = "2018912972444823554", "2018912759311265793"


def setup_strategy():
    return q("--dev", f"SELECT default_strategy_id s FROM putaway_setup WHERE id = {SETUP_ID} AND tenant_id = '{TENANT}'")[0]["s"]


def dbw(frm, to):
    sql = (f"UPDATE putaway_setup SET default_strategy_id = '{to}' WHERE id = {SETUP_ID} AND tenant_id = '{TENANT}' "
           f"AND default_strategy_id = '{frm}'")
    subprocess.run([os.path.join(ROOT, ".dbtools", "dbw"), sql], check=True)
    subprocess.run([os.path.join(ROOT, ".dbtools", "dbw"), "--execute", sql], check=True)


def cli(args):
    r = subprocess.run(["sudu-lowcode", "--profile", "dev-write", "--full"] + args + ["--format", "json"], cwd=APP, capture_output=True, text=True)
    t = r.stdout
    d = json.loads(t[t.find("{"):]) if "{" in t else {}
    if not d.get("ok"):
        raise SystemExit("sudu-lowcode %s failed: %s" % (" ".join(args[:3]), d.get("error") or r.stderr[-300:]))
    return d.get("data") or {}


def load():
    return json.load(open(STATE)) if os.path.exists(STATE) else {"added": []}


def save(st):
    json.dump(st, open(STATE, "w"), indent=1)


def status():
    st = load()
    live = 0
    if st["added"]:
        ids = ",".join(st["added"])
        live = q("--dev", f"SELECT COUNT(*) n FROM item_wu520fpw_sub WHERE id IN ({ids}) AND is_deleted = 0")[0]["n"]
    print("putaway setup strategy:", setup_strategy(), "| default bins added:", len(st["added"]), "still live:", live)


def add_bins(po_id):
    assert po_id.isdigit()
    st = load()
    items = [r["item_id"] for r in q("--dev", f"""SELECT CAST(l.item_id AS CHAR) item_id FROM purchase_order_2ukyuanr_sub l
        WHERE l.purchase_order_id = {po_id} AND l.is_deleted = 0 AND l.item_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM item_wu520fpw_sub b WHERE b.Item_id = l.item_id AND b.plant_id = {PLANT} AND b.is_deleted = 0)
        GROUP BY l.item_id ORDER BY l.item_id""")]
    print(len(items), "items need a default bin in plant", PLANT)
    for n, item in enumerate(items, 1):
        d = cli(["data", "add", "item_wu520fpw_sub", "--json",
                 json.dumps({"Item_id": item, "plant_id": PLANT, "bin_location": BIN, "storage_location": SLOC})])
        st["added"].append(str(d["id"]))
        save(st)  # after every row: a restore always knows what was added
        if n % 25 == 0:
            print(" ", n, "added")


def bins(po_id):
    add_bins(po_id)
    status()


def apply(po_id):
    add_bins(po_id)
    if setup_strategy() == "RANDOM":
        dbw("RANDOM", "FIXED BIN")
    assert setup_strategy() == "FIXED BIN"
    status()


def restore():
    st = load()
    if setup_strategy() == "FIXED BIN":
        dbw("FIXED BIN", "RANDOM")
    for rid in list(st["added"]):
        cli(["data", "del", "item_wu520fpw_sub", "--id", rid, "--yes"])
        st["added"].remove(rid)
        save(st)
    status()


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    {"status": status, "bins": lambda: bins(sys.argv[2]), "apply": lambda: apply(sys.argv[2]), "restore": restore}[cmd]()
