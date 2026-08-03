#!/usr/bin/env python3
"""
Static linter for low-code workflow JSON.

Catches the bug classes that the platform fails silently on:

  MISSING      {{node:X}} where X is not a node in the file.
  FORWARD      {{node:X}} where X executes AFTER the referring node -> null at runtime.
  DIVERGENT    {{node:X}} where X sits in a sibling branch of the same condition-or-node
               (or the opposite ifBlock of the same if) -> the two never co-execute -> null.
  CONDITIONAL  {{node:X}} where X is inside an if/loop the referrer is not inside. Resolves
               only when that branch happened to run. Often intentional (guarded in code),
               so this is informational.
  UNDECLARED   a key returned by a code-node that is missing from its response_json ->
               the platform emits {} for it and downstream reads null.
  UNUSED       a node whose output nothing references and which has no side effect
               (i.e. not a write / return / cache-set / loop / control node).

Usage:
    python3 scratchpad/validate.py <workflow.json> [<workflow.json> ...]
    python3 scratchpad/validate.py --only DIVERGENT,UNUSED <workflow.json>

Exit code is 1 if any non-informational finding is reported.
"""

import json
import re
import sys

# Node types that do something even when nobody reads their output.
SIDE_EFFECT_TYPES = {
    "add-node",
    "update-node",
    "delete-node",
    "return-node",
    "set-cache-node",
    "start-node",
    "end-node",
    # Sub-workflows are routinely fire-and-forget (they write on their own).
    "workflow-node",
    "loop",
    "if",
    "ifBlock",
    "condition-or-node",
    "condition-or-node-item",
    "condition-all-node",
}

# Container keys that hold child nodes.
CHILD_KEYS = ("blocks", "children", "nodes")

NODE_REF = re.compile(r"\{\{node:([A-Za-z0-9_\-]+)")
# ConditionRule filters address nodes as "node.<id>.data.<field>" instead of {{node:...}}.
PROP_REF = re.compile(r"^node\.([A-Za-z0-9_\-]+)\.")

INFORMATIONAL = {"CONDITIONAL"}


def children_of(node):
    out = []
    data = node.get("data") or {}
    for key in CHILD_KEYS:
        for holder in (node, data):
            val = holder.get(key)
            if isinstance(val, list) and val and isinstance(val[0], dict):
                out.extend(val)
    return out


def build_index(root_nodes):
    """Pre-order walk. Returns id -> {node, path, order}.

    `path` is the chain of ancestor node ids, so two nodes can be compared for
    branch divergence by finding where their paths first differ.
    """
    index = {}
    order = [0]

    def walk(nodes, path):
        for node in nodes:
            nid = node.get("id")
            if not nid:
                continue
            if nid in index:
                print(f"  DUPLICATE  node id {nid!r} appears more than once")
            index[nid] = {
                "node": node,
                "path": list(path),
                "order": order[0],
                "type": node.get("type"),
            }
            order[0] += 1
            walk(children_of(node), path + [nid])

    walk(root_nodes, [])
    return index


def divergence(index, src_id, dst_id):
    """Classify how src's branch relates to dst's branch.

    Returns (kind, detail) where kind is None (same branch), "DIVERGENT", or
    "CONDITIONAL".
    """
    src = index[src_id]
    dst = index[dst_id]
    src_chain = src["path"] + [src_id]
    dst_chain = dst["path"] + [dst_id]

    # Walk down the common prefix until the chains diverge.
    i = 0
    while i < len(src_chain) and i < len(dst_chain) and src_chain[i] == dst_chain[i]:
        i += 1

    # dst is an ancestor of src (or vice versa) -> always co-executes.
    if i == len(dst_chain) or i == len(src_chain):
        return None, ""

    # i is the first differing position. Its parent is the branch point.
    parent_id = src_chain[i - 1] if i > 0 else None
    parent_type = index[parent_id]["type"] if parent_id else None

    src_branch = index[src_chain[i]]
    dst_branch = index[dst_chain[i]]

    # Siblings under a condition-or-node / if are mutually exclusive.
    if parent_type in ("condition-or-node", "condition-all-node", "if"):
        if src_branch["type"] in ("condition-or-node-item", "ifBlock") and dst_branch[
            "type"
        ] in ("condition-or-node-item", "ifBlock"):
            label = (index[parent_id]["node"].get("data") or {}).get("name") or parent_id
            return (
                "DIVERGENT",
                f"branches of {parent_type} {label!r} are mutually exclusive",
            )

    # Guards the source is itself under. Two sibling `if`s with byte-identical
    # conditions always co-execute, so a reference across them is not
    # conditional -- MSR/GR both split their work across duplicated
    # `IF !Draft` blocks and rely on exactly that.
    src_guards = {
        _guard_key(index[a]["node"])
        for a in src_chain[:-1]
        if index[a]["type"] == "if"
    }

    # dst is nested inside a conditional/loop that src is not inside.
    for anc_id in dst_chain[i:-1]:
        anc_type = index[anc_id]["type"]
        if anc_type in ("if", "loop", "condition-or-node", "condition-all-node"):
            if anc_type == "if" and _guard_key(index[anc_id]["node"]) in src_guards:
                continue
            label = (index[anc_id]["node"].get("data") or {}).get("name") or anc_id
            return "CONDITIONAL", f"target is nested inside {anc_type} {label!r}"

    return None, ""


