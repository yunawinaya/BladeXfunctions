#!/usr/bin/env python3
"""Assert every extracted .js matches its embedded config.eventScript copy."""
import json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MOD = os.path.join(ROOT, "Item Assembly & BOM")

PAIRS = {
    "BOMFullJSON.json": [
        ("mounted",  "BOMonMounted.js",              "func"),
        ("iky7wors", "BOMonChangeParentMaterial.js", "func"),
        ("rxwwwgd8", "BOMonChangeSubMaterial.js",    "rule0"),
        ("2raaz2db", "BOMsave.js",                   "rule0"),
        ("wco16rzc", "BOMonChangeIsDefault.js",      "rule0"),
        ("o9ec1nsx", "BOMconfirmDefaultDialog.js",   "rule0"),
        ("hcxsdru3", "BOMcancelDefaultDialog.js",    "rule0"),
        ("fz5dx56d", "BOMonReadyVersionType.js",     "func"),
        ("piwzxkia", "BOMonChangeVersionType.js",    "func"),
        ("bomcncl1", "BOMcancel.js",                 "func"),
        ("bomtype1", "BOMonChangeBomType.js",        "func"),
    ],
    "ItemAssemblyFullJSON.json": [
        ("mounted",  "ItemAssemblyOnMounted.js",          "func"),
        ("fgivan7v", "ItemAssemblyOnChangePlant.js",      "func"),
        ("5y8a2wfi", "ItemAssemblyConfirmDialog.js",      "func"),
        ("1yc5v4i4", "ItemAssemblyOnChangeDialogUOM.js",  "func"),
        ("5ulwgpus", "ItemAssemblyOnChangeSelectHU.js",   "func"),
        ("cxk2kor9", "ItemAssemblyOnChangeSMQuantity.js", "func"),
        ("bmxmqi0j", "ItemAssemblyOnChangeCategory.js",   "func"),
        ("efnv3l7q", "ItemAssemblySearchSN.js",           "func"),
        ("vlxg4fno", "ItemAssemblyResetSN.js",            "func"),
        ("wv07g9xe", "ItemAssemblyOnChangeItem.js",       "func"),
        ("iaqty01x", "ItemAssemblyOnChangeItemQty.js",    "func"),
    ],
}

bad = 0
for form, pairs in PAIRS.items():
    doc = json.load(open(os.path.join(MOD, form)))
    by_key = {e["key"]: e for e in doc["config"]["eventScript"]}
    for key, rel, slot in pairs:
        if key not in by_key:
            print("  MISSING handler %s in %s" % (key, form)); bad += 1; continue
        e = by_key[key]
        embedded = e["func"] if slot == "func" else e["rules"][0]["options"]["func"]
        disk = open(os.path.join(MOD, rel)).read()
        if embedded != disk:
            print("  DRIFT %-34s %s" % (rel, form)); bad += 1
print("sync: %d file(s) out of sync" % bad if bad else
      "sync: all %d handlers match their .js" % sum(len(v) for v in PAIRS.values()))
sys.exit(1 if bad else 0)
