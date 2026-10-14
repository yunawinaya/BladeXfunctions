"""Looks up the four Picking V2 workflow ids on dev by name, writes ids.json, rebuilds the workflows and the client."""
import json, os, re, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
R = "/Users/yunawinaya/Developer/BladeXfunctions/"
NAMES = ["PICKING_ASYNC_SUBMIT", "PICKING_ASYNC_WORKER", "PICKING_BULK_PREPARE", "PICKING_BULK_COMMIT"]
out = subprocess.run([R + ".dbtools/wf", "--dev", "list", "PICKING_"], capture_output=True, text=True, cwd=R).stdout
found = {}
for line in out.splitlines():
    m = re.match(r"\s*(\d{19})\s+(\S+)\s*$", line)
    if m and m.group(2) in NAMES:
        assert m.group(2) not in found, "two workflows named " + m.group(2)
        found[m.group(2)] = m.group(1)
missing = [n for n in NAMES if n not in found]
print("found:", found)
if missing:
    sys.exit("not on dev yet: " + ", ".join(missing))
json.dump(found, open(os.path.join(HERE, "ids.json"), "w"), indent=1)
for cmd in (["python3", "build.py", "--write"] + NAMES, ["python3", "client_patch.py", "--write"]):
    subprocess.run(cmd, cwd=HERE, check=True)
# the README's id table
p = R + "Picking/AsyncV2/README.md"
s = open(p, encoding="utf-8").read()
for n in NAMES:
    s = re.sub(r"^\| %s \| *[0-9]* *\|" % n, "| %s | %s |" % (n, found[n]), s, flags=re.M)
open(p, "w", encoding="utf-8").write(s)
print("README ids filled")
