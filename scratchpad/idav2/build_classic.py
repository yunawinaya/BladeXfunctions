"""IDA_SAVE v7 (package B, CONTRACT.md sections 11 and 13): classic/patch_v7.py's build() for build_ida.py.

usage: python3 scratchpad/idav2/build_classic.py [--write]
       (prints the size; --write saves <repo>/Item Disassembly/AsyncV2/IDA_SAVE.json, indent 1)
Proof: python3 scratchpad/idav2/classic/diff_v6.py
"""
import sys
sys.dont_write_bytecode = True
import importlib.util
import os

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "lib"))
import v2build as V  # noqa: E402

_spec = importlib.util.spec_from_file_location("ida_classic_patch_v7", os.path.join(HERE, "classic", "patch_v7.py"))
P = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(P)

BUILDERS = P.BUILDERS
OUT = os.path.join(HERE, "..", "..", "Item Disassembly", "AsyncV2")

if __name__ == "__main__":
    V.build(BUILDERS, os.path.abspath(OUT), "--write" in sys.argv)
