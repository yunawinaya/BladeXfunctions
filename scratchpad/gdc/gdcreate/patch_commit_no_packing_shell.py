"""patch_commit_no_packing_shell.py: GD_BULK_COMMIT stops writing the hidden Packing shell at GD save (2026-10-26, the user,
agreed with Packing V2: "no Packing shell at GD save", built after the peak).

Classic GD save never made a Packing; V2's P2 wrote one (PKG|<gd_id>, Processing, numbered) whenever the Packing setup required
packing, and P7A flipped it to Created. Most stayed empty (621 keyed LSH Packings were save-time shells). Picking V2's P5 creates
the Packing (PKG|<gd_id>) when the picking completes, so the shell is not needed.
- P2 plan (code_node_JvwJVYCY): plans no shell, so condition_or_node_hgyH0H7a / add_node_F7x7HxQ2 stay dormant.
- The checks that demanded exactly one shell when packing is required accept none, or the one an earlier version of the same
  job wrote: P2 check (code_node_HGbnLhvZ), P6 barrier (code_node_DEj4DPIt), P7B check (code_node_w5PAtzWc).
- Unchanged: P7A still flips an existing hidden shell; the clean-failure switches still soft-delete one. A shell for a tenant
  that does not require packing still fails P2.
GD Complete's packing gate reads the Packing setup and the GD's packing_status, not the shell.
Rendered as the repo keeps it: Prettier --parser json.

usage: python3 patch_commit_no_packing_shell.py [--write | --out <path>]
"""
import json
import os
import subprocess
import sys

sys.exit("WITHDRAWN 2026-10-26 ~19:45, never applied: the user chose to KEEP the shell, hidden until picked (two Pickings of one "
         "GD confirm within 2 s 95 times at LSH, so P5 must always find a shell). See patch_commit_hidden_packing_shell.py.")

P = "/Users/yunawinaya/Developer/BladeXfunctions/Goods Delivery/AsyncV2/GD_BULK_COMMIT.json"
PRETTIER = os.path.expanduser("~/.npm/_npx/b388654678d519d9/node_modules/prettier/bin/prettier.cjs")

P2_PLAN_START = '  const packs = struct.filter((r) => r.kind === "PACK");\n  const p = parsePrepared(prepRows, guard.jobId);'
P2_PLAN_START_NEW = "  const p = parsePrepared(prepRows, guard.jobId);"
P2_PLAN_SHELL_HEAD = "  const pk = pre.packing || { required: 0 };\n  const packAddRows = pk.required && !packs.length ? [{ packing_status: GDC.pack_hidden,"
P2_PLAN_SHELL_TAIL = "table_item_source: [], table_hu_source: [] }] : [];\n"
P2_PLAN_SHELL_NEW = (
    "  // No Packing shell at GD save (2026-10-26): classic GD save never made one, and Picking V2's P5 creates the Packing\n"
    "  // (PKG|<gd_id>) when the picking completes. The checks still accept a shell an earlier version of this job wrote.\n"
    "  const packAddRows = [];\n"
)
EDITS = {
    "code_node_HGbnLhvZ": [(
        '  if (pk.required && packs.length !== 1) return fail(packs.length ? packs.length + " packing shells carry PKG|" + p1.gdId : "the packing shell was not written");\n',
        "  // no shell is written since 2026-10-26: none, or the one an earlier version of this job wrote (P7A publishes it)\n"
        '  if (packs.length > 1) return fail(packs.length + " packing shells carry PKG|" + p1.gdId);\n',
    )],
    "code_node_DEj4DPIt": [(
        '  if (packs !== ((pre.packing || {}).required ? 1 : 0)) problems.push("packing shells " + packs + " <> " + ((pre.packing || {}).required ? 1 : 0));',
        '  if (packs > ((pre.packing || {}).required ? 1 : 0)) problems.push("packing shells " + packs + " > " + ((pre.packing || {}).required ? 1 : 0));',
    )],
    "code_node_w5PAtzWc": [(
        '  if ((pre.packing || {}).required && (!pack || s(pack.v) !== GDC.pack_published)) return review("packing shell is " + (pack ? s(pack.v) : "missing") + " after the flip");',
        '  if (pack && s(pack.v) !== GDC.pack_published) return review("packing shell is " + s(pack.v) + " after the flip");',
    )],
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


def once(code, old, where):
    n = code.count(old)
    assert n == 1, "%s: anchor found %d times (already patched?): %s" % (where, n, old[:90])


raw = open(P, encoding="utf-8").read()
doc = json.loads(raw)
assert render(doc) == raw, "the repo file does not round-trip"

gate = json.dumps(find(doc, "condition_or_node_hgyH0H7a")["data"], ensure_ascii=False)
assert "needPackAdd" in gate and "code_node_JvwJVYCY" in gate, "the shell switch no longer reads code_node_JvwJVYCY.needPackAdd"

plan = find(doc, "code_node_JvwJVYCY")["data"]["script"]
c = plan["code"]
once(c, P2_PLAN_START, "P2 plan")
c = c.replace(P2_PLAN_START, P2_PLAN_START_NEW)
once(c, P2_PLAN_SHELL_HEAD, "P2 plan")
i = c.index(P2_PLAN_SHELL_HEAD)
j = c.index(P2_PLAN_SHELL_TAIL, i) + len(P2_PLAN_SHELL_TAIL)
assert "\n" not in c[i + len(P2_PLAN_SHELL_HEAD):j - 1], "the shell row spans more than one line"
c = c[:i] + P2_PLAN_SHELL_NEW + c[j:]
assert "packs" not in c[c.index("const publishP2Plan"):c.index("const guard = [")], "publishP2Plan still reads packs"
plan["code"] = c

for nid, edits in EDITS.items():
    sc = find(doc, nid)["data"]["script"]
    for old, new in edits:
        once(sc["code"], old, nid)
        sc["code"] = sc["code"].replace(old, new)

out = render(doc)
print("GD_BULK_COMMIT: no Packing shell at GD save; %+d chars" % (len(out) - len(raw)))
if "--write" in sys.argv:
    open(P, "w", encoding="utf-8").write(out)
    print("written")
elif "--out" in sys.argv:
    dst = sys.argv[sys.argv.index("--out") + 1]
    open(dst, "w", encoding="utf-8").write(out)
    print("written to", dst)
else:
    print("ok (dry): pass --write or --out <path>")
