"""live_si.py: live checks of the lean SI workflows on DEV (the run itself goes through scratchpad/gdc/tools/runas.mjs, its own command).

  live_si.py before <GD|SO|SI> <doc id> <tenant> <snapshot.json> [<identity.json>: only that user's runs and invoices]
      read-only: the order / delivery lines the conversion (or the cancel of invoice <doc id>) will touch, and a snowflake bound
  live_si.py after <snapshot.json> [<runas out.json>]
      read-only: every run the request made after the bound (status, time, node data, error); for each SI_SAVE run, its own payload
      replayed through v83 and v84 (sim) against the snapshot, compared with what was really written - the invoice rows the add-node
      took, the order / delivery counters now in the database, the receivable handed to AR_SAVE. For SI_CANCEL, the counters.
"""
import json, os, subprocess, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
SI2K = os.path.abspath(os.path.join(HERE, ".."))
sys.path.insert(0, os.path.join(SI2K, "..", "grv2"))
sys.path.insert(0, SI2K)
from dbq import q  # noqa: E402
_argv = sys.argv
sys.argv = sys.argv[:1]
import build_si_save as B  # noqa: E402
sys.argv = _argv

WF = {"2029040374929154050": "SI_SAVE", "2070069049332416514": "GD_Convert_SI", "2029006184569364481": "SO_Convert_SI", "2053854738953736194": "SI_CANCEL",
      "2072601187701137409": "AR_SAVE", "1990247316342333442": "CREDIT_LIMIT_CHECK", "2029464545187823617": "SI_POST", "2071778395376971778": "SI_TO_PI",
      "2037376510712283138": "CP_SAVE"}


def fill(sql, tenant, key, ids):
    return sql.replace("{{node:code_si_prep.data.tenantId}}", tenant).replace("{{node:code_si_prep.data.%s}}" % key, ",".join(ids) or "0")


def bound_now():
    return str((int(time.time() * 1000) - 5000 - 1288834974657) << 22)


def lines(tenant, so_ids, gd_ids):
    so = q("--dev", fill(B.SQL_SO, tenant, "soIdsSql", so_ids)) if so_ids else []
    gd = q("--dev", fill(B.SQL_GD, tenant, "gdIdsSql", gd_ids)) if gd_ids else []
    heads = {}
    if so_ids:
        for r in q("--dev", "SELECT CAST(id AS CHAR) id, IFNULL(si_status, '') s FROM sales_order WHERE id IN (%s)" % ",".join(so_ids)):
            heads["so:" + r["id"]] = r["s"]
    if gd_ids:
        for r in q("--dev", "SELECT CAST(id AS CHAR) id, IFNULL(si_status, '') s FROM goods_delivery WHERE id IN (%s)" % ",".join(gd_ids)):
            heads["gd:" + r["id"]] = r["s"]
    return {"so": so, "gd": gd, "heads": heads}


def before(kind, doc_id, tenant, out, user=None):
    so_ids, gd_ids = [], []
    if kind == "GD":
        gd_ids = [doc_id]
        r = q("--dev", "SELECT so_id FROM goods_delivery WHERE id = %s" % doc_id)[0]["so_id"]
        so_ids = [str(x) for x in (json.loads(r) if isinstance(r, str) else r or [])]
    elif kind == "SO":
        so_ids = [doc_id]
    else:
        r = q("--dev", "SELECT so_id, gd_id FROM sales_invoice WHERE id = %s" % doc_id)[0]
        so_ids = [str(x) for x in (json.loads(r["so_id"]) if isinstance(r["so_id"], str) else r["so_id"] or [])]
        gd_ids = [str(x) for x in (json.loads(r["gd_id"]) if isinstance(r["gd_id"], str) else r["gd_id"] or [])]
    snap = {"kind": kind, "doc": doc_id, "tenant": tenant, "user": user, "bound": bound_now(), "so_ids": so_ids, "gd_ids": gd_ids,
            "lines": lines(tenant, so_ids, gd_ids)}
    json.dump(snap, open(out, "w"))
    n = lambda rows: sum(1 for r in rows if '"id": null' not in r["j"] and '"id":null' not in r["j"])
    print("snapshot %s %s: %d SO lines, %d GD lines, bound %s -> %s" % (kind, doc_id, n(snap["lines"]["so"]), n(snap["lines"]["gd"]), snap["bound"], out))


