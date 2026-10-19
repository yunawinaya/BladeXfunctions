#!/usr/bin/env python3
"""Offline check of a generated LOT payload: derive the movements V2 sends for it (per entry M<n> SUBTRACT + M<n>.2 ADD with
unit_price_from, phase from saveAs on a new document: In Progress = STAGE -cat@source +In Transit@destination, Completed =
DIRECT -cat@source +cat@destination; Draft = none), read the rows those movements touch from DEV (read-only SELECTs) and plan
them through scratchpad/gdc/engine/core.js (required read-only, tenant 000000 has no number rule = 8 dp). Prints whether the
engine would plan it and what it would change. Writes nothing anywhere but the optional --dump file.

usage: python3 check_payload_engine.py <payload.json> [--as "In Progress"|Completed] [--dump input.json]
"""
import json, os, subprocess, sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "parity"))
from dbq import q  # noqa: E402

CORE = os.path.normpath(os.path.join(HERE, "..", "..", "gdc", "engine", "core.js"))
DIG = set("0123456789")


def ids(v):
    out = sorted({str(x) for x in v if x})
    for x in out:
        if not set(x) <= DIG:
            raise SystemExit("not an id: " + x)
    return ",".join(out) or "0"


def main():
    req = json.load(open(sys.argv[1]))
    action = sys.argv[sys.argv.index("--as") + 1] if "--as" in sys.argv else req["saveAs"]
    if action not in ("In Progress", "Completed"):
        raise SystemExit("a Draft moves no stock; pass --as 'In Progress' or --as Completed to plan what advancing it would do")
    ad = req["allData"]
    plant, org = str(ad["issuing_operation_faci"]), str(ad["organization_id"])
    mv = []
    n = 0
    for line in ad["stock_movement"]:
        for e in json.loads(line["temp_qty_data"] or "[]"):
            if float(e.get("sm_quantity") or 0) <= 0:
                continue
            n += 1
            cat = e.get("category") or "Unrestricted"
            base = {"material_id": str(e.get("material_id") or line["item_selection"]), "quantity": e["sm_quantity"], "material_uom": str(e.get("material_uom") or line["quantity_uom"]),
                    "plant_id": plant, "organization_id": org, "transaction_type": "LOT", "trx_no": "LOT-PAYLOAD-CHECK", "batch_id": e.get("batch_id") or None,
                    "doc_date": ad["issue_date"], "isMovingInv": 1, "handling_unit_id": e.get("handling_unit_id") or None,
                    "manufacturing_date": e.get("manufacturing_date") or None, "expired_date": e.get("expired_date") or None}
            mv.append(dict(base, movement_key="M%d" % n, direction="SUBTRACT", inventory_category=cat, location_id=str(e["location_id"])))
            mv.append(dict(base, movement_key="M%d.2" % n, direction="ADD", unit_price_from="M%d" % n,
                           inventory_category="In Transit" if action == "In Progress" else cat, location_id=str(line["location_id"])))
    mats = {m["material_id"] for m in mv}
    locs = {m["location_id"] for m in mv}
    bats = {m["batch_id"] for m in mv if m["batch_id"]}
    items = {}
    conv = defaultdict(list)
    for r in q("--dev", f"SELECT CAST(Item_id AS CHAR) i, CAST(alt_uom_id AS CHAR) alt_uom_id, base_qty FROM item_mji552rc_sub WHERE is_deleted=0 AND Item_id IN ({ids(mats)})"):
        conv[r["i"]].append({"alt_uom_id": r["alt_uom_id"], "base_qty": float(r["base_qty"])})
    for r in q("--dev", f"SELECT CAST(id AS CHAR) id, stock_control, CAST(based_uom AS CHAR) based_uom, material_costing_method, CAST(purchase_unit_price AS CHAR) p, "
                        f"item_batch_management FROM item WHERE is_deleted=0 AND id IN ({ids(mats)})"):
        items[r["id"]] = {"id": r["id"], "stock_control": int(r["stock_control"]), "based_uom": r["based_uom"], "material_costing_method": r["material_costing_method"],
                          "purchase_unit_price": float(r["p"] or 0), "item_batch_management": int(r["item_batch_management"] or 0), "table_uom_conversion": conv[r["id"]]}
    qty = "CAST(unrestricted_qty AS CHAR) unrestricted_qty, CAST(reserved_qty AS CHAR) reserved_qty, CAST(block_qty AS CHAR) block_qty, CAST(qualityinsp_qty AS CHAR) qualityinsp_qty, " \
          "CAST(intransit_qty AS CHAR) intransit_qty, CAST(balance_quantity AS CHAR) balance_quantity"
    where = f"tenant_id='000000' AND is_deleted=0 AND organization_id='{org}' AND plant_id={plant} AND material_id IN ({ids(mats)}) AND location_id IN ({ids(locs)})"
    bal = q("--dev", f"SELECT CAST(id AS CHAR) id, CAST(material_id AS CHAR) material_id, CAST(location_id AS CHAR) location_id, CAST(plant_id AS CHAR) plant_id, organization_id, {qty} FROM item_balance WHERE {where}")
    bb = q("--dev", f"SELECT CAST(id AS CHAR) id, CAST(material_id AS CHAR) material_id, CAST(location_id AS CHAR) location_id, CAST(batch_id AS CHAR) batch_id, CAST(plant_id AS CHAR) plant_id, "
                    f"organization_id, {qty}, DATE_FORMAT(manufacturing_date, '%Y-%m-%d %H:%i:%s') manufacturing_date, DATE_FORMAT(expired_date, '%Y-%m-%d %H:%i:%s') expired_date, "
                    f"remark, remark2, remark3 FROM item_batch_balance WHERE {where} AND batch_id IN ({ids(bats)})")
    cw = f"tenant_id='000000' AND is_deleted=0 AND organization_id='{org}' AND plant_id={plant} AND material_id IN ({ids(mats)})"
    fifo = q("--dev", "SELECT CAST(id AS CHAR) id, CAST(material_id AS CHAR) material_id, CAST(plant_id AS CHAR) plant_id, organization_id, CAST(NULLIF(batch_id, 0) AS CHAR) batch_id, "
                      f"fifo_sequence, CAST(fifo_cost_price AS CHAR) fifo_cost_price, CAST(fifo_available_quantity AS CHAR) fifo_available_quantity FROM fifo_costing_history WHERE {cw}")
    wa = q("--dev", "SELECT CAST(id AS CHAR) id, CAST(material_id AS CHAR) material_id, CAST(plant_id AS CHAR) plant_id, organization_id, CAST(NULLIF(batch_id, 0) AS CHAR) batch_id, "
                    f"CAST(wa_cost_price AS CHAR) wa_cost_price, CAST(wa_quantity AS CHAR) wa_quantity, created_at FROM wa_costing_method WHERE {cw}")
    for rows, cols in ((bal, None), (bb, None), (fifo, ("fifo_cost_price", "fifo_available_quantity")), (wa, ("wa_cost_price", "wa_quantity"))):
        for r in rows:
            for c in cols or ("unrestricted_qty", "reserved_qty", "block_qty", "qualityinsp_qty", "intransit_qty", "balance_quantity"):
                r[c] = float(r[c] or 0)
            if "created_at" in r and r["created_at"] is not None:
                r["created_at"] = str(r["created_at"])
    inp = {"operationKey": "CHK", "items": items, "itemBalances": bal, "batchBalances": bb, "fifoLayers": fifo, "waRows": wa, "movements": mv, "nowText": ""}
    if "--dump" in sys.argv:
        json.dump(inp, open(sys.argv[sys.argv.index("--dump") + 1], "w"))
    js = ("const e = require(process.argv[1]); let s = ''; process.stdin.on('data', (c) => (s += c)); process.stdin.on('end', () => { const p = e.planBulk(JSON.parse(s));"
          " const n = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.length]));"
          " console.log(JSON.stringify(p.ok ? { ok: true, results: p.results.length, codes: [...new Set(p.results.map((r) => r.code))], movements: p.movements.length,"
          " updates: n(p.updates), creates: n(p.creates) } : { ok: false, failure: p.failure, planned: p.results.length })); });")
    r = subprocess.run(["node", "-e", js, CORE], input=json.dumps(inp), capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(r.stderr[-2000:])
    out = json.loads(r.stdout)
    print(json.dumps({"payload": os.path.basename(sys.argv[1]), "as": action, "entries": n, "movements": len(mv), "engine": out}, indent=1))
    sys.exit(0 if out.get("ok") else 4)


if __name__ == "__main__":
    main()
