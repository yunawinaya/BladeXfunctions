"""python3 scratchpad/iasc/test/mutants_v14.py - each mutant of IA_SAVE v14's output split must make test/test_v14_sim.js fail: a code mutant
(code/classic/os_*.js) is built into a temp folder; a wiring mutant edits the built IA_SAVE.json (patch_v14's props, conditions, SQL)."""
import os, shutil, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
IASC = os.path.dirname(HERE)
MUTANTS = [
    # code: the merge, the completion check, the numbering, the header, the receipts
    ("merge: the stored rows ignored (mobile)", "classic/os_merge.js", "osMerge(a, src ? src.stored : null,", "osMerge(a, null,"),
    ("check: the items not read", "classic/os_check.js", "osCompletion(m, a, items,", "osCompletion(m, a, [],"),
    ("check: the bins not read", "classic/os_check.js", "osJ([{{node:sql_node_OSbins.data}}][0])", "null"),
    ("final: the generated numbers ignored", "classic/os_final.js", "[{{node:get_OSbatchesFinal.data}}][0]);", "null);"),
    ("head: never written", "classic/os_head.js", 'need: f.split === "YES" && osS(p.docId) !== "" ? "YES" : "NO"', 'need: "NO"'),
    ("head: the payload's id (none on an Add)", "classic/os_head.js", "id: osS(p.docId), storage_location_id", "id: osS(a.id), storage_location_id"),
    ("plan: no IA number on the Batch rows", "classic/os_plan.js", "osBatchRows(f.groups || [], a, p.stock_movement_no)", "osBatchRows(f.groups || [], a, \"\")"),
    ("plan: no Batch rows for a batch item", "classic/os_plan.js", 'const batch = f.kind === "SYSTEM" || f.kind === "MANUAL";', "const batch = false;"),
    ("batch ids: none passed on", "classic/os_batch_ids.js", 'return { ids: ids.join(",") || "0"', 'return { ids: "0"'),
    ("receipts: the read-back ignored", "classic/os_receipts.js", "osJ([{{node:sql_node_OSbatchRead.data}}][0]),", "null,"),
    ("add pick: no batch id", "classic/os_add_pick.js", "batch_id: r.batch_id,", "batch_id: null,"),
    ("add pick: the row's qty lost", "classic/os_add_pick.js", "quantity: r.quantity,", "quantity: 1,"),
    ("exit row: no k/n on the claim", "classic/os_exit_row.js", 'const ref = "PARTIAL|RECEIPT|" + k + "/" + n;', 'const ref = "PARTIAL|RECEIPT";'),
    ("exit batch: no 0/n on the claim", "classic/os_exit_batch.js", 'const ref = "PARTIAL|RECEIPT|" + {{node:code_node_OSreceipts.data.marker}};', 'const ref = "PARTIAL|RECEIPT";'),
    ("gen pick: the group's dates dropped", "classic/os_gen_pick.js", "manufacturing_date: g.manufacturing_date || null,", "manufacturing_date: null,"),
    ("gen norm: an empty number not stopped", "classic/os_gen_norm.js", "isError: batchNumber === '' ? 1 : 0,", "isError: 0,"),
    ("gen append: every number at index 0", "classic/os_gen_append.js", "index: {{node:code_OSgenPick.data.index}},", "index: 0,"),
    # wiring (the built JSON)
    ("wiring: v25's single number also generated for a split", "built",
     "{{node:code_batch_decide.data.needsGen}} == 1 && '{{node:code_node_OSmerge.data.split}}' != 'YES'", "{{node:code_batch_decide.data.needsGen}} == 1"),
    ("wiring: a Draft writes the completion's rows", "built", '"value": "{{node:code_node_OSmerge.data.output_split}}"', '"value": "{{node:code_node_OSfinal.data.output_split}}"'),
    ("wiring: a completion writes the merged rows (no numbers)", "built", '"value": "{{node:code_node_OSfinal.data.output_split}}"', '"value": "{{node:code_node_OSmerge.data.output_split}}"'),
    ("wiring: every receipt takes the split branch", "built", "\"code\": \"'{{node:code_node_OSmerge.data.split}}' == 'YES'\"\n", "\"code\": \"'{{node:code_node_OSmerge.data.split}}' != 'NONE'\"\n"),
    ("wiring: the row's Batch id not sent", "built", '"value": "{{node:code_node_OSaddPick.data.batch_id}}"', '"value": ""'),
    ("wiring: the stored split not read (mobile)", "built", "'output_split', h.output_split, ", "'output_split', NULL, "),
    ("wiring: the split check never stops", "built", "\"code\": \"'{{node:code_node_OScheck.data.route}}' == 'STOP'\"", "\"code\": \"false\""),
    ("wiring: the merge never stops", "built", "\"code\": \"'{{node:code_node_OSmerge.data.route}}' == 'STOP'\"", "\"code\": \"false\""),
    ("wiring: the header's row-1 fields from the payload", "built", '"value": "{{node:code_node_OShead.data.batch_no}}"', '"value": "{{node:code_fillback.data.allData.batch_no}}"'),
]
tmp13 = tempfile.mkdtemp(prefix="sc-v14-base-")
b = subprocess.run([sys.executable, os.path.join(IASC, "classic", "patch_v13.py"), "--write"], env=dict(os.environ, IASC_OUT=tmp13), capture_output=True, text=True)
assert b.returncode == 0, b.stderr[-800:]
V13 = os.path.join(tmp13, "IA_SAVE.json")
survived = 0
for name, rel, old, new in MUTANTS:
    tmp = tempfile.mkdtemp(prefix="sc-v14-mut-")
    code, out = os.path.join(tmp, "code"), os.path.join(tmp, "out")
    shutil.copytree(os.path.join(IASC, "code"), code)
    if rel != "built":
        path = os.path.join(code, rel)
        text = open(path).read()
        if old not in text:
            print("BROKEN mutant (anchor not found): " + name)
            survived += 1
            continue
        open(path, "w").write(text.replace(old, new, 1))
    env = dict(os.environ, IASC_CODE=code, IASC_OUT=out)
    b = subprocess.run([sys.executable, os.path.join(IASC, "classic", "patch_v14.py"), "--write"], env=env, capture_output=True, text=True)
    if b.returncode:
        print("killed at build: " + name)
        continue
    built = os.path.join(out, "IA_SAVE.json")
    if rel == "built":
        text = open(built).read()
        if old not in text:
            print("BROKEN mutant (anchor not found in the build): " + name)
            survived += 1
            continue
        open(built, "w").write(text.replace(old, new))
    r = subprocess.run(["node", os.path.join(HERE, "test_v14_sim.js")], env=dict(os.environ, IA_V13=V13, IA_V14=built), capture_output=True, text=True)
    if r.returncode == 0:
        survived += 1
        print("SURVIVED: " + name)
    shutil.rmtree(tmp, ignore_errors=True)
print(("FAILED %d of " % survived if survived else "ok - all killed: ") + "%d mutants" % len(MUTANTS))
sys.exit(1 if survived else 0)
