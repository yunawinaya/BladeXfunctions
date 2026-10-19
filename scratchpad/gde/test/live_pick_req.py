"""live_pick_req.py <tenant> <gd_id> <out_request.json> <k>:<picked>,... [--leave-blank]: a PICKING_LOOP request that confirms
picks on the GD's one live Picking as the web Picking form's Complete sends it (saveAs Completed, pageStatus Edit, every
item, picked_qty 0 on the rest; --leave-blank sends the rest with no picked_qty, as the form does for a line stored NULL).
k = the GD line's position (1-based, id order, live lines), the same numbering live_req.js uses. Reads read-only (dev); the
request goes to the session scratchpad."""
import importlib.util
import json
import sys

sys.path.insert(0, "/Users/yunawinaya/Developer/BladeXfunctions/scratchpad/gdc/pkv2tools")
from dbq import q  # noqa: E402

spec = importlib.util.spec_from_file_location("g", "/Users/yunawinaya/Developer/BladeXfunctions/scratchpad/gdc/prepare/sql.py")
g = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)

tenant, gd, out, picks = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
assert tenant.isdigit() and gd.isdigit()
want = {int(k): float(v) for k, v in (x.split(":") for x in picks.split(","))}
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
recs = [obj(r) for r in q("--dev", f"SELECT {g.jobj('r', 'transfer_order_vrqs3cmr_sub')} AS j FROM transfer_order_vrqs3cmr_sub r WHERE r.{T} "
                                    f"AND r.transfer_order_id = {p['id']} AND r.is_deleted = 0 ORDER BY r.id")]
lines = [str(r["id"]) for r in q("--dev", f"SELECT id FROM goods_delivery_fwii8mvb_sub WHERE {T} AND goods_delivery_id = {gd} AND is_deleted = 0 ORDER BY id")]
pos = {lid: k for k, lid in enumerate(lines, 1)}
done = {}
for it in items:
    k = pos.get(str(it.get("gd_line_id")))
    if k in want or "--leave-blank" not in sys.argv:
        it["picked_qty"] = want.get(k, 0)
    else:
        it.pop("picked_qty", None)
    if k in want:
        assert want[k] <= float(it["pending_process_qty"]), f"line {k}: {want[k]} > pending {it['pending_process_qty']}"
        done[k] = it
assert set(done) == set(want), f"no item for line(s) {sorted(set(want) - set(done))}"
for k in ("table_picking_items", "table_picking_records", "gd_no", "customer_id", "to_no", "assigned_to"):
    if isinstance(p.get(k), str):
        try:
            p[k] = json.loads(p[k])
        except ValueError:
            pass
p.update({"table_picking_items": items, "table_picking_records": recs, "page_status": "Edit"})
json.dump({"arrayData": [p], "saveAs": "Completed", "pageStatus": "Edit", "confirmed_by": "admin"}, open(out, "w"))
print(f"{p['to_id']} ({p['to_status']}): " + ", ".join(f"line {k} ({done[k]['gd_line_id']}) {want[k]:g} of {float(done[k]['pending_process_qty']):g}" for k in sorted(done))
      + f"; {len(items)} item(s), {len(recs)} record(s) already")
