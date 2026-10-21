"""patch_consumer_moved_on.py [--write]: GD_PICKING_OUTBOX_CONSUMER (Goods Delivery/AsyncV2/GD_PICKING_OUTBOX_CONSUMER.json, dev v8) ends
the job of a delivery that was completed or cancelled before its Picking was made, instead of leaving it GD_COMMITTED forever (its
poll took only Created deliveries, so the event stayed READY and the job open; GD Cancel / Revert / Edit V2 then answer BUSY).
The poll and the pick also take a Completed / Cancelled delivery's event; the plan answers NO_PICK for it when no consumption was
started (the existing DONE_NONE ending: consumption DONE with no target, the job COMPLETED, the event DONE). A STARTED consumption
still goes to review. Exact text replacements in the repo JSON (its generator, scripts/build-gd-picking-consumer.mjs, is not in
this repo); every replacement must match once."""
import json
import sys

R = "/Users/yunawinaya/Developer/BladeXfunctions/"
F = R + "Goods Delivery/AsyncV2/GD_PICKING_OUTBOX_CONSUMER.json"
PICK_OLD = ("  if (gpcStr(row.gd_status) !== GPC.gd_created || Number(row.gd_deleted) !== 0 || gpcStr(row.gd_org) !== ids.organizationId) "
            "return skip(\"the delivery is not Created (\" + (gpcStr(row.gd_status) || \"absent\") + \")\");")
PICK_NEW = ("  // a delivery completed or cancelled before its Picking was made is claimed too: the plan ends its job without a Picking\n"
            "  const movedOn = [\"Completed\", \"Cancelled\"].indexOf(gpcStr(row.gd_status)) >= 0;\n"
            "  if ((gpcStr(row.gd_status) !== GPC.gd_created && !movedOn) || Number(row.gd_deleted) !== 0 || gpcStr(row.gd_org) !== ids.organizationId) "
            "return skip(\"the delivery is not Created (\" + (gpcStr(row.gd_status) || \"absent\") + \")\");")
PLAN_OLD = ("  if (!gd || gpcStr(gd.gd_status) !== GPC.gd_created || Number(gd.is_deleted) !== 0 || gpcStr(gd.organization_id) !== ev.organizationId) {\n"
            "    if (cons) return fail(\"GD_CONSUMPTION_UNCERTAIN\", \"the delivery is no longer Created while the consumption is STARTED\");")
PLAN_NEW = ("  if (!gd || gpcStr(gd.gd_status) !== GPC.gd_created || Number(gd.is_deleted) !== 0 || gpcStr(gd.organization_id) !== ev.organizationId) {\n"
            "    // completed or cancelled before its Picking was made (none started): nothing is picked any more - the job ends, no Picking\n"
            "    if (!cons && gd && Number(gd.is_deleted) === 0 && gpcStr(gd.organization_id) === ev.organizationId && [\"Completed\", \"Cancelled\"].indexOf(gpcStr(gd.gd_status)) >= 0) "
            "return Object.assign(out, { route: \"NO_PICK\", reason: \"the delivery was \" + gpcStr(gd.gd_status) + \" before its Picking was made\" });\n"
            "    if (cons) return fail(\"GD_CONSUMPTION_UNCERTAIN\", \"the delivery is no longer Created while the consumption is STARTED\");")
SQL_OLD = "            AND g.gd_status = 'Created'\n"
SQL_NEW = "            AND g.gd_status IN ('Created', 'Completed', 'Cancelled')\n"
TITLE_OLD = "the earliest due READY GD_COMMITTED event of the tenant whose delivery is Created and whose j"
TITLE_NEW = "the earliest due READY GD_COMMITTED event of the tenant whose delivery is Created (or Completed / Cancelled first) and whose j"

raw = open(F, encoding="utf-8").read()
out = raw
for old, new, n in ((PICK_OLD, PICK_NEW, 1), (PLAN_OLD, PLAN_NEW, 1), (SQL_OLD, SQL_NEW, 1)):
    eo, en = json.dumps(old, ensure_ascii=False)[1:-1], json.dumps(new, ensure_ascii=False)[1:-1]
    assert out.count(eo) == n, (old[:60], out.count(eo))
    out = out.replace(eo, en)
k = out.count(TITLE_OLD)
assert k >= 1, "the poll node's title"
out = out.replace(TITLE_OLD, TITLE_NEW)
doc = json.loads(out)


def code_of(n, nid):
    if isinstance(n, dict):
        if n.get("id") == nid:
            return json.dumps(n["data"], ensure_ascii=False)
        for v in n.values():
            r = code_of(v, nid)
            if r:
                return r
    elif isinstance(n, list):
        for v in n:
            r = code_of(v, nid)
            if r:
                return r
    return None


assert "const movedOn" in code_of(doc, "code_node_3onV21Rv")
assert "before its Picking was made" in code_of(doc, "code_node_dQwH6dcp")
assert "IN ('Created', 'Completed', 'Cancelled')" in code_of(doc, "sql_node_LDY1o3Cx")
print("GD_PICKING_OUTBOX_CONSUMER: pick, plan, poll SQL patched (%d title copies)" % k)
if "--write" in sys.argv:
    open(F, "w", encoding="utf-8").write(out)
    print("wrote", F)
