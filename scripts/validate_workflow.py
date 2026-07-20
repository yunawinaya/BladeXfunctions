#!/usr/bin/env python3
"""Structural validator for BladeX low-code workflow JSON.

Checks the failure modes that are silent on-platform:
  - unresolvable {{node:<id>...}} selectors
  - code-node return keys missing from response_json
  - if-nodes with an empty true block (crashes the compiler)
  - === used inside an if expression (MVEL evaluates it false silently)
  - duplicate node ids
"""
import json
import re
import sys


def walk(node, out):
    """Yield every node dict in the nested blocks tree."""
    if isinstance(node, dict):
        if "id" in node and "type" in node and isinstance(node["id"], str):
            out.append(node)
        for value in node.values():
            walk(value, out)
    elif isinstance(node, list):
        for value in node:
            walk(value, out)


def code_of(node):
    data = node.get("data") or {}
    script = data.get("script") or {}
    return script.get("code") or ""


def _mask_strings_and_comments(code):
    """Blank out string/comment interiors so brace/paren counting and
    keyword matching below never trip over braces or the word `return`
    hiding inside a quoted string or a comment."""
    out = list(code)
    i, n = 0, len(code)
    while i < n:
        c = code[i]
        if c == "/" and i + 1 < n and code[i + 1] == "/":
            j = i
            while j < n and code[j] != "\n":
                out[j] = " "
                j += 1
            i = j
            continue
        if c == "/" and i + 1 < n and code[i + 1] == "*":
            j = i
            out[j] = out[j + 1] = " "
            j += 2
            while j + 1 < n and not (code[j] == "*" and code[j + 1] == "/"):
                out[j] = " "
                j += 1
            if j + 1 < n:
                out[j] = out[j + 1] = " "
                j += 2
            i = j
            continue
        if c in ("\"", "'", "`"):
            quote = c
            out[i] = " "
            j = i + 1
            while j < n and code[j] != quote:
                if code[j] == "\\" and j + 1 < n:
                    out[j] = out[j + 1] = " "
                    j += 2
                    continue
                out[j] = " "
                j += 1
            if j < n:
                out[j] = " "
                j += 1
            i = j
            continue
        i += 1
    return "".join(out)


def _matching_close(masked, open_idx, open_ch="{", close_ch="}"):
    depth = 0
    for i in range(open_idx, len(masked)):
        c = masked[i]
        if c == open_ch:
            depth += 1
        elif c == close_ch:
            depth -= 1
            if depth == 0:
                return i
    return -1


def _function_scope_intervals(masked):
    """(open, close) index ranges of every nested function/arrow BODY, so
    that a `return {...}` inside a .map()/.filter() callback or a locally
    defined helper isn't mistaken for the code-node's own output."""
    intervals = []
    for m in re.finditer(r"=>\s*\{", masked):
        open_idx = m.end() - 1
        close_idx = _matching_close(masked, open_idx)
        if close_idx != -1:
            intervals.append((open_idx, close_idx))
    for m in re.finditer(r"\bfunction\b", masked):
        paren_idx = masked.find("(", m.end())
        if paren_idx == -1:
            continue
        close_paren = _matching_close(masked, paren_idx, "(", ")")
        if close_paren == -1:
            continue
        rest = masked[close_paren + 1:]
        pad = len(rest) - len(rest.lstrip())
        brace_idx = close_paren + 1 + pad
        if brace_idx < len(masked) and masked[brace_idx] == "{":
            close_idx = _matching_close(masked, brace_idx)
            if close_idx != -1:
                intervals.append((brace_idx, close_idx))
    return intervals


def _inside_any(pos, intervals):
    return any(o < pos < c for o, c in intervals)


def _top_level_keys(content):
    """content = masked text strictly between a return statement's { and },
    split into comma-separated entries at bracket depth 0 so a nested
    object/array's own keys don't leak in as top-level return keys."""
    segments = []
    depth = 0
    current = []
    for c in content:
        if c in "{[(":
            depth += 1
            current.append(c)
        elif c in "}])":
            depth -= 1
            current.append(c)
        elif c == "," and depth == 0:
            segments.append("".join(current))
            current = []
        else:
            current.append(c)
    if current:
        segments.append("".join(current))

    keys = set()
    for seg in segments:
        s = seg.strip()
        if not s or s.startswith("..."):
            continue  # spread: keys unknowable statically, don't guess
        m = re.match(r"^([A-Za-z_$][A-Za-z0-9_$]*)\s*:", s)
        if not m:
            m = re.match(r"^([A-Za-z_$][A-Za-z0-9_$]*)$", s)
        if m:
            keys.add(m.group(1))
    return keys


