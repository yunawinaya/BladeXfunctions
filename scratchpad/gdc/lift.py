"""Lift deployed nodes, verbatim, out of a mirror workflow .ts (DSL) for reuse in a new workflow.

node_block(src, node_id) -> the full statement that defines the node (leading /* @id */ comment included),
found by its `const <id> = await` / `/* @id <id> */` anchor and ended where its bracket depth returns to zero.
substitute(text, subs) -> the same text with every token in subs replaced (exact string replacement), asserting
each token was present. Code bodies are JS string literals inside the DSL: tokens are replaced inside them as text.
"""
import re


def _scan_end(src, i):
    """i points at the first char of a statement; return the index just past its terminating ';' at depth 0."""
    depth = 0
    q = None
    esc = False
    k = i
    while k < len(src):
        c = src[k]
        if q:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == q:
                q = None
        else:
            if c in "'\"`":
                q = c
            elif c in "([{":
                depth += 1
            elif c in ")]}":
                depth -= 1
            elif c == ";" and depth == 0:
                return k + 1
        k += 1
    raise ValueError("unterminated statement")


def node_block(src, node_id):
    m = re.search(r"(?m)^([ \t]*)(?:/\* @id " + re.escape(node_id) + r"(?: @title \"[^\"]*\")? \*/ )?(?:const " + re.escape(node_id) + r" = )?await ", src)
    pos = None
    for mm in re.finditer(r"(?m)^[ \t]*(?:/\* @id (\w+)[^*]*\*/ )?(?:const (\w+) = )?await \w+\(", src):
        if mm.group(1) == node_id or mm.group(2) == node_id:
            pos = mm
            break
    if not pos:
        raise KeyError(node_id)
    start = pos.start()
    end = _scan_end(src, pos.start() + len(pos.group(0)) - 1)
    return src[start:end]


def substitute(text, subs):
    for a, b in subs.items():
        if a not in text:
            raise KeyError("token not found: " + a)
        text = text.replace(a, b)
    return text


if __name__ == "__main__":
    import sys
    src = open(sys.argv[1], encoding="utf-8").read()
    for nid in sys.argv[2:]:
        b = node_block(src, nid)
        print("=====", nid, len(b), "chars")
        print(b[:300].replace("\n", "\n  "), "...")
