"""cmds.py <what> <tag> [--ia ID] [--job ID] [--name N]: print the EXACT, fully expanded run command(s) of a RUNBOOK step - one
`node scratchpad/gdc/tools/runas.mjs ...` per line, literal ids and paths, nothing chained, so each one is run as its own shell call
(the allow rule of skill running-dev-workflows-as-tenant matches only that). Prints; never runs anything. The fixtures dir is
--out-dir or $IA_LIVE_OUT (outside the repo); <tag> = a build_ia_payload.py folder (its plan.json names the tenant).
  classic | draft | submit | status <tag>     IA_SAVE {classic.json | draft.json} / IA_V2_SUBMIT {submit.json | status.json}
  edit-classic | edit-draft | edit-submit | edit-status <tag>   the same for an `edit` build (a stored Draft)
  worker <tag> --job ID [--revert]            one IA_V2_WORKER (IA_REVERT_V2_WORKER) {job_id} call (tick_ia.sh loops it)
  tick <tag> --job ID [--revert]              the tick_ia.sh loop
  revert-classic <tag> --ia ID                writes <tag>/revert_classic.<ia>.json = the list's classic IA_REVERT request
                                              {ia_id, ia_no, organization_id} from the stored IA (read-only SELECT) and prints its run
  revert-v2 <tag> --ia ID                     writes <tag>/revert_v2.<ia>.json (+ .status.json) = the list's IA_REVERT_V2_SUBMIT request
                                              (RV4: SUBMIT, idempotency_key IAV:<org>:<id>:<clickToken>, LIST, min_picks "50", the row)
  ans <out.json>                              read an answer: HTTP envelope, route / code / message / job_id / ia_id / ia_no / error
A V2 command is refused while its shell id is "0" in scratchpad/iav2/ids.json."""
import json, os, sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ialib as L  # noqa: E402

RUNAS = "node scratchpad/gdc/tools/runas.mjs scratchpad/gdc/tools/id{t}.json {wf} {req} {out}"


def wf(name):
    ids = L.load_ids()
    cls = L.load_config()["workflows_classic"]
    v = ids.get(name) or cls.get(name) or ""
    if not v or v == "0" or not v.isdigit():
        raise SystemExit(f"{name}: shell id not set in scratchpad/iav2/ids.json ({v!r}) - create the shells first (CONTRACT ruling 3)")
    return v


def tag_dir(tag):
    d = L.out_dir(tag)
    plan = os.path.join(d, "plan.json")
    tenant = L.read_json(plan)["tenant"] if os.path.exists(plan) else L.arg("--tenant")
    if not tenant:
        raise SystemExit(f"{plan} missing: build the tag first (build_ia_payload.py) or give --tenant")
    return d, L.digits(tenant, "tenant")


def runas(t, name, req, out):
    if not os.path.exists(req):
        raise SystemExit("missing request " + req)
    n = 2
    base = out
    while os.path.exists(out):
        out = base.replace(".out.json", f".out{n}.json")
        n += 1
    print(RUNAS.format(t=t, wf=wf(name), req=req, out=out))


def ans(path):
    d = L.read_json(path)
    x = d.get("data") if isinstance(d, dict) else None
    if isinstance(x, dict) and isinstance(x.get("data"), dict) and "route" not in x:
        x = x["data"]
    print(f"HTTP envelope code {d.get('code')} success {d.get('success')} msg {str(d.get('msg'))[:200]!r}")
    if not isinstance(x, dict):
        print("   no data (a run that failed at a node: the envelope's msg is the text the client shows)")
        return
    keys = ("route", "code", "message", "reason", "action", "job_id", "job_status", "terminal", "ia_id", "ia_no", "line_count", "progress_percent",
            "progress_message", "error_code", "error_message", "worker_route", "processed", "result_code", "result_message", "id", "msg", "conflicts")
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
    if what in ("classic", "draft", "edit-classic", "edit-draft"):
        f = what.replace("edit-", "")
        runas(t, "IA_SAVE", os.path.join(d, f + ".json"), os.path.join(d, f + ".out.json"))
    elif what in ("submit", "status", "edit-submit", "edit-status"):
        f = what.replace("edit-", "")
        runas(t, "IA_V2_SUBMIT", os.path.join(d, f + ".json"), os.path.join(d, f + ".out.json"))
    elif what in ("worker", "tick"):
        job = L.digits(L.arg("--job"), "--job")
        rev = L.flag("--revert")
        name = "IA_REVERT_V2_WORKER" if rev else "IA_V2_WORKER"
        if what == "tick":
            wf(name)
            print(f"sh scratchpad/iav2/live/tick_ia.sh {t} {job} {d} 12 4" + (" --revert" if rev else ""))
        else:
            req = os.path.join(d, f"worker.{job}.json")
            L.write_json(req, {"job_id": job})
            n = 1
            while os.path.exists(os.path.join(d, f"worker.{job}.call{n}.out.json")):
                n += 1
            runas(t, name, req, os.path.join(d, f"worker.{job}.call{n}.out.json"))
    elif what in ("revert-classic", "revert-v2"):
        ia = L.digits(L.arg("--ia"), "--ia")
        h = L.q(f"SELECT CAST(id AS CHAR) id, stock_movement_no, item_assembly_status, organization_id FROM sm_item_assembly WHERE tenant_id = '{t}' AND id = {ia} AND is_deleted = 0")
        if not h:
            raise SystemExit(f"IA {ia} not found in tenant {t}")
        h = h[0]
        if what == "revert-classic":
            req = os.path.join(d, f"revert_classic.{ia}.json")
            L.write_json(req, {"ia_id": h["id"], "ia_no": h["stock_movement_no"], "organization_id": h["organization_id"]})
            runas(t, "IA_REVERT", req, req.replace(".json", ".out.json"))
        else:
            key = L.rv_key(h["organization_id"], h["id"], L.page_token("rv" + ia))
            row = {"id": h["id"], "item_assembly_status": h["item_assembly_status"], "stock_movement_no": h["stock_movement_no"], "organization_id": h["organization_id"]}
            req = os.path.join(d, f"revert_v2.{ia}.json")
            L.write_json(req, {"operation": "SUBMIT", "ia_id": h["id"], "idempotency_key": key, "source": "LIST", "min_picks": "50", "form": row})
            L.write_json(req.replace(".json", ".status.json"), {"operation": "STATUS", "ia_id": h["id"], "idempotency_key": key, "source": "LIST", "min_picks": "50", "form": {}})
            print(f"# stored {h['item_assembly_status']} {h['stock_movement_no']}; key {key}")
            runas(t, "IA_REVERT_V2_SUBMIT", req, req.replace(".json", ".out.json"))
            print("# STATUS (no DB write):")
            runas(t, "IA_REVERT_V2_SUBMIT", req.replace(".json", ".status.json"), req.replace(".json", ".status.out.json"))
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main()
