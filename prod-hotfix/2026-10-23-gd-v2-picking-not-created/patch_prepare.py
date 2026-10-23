"""patch_prepare.py: GD Created V2 (GD_BULK_PREPARE) stamps picking_status "Not Created" on the header and every stock line
when the organization's Picking Setup requires picking after the Goods Delivery and does not auto-create it (auto_trigger_to
not 1), as the classic save does (GOODS_DELIVERY code_node_IyJHrBst lines / code_node_8pN1MyXz header). Without it the GD
list's Convert to Picking refuses the delivery (it takes only lines "Not Created"). Prod incident 2026-10-23: 900938
GD-26/10/0500. Auto-triggered setups are unchanged (the Picking consumer stamps "Created").

python3 patch_prepare.py <in.json> <out.json>: every replacement is exact and counted; refuses on any mismatch."""
import json
import sys

src, dst = sys.argv[1:3]
raw = open(src).read()
esc = lambda t: json.dumps(t, ensure_ascii=False)[1:-1]


def sub(old, new, count=1, escape=True):
    global raw
    o, n = (esc(old), esc(new)) if escape else (old, new)
    k = raw.count(o)
    assert k == count, "%d matches (want %d) for %r" % (k, count, old[:80])
    raw = raw.replace(o, n)


# 1. sql_node_rCfSqwDY: the SETUP row also carries auto_trigger_to (q3 was an empty filler column)
sub("CAST(ps.full_cl_check AS CHAR) AS q2, '' AS q3,", "CAST(ps.full_cl_check AS CHAR) AS q2, CAST(ps.auto_trigger_to AS CHAR) AS q3,")
sub("p.picking_after, p.picking_required, p.full_cl_check\n", "p.picking_after, p.picking_required, p.full_cl_check, p.auto_trigger_to\n")

# 2. code_node_kyHUfWS3: pickingAuto next to pickingRequired, declared (else the platform drops it)
sub('const pickingRequired = st0 && s(st0.v4) === "Goods Delivery" && s(st0.q1) === "1" && !skipPicking ? 1 : 0;\n',
    'const pickingRequired = st0 && s(st0.v4) === "Goods Delivery" && s(st0.q1) === "1" && !skipPicking ? 1 : 0;\n'
    '  // auto_trigger_to 1: the Picking consumer makes the Picking and stamps "Created"; else the lines wait "Not Created"\n'
    '  const pickingAuto = st0 && s(st0.q3) === "1" ? 1 : 0;\n')
sub("pickingRequired: pickingRequired }, idLists(lines));", "pickingRequired: pickingRequired, pickingAuto: pickingAuto }, idLists(lines));")
ENTRY = ('            "name": "pickingRequired",\n            "title": "pickingRequired",\n            "description": "",\n'
         '            "bsonType": "int",\n            "isExpand": false,\n            "children": []\n          }\n')
sub(ENTRY, ENTRY + '          {\n            "key": "q4mz7tkc",\n            "name": "pickingAuto",\n            "title": "pickingAuto",\n'
    '            "description": "",\n            "bsonType": "int",\n            "isExpand": false,\n            "children": []\n'
    '          }\n', escape=False)
raw = raw.replace('            "children": []\n          }\n          {\n            "key": "q4mz7tkc"',
                  '            "children": []\n          },\n          {\n            "key": "q4mz7tkc"')

# 3. code_node_J5T1G2s9 (Validate) and code_node_egoCivrm (Finish) build the same lines + header (shared helpers)
sub('pickingRequired: String(a.pickingRequired) === "1" ? 1 : 0 });',
    'pickingRequired: String(a.pickingRequired) === "1" ? 1 : 0, pickingAuto: String(a.pickingAuto) === "1" ? 1 : 0 });', 2)
sub("  const bundlePicking = parse.pickingRequired === 1 && !fromPicking && !s(header.picking_status);\n",
    "  const bundlePicking = parse.pickingRequired === 1 && !fromPicking && !s(header.picking_status);\n"
    "  // the old save's stamps of every other line and the header (code_node_IyJHrBst / code_node_8pN1MyXz): picking\n"
    "  // required and not auto-created -> \"Not Created\", what Convert to Picking takes (prod 2026-10-23, GD-26/10/0500)\n"
    "  const manualPicking = bundlePicking && parse.pickingAuto !== 1;\n", 2)
sub('batch_id: A.a.batch_id || "", gd_quantity: A.a.quantity, plant_id: plant, organization_id: org, is_deleted: 0, balance_id: "" })));\n',
    'batch_id: A.a.batch_id || "", gd_quantity: A.a.quantity, plant_id: plant, organization_id: org, is_deleted: 0, balance_id: "" })));\n'
    '    if (manualPicking) out.picking_status = "Not Created";\n', 2)
sub("  hdr.plant_id = plant;\n", "  hdr.plant_id = plant;\n  if (manualPicking) hdr.picking_status = \"Not Created\";\n", 2)

json.loads(raw)
open(dst, "w").write(raw)
print("patched ->", dst)