def returned_keys(code):
    """Every key the code's TOP-LEVEL return statement(s) hand back —
    i.e. return statements not nested inside a callback or helper function
    defined within the same code-node."""
    masked = _mask_strings_and_comments(code)
    intervals = _function_scope_intervals(masked)
    returned = set()
    for m in re.finditer(r"\breturn\b", masked):
        if _inside_any(m.start(), intervals):
            continue
        j = m.end()
        while j < len(masked) and masked[j].isspace():
            j += 1
        if j < len(masked) and masked[j] == "{":
            close_idx = _matching_close(masked, j)
            if close_idx != -1:
                returned |= _top_level_keys(masked[j + 1:close_idx])
    return returned


def main(path):
    doc = json.load(open(path, encoding="utf-8"))
    nodes = []
    walk(doc.get("nodes", []), nodes)

    findings = []
    ids = [n["id"] for n in nodes]

    for node_id in sorted({i for i in ids if ids.count(i) > 1}):
        findings.append(f"duplicate node id: {node_id}")

    id_set = set(ids)
    blob = json.dumps(doc, ensure_ascii=False)

    # 1. every {{node:<id>...}} selector must name a node that exists
    for ref in sorted(set(re.findall(r"\{\{node:([A-Za-z0-9_]+)", blob))):
        if ref not in id_set:
            findings.append(f"selector references missing node: {ref}")

    # 2. code nodes must declare every key they return
    for node in nodes:
        if node.get("type") != "code-node":
            continue
        declared = {
            f.get("name") for f in (node.get("data", {}).get("response_json") or [])
        }
        code = code_of(node)
        returned = returned_keys(code)
        missing = returned - declared
        if missing:
            findings.append(
                f"{node['id']}: returns {sorted(missing)} not declared in response_json"
            )

    # 2b. code-node placeholders must NOT be wrapped in quotes.
    # The platform substitutes {{...}} with a JS EXPRESSION
    # (_meta.cmpData['workflowparams:x']), so '{{...}}' produces nested quotes
    # and the node dies at load time with "Expected ; but found workflowparams".
    # Note if-node expressions are the opposite - there the value is substituted
    # as a bare literal and MUST be quoted - so this check is code-nodes only.
    quoted = re.compile(r"""(['"`])(\{\{[^}]+\}\})\1""")
    for node in nodes:
        if node.get("type") != "code-node":
            continue
        for match in quoted.finditer(code_of(node)):
            line = code_of(node)[: match.start()].count("\n") + 1
            findings.append(
                f"{node['id']}: line {line} wraps a placeholder in quotes "
                f"({match.group(0)}) - code-node placeholders must be bare"
            )

    # 3. if nodes need a non-empty true block, and no === in the expression
    for node in nodes:
        if node.get("type") != "if":
            continue
        blocks = node.get("blocks") or []
        if len(blocks) < 2:
            findings.append(f"{node['id']}: needs both a true and a false ifBlock")
        elif not (blocks[0].get("blocks") or []):
            findings.append(f"{node['id']}: true ifBlock is empty (crashes the compiler)")
        expr = (node.get("data", {}).get("expression") or {}).get("code") or ""
        if "===" in expr or "!==" in expr:
            findings.append(f"{node['id']}: uses ===/!== in an if expression (use ==/!=)")

    # 4. response_json names must match the success end-node's response_value props
    declared_out = {f.get("name") for f in doc.get("response_json") or []}
    for node in nodes:
        data = node.get("data") or {}
        if node.get("type") == "end-node" and data.get("back_data_type") == "OutputParams":
            props = {
                p.get("prop") for p in (data.get("response_value") or {}).get("list") or []
            }
            if props - declared_out:
                findings.append(
                    f"{node['id']}: returns {sorted(props - declared_out)} "
                    "not declared in top-level response_json"
                )

    print(f"{path}: {len(nodes)} nodes")
    if findings:
        for f in findings:
            print(f"  FAIL  {f}")
        return 1
    print("  OK    all structural checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
