"""Escaped-string patcher for workflow JSON. Never re-dumps the file."""
import json, sys

def esc(s):
    return json.dumps(s)[1:-1]

def replace_raw(path, old, new, count=1):
    s = open(path, encoding="utf-8").read()
    n = s.count(old)
    if n != count:
        raise SystemExit(f"FAIL: expected {count} match(es) of raw text, found {n}\n---\n{old[:300]}")
    open(path, "w", encoding="utf-8").write(s.replace(old, new))
    return n

def replace_in_script(path, old, new, count=1):
    """old/new are plain JS text; they are escaped to match the JSON string body."""
    return replace_raw(path, esc(old), esc(new), count)

def check(path):
    d = json.load(open(path, encoding="utf-8"))
    return len(d["nodes"])
