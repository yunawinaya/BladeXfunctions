#!/usr/bin/env python3
"""DEV test: pack a Packing's source rows into N HUs without the form, as the form would.

  autopack.py plan <packing_no> <tenant> <hu_count> <hu_bin_id> <hu_storage_location_id> <dir>
      -> <dir>/repack_<i>.json   REPACKING_PROCESS params per HU (as PackingTableHUCompleted sends them)
         <dir>/group_<i>.json    the HU's temp_data (as PackingBulkPickItems builds it), item_count, total_quantity
         <dir>/meta.json
  autopack.py rows <dir>
      -> <dir>/addhu.json        PKG_TEST_ADD_HU_ROWS request, from <dir>/repack_out_<i>.json (huId / huNo)
         <dir>/submit.json       PACKING_ASYNC_SUBMIT request (COMPLETE)
"""
import json, os, subprocess, sys, time

DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", ".dbtools", "db")


def q(sql):
    r = subprocess.run([DB, "--dev", "--json", "--limit", "0", sql], capture_output=True, text=True)
    if r.returncode:
        sys.exit(r.stderr.strip()[-2000:])
    return json.loads(r.stdout)


def nz(v):
    return None if v in (None, "", "None") else v


def plan(packing_no, T, n, bin_id, sl_id, d):
    os.makedirs(d, exist_ok=True)
    p = q(f"""SELECT CAST(p.id AS CHAR) id, p.packing_no, p.packing_status, CAST(p.plant_id AS CHAR) plant_id, p.organization_id,
                     (SELECT COUNT(*) FROM packing_hr4nq20g_sub h WHERE h.tenant_id='{T}' AND h.packing_id=p.id AND h.is_deleted=0) hu_rows
                FROM packing p WHERE p.tenant_id='{T}' AND p.packing_no='{packing_no}' AND p.is_deleted=0""")
    if len(p) != 1:
        sys.exit(f"{packing_no}: {len(p)} Packings")
    p = p[0]
    if p["packing_status"] != "Created" or int(p["hu_rows"]) > 0:
        sys.exit(f"{packing_no} is {p['packing_status']} with {p['hu_rows']} HU rows: not a fresh Created Packing")
    src = q(f"""SELECT CAST(s.id AS CHAR) id, CAST(s.item_code AS CHAR) item_code, s.item_name, s.item_desc, s.remark, s.remark_2, s.remark_3,
                       CAST(s.item_uom AS CHAR) item_uom, CAST(s.batch_no AS CHAR) batch_no, CAST(s.bin_location AS CHAR) bin_location,
                       CAST(s.total_quantity AS CHAR) total_quantity, CAST(s.so_id AS CHAR) so_id, s.so_no, CAST(s.so_line_id AS CHAR) so_line_id,
                       CAST(s.gd_id AS CHAR) gd_id, s.gd_no, CAST(s.gd_line_id AS CHAR) gd_line_id, CAST(s.to_id AS CHAR) to_id, CAST(s.to_line_id AS CHAR) to_line_id
                  FROM packing_jz8m9w3h_sub s WHERE s.tenant_id='{T}' AND s.packing_id={p['id']} AND s.is_deleted=0 ORDER BY s.id""")
    # the balance row each HU item names, as PackingTableHUCompleted reads it: item_batch_balance for a batch, else item_balance
    bal = {}
    mats = f"(SELECT s.item_code FROM packing_jz8m9w3h_sub s WHERE s.tenant_id='{T}' AND s.packing_id={p['id']} AND s.is_deleted=0)"
    for r in q(f"""SELECT CAST(b.id AS CHAR) id, CAST(b.material_id AS CHAR) m, CAST(b.location_id AS CHAR) l
                     FROM item_balance b WHERE b.tenant_id='{T}' AND b.plant_id={p['plant_id']} AND b.is_deleted=0 AND b.material_id IN {mats}"""):
        bal.setdefault((r["m"], r["l"], ""), r["id"])
    if any(nz(r["batch_no"]) for r in src):
        for r in q(f"""SELECT CAST(b.id AS CHAR) id, CAST(b.material_id AS CHAR) m, CAST(b.location_id AS CHAR) l, CAST(b.batch_id AS CHAR) bt
                         FROM item_batch_balance b WHERE b.tenant_id='{T}' AND b.plant_id={p['plant_id']} AND b.is_deleted=0 AND b.material_id IN {mats}"""):
            bal.setdefault((r["m"], r["l"], r["bt"]), r["id"])
    size = -(-len(src) // n)
    groups = [src[i:i + size] for i in range(0, len(src), size)]
    for gi, rows in enumerate(groups, 1):
        entries, items = [], []
        for r in rows:
            qty = float(r["total_quantity"])
            entries.append({"line_index": len(entries), "line_item_id": r["id"], "item_id": r["item_code"], "item_code": r["item_code"], "item_name": r["item_name"],
                            "item_desc": r["item_desc"], "remark": r["remark"], "remark_2": r["remark_2"], "remark_3": r["remark_3"], "item_uom": nz(r["item_uom"]),
                            "batch_no": nz(r["batch_no"]), "bin_location": r["bin_location"], "total_quantity": qty, "so_id": nz(r["so_id"]), "so_no": r["so_no"],
                            "so_line_id": nz(r["so_line_id"]), "gd_id": nz(r["gd_id"]), "gd_no": r["gd_no"], "gd_line_id": nz(r["gd_line_id"]),
                            "to_id": nz(r["to_id"]), "to_line_id": nz(r["to_line_id"])})
            items.append({"material_id": r["item_code"], "material_uom": nz(r["item_uom"]), "location_id": r["bin_location"], "batch_id": nz(r["batch_no"]),
                          "balance_id": bal.get((r["item_code"], r["bin_location"], nz(r["batch_no"]) or ""), ""), "quantity": qty})
        missing = [i for i in items if not i["balance_id"]]
        if missing:
            sys.exit(f"HU {gi}: {len(missing)} items without an item_balance row at their bin")
        params = {"plant_id": p["plant_id"], "organization_id": p["organization_id"], "process_type": "Load", "trx_no": p["packing_no"],
                  "parent_trx_no": entries[0]["gd_no"] or "", "items": items, "source_hu": None,
                  "target_hu": {"id": "", "handling_no": "Auto-generated number", "hu_material_id": "", "hu_type": "", "hu_quantity": 1, "hu_uom": None,
                                "storage_location_id": sl_id, "location_id": bin_id, "parent_hu_id": "", "hu_status": "Packed"},
                  "target_storage_location_id": sl_id, "target_location_id": bin_id, "remark": "", "transaction_type": "Packing", "isPacking": 1,
                  "packing_id": p["id"]}
        json.dump(params, open(os.path.join(d, f"repack_{gi}.json"), "w"), ensure_ascii=False)
        json.dump({"temp_data": json.dumps(entries, ensure_ascii=False, separators=(",", ":")), "item_count": len({e["item_id"] for e in entries}),
                   "total_quantity": sum(e["total_quantity"] for e in entries), "lines": len(entries)},
                  open(os.path.join(d, f"group_{gi}.json"), "w"), ensure_ascii=False)
        print(f"HU {gi}: {len(entries)} lines, {len({e['item_id'] for e in entries})} items, qty {sum(e['total_quantity'] for e in entries)}")
    json.dump({"packing_id": p["id"], "packing_no": p["packing_no"], "organization_id": p["organization_id"], "tenant": T, "hus": len(groups),
               "bin": bin_id, "storage_location": sl_id}, open(os.path.join(d, "meta.json"), "w"))


def rows(d):
    m = json.load(open(os.path.join(d, "meta.json")))
    out = []
    for gi in range(1, m["hus"] + 1):
        res = json.load(open(os.path.join(d, f"repack_out_{gi}.json")))
        data = res.get("data") or {}
        if str(data.get("code")) != "200" or not data.get("huId"):
            sys.exit(f"HU {gi}: REPACKING_PROCESS answered {json.dumps(res)[:300]}")
        g = json.load(open(os.path.join(d, f"group_{gi}.json")))
        out.append({"handling_unit_id": str(data["huId"]), "handling_no": data["huNo"], "location_id": m["bin"], "storage_location_id": m["storage_location"],
                    "temp_data": g["temp_data"], "item_count": g["item_count"], "total_quantity": g["total_quantity"]})
        print(f"HU {gi}: {data['huNo']} ({data['huId']})")
    json.dump({"packing_id": m["packing_id"], "rows": json.dumps(out, ensure_ascii=False)}, open(os.path.join(d, "addhu.json"), "w"), ensure_ascii=False)
    key = "PKGTEST-%s-%d" % (m["packing_id"], int(time.time()))
    json.dump({"packing_id": m["packing_id"], "organization_id": m["organization_id"], "operation": "COMPLETE", "idempotency_key": key,
               "header_patch": "{}", "submitted_name": "admin"}, open(os.path.join(d, "submit.json"), "w"))
    print("wrote addhu.json, submit.json (key %s)" % key)


if __name__ == "__main__":
    if sys.argv[1] == "plan":
        plan(sys.argv[2], sys.argv[3], int(sys.argv[4]), sys.argv[5], sys.argv[6], sys.argv[7])
    else:
        rows(sys.argv[2])
