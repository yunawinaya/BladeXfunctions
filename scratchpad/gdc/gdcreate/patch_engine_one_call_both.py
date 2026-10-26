"""patch_engine_one_call_both.py: INVENTORY_APPLY_OPERATION takes AND gives back every key in ONE call each (2026-10-26).

Replaces the withdrawn engine half of patch_one_stock_call.py, which made only the TAKE one call. Its v13 froze every
operation with more than 25 keys at give-back on prod (11:06-11:39): a lane cannot release a key the main call took.
Prod facts on who can release what (the platform keeps an atomic-count lock until the top-level run ends):
- main take + main give: every operation with 25 keys or fewer, always;
- laned take + laned give, same split: v12 DONE path;
- laned take + ONE main give: v12 REJECT path, GD|2114499739281133569|15, 63 keys given back in one call in 6.1 s;
- main take + laned give: FROZE (v13).
So both calls go on the main path. Lock order is then one ascending sequence per operation: no lane can wait on a key while
another lane of the same operation holds a later one (the 07:31 deadlock).
- code_node_LNtake: every key in the first TAKE call; the 9 lanes stay empty.
- code_node_LNgive: every key in the first GIVE call; the 9 lanes stay empty.
The RECOVER / REJECT gives are already one main call. test/test_one_stock_call.js checks that TAKE and GIVE split
identically, and both as one call.
Rendered as the repo keeps it: Prettier --parser json.

usage: python3 patch_engine_one_call_both.py [--write]
"""
import json
import os
import subprocess
import sys

APPLY = "/Users/yunawinaya/Developer/BladeXfunctions/Goods Delivery/AsyncV2/INVENTORY_APPLY_OPERATION.json"
PRETTIER = os.path.expanduser("~/.npm/_npx/b388654678d519d9/node_modules/prettier/bin/prettier.cjs")

SPLIT_OLD = (
    "const solo = new Set(rows.map(String)).size !== rows.length; // a key twice: one call, as before\n"
    "const more = solo ? [] : rows.slice(25), per = Math.max(1, Math.ceil(more.length / 9));\n"
    "const out = { warm: solo ? rows : rows.slice(0, 25), count: String(rows.length) };\n"
)
SPLIT_NEW = (
    "// 2026-10-26: every key in this ONE call, in lock order; the lanes stay empty. TAKE and GIVE must split alike: a lane\n"
    "// cannot release a key the main call took (v13 froze every operation with more than 25 keys at give-back)\n"
    "const more = [], per = 1;\n"
    "const out = { warm: rows, count: String(rows.length) };\n"
)
NODES = {
    "code_node_LNtake": "// INVENTORY_APPLY_OPERATION - lock TAKE: the first 25 keys alone (one first load of INVENTORY_LOCK_TOKENS after a restart), then 9 lanes (10-22)\n",
    "code_node_LNgive": "// INVENTORY_APPLY_OPERATION - lock GIVE: the first 25 keys alone (one first load of INVENTORY_LOCK_TOKENS after a restart), then 9 lanes (10-22)\n",
}
HEAD_NEW = {
    "code_node_LNtake": "// INVENTORY_APPLY_OPERATION - lock TAKE: every key in one call (2026-10-26; the 9 lanes of 10-22 stay empty)\n",
    "code_node_LNgive": "// INVENTORY_APPLY_OPERATION - lock GIVE: every key in one call (2026-10-26; the 9 lanes of 10-22 stay empty)\n",
}


def render(doc):
    compact = json.dumps(doc, ensure_ascii=False, separators=(",", ":"))
    return subprocess.run(["node", PRETTIER, "--parser", "json"], input=compact, capture_output=True, text=True, check=True).stdout


def find(o, nid):
    if isinstance(o, dict):
        if o.get("id") == nid:
            return o
        for v in o.values():
            r = find(v, nid)
            if r is not None:
                return r
    elif isinstance(o, list):
        for v in o:
            r = find(v, nid)
            if r is not None:
                return r
    return None


def swap(code, old, new, what):
    assert code.count(old) == 1, "%s: anchor found %d times" % (what, code.count(old))
    return code.replace(old, new)


raw = open(APPLY, encoding="utf-8").read()
doc = json.loads(raw)
assert render(doc) == raw, "the repo file does not round-trip"
assert "numScale" in raw, "build on the engine with the price fix (patch_engine_precision.py) - dev v16 / v14 content"
for nid in NODES:
    c = find(doc, nid)["data"]["script"]
    assert "every key in this ONE call" not in c["code"], nid + ": already patched"
    c["code"] = swap(c["code"], NODES[nid], HEAD_NEW[nid], nid + " header")
    c["code"] = swap(c["code"], SPLIT_OLD, SPLIT_NEW, nid + " split")

out = render(doc)
print("INVENTORY_APPLY_OPERATION: TAKE and GIVE each one call (lanes empty); %+d chars" % (len(out) - len(raw)))
if "--write" in sys.argv:
    open(APPLY, "w", encoding="utf-8").write(out)
    print("written")
else:
    print("ok (dry): pass --write")
