#!/usr/bin/env python3
"""node --check every code-node script / end-node msg in a workflow JSON.

Placeholders are not JS, so each {{...}} is swapped for a literal `null` first.
Scripts are wrapped in a function because they use a bare top-level `return`.
"""
import json, re, subprocess, sys, tempfile, os

PH = re.compile(r"\{\{[^}]*\}\}")

def check(path):
    d = json.load(open(path))
    items, bad = [], 0
    def walk(bs):
        for n in bs:
            dd = n.get("data") or {}
            sc = (dd.get("script") or {}).get("code")
            if sc:
                items.append((n["id"], "script", sc, True))
            msg = (dd.get("msg") or {}).get("code")
            if msg:
                items.append((n["id"], "msg", msg, False))
            expr = (dd.get("expression") or {}).get("code")
            if expr and n.get("type") == "if":
                items.append((n["id"], "if-expr", expr, False))
            walk(n.get("blocks") or [])
    walk(d["nodes"])

    for nid, kind, code, wrap in items:
        js = PH.sub("null", code)
        if kind == "if-expr":
            # MVEL, not JS: only == != > < && || are legal.
            for banned in ("===", "!==", ".indexOf", "["):
                if banned in js:
                    print("  MVEL  %-22s %s contains %r" % (nid, kind, banned)); bad += 1
            continue
        src = "(function(){\n%s\n})" % js if wrap else "(%s)" % js
        with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as fh:
            fh.write(src); tmp = fh.name
        r = subprocess.run(["node", "--check", tmp], capture_output=True, text=True)
        os.unlink(tmp)
        if r.returncode != 0:
            print("  SYNTAX %-22s %s\n%s" % (nid, kind, r.stderr[:600])); bad += 1
    print("%s: %d scripts/exprs checked, %d problem(s)" % (path, len(items), bad))
    return bad

sys.exit(1 if sum(check(p) for p in sys.argv[1:]) else 0)
