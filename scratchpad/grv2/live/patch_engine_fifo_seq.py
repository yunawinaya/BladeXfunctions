"""INVENTORY_BULK_APPLY: a new FIFO layer's fifo_sequence is written as text ("4"), and the read-back / resume match a
sequence by its number, so layers stored as "4.0" (a JS number in the varchar(255) column) still match. Found by the 2,000-line
GR V2 live run 2026-10-15: every new layer read back as "N.0", the read-back called it missing (REQUIRES_REVIEW), and a
resume would have inserted the layers again. Applied to the engine sources (scratchpad/gdc) and the deployed JSON alike.

usage: python3 patch_engine_fifo_seq.py [--check]
"""
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
SEQ = 'String(parseInt(c.fifo_sequence || 0, 10))'
EDITS = [
    ("fifo_sequence: next,", "fifo_sequence: String(next),"),
    ('if (t === "fifo") return [c.material_id, c.plant_id, c.batch_id, c.fifo_sequence].join("|");',
     'if (t === "fifo") return [c.material_id, c.plant_id, c.batch_id, %s].join("|");' % SEQ),
    ('if (t === "fifo") k.fifo_sequence = s(c.fifo_sequence);', 'if (t === "fifo") k.fifo_sequence = %s;' % SEQ),
    ('const norm = (k, v) => (k === "batch_id" && (v === null || v === undefined || s(v) === "0") ? "" : s(v));',
     'const norm = (k, v) => (k === "batch_id" && (v === null || v === undefined || s(v) === "0") ? "" : k === "fifo_sequence" ? String(parseInt(v || 0, 10)) : s(v));'),
]
SOURCES = ["scratchpad/gdc/engine/core.js", "scratchpad/gdc/iba/code/plan.js", "scratchpad/gdc/iba/code/verify.js"]
JSON_FILE = "Balance Table/INVENTORY_BULK_APPLY.json"
CHECK = "--check" in sys.argv


def apply(text, where):
    out = text
    for old, new in EDITS:
        if new in out:
            continue
        n = out.count(old)
        if n > 1:
            sys.exit("%s: %r found %d times" % (where, old[:50], n))
        out = out.replace(old, new)
    return out


changed = []
for rel in SOURCES:
    p = os.path.join(ROOT, rel)
    t = open(p, encoding="utf-8").read()
    u = apply(t, rel)
    if u != t:
        changed.append(rel)
        if not CHECK:
            open(p, "w", encoding="utf-8").write(u)

p = os.path.join(ROOT, JSON_FILE)
raw = open(p, encoding="utf-8").read()
doc = json.loads(raw)
assert json.dumps(doc, indent=1, ensure_ascii=False) == raw, "the engine JSON does not round-trip; refusing to rewrite it"


def walk(o):
    if isinstance(o, dict):
        if o.get("type") == "code-node":
            sc = (o.get("data") or {}).get("script") or {}
            if isinstance(sc.get("code"), str):
                sc["code"] = apply(sc["code"], o.get("id"))
        for v in o.values():
            walk(v)
    elif isinstance(o, list):
        for v in o:
            walk(v)


walk(doc)
new = json.dumps(doc, indent=1, ensure_ascii=False)
if new != raw:
    changed.append(JSON_FILE)
    if not CHECK:
        open(p, "w", encoding="utf-8").write(new)
left = sum(new.count(json.dumps(old)[1:-1]) for old, _ in EDITS)
print(("would change" if CHECK else "changed"), changed or "nothing", "| old forms left in the JSON:", left)
