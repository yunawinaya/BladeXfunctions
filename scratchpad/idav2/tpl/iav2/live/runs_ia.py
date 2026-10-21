"""runs_ia.py <NAME | workflow id> --tenant T [--minutes 30] [--like TEXT] [-n 10]: the latest runs of one workflow in one tenant,
read-only (su_code_workflow_inst, bounded by workflow_id + a snowflake id window - never by create_time): status, exit node,
seconds (end - start), MB of nodes_data / request / response, the answer's head. NAME = an ids.json / config workflows_classic name
(IA_SAVE, IA_REVERT, IA_V2_SUBMIT, IA_V2_WORKER, IA_V2_PREPARE, IA_V2_COMMIT, IA_REVERT_V2_*, INVENTORY_BULK_APPLY, ...).
--like TEXT keeps the runs whose request holds TEXT (an IA id, a job id, an idempotency key; [A-Za-z0-9|:_.-] only)."""
import os, sys, time

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ialib as L  # noqa: E402


def main():
    if len(sys.argv) < 2 or not L.arg("--tenant"):
        raise SystemExit(__doc__)
    name = sys.argv[1]
    ids, cls = L.load_ids(), L.load_config()["workflows_classic"]
    wid = name if name.isdigit() else (ids.get(name) or cls.get(name) or "")
    if not wid or wid == "0":
        raise SystemExit(f"{name}: no workflow id (ids.json still '0'?)")
    t = L.digits(L.arg("--tenant"), "--tenant")
    lo = (int((time.time() - 60 * float(L.arg("--minutes", "30"))) * 1000) - L.EPOCH) << 22
    like = L.arg("--like") or ""
    if like and not all(ch.isalnum() or ch in "|:_.-" for ch in like):
        raise SystemExit("--like takes [A-Za-z0-9|:_.-] only")
    rows = L.q(f"SELECT CAST(id AS CHAR) id, status, current_node_id, start_date, end_date, run_time, LENGTH(nodes_data) nd, LENGTH(request_json_data) rq, "
               f"LENGTH(response_json_data) rs, LEFT(response_json_data, 220) head, LEFT(error_msg, 200) err FROM su_code_workflow_inst WHERE workflow_id = {L.digits(wid, name)} "
               f"AND id > {lo} AND tenant_id = '{t}'" + (f" AND request_json_data LIKE '%{like}%'" if like else "") + f" ORDER BY id DESC LIMIT {int(L.arg('-n', '10'))}")
    print(f"{name} ({wid}) tenant {t}, last {L.arg('--minutes', '30')} min{', request LIKE ' + like if like else ''}: {len(rows)} run(s)")
    for r in rows:
        try:
            secs = (int(r["end_date"]) - int(r["start_date"])) / 1000
        except (TypeError, ValueError):
            secs = float(r.get("run_time") or 0) / 1000
        print(f"  {r['id']} {str(r['status']):8s} exit {str(r['current_node_id'])[:30]:30s} {secs:8.1f}s  nodes_data {int(r['nd'] or 0) / 1e6:7.2f} MB  "
              f"request {int(r['rq'] or 0) / 1e6:6.2f} MB  response {int(r['rs'] or 0) / 1e6:6.2f} MB")
        print(f"      {(r['err'] or r['head'] or '')[:220]}")


if __name__ == "__main__":
    main()