def runs_after(snap):
    rows = q("--dev", "SELECT CAST(id AS CHAR) id, CAST(workflow_id AS CHAR) w, status, run_time, LENGTH(nodes_data) nd, LENGTH(request_json_data) rq, "
                      "LEFT(IFNULL(error_msg, ''), 300) err, current_node_id node FROM su_code_workflow_inst WHERE id > %s AND tenant_id = '%s' "
                      "AND workflow_id IN (%s)%s ORDER BY id" % (snap["bound"], snap["tenant"], ",".join(WF),
                                                                 (" AND create_user = %s" % snap["user"]) if snap.get("user") else ""))
    return rows


def node_js(script, payload):
    out = subprocess.run(["node", "-e", script], input=json.dumps(payload), capture_output=True, text=True, cwd=os.path.join(SI2K, "sim"))
    if out.returncode:
        raise RuntimeError(out.stderr[-3000:])
    return json.loads(out.stdout)


PREDICT = r"""
const fs = require("fs");
const L = require("./lib.js");
const { Engine } = require("./engine.js");
const { World, clone } = require("./world_save.js");
const input = JSON.parse(fs.readFileSync(0, "utf8"));
const shape = new Function(fs.readFileSync("../code/si_check.js", "utf8") + "\nreturn siShape;")();
const run = L.parseJ(input.runJson);
const req = L.parseJ(run.request_json_data);
const data = (req.workflowparams || req.request_json).data;
const rec = {};
const wrote = {};
for (const x of L.parseJ(run.nodes_data) || []) {
  if (!x || !x.node_id) continue;
  const o = L.parseJ(x.response_json_data);
  if (o && typeof o === "object" && "data" in o) rec[x.node_id] = o.data;
  if (x.node_id === "add_node_adYeQB4a" || x.node_id === "update_node_I7KGszOE") wrote[x.node_id] = L.parseJ(x.request_json_data);
}
const mk = () => {
  const w = new World(rec, { tenantId: input.tenant });
  for (const d of shape(input.lines.so, "table_so")) w.addDoc(w.so, d, "table_so");
  for (const d of shape(input.lines.gd, "table_gd")) w.addDoc(w.gd, d, "table_gd");
  for (const d of Object.values(w.so)) Object.assign(d.header, { si_status: input.lines.heads["so:" + d.header.id] });
  for (const d of Object.values(w.gd)) Object.assign(d.header, { si_status: input.lines.heads["gd:" + d.header.id] });
  return w;
};
const out = {};
for (const [k, file] of [["v83", "../base/dev/SI_SAVE.v83.json"], ["v84", "../out/SI_SAVE.json"]]) {
  const w = mk();
  const e = new Engine(JSON.parse(fs.readFileSync(file, "utf8")), w, {});
  const r = e.run(clone({ data }));
  out[k] = { outcome: r.outcome, si: r.writes.filter((x) => x.table === "Sales Invoice").map((x) => ({ kind: x.kind, rows: x.rows })),
    counters: w.counters(), calls: w.calls.filter((c) => c.name !== "CHECK_REQUIRED_FIELD") };
}
out.wrote = wrote;
process.stdout.write(JSON.stringify(out));
"""

CANON = r"""
const canon = (v) => {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") { const o = {}; for (const k of Object.keys(v).sort()) if (v[k] !== undefined && v[k] !== null) o[k] = canon(v[k]); return o; }
  if (typeof v === "number" && Number.isFinite(v)) return Number(v.toPrecision(15));
  return v;
};
"""


def counters_now(snap):
    now = lines(snap["tenant"], snap["so_ids"], snap["gd_ids"])
    out = {}
    for kind in ("so", "gd"):
        for r in now[kind]:
            o = json.loads(r["j"])
            if o.get("id") is None:
                continue
            q8 = None if o.get("invoice_qty") is None else round(float(o["invoice_qty"]), 8)
            out["%s:%s:%s" % (kind, o["doc"], o["id"])] = {"invoice_qty": q8, "si_status": o.get("si_status") or ""}
    for k, v in now["heads"].items():
        out[k] = {"si_status": v}
    return out


