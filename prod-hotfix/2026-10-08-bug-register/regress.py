#!/usr/bin/env python3
"""Broad regression: replay every CHANGED code-node of one workflow (BASE vs PROD) on a sample of
recent prod runs, using each run's recorded inputs. Prints every run where the outputs differ
on the keys BASE already returned (keys PROD adds are listed once, not counted as differences).

usage: python3 regress.py <WF> <from YYYY-MM-DD> <to YYYY-MM-DD> [max_runs]"""
import concurrent.futures, datetime, json, os, sys
import replay_tests as rt
import verify

E = 1288834974657
WIDS = {"GOODS_DELIVERY": 2017151544868491265, "PICKING": 2020683258347081730,
        "PACKING_SAVE": 1994279909883895810, "SI_SAVE": 2029040374929154050,
        "PICKING_PLAN": 2021431201147527170, "HANDLING_UNIT": 2037062451509002241,
        "GD_Convert_SI": 2070069049332416514, "PICKING_LOOP": 2021065804251615233,
        "SM_LOCATION_TRANSFER": 2013133675374927874}


def sid(dt):
    dt = (dt - datetime.timedelta(hours=8)).replace(tzinfo=datetime.timezone.utc)
    return (int(dt.timestamp() * 1000) - E) << 22


def changed_code_nodes(wf):
    base = json.load(open(os.path.join(verify.HERE, f"{wf}.BASE.json"), encoding="utf-8"))
    prod = json.load(open(os.path.join(verify.HERE, f"{wf}.PROD.json"), encoding="utf-8"))
    ib, ip = verify.index(base), verify.index(prod)
    return sorted(i for i in set(ib) & set(ip) if ib[i]["type"] == "code-node"
                  and ib[i]["data"]["script"]["code"] != ip[i]["data"]["script"]["code"])


def sample_ids(wid, start, end, limit):
    """Spread the sample across the window: an equal share from each 12h slice."""
    slices, cur = [], start
    while cur < end:
        slices.append((cur, min(cur + datetime.timedelta(hours=12), end)))
        cur += datetime.timedelta(hours=12)
    per = max(1, limit // len(slices))
    ids = []
    for lo, hi in slices:
        ids += [r["id"] for r in rt.db(
            f"SELECT id FROM su_code_workflow_inst WHERE workflow_id={wid} AND status='Complete' "
            f"AND id BETWEEN {sid(lo)} AND {sid(hi)} ORDER BY id DESC LIMIT {per}")]
    return ids[:limit]


def one(args):
    wf, run_id, nodes_to_check = args
    params, nodes = rt.trace(run_id)
    rt._cache.pop(run_id, None)
    out = []
    for nid in nodes_to_check:
        if not (nodes.get(nid) or {}).get("data"):
            continue  # the node did not run here
        try:
            old, new = rt.both(wf, nid, params, nodes, rt.run_time_ms(run_id))
        except Exception as e:
            out.append((nid, "ERROR", str(e)[:300]))
            continue
        if not rt.same_as_recorded(old, nodes[nid]["data"]):
            out.append((nid, "BASE!=recorded", ""))
            continue
        added = sorted(set(new) - set(old))
        diff = sorted(k for k in old if not rt.same(old[k], new.get(k)))
        out.append((nid, "DIFF" if diff else "same", {"keys": diff, "added": added,
                    "sample": {k: (json.dumps(old[k], ensure_ascii=False)[:200],
                                   json.dumps(new.get(k), ensure_ascii=False)[:200]) for k in diff[:3]}}))
    return run_id, out


if __name__ == "__main__":
    wf = sys.argv[1]
    start, end = (datetime.datetime.strptime(a, "%Y-%m-%d") for a in sys.argv[2:4])
    limit = int(sys.argv[4]) if len(sys.argv) > 4 else 200
    nodes_to_check = changed_code_nodes(wf)
    ids = sample_ids(WIDS[wf], start, end, limit)
    print(f"{wf}: {len(ids)} runs, changed code nodes {nodes_to_check}", flush=True)
    tally = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for run_id, results in pool.map(one, [(wf, i, nodes_to_check) for i in ids]):
            for nid, verdict, detail in results:
                tally[(nid, verdict)] = tally.get((nid, verdict), 0) + 1
                if verdict != "same":
                    print(f"  {verdict} {run_id} {nid} {json.dumps(detail, ensure_ascii=False)[:900]}", flush=True)
    for (nid, verdict), n in sorted(tally.items()):
        print(f"TALLY {nid} {verdict} {n}")
