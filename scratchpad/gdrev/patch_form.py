"""patch_form.py [--write] [--to <file>]: the GD form's Processing view follows a GD Revert V2 job like a cancel - GD_BG_WF gets REVERT_GD (the
GD_REVERT_WORKER id from Goods Delivery/RevertV2/ids.json; GDREV_IDS overrides it for a dry run) and "reverted" wording. GD_EDIT_SUBMIT's
STATUS already answers the job holding the GD's lock, whatever its command. Edits Goods Delivery/GDonMounted.js and its mirror,
GDfullJSON.json's mounted handler (config.eventScript[0].func), which must still be the committed (git HEAD) text."""
import json
import os
import subprocess
import sys

R = "/Users/yunawinaya/Developer/BladeXfunctions/"
JS = R + "Goods Delivery/GDonMounted.js"
FORM = R + "Goods Delivery/GDfullJSON.json"
IDS = json.load(open(os.environ.get("GDREV_IDS") or R + "Goods Delivery/RevertV2/ids.json"))
WORKER = IDS.get("GD_REVERT_WORKER", "")
assert WORKER.isdigit(), "GD_REVERT_WORKER has no workflow id in ids.json"
EDITS = [
    ('  STATUS: "2110618741159940097", // GD_EDIT_SUBMIT (its STATUS covers edits, completions and cancels)\n',
     '  STATUS: "2110618741159940097", // GD_EDIT_SUBMIT (its STATUS covers edits, completions, cancels and reverts)\n'),
    ('  CANCEL_GD: "2112455700319932418", // GD_CANCEL_WORKER\n',
     '  CANCEL_GD: "2112455700319932418", // GD_CANCEL_WORKER\n  REVERT_GD: "%s", // GD_REVERT_WORKER\n' % WORKER),
    ('        CANCEL_GD: ["cancelled", "cancellation"],\n',
     '        CANCEL_GD: ["cancelled", "cancellation"],\n        REVERT_GD: ["reverted", "revert"],\n'),
]


def head(path):
    return subprocess.run(["git", "-C", R, "show", "HEAD:" + os.path.relpath(path, R)], capture_output=True, text=True, check=True).stdout


old = open(JS, encoding="utf-8").read()
assert old == head(JS), "GDonMounted.js is not the committed text: rebuild on the live form"
new = old
for a, b in EDITS:
    assert new.count(a) == 1, a
    new = new.replace(a, b)
raw = open(FORM, encoding="utf-8").read()
form = json.loads(raw)
assert form["config"]["eventScript"][0]["func"] == old, "GDfullJSON.json's mounted handler is not GDonMounted.js"
eo, en = json.dumps(old, ensure_ascii=False), json.dumps(new, ensure_ascii=False)
assert raw.count(eo) == 1, "the handler text is not unique in the form file"
out = raw.replace(eo, en)
assert json.loads(out)["config"]["eventScript"][0]["func"] == new
print("GD form mounted: %d -> %d chars (REVERT_GD -> %s)" % (len(old), len(new), WORKER))
if "--to" in sys.argv:
    # the patched GDonMounted.js elsewhere (test/test_form_revert_follow.js before the ids are real)
    open(sys.argv[sys.argv.index("--to") + 1], "w", encoding="utf-8").write(new)
if "--write" in sys.argv:
    open(FORM, "w", encoding="utf-8").write(out)
    open(JS, "w", encoding="utf-8").write(new)
    print("wrote GDfullJSON.json and GDonMounted.js")
