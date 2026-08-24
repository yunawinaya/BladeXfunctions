"""Run a workflow code-node's script for real, with placeholders bound to fixtures."""
import json, re, subprocess, tempfile, os

def idx(nodes, m):
    for n in nodes:
        if isinstance(n, dict):
            if n.get("id"): m[n["id"]] = n
            idx(n.get("blocks") or [], m)
    return m

def load(path):
    d = json.load(open(path, encoding="utf-8"))
    return idx(d["nodes"], {})

def bind(src):
    src = re.sub(r"\{\{workflowparams:([^}]*)\}\}", r"F.wp.\1", src)
    src = re.sub(r"\{\{node:([^}]*)\}\}", r"F.node.\1", src)
    return src

def run(script, fixtures, extra=""):
    js = (
        "const F = " + json.dumps(fixtures) + ";\n"
        "const out = (function(){\n" + bind(script) + "\n})();\n"
        + extra +
        "console.log(JSON.stringify(out));\n"
    )
    fd, path = tempfile.mkstemp(suffix=".js"); os.write(fd, js.encode()); os.close(fd)
    r = subprocess.run(["node", path], capture_output=True, text=True)
    os.unlink(path)
    if r.returncode:
        raise RuntimeError(r.stderr[:1500])
    return json.loads(r.stdout.strip().splitlines()[-1])
