"""patch_commit_hidden_packing_shell.py: GD_BULK_COMMIT keeps the Packing shell it writes at GD save HIDDEN until a Picking fills
it (2026-10-26, the user's decision, agreed by the GD, Edit & Picking and Packing V2 sessions).

Until now P7A flipped the shell "Processing" -> "Created", so every packing-required GD showed an empty Packing on the lists
(621 keyed LSH Packings were save-time shells). The shell itself stays: two Pickings of one GD confirm within 2 s often (95 times
across 29 LSH GDs since 10-25 15:22), and P5 must always find a shell to refresh instead of racing to create one.
- P2 is unchanged: the shell is written "Processing", the in-commit marker only.
- P7A (code_node_SlxWSQ0R) flips it to "Waiting" instead of "Created".
- P7B check (code_node_w5PAtzWc) and P2 check (code_node_HGbnLhvZ) accept "Waiting", and still "Created" for a job an
  earlier version already flipped.
- Picking V2's P5 and classic PICKING's packing branch set "Waiting" -> "Created" when they fill it (the Edit & Picking
  session's change); the desktop list and the mobile Packing list hide "Waiting" (Packing V2's). Go-live order: list filters,
  the un-hide, this patch, then Packing's cleanup of the existing empty Created shells.
Rendered as the repo keeps it: Prettier --parser json.

usage: python3 patch_commit_hidden_packing_shell.py [--write | --out <path>]
"""
import json
import os
import subprocess
import sys

P = "/Users/yunawinaya/Developer/BladeXfunctions/Goods Delivery/AsyncV2/GD_BULK_COMMIT.json"
PRETTIER = os.path.expanduser("~/.npm/_npx/b388654678d519d9/node_modules/prettier/bin/prettier.cjs")

GDC_OLD = '"pack_published":"Created"}'
GDC_NEW = '"pack_published":"Created","pack_waiting":"Waiting"}'
EDITS = {
    "code_node_HGbnLhvZ": [(
        "  if (packs.length && [GDC.pack_hidden, GDC.pack_published].indexOf(s(packs[0].v)) < 0)",
        "  if (packs.length && [GDC.pack_hidden, GDC.pack_waiting, GDC.pack_published].indexOf(s(packs[0].v)) < 0)",
    )],
    "code_node_SlxWSQ0R": [(
        "  const packFlipRows = pack && s(pack.v) === GDC.pack_hidden ? [{ id: s(pack.id), packing_status: GDC.pack_published }] : [];",
        "  // the shell leaves the in-commit marker for \"Waiting\": hidden until a Picking fills it (2026-10-26), no longer \"Created\"\n"
        "  const packFlipRows = pack && s(pack.v) === GDC.pack_hidden ? [{ id: s(pack.id), packing_status: GDC.pack_waiting }] : [];",
    )],
    "code_node_w5PAtzWc": [(
        '  if ((pre.packing || {}).required && (!pack || s(pack.v) !== GDC.pack_published)) return review("packing shell is "',
        "  // \"Waiting\" = hidden until a Picking fills it (2026-10-26); \"Created\" = flipped by an earlier version of this job\n"
        '  if ((pre.packing || {}).required && (!pack || [GDC.pack_waiting, GDC.pack_published].indexOf(s(pack.v)) < 0)) return review("packing shell is "',
    )],
}
FLIP_TITLE_OLD = "P7B: packing.packing_status Processing -> Created"
FLIP_TITLE_NEW = "P7B: packing.packing_status Processing -> Waiting (hidden until a Picking fills it)"


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


def once(code, old, where):
    n = code.count(old)
    assert n == 1, "%s: anchor found %d times (already patched?): %s" % (where, n, old[:90])


raw = open(P, encoding="utf-8").read()
doc = json.loads(raw)
assert render(doc) == raw, "the repo file does not round-trip"

for nid, edits in EDITS.items():
    sc = find(doc, nid)["data"]["script"]
    once(sc["code"], GDC_OLD, nid + " GDC")
    sc["code"] = sc["code"].replace(GDC_OLD, GDC_NEW)
    for old, new in edits:
        once(sc["code"], old, nid)
        sc["code"] = sc["code"].replace(old, new)
    assert sc["code"].count("GDC.pack_published") == (0 if nid == "code_node_SlxWSQ0R" else 1), nid + ": unexpected pack_published uses"

flip = find(doc, "update_node_PV0oFLij")["data"]
for k in ("title", "nodeName", "name"):
    assert flip[k] == FLIP_TITLE_OLD, "update_node_PV0oFLij %s changed: %s" % (k, flip[k])
    flip[k] = FLIP_TITLE_NEW
props = json.dumps(flip.get("props"), ensure_ascii=False)
assert "code_node_SlxWSQ0R.data.packFlipRows.packing_status" in props, "the flip node no longer writes P7A's packing_status"

out = render(doc)
print("GD_BULK_COMMIT: the save-time Packing shell stays hidden (\"Waiting\") until a Picking fills it; %+d chars" % (len(out) - len(raw)))
if "--write" in sys.argv:
    open(P, "w", encoding="utf-8").write(out)
    print("written")
elif "--out" in sys.argv:
    dst = sys.argv[sys.argv.index("--out") + 1]
    open(dst, "w", encoding="utf-8").write(out)
    print("written to", dst)
else:
    print("ok (dry): pass --write or --out <path>")
