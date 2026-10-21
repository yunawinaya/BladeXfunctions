"""SA V2 / SC Review V2 - the one build entry point (thin dispatcher; CONTRACT.md §13). Copy of smv2 build_lot.py.

usage: python3 build_sa.py [--write] [NAME ...]

Calls each package's builder module, in this order (the order wfkit's key stream follows - keep it):
  build_prepare.py  (A)   BUILDERS = [("SA_V2_PREPARE", fn)]
  build_commit.py   (C)   BUILDERS = [("SA_V2_COMMIT", fn)]
  build_worker.py   (C)   BUILDERS = [("SA_V2_WORKER", fn)]
  build_submit.py   (B2)  BUILDERS = [("SA_V2_SUBMIT", fn)]
  build_classic.py  (B1)  BUILDERS = [("STOCK_ADJUSTMENT", fn), ("STOCK_COUNT", fn)]   (base + guard nodes)
fn() returns the FlowGram dict; lib/v2build.build wraps long SQL lines, checks node ids and (with --write) writes
<repo>/Stock Adjustment/AsyncV2/<NAME>.json - except STOCK_COUNT, which goes to <repo>/Stock Count/AsyncV2/. A module that
is not there yet, or a fn raising NotImplementedError, is skipped; any other error stops the build.
"""
import importlib
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "lib"))
sys.path.insert(0, HERE)
import v2build as V  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = {"STOCK_COUNT": os.path.join(REPO, "Stock Count", "AsyncV2")}
OUT_DEFAULT = os.path.join(REPO, "Stock Adjustment", "AsyncV2")
MODULES = ["build_prepare", "build_commit", "build_worker", "build_submit", "build_classic"]
EXPECTED = {"build_prepare": ["SA_V2_PREPARE"], "build_commit": ["SA_V2_COMMIT"], "build_worker": ["SA_V2_WORKER"],
            "build_submit": ["SA_V2_SUBMIT"], "build_classic": ["STOCK_ADJUSTMENT", "STOCK_COUNT"]}


def builders():
    out = []
    for mod in MODULES:
        try:
            m = importlib.import_module(mod)
        except ModuleNotFoundError as e:
            if e.name != mod:
                raise
            print(f"{mod}.py: not there yet - {', '.join(EXPECTED[mod])} skipped")
            continue
        got = list(getattr(m, "BUILDERS", []))
        names = [n for n, _ in got]
        assert names, f"{mod}.py has no BUILDERS"
        unexpected = [n for n in names if n not in EXPECTED[mod]]
        assert not unexpected, f"{mod}.py builds {unexpected}; CONTRACT.md gives it {EXPECTED[mod]}"
        out.extend(got)
    return out


if __name__ == "__main__":
    want = [a for a in sys.argv[1:] if not a.startswith("--")]
    write = "--write" in sys.argv
    all_builders = builders()
    for out_dir in [OUT_DEFAULT] + sorted(set(OUT.values())):
        mine = [(n, fn) for n, fn in all_builders if OUT.get(n, OUT_DEFAULT) == out_dir]
        if mine:
            V.build(mine, out_dir, write, want)
