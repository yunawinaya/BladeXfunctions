#!/usr/bin/env python3
"""Mirror the patched workflows that are identical in dev and prod into the repo module files.

Repo files are Prettier-formatted (workflow recipe: Prettier --parser json over compact JSON).
A file that round-trips through that recipe is rewritten from the patched content; one that does
not (hand-expanded objects) gets only the changed hunks, via diff -u + patch, so its formatting
survives. Every result is checked to parse to exactly the intended content.

LOT is special: the repo copy is AHEAD of dev (unreleased Stock Picking nodes), so the fix is
applied to the repo's own content instead of replacing it with the deployed version.

usage: python3 sync_repo.py [--write]      (default: dry run)
"""
import copy, json, os, subprocess, sys, tempfile
import build

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
PRETTIER = os.path.expanduser("~/.npm/_npx/b388654678d519d9/node_modules/prettier/bin/prettier.cjs")

TARGETS = {
    "SI_SAVE": ["Sales Invoice/SIsaveWorkflow.json"],
    "HANDLING_UNIT": ["Handling Unit/HUworkflow.json"],
    "PICKING_LOOP": ["Picking/PickingLoopWorkflow.json", "Picking/PickingLoopWorkflow.PROD.json"],
    "PACKING_SAVE": ["Packing/PackingSaveWorkflowJSON.json"],
    "PICKING_PLAN": ["Picking Plan/PPheadWorkflow.json"],
    "PICKING": ["Picking/PickingProcessWorkflow.json", "Picking/PickingProcessWorkflow.PROD.json"],
    "GD_UNUSED_FN_NEW": ["Goods Delivery/GDinventoryProcessWorkflow.json"],
    "SM_LOCATION_TRANSFER": ["Stock Movement/Location Transfer/LOTsaveWorkflow.json"],
}
# .js mirrors of a workflow code node (raw embedded string, no trailing newline).
JS_MIRRORS = {("GD_UNUSED_FN_NEW", "code_node_b71wypDJ"): "Goods Delivery/GDProcessTable_batchProcess.js"}


def render(obj):
    src = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    r = subprocess.run(["node", PRETTIER, "--parser", "json"], input=src, capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(r.stderr[:400])
    return r.stdout


def patch_lot_repo(d):
    """The repo LOT already returns early for its new "Created" status; add the Draft fix after it."""
    if "a Draft never staged any" in build.find(d, "code_node_uht83Wzh")[0]["data"]["script"]["code"]:
        return  # already applied; the anchor below also matches the end of the inserted block
    build.code_replace(d, "code_node_uht83Wzh",
        "    stock_movement_no: ctx.docNo, doc_date: ctx.docDate,\n  };\n}\n\nconst lineStaging",
        "    stock_movement_no: ctx.docNo, doc_date: ctx.docDate,\n  };\n}\n\n"
        "// Reconcile adjusts stock this document already staged; a Draft never staged any.\n"
        "if ((initialData.stock_movement_status || currentData.stock_movement_status) !== \"In Progress\") {\n"
        "  return {\n"
        "    isDifferent: 0, movements: [], movementsLength: 0,\n"
        "    transitCreates: [], hasTransitCreates: 0,\n"
        "    transitUpdates: [], hasTransitUpdates: 0,\n"
        "    shortages: [], hasShortage: 0, materialIds: [],\n"
        "    plant_id: ctx.plantId, organization_id: ctx.orgId,\n"
        "    stock_movement_no: ctx.docNo, doc_date: ctx.docDate,\n"
        "  };\n"
        "}\n\nconst lineStaging")


def code_nodes(d):
    out = {}

    def walk(lst):
        for n in lst:
            if isinstance(n, dict) and "type" in n and "data" in n:
                if n["type"] == "code-node":
                    out[n["id"]] = n["data"]["script"]["code"]
                walk(n.get("blocks") or [])
    walk(d["nodes"])
    return out


def normalize_changed_code(raw, current, target):
    """Some repo files store a code string with \\uXXXX escapes, which the rendered diff cannot
    match. Only for code strings that change anyway, rewrite them as the renderer writes them."""
    cur, tgt = code_nodes(current), code_nodes(target)
    for nid, code in cur.items():
        if tgt.get(nid) == code:
            continue
        rendered = json.dumps(code, ensure_ascii=False)
        escaped = json.dumps(code, ensure_ascii=True)
        if rendered not in raw and raw.count(escaped) == 1:
            raw = raw.replace(escaped, rendered)
    return raw


def apply_hunks(raw, old_r, new_r):
    """diff old_r -> new_r, applied onto raw (which differs from old_r only in formatting)."""
    with tempfile.TemporaryDirectory() as t:
        paths = {k: os.path.join(t, k) for k in ("raw", "old", "new", "p")}
        for k, v in (("raw", raw), ("old", old_r), ("new", new_r)):
            open(paths[k], "w", encoding="utf-8").write(v)
        diff = subprocess.run(["diff", "-u", paths["old"], paths["new"]], capture_output=True, text=True).stdout
        open(paths["p"], "w", encoding="utf-8").write(diff)
        r = subprocess.run(["patch", "--no-backup-if-mismatch", "-s", paths["raw"], paths["p"]],
                           capture_output=True, text=True)
        if r.returncode:
            return None, (r.stdout + r.stderr)[:600]
        return open(paths["raw"], encoding="utf-8").read(), None


def main(write):
    ok_all = True
    for wf, files in TARGETS.items():
        prod = json.load(open(os.path.join(HERE, f"{wf}.PROD.json"), encoding="utf-8"))
        for rel in files:
            path = os.path.join(REPO, rel)
            raw = open(path, encoding="utf-8").read()
            current = json.loads(raw)
            if wf == "SM_LOCATION_TRANSFER":
                target = copy.deepcopy(current)
                patch_lot_repo(target)
            else:
                target = prod
            if build.canon(current) == build.canon(target):
                print(f"  already current   {rel}")
                continue
            if render(current) == raw:
                out, how = render(target), "rewritten (round-trips)"
            else:
                raw = normalize_changed_code(raw, current, target)
                out, err = apply_hunks(raw, render(current), render(target))
                how = "hunks applied (formatting kept)"
                if out is None:
                    out, how = render(target), f"REWRITTEN in full (patch failed: {err.strip()[:120]})"
            good = build.canon(json.loads(out)) == build.canon(target)
            ok_all &= good
            print(f"  {'OK ' if good else 'BAD'} {how:40} {rel}")
            if write and good:
                open(path, "w", encoding="utf-8").write(out)

    for (wf, nid), rel in JS_MIRRORS.items():
        base_code = build.find(json.load(open(os.path.join(HERE, f"{wf}.BASE.json"))), nid)[0]["data"]["script"]["code"]
        prod_code = build.find(json.load(open(os.path.join(HERE, f"{wf}.PROD.json"))), nid)[0]["data"]["script"]["code"]
        path = os.path.join(REPO, rel)
        cur = open(path, encoding="utf-8").read()
        nl = "\n" if cur.endswith("\n") else ""
        if cur == prod_code + nl:
            print(f"  already current   {rel}")
            continue
        # The embedded node is the authority; a stale mirror is synced from it, fix included.
        how = "mirror updated" if cur == base_code + nl else "STALE mirror synced to deployed node + fix"
        print(f"  OK  {how:40} {rel}")
        if write:
            open(path, "w", encoding="utf-8").write(prod_code + nl)
    print("WRITTEN" if write else "dry run (pass --write to apply)")
    return ok_all


if __name__ == "__main__":
    sys.exit(0 if main("--write" in sys.argv) else 1)
