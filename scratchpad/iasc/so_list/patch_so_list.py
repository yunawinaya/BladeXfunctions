"""SO list (page 1901872125787099137): Convert to GD names what was made or reserved in another plant first (the user, 10-28: a delivery
allocates only in its own plant, so an organisation-level SO's IA / production in plant A is useless to a GD in plant B). Additive, in
onConfirm_selectPlant only - never func_handleConvertGD (the GD session's, byte-identical): the helper (so_plant_check.js) before the
handler's body and one call at the start of its goods-delivery branch. Built on the live dev v540 and prod v270 (pinned md5; their two
handlers are the same text): out/so_list_dev.json, out/so_list_prod.json.

usage: python3 scratchpad/iasc/so_list/patch_so_list.py [--write]   (SO_LIST_OUT=<dir> writes there; --patches prints the text changes)"""
import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.environ.get("SO_LIST_OUT") or os.path.join(HERE, "out")
BASES = {"dev": ("so_list_dev_v540.json", "c2283cb1100a16d644d74ccabae770b3"), "prod": ("so_list_prod_v270.json", "fb72408abc58b74f5230c4f0d24b023b")}
HANDLER = "onConfirm_selectPlant"
BODY = "(async () => {\n"
GD_BRANCH = '    } else if (docType === "goods delivery") {\n'
HELPER = open(os.path.join(HERE, "so_plant_check.js"), encoding="utf-8").read().rstrip("\n") + "\n\n"
CALL = ("      // made or reserved in another plant (the user, 10-28): named first; Cancel keeps the Select Plant dialog open\n"
        "      if (!(await soPlantElsewhere(selectedRecords, plantID))) return;\n")


def build(base):
    name, md5 = BASES[base]
    raw = open(os.path.join(HERE, "base", name), encoding="utf-8").read()
    assert hashlib.md5(raw.encode("utf-8")).hexdigest() == md5, "base/%s is not the pinned live page" % name
    page = json.loads(raw)
    hits = [e for e in page["config"]["eventScript"] if e.get("name") == HANDLER]
    assert len(hits) == 1, HANDLER
    f = hits[0]["func"]
    assert f.startswith(BODY) and f.count(GD_BRANCH) == 1 and "soPlantElsewhere" not in f, "onConfirm_selectPlant moved"
    hits[0]["func"] = HELPER + f.replace(GD_BRANCH, GD_BRANCH + CALL)
    return page


if __name__ == "__main__":
    if "--patches" in sys.argv:
        print(json.dumps({"helper": HELPER, "call": CALL}))
        sys.exit(0)
    for base in BASES:
        page = build(base)
        text = json.dumps(page, ensure_ascii=False, separators=(",", ":"))
        path = os.path.join(OUT, "so_list_%s.json" % base)
        print("%s: md5 %s%s" % (base, hashlib.md5(text.encode("utf-8")).hexdigest(), " -> " + path if "--write" in sys.argv else " (dry)"))
        if "--write" in sys.argv:
            os.makedirs(OUT, exist_ok=True)
            open(path, "w", encoding="utf-8").write(text)
