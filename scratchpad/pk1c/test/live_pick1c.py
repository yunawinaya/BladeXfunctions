"""live_pick1c.py <tenant> <gd_id> <classic|v2> <out_request.json> <k>:<qty>[@<bin>][/<batch>],...
Picking V2 1c live twins: one pick spec -> the request for one twin GD's one live Picking.
  classic: a PICKING_LOOP request as the web Picking form's Complete sends it (saveAs Completed, pageStatus Edit, every
           item, picked_qty 0 on the rest), each picked item carrying target_location / target_batch (copied from
           scratchpad/gde/test/live_pick_req.py, + the targets)
  v2:      PICKING_ASYNC_SUBMIT CONFIRM params, lines [{row_id, qty, target_location_id, target_batch_id}]
k = the GD line's position (1-based, id order, live lines); @bin / /batch = the target (omitted: the stored source).
Reads read-only (dev); the request goes to the session scratchpad."""
import importlib.util
import json
import sys
import time

sys.path.insert(0, "/Users/yunawinaya/Developer/BladeXfunctions/scratchpad/gdc/pkv2tools")
from dbq import q  # noqa: E402

spec = importlib.util.spec_from_file_location("g", "/Users/yunawinaya/Developer/BladeXfunctions/scratchpad/gdc/prepare/sql.py")
g = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)

tenant, gd, mode, out, picks = sys.argv[1:6]
assert tenant.isdigit() and gd.isdigit() and mode in ("classic", "v2")
want = {}
for x in picks.split(","):
    k, rest = x.split(":")
    qty, _, tgt = rest.partition("@")
    loc, _, bat = tgt.partition("/")
    assert all(v == "" or v.isdigit() for v in (loc, bat)), x
    want[int(k)] = (float(qty), loc, bat)
SYS = {"create_user", "create_dept", "create_time", "update_user", "update_time", "is_deleted", "sub_tenant_id", "sub_tenant_id_d_xxjld"}


def obj(row):
    def fix(v):
        if isinstance(v, bool):
            return v
        if isinstance(v, int) and len(str(abs(v))) >= 16:
            return str(v)
        if isinstance(v, dict):
            return {k: fix(x) for k, x in v.items()}
        if isinstance(v, list):
            return [fix(x) for x in v]
        return v
    return {k: v for k, v in fix(json.loads(row["j"])).items() if k not in SYS}


T = f"tenant_id = '{tenant}'"
names = f"(JSON_CONTAINS(t.gd_no, JSON_QUOTE('{gd}')) OR JSON_CONTAINS(t.gd_no, '{gd}'))"
picks_ = [obj(r) for r in q("--dev", f"SELECT {g.jobj('t', 'transfer_order')} AS j FROM transfer_order t WHERE t.{T} AND t.movement_type = 'Picking' "
                                      f"AND t.is_deleted = 0 AND t.to_status NOT IN ('Cancelled', 'Draft') AND {names}")]
assert len(picks_) == 1, f"{len(picks_)} live Pickings"
p = picks_[0]
assert str(p.get("is_processing") or 0) == "0", "the Picking is held"
items = [obj(r) for r in q("--dev", f"SELECT {g.jobj('i', 'transfer_order_jz8m9w3h_sub')} AS j FROM transfer_order_jz8m9w3h_sub i WHERE i.{T} "
                                     f"AND i.transfer_order_id = {p['id']} AND i.is_deleted = 0 ORDER BY i.id")]
lines = [str(r["id"]) for r in q("--dev", f"SELECT id FROM goods_delivery_fwii8mvb_sub WHERE {T} AND goods_delivery_id = {gd} AND is_deleted = 0 ORDER BY id")]
pos = {lid: k for k, lid in enumerate(lines, 1)}
done = {}
for it in items:
    k = pos.get(str(it.get("gd_line_id")))
    if k in want:
        qty, loc, bat = want[k]
        assert qty <= float(it["pending_process_qty"]), f"line {k}: {qty} > pending {it['pending_process_qty']}"
        done[k] = it
    if mode == "classic":
        it["picked_qty"] = want[k][0] if k in want else 0
        if k in want and want[k][1]:
            it["target_location"] = want[k][1]
        if k in want and want[k][2]:
            it["target_batch"] = want[k][2]
assert set(done) == set(want), f"no item for line(s) {sorted(set(want) - set(done))}"
if mode == "classic":
    recs = [obj(r) for r in q("--dev", f"SELECT {g.jobj('r', 'transfer_order_vrqs3cmr_sub')} AS j FROM transfer_order_vrqs3cmr_sub r WHERE r.{T} "
                                        f"AND r.transfer_order_id = {p['id']} AND r.is_deleted = 0 ORDER BY r.id")]
    for k in ("table_picking_items", "table_picking_records", "gd_no", "customer_id", "to_no", "assigned_to"):
        if isinstance(p.get(k), str):
            try:
                p[k] = json.loads(p[k])
            except ValueError:
                pass
    p.update({"table_picking_items": items, "table_picking_records": recs, "page_status": "Edit"})
    body = {"arrayData": [p], "saveAs": "Completed", "pageStatus": "Edit", "confirmed_by": "admin"}
else:
    sent = []
    for k in sorted(done):
        qty, loc, bat = want[k]
        line = {"row_id": str(done[k]["id"]), "qty": qty}
        if loc:
            line["target_location_id"] = loc
        if bat:
            line["target_batch_id"] = bat
        sent.append(line)
    body = {"picking_id": str(p["id"]), "organization_id": str(p["organization_id"]), "operation": "CONFIRM", "idempotency_key": f"PK1C-{gd}-{int(time.time())}",
            "payload": json.dumps({"lines": sent, "header_patch": {}}), "confirmed_by": "admin"}
json.dump(body, open(out, "w"))
print(f"{mode} {p['to_id']} ({p['to_status']}): " + ", ".join(f"line {k} {want[k][0]:g} of {float(done[k]['pending_process_qty']):g} from {done[k].get('source_bin')}/{done[k].get('batch_no')}"
      + (f" -> {want[k][1] or '-'}/{want[k][2] or '-'}" if want[k][1] or want[k][2] else "") for k in sorted(done)))
