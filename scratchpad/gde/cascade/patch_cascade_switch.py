"""patch_cascade_switch.py [--write]: GD Edit V2 final fix I3 - SO_CASCADE (Sales Order/SOcascadeDownstreamWorkflow.json, dev v26
base) gets one switch, GDE_CASCADE_ENABLED in code_cd_gde_args. Off: no delivery is submitted to GD_EDIT_SUBMIT; each goes to
the classic save as before GD Edit V2, with its 500-line refusal (the 1,000-line one is the background save's). With the GD
form's ASYNC_EDIT_ENABLED this turns GD Edit V2 off. Prints what changes; writes only with --write.
The file round-trips json.dumps(indent=2)."""
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


def field(key, name, bson="any"):
    return {"key": key, "name": name, "title": name, "description": "", "bsonType": bson, "isExpand": False, "children": []}


def patch(doc):
    nodes = doc["nodes"]
    args = find(nodes, "code_cd_gde_args")
    a = args["data"]["script"]
    a["code"] = once(a["code"], """const ref = String({{workflowparams:cascade_ref}} || "").trim();
""", """// false: every delivery goes to the classic save, as before GD Edit V2 (the GD form's switch is ASYNC_EDIT_ENABLED)
const GDE_CASCADE_ENABLED = true;
const ref = String({{workflowparams:cascade_ref}} || "").trim();
""", "args: the switch")
    a["code"] = once(a["code"], 'cancelOp: "CANCEL_HELD", cascadeRef: ref,', 'cancelOp: "CANCEL_HELD", cascadeRef: ref, enabled: GDE_CASCADE_ENABLED ? "YES" : "NO",', "args: enabled")
    assert not any(f["name"] == "enabled" for f in args["data"]["response_json"])
    args["data"]["response_json"].append(field("socd_gde_ar_on", "enabled", "string"))

    size = find(nodes, "code_cd_gde_size")
    z = size["data"]["script"]
    z["code"] = once(z["code"], """return { big: lines > 1000 ? "Y" : "N", lines: lines };""",
                     """const on = String([{{node:code_cd_gde_args.data.enabled}}][0] || "") === "YES";
return { big: on && lines > 1000 ? "Y" : "N", ask: on && lines <= 1000 ? "Y" : "N", lines: lines };""", "size: off = no submit")
    size["data"]["response_json"].append(field("socd_gde_sz_ask", "ask", "string"))

    small = find(nodes, "if_cd_gde_small")
    leaf = small["data"]["filter"]["list"]
    assert len(leaf) == 1 and leaf[0]["prop"] == "node.code_cd_gde_size.data.big" and leaf[0]["value"] == "N", leaf
    leaf[0].update({"prop": "node.code_cd_gde_size.data.ask", "value": "Y", "propLabel": "ask"})

    route = find(nodes, "code_cd_gde_route")
    r = route["data"]["script"]
    r["code"] = once(r["code"], """if (!ref || s(a.route) === "NOT_ELIGIBLE") route = "CLASSIC";""",
                     """if (!ref || s([{{node:code_cd_gde_args.data.enabled}}][0]) !== "YES" || s(a.route) === "NOT_ELIGIBLE") route = "CLASSIC";""", "route: off = classic")
    return ["code_cd_gde_args (+ enabled)", "code_cd_gde_size (+ ask)", "if_cd_gde_small (ask == Y)", "code_cd_gde_route (off = CLASSIC)"]


if __name__ == "__main__":
    raw = open(PATH, encoding="utf-8").read()
    doc = json.loads(raw)
    assert json.dumps(doc, ensure_ascii=False, indent=2) + "\n" == raw or json.dumps(doc, ensure_ascii=False, indent=2) == raw, "the file does not round-trip"
    nl = raw.endswith("\n")
    changed = patch(doc)
    out = json.dumps(doc, ensure_ascii=False, indent=2) + ("\n" if nl else "")
    print("SO_CASCADE ->", ", ".join(changed), "| %d -> %d chars" % (len(raw), len(out)))
    if "--write" in sys.argv:
        open(PATH, "w", encoding="utf-8").write(out)
        print("written")
    else:
        print("dry run (--write to save)")
