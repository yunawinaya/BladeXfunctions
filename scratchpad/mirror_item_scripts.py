#!/usr/bin/env python3
"""Mirror Item/*.js into ItemFullJSON.json's config.eventScript, in place.

The form JSON is Prettier-formatted, so a json.load/json.dump round-trip would
reformat all 22k lines. Instead the exact JSON-escaped `func` string is swapped
in the raw text, which touches only the one line per script.
"""
import json, sys, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FORM = os.path.join(ROOT, "Item", "ItemFullJSON.json")
PAIRS = [("m52vcpap", "Item/ItemSave.js"), ("oq9hji9a", "Item/ItemSavePost.js")]

raw = open(FORM).read()
doc = json.loads(raw)
by_key = {e["key"]: e for e in doc["config"]["eventScript"]}

for key, rel in PAIRS:
    entry = by_key[key]
    new = open(os.path.join(ROOT, rel)).read()
    if entry["func"] == new:
        print("  %s (%s): already in sync" % (key, entry["name"])); continue
    old_lit, new_lit = (json.dumps(entry["func"], ensure_ascii=False),
                       json.dumps(new, ensure_ascii=False))
    n = raw.count(old_lit)
    if n != 1:
        sys.exit("  %s: expected 1 occurrence of the old func literal, found %d" % (key, n))
    raw = raw.replace(old_lit, new_lit)
    print("  %s (%s): %d -> %d chars" % (key, entry["name"], len(entry["func"]), len(new)))

check = json.loads(raw)
for key, rel in PAIRS:
    want = open(os.path.join(ROOT, rel)).read()
    got = {e["key"]: e for e in check["config"]["eventScript"]}[key]["func"]
    assert got == want, "%s did not land byte-identically" % key
# nothing but those func values may have changed
for e in check["config"]["eventScript"]:
    if e["key"] not in dict(PAIRS):
        assert e == by_key[e["key"]], "collateral change in %s" % e["key"]
assert {k: v for k, v in check.items() if k != "config"} == {k: v for k, v in doc.items() if k != "config"}

open(FORM, "w").write(raw)
print("mirrored OK; form JSON still parses and nothing else changed")
