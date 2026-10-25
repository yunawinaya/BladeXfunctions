#!/usr/bin/env python3
"""
Read-only: which LSH (128671) users still run the classic mobile app (store build 1.1.34) since a given time, so their phones
can be updated before they collide with V2 stock writes (GD-2610-1100 review 10-24, GD-2610-1245 lost write 10-25).

  Classic Packing completion = PACKING_SAVE with saveAs "Completed". Updated V2 phones still call PACKING_SAVE for Draft /
  Created saves (HU progress); a Completed one from an updated phone is only the NOT_ELIGIBLE fallback (~0 at LSH).
  Classic Picking confirm = PICKING_LOOP with saveAs "Completed" and pageStatus "Edit". (saveAs "Created" + pageStatus "Add" is
  Convert to Picking, an office action.) An updated phone also confirms classic right after PICKING_ASYNC_SUBMIT answered
  NOT_ELIGIBLE for the same Picking (bin / batch swap, Force Complete): those are left out. Each classic confirm is labelled
  phone or web: the app's Picking rows carry _mobile_locations (1.1.34 also sends fm_key, so fm_key cannot tell them apart).

Usage: python3 scratchpad/lsh_classic_phones.py [--since "2026-10-26 06:00"] [--tenant 128671]
Exit 1 when a classic phone is found, 0 when none.
"""
import datetime
import json
import subprocess
import sys

EPOCH = 1288834974657
MYT = datetime.timezone(datetime.timedelta(hours=8))
FALLBACK_WINDOW_S = 300


def rows(sql):
    out = subprocess.run([".dbtools/db", "--prod", "--json", "--limit", "100000", sql], capture_output=True, text=True).stdout
    i = out.find("[")
    return json.loads(out[i:]) if i >= 0 else []


def main():
    args = sys.argv[1:]
    tenant, since = "128671", datetime.datetime.now(MYT).strftime("%Y-%m-%d") + " 00:00"
    while args:
        a = args.pop(0)
        if a == "--since":
            since = args.pop(0)
        elif a == "--tenant":
            tenant = args.pop(0)
        else:
            print(__doc__)
            return 2
    assert tenant.isdigit()
    lo = (int(datetime.datetime.strptime(since, "%Y-%m-%d %H:%M").replace(tzinfo=MYT).timestamp() * 1000) - EPOCH) << 22
    base = "FROM su_code_workflow_inst WHERE id > %d AND tenant_id = '%s' " % (lo, tenant)
    packs = rows("SELECT IFNULL(create_user_name, create_user) AS u, COUNT(*) AS n, MAX(create_time) AS last " + base +
                 "AND workflow_name = 'PACKING_SAVE' AND JSON_UNQUOTE(JSON_EXTRACT(request_json_data, '$.workflowparams.saveAs')) = 'Completed' GROUP BY u")
    picks = rows("SELECT IFNULL(create_user_name, create_user) AS u, create_time AS t, JSON_EXTRACT(request_json_data, '$.workflowparams.arrayData[*].id') AS ids, "
                 "LOCATE('\"_mobile_locations\"', JSON_EXTRACT(request_json_data, '$.workflowparams.arrayData')) = 0 AS web " + base +
                 "AND workflow_name = 'PICKING_LOOP' AND JSON_UNQUOTE(JSON_EXTRACT(request_json_data, '$.workflowparams.saveAs')) = 'Completed' "
                 "AND JSON_UNQUOTE(JSON_EXTRACT(request_json_data, '$.workflowparams.pageStatus')) = 'Edit'")
    refused = rows("SELECT JSON_UNQUOTE(JSON_EXTRACT(request_json_data, '$.workflowparams.picking_id')) AS pid, create_time AS t " + base +
                   "AND workflow_name = 'PICKING_ASYNC_SUBMIT' AND JSON_UNQUOTE(JSON_EXTRACT(response_json_data, '$.data.route')) = 'NOT_ELIGIBLE'")
    ts = lambda x: datetime.datetime.strptime(str(x)[:19], "%Y-%m-%d %H:%M:%S")
    refused_at = {}
    for r in refused:
        refused_at.setdefault(str(r["pid"]), []).append(ts(r["t"]))
    classic_picks = {}
    for r in picks:
        ids = [str(i) for i in (json.loads(r["ids"]) if r["ids"] else []) if i]
        t = ts(r["t"])
        fallback = any(0 <= (t - s).total_seconds() <= FALLBACK_WINDOW_S for i in ids for s in refused_at.get(i, []))
        if not fallback:
            c = classic_picks.setdefault((r["u"], "web" if str(r["web"]) == "1" else "phone"), [0, t])
            c[0] += 1
            c[1] = max(c[1], t)
    print("LSH classic mobile runs since %s MYT (tenant %s)" % (since, tenant))
    found = False
    for r in sorted(packs, key=lambda x: -int(x["n"])):
        found = True
        print("  %-16s classic Packing completion   runs %-4s last %s" % (r["u"], r["n"], r["last"]))
    for (u, src), (n, last) in sorted(classic_picks.items(), key=lambda kv: -kv[1][0]):
        found = True
        print("  %-16s classic Picking confirm (%s) runs %-4s last %s" % (u, src, n, last))
    if not found:
        print("  none: no classic Packing completion or classic Picking confirm since then")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main())
