"""SM V2 / Location Transfer - the one build entry point (thin dispatcher; CONTRACT.md "Build").

usage: python3 build_lot.py [--write] [NAME ...]

Calls each package's builder module, in this order (the order wfkit's key stream follows - keep it):
  build_prepare.py  (A)  BUILDERS = [("LOT_V2_PREPARE", fn)]
  build_commit.py   (C)  BUILDERS = [("LOT_V2_COMMIT", fn)]
  build_worker.py   (C)  BUILDERS = [("LOT_V2_WORKER", fn)]
  build_submit.py   (B)  BUILDERS = [("LOT_V2_SUBMIT", fn)]
  build_classic.py  (B)  BUILDERS = [("SM_LOCATION_TRANSFER", fn)]   (the guarded classic = base v82 + the guard nodes)
fn() returns the FlowGram dict; lib/v2build.build wraps long SQL lines, checks node ids and (with --write) writes
<repo>/Stock Movement/Location Transfer/AsyncV2/<NAME>.json. A module that is not there yet, or a fn raising
NotImplementedError, is skipped; any other error stops the build (a broken builder must be seen).
"""
import importlib
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "lib"))
sys.path.insert(0, HERE)
import v2build as V  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(REPO, "Stock Movement", "Location Transfer", "AsyncV2")
MODULES = ["build_prepare", "build_commit", "build_worker", "build_submit", "build_classic"]
EXPECTED = {"build_prepare": ["LOT_V2_PREPARE"], "build_commit": ["LOT_V2_COMMIT"], "build_worker": ["LOT_V2_WORKER"], "build_submit": ["LOT_V2_SUBMIT"],
            "build_classic": ["SM_LOCATION_TRANSFER"]}


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
    V.build(builders(), OUT, "--write" in sys.argv, want)