def _guard_key(if_node):
    """Identity of an `if`'s condition, ignoring cosmetic ids/labels."""
    data = if_node.get("data") or {}
    leaves = []

    def scan(obj):
        if isinstance(obj, dict):
            if obj.get("type") == "leaf" and obj.get("prop"):
                leaves.append((obj.get("prop"), obj.get("operator"), json.dumps(obj.get("value"), sort_keys=True)))
            for value in obj.values():
                scan(value)
        elif isinstance(obj, list):
            for item in obj:
                scan(item)

    scan(data.get("filter"))
    expr = ((data.get("expression") or {}).get("code") or "").strip()
    return json.dumps({"leaves": sorted(leaves), "expr": expr}, sort_keys=True)


def iter_refs(node):
    """Yield (referenced_id, where) for every node reference inside `node`.

    Only the node's own payload is scanned; child blocks are stripped so a
    reference is attributed to the node that actually makes it.
    """
    data = dict(node.get("data") or {})
    for key in CHILD_KEYS:
        data.pop(key, None)

    payload = json.dumps(data, ensure_ascii=False)
    for match in NODE_REF.finditer(payload):
        yield match.group(1), "template"

    # ConditionRule filter leaves use the "node.<id>.data.<field>" form.
    def scan_filters(obj):
        if isinstance(obj, dict):
            prop = obj.get("prop")
            if isinstance(prop, str):
                m = PROP_REF.match(prop)
                if m:
                    yield m.group(1), "filter"
            for value in obj.values():
                yield from scan_filters(value)
        elif isinstance(obj, list):
            for item in obj:
                yield from scan_filters(item)

    yield from scan_filters(data)


def returned_keys(code):
    """Top-level keys of the last `return { ... }` in a code-node script."""
    starts = [m.end() - 1 for m in re.finditer(r"\breturn\s*\{", code)]
    if not starts:
        return None
    start = starts[-1]

    depth = 0
    i = start
    quote = None
    body_start = start + 1
    while i < len(code):
        ch = code[i]
        if quote:
            if ch == "\\":
                i += 2
                continue
            if ch == quote:
                quote = None
        elif ch in "\"'`":
            quote = ch
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                break
        i += 1
    body = code[body_start:i]

    keys = []
    depth = 0
    quote = None
    token = ""
    for ch in body:
        if quote:
            token += ch
            if ch == quote:
                quote = None
            continue
        if ch in "\"'`":
            quote = ch
            token += ch
            continue
        if ch in "{[(":
            depth += 1
        elif ch in "}])":
            depth -= 1
        if ch == "," and depth == 0:
            keys.append(token)
            token = ""
        else:
            token += ch
    keys.append(token)

    out = []
    for raw in keys:
        raw = re.sub(r"//.*", "", raw).strip()
        if not raw:
            continue
        # `key: value`, `key,` (shorthand), or `...spread`
        m = re.match(r"^([A-Za-z_$][A-Za-z0-9_$]*)\s*(:|$)", raw)
        if m:
            out.append(m.group(1))
        elif raw.startswith("..."):
            return None  # spread -> keys not statically known, skip the check
    return out


def check(path, only=None):
    with open(path) as fh:
        doc = json.load(fh)

    index = build_index(doc.get("nodes", []))
    findings = []
    referenced = set()

    for nid, info in index.items():
        node = info["node"]
        for ref, where in iter_refs(node):
            if ref == nid:
                continue
            referenced.add(ref)

            if ref not in index:
                findings.append(("MISSING", nid, f"references unknown node {ref!r} ({where})"))
                continue

            # Divergence is checked first: a cross-branch reference is also
            # positionally "later", but the branch split is the real cause.
            kind, detail = divergence(index, nid, ref)
            if kind:
                findings.append((kind, nid, f"references {ref!r}: {detail}"))
                continue

            if index[ref]["order"] > info["order"]:
                findings.append(
                    ("FORWARD", nid, f"references {ref!r} which executes later -> null")
                )

        if info["type"] == "code-node":
            script = ((node.get("data") or {}).get("script") or {}).get("code") or ""
            keys = returned_keys(script)
            if keys is not None:
                declared = {
                    entry.get("name")
                    for entry in (node.get("data") or {}).get("response_json") or []
                }
                for key in keys:
                    if key not in declared:
                        findings.append(
                            ("UNDECLARED", nid, f"returns {key!r} but response_json omits it")
                        )

    for nid, info in index.items():
        if nid in referenced:
            continue
        if info["type"] in SIDE_EFFECT_TYPES:
            continue
        label = (info["node"].get("data") or {}).get("name") or ""
        findings.append(("UNUSED", nid, f"{info['type']} {label!r} output is never referenced"))

    if only:
        findings = [f for f in findings if f[0] in only]

    print(f"\n=== {path}  ({len(index)} nodes)")
    if not findings:
        print("  clean")
    order = ["MISSING", "FORWARD", "DIVERGENT", "UNDECLARED", "UNUSED", "CONDITIONAL"]
    findings.sort(key=lambda f: (order.index(f[0]) if f[0] in order else 99, f[1]))
    for kind, nid, message in findings:
        print(f"  {kind:<12} {nid:<28} {message}")

    return [f for f in findings if f[0] not in INFORMATIONAL]


def main():
    args = sys.argv[1:]
    only = None
    if args and args[0] == "--only":
        only = set(args[1].split(","))
        args = args[2:]
    if not args:
        print(__doc__)
        return 2

    failures = 0
    for path in args:
        failures += len(check(path, only))
    print()
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
