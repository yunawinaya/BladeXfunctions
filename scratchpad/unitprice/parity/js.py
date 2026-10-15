"""Calls parity/harness.js: run([(id, fn, args)]) -> {id: (res, err, ms)}"""
import json, os, subprocess, tempfile

H = os.path.join(os.path.dirname(os.path.abspath(__file__)), "harness.js")
FX = "/private/tmp/claude-501/-Users-yunawinaya-Developer-BladeXfunctions/3184bace-c1a2-43fd-9910-40a12d531785/scratchpad/unitprice_fx"


def run(cases):
    d = tempfile.mkdtemp(dir=FX)
    inp, outp = os.path.join(d, "in.jsonl"), os.path.join(d, "out.jsonl")
    with open(inp, "w") as f:
        for cid, fn, args in cases:
            f.write(json.dumps({"id": cid, "fn": fn, "args": args}, ensure_ascii=False) + "\n")
    r = subprocess.run(["node", H, inp, outp], capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(r.stderr[-2000:])
    res = {}
    for line in open(outp):
        o = json.loads(line)
        res[o["id"]] = (o["res"], o["err"], o["ms"])
    return res
