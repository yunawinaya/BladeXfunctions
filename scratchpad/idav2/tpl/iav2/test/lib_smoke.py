"""python3 scratchpad/iav2/test/lib_smoke.py - the lib/ copy is the recorded one and its builders import and resolve to iav2."""
import hashlib
import json
import os
import subprocess
import sys

IAV2 = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB = os.path.join(IAV2, "lib")
SMV2_LIB = os.path.join(os.path.dirname(IAV2), "smv2", "lib")
bad = []
n = 0


def check(label, ok, extra=""):
    global n
    n += 1
    print(("ok   " if ok else "FAIL ") + label + ((" - " + extra) if extra else ""))
    if not ok:
        bad.append(label)


def md5(path):
    return hashlib.md5(open(path, "rb").read()).hexdigest()


recorded = {}
for row in open(os.path.join(IAV2, "tpl", "LIB.MD5")).read().split("\n"):
    if row.strip():
        h, rel = row.split(" ", 1)
        recorded[rel[2:] if rel.startswith("./") else rel] = h
for rel, h in sorted(recorded.items()):
    if rel == "README.md":
        continue
    check("lib/%s = LIB.MD5" % rel, md5(os.path.join(LIB, rel)) == h)
same_now = [rel for rel in recorded if rel != "README.md" and os.path.exists(os.path.join(SMV2_LIB, rel)) and md5(os.path.join(SMV2_LIB, rel)) == recorded[rel]]
print("info scratchpad/smv2/lib still equal for %d of %d files (informational: smv2 belongs to another session)" % (len(same_now), len(recorded) - 1))

sys.path.insert(0, LIB)
import wfkit as K  # noqa: E402
import v2build as V  # noqa: E402
check("import wfkit, v2build from iav2/lib", K.__file__.startswith(LIB) and V.__file__.startswith(LIB))
check("wfkit.ROOT is iav2", os.path.realpath(K.ROOT) == os.path.realpath(IAV2), K.ROOT)
check("v2build root is iav2", os.path.realpath(V.SMV2) == os.path.realpath(IAV2), V.SMV2)
for f in ("ia_common.js", "fingerprint.js", "movekey.js", "price.js"):
    text = V.include_js(IAV2, "code/shared/" + f)
    check("include_js code/shared/" + f, "if (typeof module" not in text and len(text) > 200)
cfg = V.worker_config(name="IA_V2_WORKER", code_dir=os.path.join(IAV2, "code", "worker"), ids_base=1799600000000, command="COMPLETE_IA",
                      states=["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_IA"], lock_join="", id_col="", prev_col="", corr_offset=4, id_alias="gr_id",
                      prepare=("IA_V2_PREPARE", "0"), commit=("IA_V2_COMMIT", "0"), unlock=V.status_unlock("Item Assembly:Table:2098256587713404929", "item_assembly_status",
                                                                                                       {"item_assembly_status": "Item Assembly Status"}),
                      cache_prefix="ia_wrk_")
check("worker_config takes the IA keys", cfg["command"] == "COMPLETE_IA" and cfg["renames"] == [])
node = subprocess.run(["node", "-e", "const l=require(process.argv[1]); const h=require(process.argv[2]); console.log(JSON.stringify({root: l.root, run: typeof h.run}))",
                       os.path.join(LIB, "test_load.js"), os.path.join(LIB, "harness.js")], capture_output=True, text=True)
out = json.loads(node.stdout or "{}")
check("test_load.js code root is iav2/code", os.path.realpath(out.get("root", "")) == os.path.realpath(os.path.join(IAV2, "code")), out.get("root", node.stderr[:200]))
check("harness.js loads", out.get("run") == "function")
lift = subprocess.run([sys.executable, os.path.join(LIB, "lift", "lift.py")], capture_output=True, text=True)
check("lift.py runs (usage without a config)", "Traceback" not in lift.stderr or "usage" in (lift.stdout + lift.stderr).lower(), (lift.stdout + lift.stderr)[:120])
print("%s - %d checks" % ("FAILED " + str(len(bad)) if bad else "ok", n))
sys.exit(1 if bad else 0)