def invariants(snap):
    """straight from the database: the invoice lines written after the bound account for every change of the order / delivery
    counters, and every touched line's status follows from its quantities (any size: no recorded node data needed)"""
    t = snap["tenant"]
    sis = q("--dev", "SELECT CAST(id AS CHAR) id, sales_invoice_no, si_status, invoice_total FROM sales_invoice WHERE tenant_id = '%s' AND is_deleted = 0 "
                     "AND id > %s%s ORDER BY id" % (t, snap["bound"], (" AND create_user = %s" % snap["user"]) if snap.get("user") else ""))
    if not sis:
        print("  invariants: no invoice written after the bound")
        return
    ids = ",".join(s["id"] for s in sis)
    sil = q("--dev", "SELECT CAST(so_line_id AS CHAR) so_line, CAST(gd_line_id AS CHAR) gd_line, invoice_qty FROM sales_invoice_zt0c3x55_sub "
                     "WHERE tenant_id = '%s' AND is_deleted = 0 AND sales_invoice_id IN (%s)" % (t, ids))
    completed = all(s["si_status"] == "Completed" for s in sis)
    by = {"so": {}, "gd": {}}
    for l in sil:
        for kind, key in (("so", "so_line"), ("gd", "gd_line")):
            if l[key]:
                by[kind][l[key]] = by[kind].get(l[key], 0) + float(l["invoice_qty"] or 0)
    before = {}
    for kind in ("so", "gd"):
        for r in snap["lines"][kind]:
            o = json.loads(r["j"])
            if o.get("id") is not None:
                before[(kind, o["id"])] = o
    now = lines(t, snap["so_ids"], snap["gd_ids"])
    bad, checked, top_status = [], 0, {}
    for kind in ("so", "gd"):
        qty_key = "so_quantity" if kind == "so" else "gd_qty"
        for r in now[kind]:
            o = json.loads(r["j"])
            if o.get("id") is None:
                continue
            b = before.get((kind, o["id"]), {})
            delta = round(float(o.get("invoice_qty") or 0) - float(b.get("invoice_qty") or 0), 6)
            want = round(by[kind].get(o["id"], 0), 6) if completed else 0
            checked += 1
            if abs(delta - want) > 1e-6:
                bad.append("%s line %s: invoiced %+g, invoice lines say %+g" % (kind, o["id"], delta, want))
            if want and o.get("parent_id") is None:
                inv, qty = float(o.get("invoice_qty") or 0), float(o.get(qty_key) or 0)
                exp = "Fully Invoiced" if inv >= qty else "Partially Invoiced"
                if (o.get("si_status") or "") != exp:
                    bad.append("%s line %s: status %r, quantities say %r" % (kind, o["id"], o.get("si_status"), exp))
            if o.get("parent_id") is None:
                top_status.setdefault((kind, o["doc"]), []).append(o.get("si_status") or "")
    for (kind, doc), sts in top_status.items():
        fully, partly = sts.count("Fully Invoiced"), sts.count("Partially Invoiced")
        exp = ("Fully Invoiced" if fully == len(sts) else "Partially Invoiced") if (fully or partly) else ""
        got = now["heads"].get("%s:%s" % (kind, doc), "")
        if completed and got != exp:
            bad.append("%s header %s: %r, its lines say %r" % (kind, doc, got, exp))
    print("  invariants: %d invoice(s) %s, %d invoice lines; %d order / delivery lines checked; %d problems" % (
        len(sis), ", ".join("%s %s %s" % (s["sales_invoice_no"], s["si_status"], s["invoice_total"]) for s in sis), len(sil), checked, len(bad)))
    for x in bad[:10]:
        print("     " + x)


