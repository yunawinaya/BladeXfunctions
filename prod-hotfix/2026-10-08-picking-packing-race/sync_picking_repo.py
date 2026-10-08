#!/usr/bin/env python3
"""Mirror PICKING.PROD.json into the repo's PICKING files, keeping their formatting.

The change is structural (the parallel block becomes two if-nodes), so a line diff of two
renderings cannot be patched onto the hand-formatted files. Instead the block's text is replaced
in place: the add-node and the loop move verbatim (same nesting depth), the if-node shells are
rendered, and one Prettier pass over the file normalizes only what changed -- Prettier keeps every
existing object's expanded/collapsed layout.

The starting text is the bug-register sync of HEAD (../2026-10-08-bug-register/sync_repo.py), so a
re-run from any state gives the same result.   usage: python3 sync_repo.py [--write]"""
import copy, difflib, json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "2026-10-08-bug-register"))
import build as hb  # noqa: E402
import sync_repo as sr  # noqa: E402

FILES = ["Picking/PickingProcessWorkflow.json", "Picking/PickingProcessWorkflow.PROD.json"]
BLOCK, MOVED = "condition_all_NEt9SBHT", ("add_node_LcxwYc7z", "loop_PackingUpdates")


def prettier(text):
    """Prettier, keeping the input's own final-newline convention (these files have none)."""
    r = subprocess.run(["node", sr.PRETTIER, "--parser", "json"], input=text, capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(r.stderr[:400])
    return r.stdout if text.endswith("\n") else r.stdout.rstrip("\n")


def object_spans(text):
    """id -> [(start, end)] for every JSON object whose "id" is a string."""
    out, stack, i = {}, [], 0
    while i < len(text):
        c = text[i]
        if c == '"':
            j = i + 1
            while text[j] != '"':
                j += 2 if text[j] == "\\" else 1
            k = j + 1
            while text[k] in " \t\r\n":
                k += 1
            if stack and stack[-1][0] == "{":
                if text[k] == ":":
                    stack[-1][2] = json.loads(text[i:j + 1])
                elif stack[-1][2] == "id" and stack[-1][3] is None:
                    stack[-1][3] = json.loads(text[i:j + 1])
            i = j + 1
            continue
        if c in "{[":
            stack.append([c, i, None, None])
        elif c in "}]":
            kind, start, _, oid = stack.pop()
            if kind == "{" and oid is not None:
                out.setdefault(oid, []).append((start, i + 1))
        i += 1
    return out


def bug_register_text(rel):
    head = subprocess.run(["git", "show", f"HEAD:{rel}"], capture_output=True, text=True, cwd=sr.REPO).stdout
    current = json.loads(head)
    target = json.load(open(os.path.join(sr.HERE, "PICKING.PROD.json"), encoding="utf-8"))
    if hb.canon(current) == hb.canon(target):
        return head
    out, err = sr.apply_hunks(sr.normalize_changed_code(head, current, target), sr.render(current), sr.render(target))
    if out is None or hb.canon(json.loads(out)) != hb.canon(target):
        raise SystemExit(f"cannot rebuild the bug-register state of {rel}: {err}")
    return out


def apply_fix(text, target):
    spans = object_spans(text)
    (bs, be), = spans[BLOCK]
    moved = {}
    for nid in MOVED:
        (s, e), = spans[nid]
        assert bs < s < e < be
        moved[nid] = text[s:e]
    shells = []
    for if_id, nid in (("if_PkCreates", MOVED[0]), ("if_PkUpdates", MOVED[1])):
        node = copy.deepcopy(hb.find(target, if_id)[0])
        assert [n["id"] for n in node["blocks"][0]["blocks"]] == [nid]
        node["blocks"][0]["blocks"] = [f"@@{nid}@@"]
        shells.append(sr.render(node).strip().replace(json.dumps(f"@@{nid}@@"), moved[nid]))
    return prettier(text[:bs] + ",\n".join(shells) + text[be:])


def main(write):
    target = json.load(open(os.path.join(HERE, "PICKING.PROD.json"), encoding="utf-8"))
    ok = True
    for rel in FILES:
        base = bug_register_text(rel)
        assert prettier(base) == base, f"{rel}: the bug-register text is not Prettier-stable"
        out = apply_fix(base, target)
        good = hb.canon(json.loads(out)) == hb.canon(target)
        ok &= good
        delta = sum(1 for l in difflib.unified_diff(base.splitlines(), out.splitlines(), lineterm="", n=0)
                    if l[:1] in "+-" and not l.startswith(("+++", "---")))
        print(f"  {'OK ' if good else 'BAD'} {delta:4} lines vs the bug-register state   {rel}")
        if write and good:
            open(os.path.join(sr.REPO, rel), "w", encoding="utf-8").write(out)
    print("WRITTEN" if write else "dry run (pass --write to apply)")
    return ok


if __name__ == "__main__":
    sys.exit(0 if main("--write" in sys.argv) else 1)
