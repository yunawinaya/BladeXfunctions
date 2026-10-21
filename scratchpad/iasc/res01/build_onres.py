"""RES-01 R1: the on_reserved_gd form (su_code_tables 1935880014687440897) = live dev v19 + the doc_type value "Item Assembly",
the owner type of an Item Assembly's raw-material hold (the list is static; Miscellaneous Issue and Plant Transfer were added the
same way). Shared table: the GD readers skip IA rows (status Allocated, no parent_line_id, no target_gd_id).

  python3 scratchpad/iasc/res01/build_onres.py [--write]      -> res01/out/on_reserved_gd_form.json
"""
import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.join(HERE, "base", "on_reserved_gd_form_v19.json")
BASE_MD5 = "87a6a9f468a3949fdbead736d732f305"
OUT = os.path.join(HERE, "out", "on_reserved_gd_form.json")
VALUE = {"value": "Item Assembly", "label": "Item Assembly", "explain": "", "disabled": False, "visible": True}


def find(n, model):
    if isinstance(n, dict):
        if n.get("model") == model and "type" in n:
            return n
        for v in n.values():
            r = find(v, model)
            if r:
                return r
    elif isinstance(n, list):
        for v in n:
            r = find(v, model)
            if r:
                return r
    return None


def build():
    raw = open(BASE, encoding="utf-8").read()
    assert hashlib.md5(raw.encode("utf-8")).hexdigest() == BASE_MD5, "base/on_reserved_gd_form_v19.json is not the pinned v19"
    form = json.loads(raw)
    sel = find(form["list"], "doc_type")
    assert sel["type"] == "select" and sel["options"].get("remote") is False
    values = [o["value"] for o in sel["options"]["options"]]
    assert VALUE["value"] not in values, values
    sel["options"]["options"].append(dict(VALUE))
    return form


def main():
    form = build()
    print("doc_type: %d values, last %s" % (len(find(form["list"], "doc_type")["options"]["options"]), VALUE["value"]))
    if "--write" in sys.argv:
        os.makedirs(os.path.dirname(OUT), exist_ok=True)
        open(OUT, "w", encoding="utf-8").write(json.dumps(form, ensure_ascii=False, indent=1) + "\n")
        print("wrote", OUT)


if __name__ == "__main__":
    main()