def _same(a, b):
    """a stored value against a predicted one: number formats, '' vs NULL, a date's time part, JSON text, bigint as text"""
    def n(v):
        if isinstance(v, str):
            s = v.strip()
            if s == "":
                return None
            if s[:1] in "[{":
                try:
                    return n(json.loads(s))
                except ValueError:
                    pass
            try:
                f = float(s)
                return round(f, 6) if len(s.split(".")[0].lstrip("-")) < 16 else s
            except ValueError:
                return s[:10] if len(s) >= 19 and s[4] == "-" and s[10] == " " and s[11:] in ("00:00:00", "00:00:00.000", "00:00:00.0") else s
        if isinstance(v, bool):
            return int(v)
        if isinstance(v, (int, float)):
            return round(float(v), 6) if abs(v) < 1e15 else str(int(v))
        if isinstance(v, list):
            return [n(x) for x in v]
        if isinstance(v, dict):
            return {k: n(x) for k, x in v.items() if n(x) is not None}
        return v
    return n(a) == n(b)


def stored_vs_predicted(tenant, pred_rows):
    """the invoice as stored now (header + every line, all columns) against the add-node row v83 would have written"""
    if not pred_rows:
        return
    row = pred_rows[0]
    sis = q("--dev", "SELECT * FROM sales_invoice WHERE tenant_id = '%s' AND is_deleted = 0 AND so_no_display = '%s' AND id > %s ORDER BY id DESC LIMIT 1" % (
        tenant, str(row.get("so_no_display", "")).replace("'", "''"), str((int(time.time() * 1000) - 3600000 - 1288834974657) << 22)))
    if not sis:
        print("  stored invoice: not found")
        return
    head = sis[0]
    cols = set(head)
    skip = {"id", "sales_invoice_no", "create_user", "create_dept", "create_time", "update_user", "update_time", "tenant_id", "is_deleted", "sub_tenant_id"}
    hd = [k for k in row if k != "table_si" and k in cols and k not in skip and not _same(head[k], row[k])]
    lines_db = q("--dev", "SELECT * FROM sales_invoice_zt0c3x55_sub WHERE sales_invoice_id = %s AND is_deleted = 0 ORDER BY id" % head["id"])
    flat = []
    for l in row.get("table_si") or []:
        flat.append({k: v for k, v in l.items() if k != "children"})
        for c in l.get("children") or []:
            flat.append(c)
    lcols = set(lines_db[0]) if lines_db else set()
    by_gd = {}
    for l in lines_db:
        by_gd.setdefault((str(l.get("gd_line_id") or ""), str(l.get("so_line_id") or ""), str(l.get("line_index") or "")), l)
    ld, missing = {}, 0
    for p in flat:
        got = by_gd.get((str(p.get("gd_line_id") or ""), str(p.get("so_line_id") or ""), str(p.get("line_index") or "")))
        if not got:
            missing += 1
            continue
        for k, v in p.items():
            if k in lcols and k not in skip and k not in ("parent_id", "sales_invoice_id") and not _same(got[k], v):
                ld[k] = ld.get(k, 0) + 1
    print("  stored invoice %s: header %d columns compared, %d differ%s | lines %d stored / %d predicted, %d unmatched, columns differing: %s" % (
        head["sales_invoice_no"], len([k for k in row if k in cols and k not in skip]), len(hd), (" " + str(hd)) if hd else "", len(lines_db), len(flat),
        missing, ld or "none"))


