"""patch_cascade_cap500.py [--write]: GD Edit V2 final fix I1 (its size side) - SO_CASCADE (after patch_cascade_fallback.py) takes a
delivery of at most 500 lines (was 1,000): SO_SAVE now commits every released GD edit inside the same request, and at 1,000
lines (SO_SAVE + the cascade + SUBMIT + PREPARE + COMMIT) a save would pass the 55 s gateway. 500 is prod's classic limit, so the
text is the classic one. Prints what changes; writes only with --write. Round-trips json.dumps(indent=2)."""
import json
import sys

R = "/Users/yunawinaya/Developer/BladeXfunctions/"
PATH = R + "Sales Order/SOcascadeDownstreamWorkflow.json"


def find(lst, nid):
    for n in lst or []:
        if n.get("id") == nid:
            return n
        r = find(n.get("blocks"), nid)
        if r:
            return r
    return None


def once(text, old, new, what):
    assert text.count(old) == 1, "%s: %d matches" % (what, text.count(old))
    return text.replace(old, new)


def patch(doc):
    nodes = doc["nodes"]
    size = find(nodes, "code_cd_gde_size")["data"]["script"]
    size["code"] = once(size["code"], "// GD Edit V2: past 1000 lines a delivery is not saved from here (SO_SAVE + this cascade + its checks in one request took dev down)",
                        "// GD Edit V2: past 500 lines a delivery is not saved from here (SO_SAVE commits the edit in the same request: 55 s gateway)", "size: comment")
    size["code"] = once(size["code"], 'big: on && lines > 1000 ? "Y" : "N", ask: on && lines <= 1000 ? "Y" : "N"', 'big: on && lines > 500 ? "Y" : "N", ask: on && lines <= 500 ? "Y" : "N"', "size: 500")
    route = find(nodes, "code_cd_gde_route")["data"]["script"]
    route["code"] = once(route["code"], "more than a Sales Order change can update (1,000).", "more than a Sales Order change can update (500).", "route: pass B text")
    route["code"] = once(route["code"], "a Sales Order change can update a delivery of up to 1,000 lines.", "a Sales Order change can update a delivery of up to 500 lines.", "route: pass A text")
    return ["code_cd_gde_size (500)", "code_cd_gde_route (texts 500)"]


if __name__ == "__main__":
    raw = open(PATH, encoding="utf-8").read()
    doc = json.loads(raw)
    nl = raw.endswith("\n")
    assert json.dumps(doc, ensure_ascii=False, indent=2) + ("\n" if nl else "") == raw, "the file does not round-trip"
    changed = patch(doc)
    out = json.dumps(doc, ensure_ascii=False, indent=2) + ("\n" if nl else "")
    print("SO_CASCADE ->", ", ".join(changed), "| %d -> %d chars" % (len(raw), len(out)))
    if "--write" in sys.argv:
        open(PATH, "w", encoding="utf-8").write(out)
        print("written")
    else:
        print("dry run (--write to save)")
