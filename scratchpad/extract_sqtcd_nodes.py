# Pulls the two code-nodes sqtcd_harness.js runs, out of the workflow JSON.
import io, json, os

d = json.load(io.open("Quotation/SQTcascadeDownstreamWorkflow.json", encoding="utf-8"))

def get(o, nid):
    if isinstance(o, dict):
        if o.get("id") == nid:
            return o
        for v in o.values():
            r = get(v, nid)
            if r:
                return r
    elif isinstance(o, list):
        for v in o:
            r = get(v, nid)
            if r:
                return r

for nid in ("code_sqtcd_diff", "code_sqtcd_plan"):
    io.open("/tmp/h_%s.txt" % nid, "w", encoding="utf-8").write(
        get(d, nid)["data"]["script"]["code"])
    print("extracted", nid)
