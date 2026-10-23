"""live_test.py: GD_SO_CONVERT_CHECK v8's lost-convert-run lookup on dev 000000 (user's yes 10-23). No business writes:
SO_AUTO_GD is run on two fully planned test sales orders (SO/20261020-050, -051), which it refuses ("Nothing left to deliver")
before any save. The check is asked before the run (no run yet: null) and after it (the run's own answer)."""
import json
import subprocess
import time

T = "scratchpad/gdc/gdcreate/deploy_convert_recover"
RUNAS = ["node", "scratchpad/gdc/tools/runas.mjs", "scratchpad/gdc/tools/id000000.json"]
CHECK, AUTO = "2112084100104495105", "2076557490389835777"
SOS = ["2112387415213707266", "2112387421748432898"]
ORG = "1123598813738675201"


def run(wf, name, body):
    open("%s/%s.req.json" % (T, name), "w").write(json.dumps(body))
    subprocess.run(RUNAS + [wf, "%s/%s.req.json" % (T, name), "%s/%s.out.json" % (T, name)], capture_output=True, text=True)
    try:
        return json.load(open("%s/%s.out.json" % (T, name)))
    except Exception as e:
        return {"error": str(e)}


def check(name, since):
    d = (run(CHECK, name, {"run_so_ids": SOS, "run_since_s": str(since)}).get("data") or {})
    return d.get("code"), d.get("run_json")


t0 = time.time()
print("before:", check("check_before", 60))
auto = run(AUTO, "auto", {"so_ids": SOS, "gd_type": "multiple", "plant_id": ORG, "organization_id": ORG, "created_by": "live-test", "v2": "1"})
a = auto.get("data") or {}
print("SO_AUTO_GD: code %s, message %r, created %s, blocked %s, queued %s" % (a.get("code"), a.get("message"), a.get("created"), a.get("blocked"), a.get("queued")))
code, rj = check("check_after", int(time.time() - t0) + 10)
run_ = json.loads(rj) if rj else None
print("after: code %s, run %s" % (code, json.dumps(run_)[:600]))
same = bool(run_) and run_.get("status") == "Complete" and run_.get("result", {}).get("blocked") == a.get("blocked") and run_.get("result", {}).get("message") == a.get("message")
print("RESULT:", "PASS - the check returned the run's own answer" if same else "FAIL")
