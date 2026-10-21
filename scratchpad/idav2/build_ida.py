"""Item Disassembly V2 - the one build entry point (thin dispatcher; CONTRACT.md section 13). Copy of tpl/iav2/build_ia.py.

usage: python3 scratchpad/idav2/build_ida.py [--write] [NAME ...]

Calls each package's builder module in this order (the publish order; wfkit's key stream follows it):
  build_prepare.py  (A)  BUILDERS = [("IDA_V2_PREPARE", fn)]
  build_commit.py   (C)  BUILDERS = [("IDA_V2_COMMIT", fn)]
  build_worker.py   (C)  BUILDERS = [("IDA_V2_WORKER", fn)]
  build_submit.py   (B)  BUILDERS = [("IDA_V2_SUBMIT", fn)]
  build_classic.py  (B)  BUILDERS = [("IDA_SAVE", fn)]      (deployed v6 + the v7 guard nodes + the code_cost_alloc price fix)
fn() returns the FlowGram dict; lib/v2build.build wraps long SQL lines, checks node ids and, with --write, writes
<repo>/Item Disassembly/AsyncV2/<NAME>.json (indent 1). A module not there yet, or a fn raising NotImplementedError, is skipped;
any other error stops the build. The client (D) builds with its own client/build_client.py.
"""
import importlib
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "lib"))
sys.path.insert(0, HERE)
import v2build as V  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(REPO, "Item Disassembly", "AsyncV2")
MODULES = ["build_prepare", "build_commit", "build_worker", "build_submit", "build_classic"]
EXPECTED = {"build_prepare": ["IDA_V2_PREPARE"], "build_commit": ["IDA_V2_COMMIT"], "build_worker": ["IDA_V2_WORKER"],
            "build_submit": ["IDA_V2_SUBMIT"], "build_classic": ["IDA_SAVE"]}


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
    V.build(builders(), OUT, write, want)