def after(snap_file, runas_out=None):
    snap = json.load(open(snap_file))
    invariants(snap)
    if runas_out and os.path.exists(runas_out):
        res = json.load(open(runas_out))
        print("response:", json.dumps(res.get("data", res), ensure_ascii=False)[:600])
    runs = runs_after(snap)
    for r in runs:
        print("  run %s %-18s %-9s %7.1f s | node data %6.2f MB | request %6.2f MB | end %s %s" % (
            r["id"], WF.get(r["w"], r["w"]), r["status"], int(r["run_time"] or 0) / 1000, int(r["nd"] or 0) / 1e6, int(r["rq"] or 0) / 1e6, r["node"],
            ("| ERROR " + r["err"]) if r["err"] else ""))
    now = counters_now(snap)
    for r in [x for x in runs if WF.get(x["w"]) == "SI_SAVE"]:
        full = q("--dev", "SELECT request_json_data, nodes_data FROM su_code_workflow_inst WHERE id = %s" % r["id"])[0]
        pred = node_js(PREDICT, {"runJson": json.dumps(full), "tenant": snap["tenant"], "lines": snap["lines"]})
        canon = lambda v: node_js(CANON + "process.stdout.write(JSON.stringify(canon(JSON.parse(require('fs').readFileSync(0,'utf8')))));", v)
        same_pred = json.dumps(canon(pred["v83"]["si"]), sort_keys=True) == json.dumps(canon(pred["v84"]["si"]), sort_keys=True)
        live_rows = pred["wrote"].get("add_node_adYeQB4a") or pred["wrote"].get("update_node_I7KGszOE") or {}
        live_rows = live_rows.get("data") if isinstance(live_rows, dict) and "data" in live_rows else live_rows
        live_rows = [live_rows] if isinstance(live_rows, dict) else live_rows
        pred_rows = (pred["v83"]["si"] or [{}])[0].get("rows")
        same_live = json.dumps(canon(live_rows), sort_keys=True) == json.dumps(canon(pred_rows), sort_keys=True)
        print("  SI_SAVE %s: v83 outcome %s, v84 outcome %s | invoice rows v83 = v84 (sim): %s | live add/update input = v83 prediction: %s" % (
            r["id"], (pred["v83"]["outcome"] or {}).get("code"), (pred["v84"]["outcome"] or {}).get("code"), same_pred, same_live))
        if not same_live:
            a, b = canon(live_rows), canon(pred_rows)
            a = a[0] if isinstance(a, list) and a else a
            b = b[0] if isinstance(b, list) and b else b
            for k in sorted(set(a or {}) | set(b or {})):
                if json.dumps((a or {}).get(k), sort_keys=True) != json.dumps((b or {}).get(k), sort_keys=True):
                    print("     %s: live %s | v83 %s" % (k, json.dumps((a or {}).get(k))[:200], json.dumps((b or {}).get(k))[:200]))
        stored_vs_predicted(snap["tenant"], pred_rows)
        for ver in ("v83", "v84"):
            exp = pred[ver]["counters"]
            def norm(d):
                return {kk: (round(float(v), 8) if isinstance(v, (int, float)) else (v or "")) for kk, v in (d or {}).items() if kk != "posted_qty"}
            bad = [(k, exp[k], now.get(k)) for k in exp if norm(exp[k]) != norm({kk: now.get(k, {}).get(kk) for kk in exp[k]})]
            only_heads = all(k.count(":") == 1 for k, _, _ in bad)
            print("  counters now vs %s prediction: %d of %d differ%s" % (ver, len(bad), len(exp), " (headers only: the v84 header fix)" if bad and only_heads and ver == "v83" else ""))
            for k, e, n in bad[:6]:
                print("     %s: predicted %s | now %s" % (k, e, n))
        ar = [c for c in pred["v83"]["calls"] if c["name"] == "AR_SAVE"]
        live_ar = [x for x in runs if WF.get(x["w"]) == "AR_SAVE"]
        if ar and live_ar:
            got = q("--dev", "SELECT request_json_data FROM su_code_workflow_inst WHERE id = %s" % live_ar[0]["id"])[0]["request_json_data"]
            got = node_js("const L=require('./lib.js');let r=L.parseJ(require('fs').readFileSync(0,'utf8'));if(typeof r==='string')r=L.parseJ(r);const p=r.workflowparams||r.request_json||r;"
                          "process.stdout.write(JSON.stringify(p));", got)
            exp_ar = dict(ar[0]["params"])
            for p in (got, exp_ar):
                if isinstance(p.get("data"), dict):
                    p["data"].pop("due_date", None)
            same_ar = json.dumps(canon(got), sort_keys=True) == json.dumps(canon(exp_ar), sort_keys=True)
            print("  AR_SAVE payload = v83 prediction (due date aside): %s" % same_ar)


if __name__ == "__main__":
    if sys.argv[1] == "before":
        before(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5], json.load(open(sys.argv[6]))["user_id"] if len(sys.argv) > 6 else None)
    else:
        after(sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None)
