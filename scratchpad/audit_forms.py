#!/usr/bin/env python3
"""Audit a form JSON: dangling handler refs, orphan handlers, unresolved model paths."""
import json, re, sys

path = sys.argv[1]
d = json.load(open(path))

models, tabcols = set(), {}
def walk(nodes, parent=None):
    for x in nodes:
        if not isinstance(x, dict):
            continue
        if "label" in x and "list" in x and "type" not in x:
            walk(x["list"], parent); continue
        m, o = x.get("model"), x.get("options", {}) or {}
        if m: models.add(m)
        newp = m if x.get("type") == "table" else parent
        if parent and m: tabcols.setdefault(parent, set()).add(m)
        for k in ("list", "columns", "children", "tableColumns", "tabs"):
            if isinstance(x.get(k), list): walk(x[k], newp)
        for k in ("list", "columns", "tabs"):
            if isinstance(o.get(k), list): walk(o[k], newp)
walk(d["list"])

names = {s["key"] for s in d["config"]["eventScript"]}
bound, empty_btn = set(), []
def walk2(nodes):
    for x in nodes:
        if not isinstance(x, dict):
            continue
        if "label" in x and "list" in x and "type" not in x:
            walk2(x["list"]); continue
        ev = x.get("events") or {}
        if isinstance(ev, dict):
            for k, v in ev.items():
                if v: bound.add(v)
                elif x.get("type") == "button": empty_btn.append((x.get("model"), k))
        o = x.get("options", {}) or {}
        # List-page CRUD buttons bind their handlers under customProps, not events.
        # viewBtn/editBtn/addBtn reference a func_* key the platform auto-wires and
        # that never exists in eventScript, so only `custom` actions are checked.
        cprops = o.get("customProps") or {}
        for grp in ("rowActions", "toolbar", "batchActions"):
            for a in cprops.get(grp) or []:
                for e in (a.get("events") or []):
                    if not e.get("key"):
                        continue
                    if a.get("type") == "custom":
                        bound.add(e["key"])
                    elif e["key"] in {s["key"] for s in d["config"]["eventScript"]}:
                        bound.add(e["key"])
        for k in ("list", "columns", "children", "tableColumns", "tabs"):
            if isinstance(x.get(k), list): walk2(x[k])
        for k in ("list", "columns", "tabs"):
            if isinstance(o.get(k), list): walk2(o[k])
walk2(d["list"])

STUBS = {"mounted","refresh","onParamUpdate","onBeforeAdd","onAfterAdd","onBeforeUpdate",
         "onAfterUpdate","onFormChange","onCommentPublish","onCommentDelete","onMention","onLoad"}
orphans = [s["key"] for s in d["config"]["eventScript"]
           if s["key"] not in bound and s["key"] not in STUBS
           and (s.get("func") or s.get("rules"))
           and (str(s.get("func") or "").strip()
                or any((r.get("options", {}) or {}).get("func", "").strip()
                       for r in (s.get("rules") or []) if isinstance(r, dict)))]

def resolves(p):
    parts = p.split(".")
    if parts[0] not in models: return False
    if len(parts) >= 3 and re.fullmatch(r"\d+", parts[1]):
        return parts[2] in tabcols.get(parts[0], set())
    return True

KNOWN_NON_MODELS = {"id"}
bad = {}
for s in d["config"]["eventScript"]:
    code = s.get("func") or ""
    for r in (s.get("rules") or []):
        if isinstance(r, dict):
            code += "\n" + ((r.get("options", {}) or {}).get("func") or "")
    if not code.strip():
        continue
    b = set()
    for m in re.finditer(r"""(?:getValue|disabled|setOptionData|display|hide)\(\s*\[?\s*["'`]([A-Za-z0-9_.]+)["'`]""", code):
        if not resolves(m.group(1)): b.add(m.group(1))
    for m in re.finditer(r"""\[\s*`([A-Za-z0-9_]+)\.\$\{[^}]*\}\.([A-Za-z0-9_]+)`\s*\]""", code):
        if m.group(1) not in models or m.group(2) not in tabcols.get(m.group(1), set()):
            b.add("%s.*.%s" % (m.group(1), m.group(2)))
    for m in re.finditer(r"setData\(\s*\{", code):
        i, depth = m.end() - 1, 0
        for j in range(i, len(code)):
            if code[j] == "{": depth += 1
            elif code[j] == "}":
                depth -= 1
                if depth == 0: break
        for km in re.finditer(r"(?:^|[{,])\s*([A-Za-z_][A-Za-z0-9_]*)\s*:", code[i:j+1]):
            if km.group(1) not in models and km.group(1) not in KNOWN_NON_MODELS:
                b.add(km.group(1))
    if b: bad[s.get("name")] = sorted(b)

print("== %s" % path)
print("  dangling handler refs :", sorted(b for b in bound if b not in names) or "none")
print("  orphan handlers       :", orphans or "none")
print("  buttons w/ empty click:", empty_btn or "none")
print("  unresolved model paths:", bad or "none")
# A repeated key in a setData object literal silently drops the earlier value —
# the shape a careless find/replace leaves behind.
dupes = {}
for s in d["config"]["eventScript"]:
    code = s.get("func") or ""
    for r in (s.get("rules") or []):
        if isinstance(r, dict):
            code += "\n" + ((r.get("options", {}) or {}).get("func") or "")
    for m in re.finditer(r"setData\(\s*\{", code):
        i, depth = m.end() - 1, 0
        for j in range(i, len(code)):
            if code[j] == "{": depth += 1
            elif code[j] == "}":
                depth -= 1
                if depth == 0: break
        keys = re.findall(r"(?:^|[{,])\s*([A-Za-z_][A-Za-z0-9_]*)\s*:", code[i:j+1])
        rep = sorted({k for k in keys if keys.count(k) > 1})
        if rep:
            dupes.setdefault(s.get("name"), set()).update(rep)
print("  duplicate setData keys :", {k: sorted(v) for k, v in dupes.items()} or "none")

sus = re.findall(r"\b[a-z_][a-z0-9_]*_[12]\b", json.dumps(d["config"]["eventScript"]))
sus = sorted({s for s in sus if s not in models and s not in ("item_remark_2","item_remark_3")})
print("  suspicious _1/_2 idents:", sus or "none")
