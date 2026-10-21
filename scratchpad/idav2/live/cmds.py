"""cmds.py <what> <tag> [--job ID]: print the EXACT, fully expanded run command(s) of a RUNBOOK step - one
`node scratchpad/gdc/tools/runas.mjs ...` per line, literal ids and paths, nothing chained, so each one is run as its own shell call
(the allow rule of skill running-dev-workflows-as-tenant matches only that). Prints; never runs anything. The fixtures dir is
--out-dir or $IDA_LIVE_OUT (outside the repo); <tag> = a build_ida_payload.py / variant.py folder (its plan.json names the tenant).
  classic | draft <tag> [--again]       IDA_SAVE {classic.json | draft.json}  (the form's Completed / Save as Draft); refused when its
                                        <what>.out.json exists (a retry after a timeout would save a SECOND IDA: --again prints it as
                                        .out2.json), and refused for a request only v7 refuses (> 250 moves Completed, an Edit of a stored
                                        non-Draft IDA) while the enabled IDA_SAVE lacks v7's code_node_IDAguardStored (on v6 it WRITES)
  submit | status <tag>                 IDA_V2_SUBMIT {submit.json | status.json}  (status writes nothing)
  worker <tag> --job ID                 one IDA_V2_WORKER {job_id} call (tick_ida.sh loops it)
  tick <tag> --job ID                   the tick_ida.sh loop line
  ans <out.json>                        read an answer: HTTP envelope, route / code / message / job_id / ida_id / ida_no / error
A V2 command is refused while its shell id is "0" in scratchpad/idav2/ids.json. The checks are SELECTs (dev)."""
import os, sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import idalib as L  # noqa: E402

RUNAS = "node scratchpad/gdc/tools/runas.mjs scratchpad/gdc/tools/id{t}.json {wf} {req} {out}"
GUARD_NODE = "code_node_IDAguardStored"


def tag_dir(tag):
    d = L.out_dir(tag)
    plan = os.path.join(d, "plan.json")
    tenant = L.read_json(plan)["tenant"] if os.path.exists(plan) else L.arg("--tenant")
    if not tenant:
        raise SystemExit(f"{plan} missing: build the tag first (build_ida_payload.py) or give --tenant")
    return d, L.digits(tenant, "tenant")


def runas(t, name, req, out, once=False):
    """once: a classic / draft save is not idempotent - its answer file existing means it already ran (or timed out mid-run)"""
    if not os.path.exists(req):
        raise SystemExit("missing request " + req)
    if once and os.path.exists(out) and not L.flag("--again"):
        raise SystemExit(f"refusing: {out} exists - this IDA_SAVE request already ran (a retry after a timeout saves a SECOND IDA). Read it with "
                         f"`cmds.py ans {out}` and check the IDA by SELECT; --again prints the command anyway (answer -> .out2.json)")
    n, base = 2, out
    while os.path.exists(out):
        out = base.replace(".out.json", f".out{n}.json")
        n += 1
    print(RUNAS.format(t=t, wf=L.wf_id(name), req=req, out=out))


def v7_live():
    """(True, version) when the ENABLED IDA_SAVE history row (the live one) carries v7's stored-status guard node"""
    rows = L.q(f"SELECT CAST(version_number AS CHAR) v, LOCATE('{GUARD_NODE}', script_json) g FROM su_code_workflow_history WHERE data_id = {L.wf_id('IDA_SAVE')} "
               "AND status = 'enabled' ORDER BY id DESC LIMIT 1")
    return (bool(rows) and int(rows[0]["g"] or 0) > 0), (rows[0]["v"] if rows else None)


def v7_only(what, req, tenant):
    """why this IDA_SAVE request is a refusal on v7 but a WRITE on v6 ([] = the same on both): Completed with > 250 moves (v7's move cap,
    idaMoveCount as the guard counts), an Edit of a stored IDA that is not Draft (Processing: v7's busy 400; Completed / Fully Posted: 409)"""
    ad = req.get("allData") or {}
    why = []
    moves = L.node(L.SHARED_JS + "console.log(JSON.stringify(C.idaMoveCount(p, p.stock_movement)));", ad)
    if what == "classic" and moves > 250:
        why.append(f"{moves} moves > 250 (v7 refuses the classic save; v6 COMPLETES it)")
    if str(req.get("pageStatus") or "") == "Edit":
        ida = str(ad.get("id") or "")
        if not ida.isdigit():
            why.append("an Edit without a stored id")
        else:
            row = L.q(f"SELECT item_disassembly_status s FROM sm_item_disassembly WHERE tenant_id = '{L.digits(tenant, 'tenant')}' AND id = {ida} AND is_deleted = 0")
            st = row[0]["s"] if row else None
            if st != "Draft":
                why.append(f"an Edit of the stored {st or 'MISSING'} IDA {ida} (v7 refuses it; v6 OVERWRITES it)")
    return why


def ans(path):
    d = L.read_json(path)
    x = d.get("data") if isinstance(d, dict) else None
    if isinstance(x, dict) and isinstance(x.get("data"), dict) and "route" not in x and "code" not in x:
        x = x["data"]
    print(f"HTTP envelope code {d.get('code')} success {d.get('success')} msg {str(d.get('msg'))[:200]!r}")
    if not isinstance(x, dict):
        print("   no data (a run that failed at a node: the envelope's msg is the text the client shows)")
        return
    keys = ("route", "code", "message", "reason", "action", "job_id", "job_status", "terminal", "ida_id", "ida_no", "line_count", "progress_percent",
            "progress_message", "error_code", "error_message", "worker_route", "processed", "jobs", "result_code", "result_message", "id", "msg", "evidence")
    for k in keys:
        if k in x and x[k] not in (None, ""):
            print(f"   {k}: {str(x[k])[:300]}")


def main():
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    what, tag = sys.argv[1], sys.argv[2]
    if what == "ans":
        return ans(tag)
    d, t = tag_dir(tag)
    if what in ("classic", "draft"):
        req = os.path.join(d, what + ".json")
        why = v7_only(what, L.read_json(req), t) if os.path.exists(req) else []
        if why:
            live, ver = v7_live()
            if not live:
                raise SystemExit(f"refusing: on the live IDA_SAVE (enabled v{ver}, no {GUARD_NODE}) this request WRITES - {'; '.join(why)}. "
                                 "Run it only after batch 1 publishes v7 (RUNBOOK: 'WRITE on v6 - run only after batch 1')")
            print(f"# v7 live (enabled IDA_SAVE v{ver} carries {GUARD_NODE}): expected refusal - {'; '.join(why)}", file=sys.stderr)
        runas(t, "IDA_SAVE", req, os.path.join(d, what + ".out.json"), once=True)
    elif what in ("submit", "status"):
        runas(t, "IDA_V2_SUBMIT", os.path.join(d, what + ".json"), os.path.join(d, what + ".out.json"))
    elif what in ("worker", "tick"):
        job = L.digits(L.arg("--job"), "--job")
        if what == "tick":
            L.wf_id("IDA_V2_WORKER")
            print(f"sh scratchpad/idav2/live/tick_ida.sh {t} {job} {d} 12 4")
        else:
            req = os.path.join(d, f"worker.{job}.json")
            L.write_json(req, {"job_id": job})
            n = 1
            while os.path.exists(os.path.join(d, f"worker.{job}.call{n}.out.json")):
                n += 1
            runas(t, "IDA_V2_WORKER", req, os.path.join(d, f"worker.{job}.call{n}.out.json"))
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main()
