"""IA_V2_SUBMIT v5 = the deployed v13 (patch_v4.build(), pinned md5 of its written text) + the IA output split, phase 1 (plan 10-27): a
completion whose output is split across bins (output_split has rows) is NOT_ELIGIBLE, so the form completes it through the classic
IA_SAVE (v14: one ADD_INVENTORY per row); above the classic's 250 picks the gate's own STOP (IA_TOO_BIG) names the reason.
One change: code_node_ISgate's eligibility (the lifted iaIneligible) also asks iaOsIneligible. Asserted: undone -> v13 node for node.

usage: python3 scratchpad/iasc/submit/patch_v5.py [--write]   (writes Item Assembly & BOM/SmallCycle/IA_V2_SUBMIT.json)"""
import copy
import hashlib
import json
import os
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
IASC = os.path.dirname(HERE)
REPO = os.path.abspath(os.path.join(IASC, "..", ".."))
sys.path.insert(0, HERE)
import patch_v4 as P4  # noqa: E402

# Item Assembly & BOM/SmallCycle/IA_V2_SUBMIT.json as patch_v4 writes it = DEV v13 (IDENTICAL, 10-27)
BASE_MD5 = "cb7881f742b0d83976534a5ba507479a"
OUT = os.environ.get("IASC_OUT") or os.path.join(REPO, "Item Assembly & BOM", "SmallCycle")
GATE = "code_node_ISgate"
WHY = ("      const why = iaIneligible(r.allData, r.allData.stock_movement, r.itemIds, byItem, R);\n",
       "      const why = iaIneligible(r.allData, r.allData.stock_movement, r.itemIds, byItem, R) || iaOsIneligible(r.allData);\n")
HELPER_AT = "const submitGate = function submitGate(guard, entry, keys, form, R) {\n"
HELPER = ("// IA output split (plan 10-27, phase 1): a completion whose output is split across bins completes through the classic save (one\n"
          "// ADD_INVENTORY per row); the rows as the form sends them (an array, or its JSON text)\n"
          "const iaOsIneligible = function iaOsIneligible(a) {\n"
          "  let v = a ? a.output_split : null;\n"
          "  if (typeof v === \"string\") {\n"
          "    try {\n"
          "      v = JSON.parse(v);\n"
          "    } catch (e) {\n"
          "      v = null;\n"
          "    }\n"
          "  }\n"
          "  return Array.isArray(v) && v.length > 0 ? \"its output is split across bins\" : \"\";\n"
          "};\n")


def build():
    v4 = P4.build()
    text4 = json.dumps(v4, ensure_ascii=False, indent=1) + "\n"
    assert hashlib.md5(text4.encode("utf-8")).hexdigest() == BASE_MD5, "patch_v4's build is no longer the deployed v13"
    assert "iaOsIneligible" not in text4
    base = json.loads(text4)
    doc = copy.deepcopy(base)
    sc = P4.index(doc)[GATE]["data"]["script"]
    for was in (WHY[0], HELPER_AT):
        assert sc["code"].count(was) == 1, ("the gate changed", was[:60])
    sc["code"] = sc["code"].replace(WHY[0], WHY[1]).replace(HELPER_AT, HELPER + HELPER_AT)
    rev = copy.deepcopy(doc)
    rs = P4.index(rev)[GATE]["data"]["script"]
    rs["code"] = rs["code"].replace(WHY[1], WHY[0]).replace(HELPER, "")
    assert P4.canon(rev) == P4.canon(base), "v13 changed beyond the gate's eligibility"
    return doc


if __name__ == "__main__":
    doc = build()
    text = json.dumps(doc, ensure_ascii=False, indent=1)
    path = os.path.join(OUT, "IA_V2_SUBMIT.json")
    print("IA_V2_SUBMIT v5: %d chars, %d nodes" % (len(text), len(P4.index(doc))) + (" -> " + path if "--write" in sys.argv else " (dry; --write to save)"))
    if "--write" in sys.argv:
        os.makedirs(OUT, exist_ok=True)
        open(path, "w", encoding="utf-8").write(text + "\n")
