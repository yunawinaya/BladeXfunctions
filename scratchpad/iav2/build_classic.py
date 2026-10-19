"""IA_SAVE v12 (package B, CONTRACT.md sections 11 and 13): classic/patch_v12.py's build() for build_ia.py.

usage: python3 scratchpad/iav2/build_classic.py [--write]
       (prints the size; --write saves <repo>/Item Assembly & BOM/AsyncV2/IA_SAVE.json, indent 1)
Proof: python3 scratchpad/iav2/classic/diff_v11.py
"""
import sys
sys.dont_write_bytecode = True
import importlib.util
import os

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "lib"))
import v2build as V  # noqa: E402

_spec = importlib.util.spec_from_file_location("ia_classic_patch_v12", os.path.join(HERE, "classic", "patch_v12.py"))
P = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(P)

BUILDERS = P.BUILDERS
OUT = os.path.join(HERE, "..", "..", "Item Assembly & BOM", "AsyncV2")

if __name__ == "__main__":
    V.build(BUILDERS, os.path.abspath(OUT), "--write" in sys.argv)
