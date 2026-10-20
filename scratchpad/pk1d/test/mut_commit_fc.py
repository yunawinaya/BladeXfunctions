"""mut_commit_fc.py: each MUTANT undoes one force-complete rule of the patched PICKING_BULK_COMMIT (in a copy under a temp dir) and
runs test_commit_fc.js on it (PK_OUT), which must then FAIL. usage: python3 mut_commit_fc.py"""
import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
R = "/Users/yunawinaya/Developer/BladeXfunctions/"
SRC = R + "Picking/AsyncV2/"
MUTANTS = [
    ("FC_GDS gate off", "code_node_PCentry", "if (fc && !done.FC_GDS) return", "if (false) return"),
    ("P0: a change fails + unlocks (as a confirm)", "code_node_PCp0", "  if (fc) {\n    const whyFc", "  if (false) {\n    const whyFc"),
    ("P0: records not compared", "code_node_PCp0", "if (fc && (Number(rec.id)", "if (false && (Number(rec.id)"),
    ("P0: delivery status absolute (as a confirm)", "code_node_PCp0", "else if (fc ? st !== s(snap.gds[g]) :", "else if (false ? 0 :"),
    ("P1: an open line does not stop the write", "code_node_PCp1merge", "  if (fc && toStatus !== \"Completed\") {", "  if (false) {"),
    ("P4: a completed delivery rolled up", "code_node_PCp4plan", ' || s(h.gd_status) === "Completed") {', ") {"),
    ("P5: a completed delivery packed", "code_node_PCp5build", ' || s(gd.gd_status) === "Completed" ||', " ||"),
]


def walk(ns):
    for n in ns:
        yield n
        yield from walk(n.get("blocks") or [])


def main():
    killed = 0
    for name, nid, a, b in MUTANTS:
        tmp = tempfile.mkdtemp(prefix="mutc_")
        try:
            for f in os.listdir(SRC):
                if f.endswith(".json"):
                    shutil.copy(SRC + f, os.path.join(tmp, f))
            doc = json.load(open(SRC + "PICKING_BULK_COMMIT.json"))
            node = [n for n in walk(doc["nodes"]) if n.get("id") == nid][0]
            code = node["data"]["script"]["code"]
            assert code.count(a) == 1, "%s: %r occurs %d times" % (name, a, code.count(a))
            node["data"]["script"]["code"] = code.replace(a, b)
            json.dump(doc, open(os.path.join(tmp, "PICKING_BULK_COMMIT.json"), "w"))
            r = subprocess.run(["node", os.path.join(HERE, "test_commit_fc.js")], capture_output=True, text=True, env=dict(os.environ, PK_OUT=tmp))
            ok = r.returncode != 0
            killed += ok
            print("%s %s%s" % ("KILLED  " if ok else "SURVIVED", name, "" if ok else "  <- " + r.stdout.strip().split("\n")[-1]))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
    print("%d/%d mutants killed" % (killed, len(MUTANTS)))
    sys.exit(0 if killed == len(MUTANTS) else 1)


if __name__ == "__main__":
    main()
