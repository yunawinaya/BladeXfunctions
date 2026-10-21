"""snap_ida.py --tenant T (--ida ID | --request FILE) [--ida ID] [--base SNAP] [--job ID,..] --out FILE: every row an Item Disassembly
completion can touch, read-only (dev), tenant-scoped. Copied from tpl/iav2/live/snap_ia.py (IDA tables, IDC| names, the org's batch
config, Batch rows by the IDA number):
  ida / idal     the IDA header + its recovery lines (SELECT *, deleted lines included: the whole-subform write soft-deletes)
  ib / ibb       item_balance / item_batch_balance of the touched materials (the source + every line's item) at the plant, SELECT *,
                 deleted rows included (a soft delete is a change)
  fifo / wa      fifo_costing_history / wa_costing_method of those materials at the plant, SELECT *
  batch          Batch rows of those materials + every row whose transaction_no is the IDA's number (the classic's blank rows, V2's D1 rows)
  bnc            batch_number_config of the organization (D1 advances running_number by the AUTO count)
  mv             inventory_movement of those materials at the plant with id > the window start (--base SNAP's max_mv_id; none in a
                 'before' snapshot) + the IDA's own rows (trx_no = its number, id > the IDA id)
  item / itemdef Item last_transaction_date / update_time; costing method, batch flags, stock control, UOM rows (planner input)
  job / step     gd_async_job COMPLETE_IDA of IDA|<ida> + --job ids + the request's idempotency key; gd_publish_step of IDC|<ida> (locks),
                 each job (claims, parts, D0-D4, D1|I|nnn) and its engine operations IDC|<job>|I / |R
  lock           inventory_balance_lock rows of the materials (ITEM| / BATCH| / COST|) + every row an IDC|<job>| operation owned
  precision      the tenant's Inventory Price / Qty number rules (planner input)
Before an Add exists: --request <classic.json | submit.json> names the materials (and the key); after it: --ida ID. Twins sharing items
are snapshotted SEQUENTIALLY (A before, A after, B before, B after). Output holds dev data: written outside the repo only."""
import os, sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import idalib as L  # noqa: E402


def materials_of_request(path):
    r = L.read_json(path)
    doc = r.get("allData") or r.get("form") or {}
    mats = {str(doc.get("item_id") or "")} | {str(l.get("item_selection") or "") for l in doc.get("stock_movement") or []}
    return {m for m in mats if m.isdigit()}, str(r.get("idempotency_key") or ""), doc


def snapshot(tenant, ida=None, request=None, base=None, jobs=()):
    tc = L.tenant_cfg(L.load_config(), tenant)
    T = f"tenant_id = '{L.digits(tenant, 'tenant')}'"
    plant, org = L.digits(tc["plant"], "plant"), L.digits(tc["org"], "org")
    snap = {"meta": {"tenant": tenant, "plant": plant, "org": org, "ida_id": ida or "", "taken_at": L.db_now(),
                     "max_mv_id": str(L.q(f"SELECT CAST(COALESCE(MAX(id), 0) AS CHAR) m FROM inventory_movement WHERE {T}")[0]["m"]),
                     "max_batch_id": str(L.q(f"SELECT CAST(COALESCE(MAX(id), 0) AS CHAR) m FROM batch WHERE {T}")[0]["m"]),
                     "window_from": str((base or {}).get("meta", {}).get("max_mv_id") or "")}}
    mats, key = set(), ""
    if request:
        mats, key, _ = materials_of_request(request)
    snap["ida"], snap["idal"] = [], []
    if ida:
        L.digits(ida, "--ida")
        snap["ida"] = L.q(f"SELECT * FROM sm_item_disassembly WHERE {T} AND id = {ida}")
        snap["idal"] = L.q(f"SELECT * FROM sm_item_disassembly_tlm8ve69_sub WHERE {T} AND sm_item_disassembly_id = {ida} ORDER BY id")
        mats |= {str(r["item_selection"]) for r in snap["idal"] if str(r.get("item_selection") or "").isdigit() and not r.get("is_deleted")}
        if snap["ida"] and str(snap["ida"][0].get("item_id") or "").isdigit():
            mats.add(str(snap["ida"][0]["item_id"]))
    if base:
        mats |= set(base.get("meta", {}).get("materials") or [])
    if not mats:
        raise SystemExit("no material to snapshot (give --ida or --request)")
    snap["meta"]["materials"] = sorted(mats, key=int)
    snap["meta"]["key"] = key or (base or {}).get("meta", {}).get("key", "")
    for k in ("ib", "ibb", "fifo", "wa", "batch", "mv", "item", "itemdef", "lock"):
        snap[k] = []
    lo = snap["meta"]["window_from"]
    for part in L.chunks(snap["meta"]["materials"], 400):
        ids = ",".join(part)
        W = f"{T} AND plant_id = {plant} AND material_id IN ({ids})"
        snap["ib"] += L.q(f"SELECT * FROM item_balance WHERE {W} ORDER BY id")
        snap["ibb"] += L.q(f"SELECT * FROM item_batch_balance WHERE {W} ORDER BY id")
        snap["fifo"] += L.q(f"SELECT * FROM fifo_costing_history WHERE {W} ORDER BY id")
        snap["wa"] += L.q(f"SELECT * FROM wa_costing_method WHERE {T} AND plant_id = '{plant}' AND material_id IN ({ids}) ORDER BY id")
        snap["batch"] += L.q(f"SELECT * FROM batch WHERE {T} AND material_id IN ({ids}) ORDER BY id")
        if lo:
            snap["mv"] += L.q(f"SELECT * FROM inventory_movement WHERE {T} AND id > {L.digits(lo, 'window')} AND plant_id = {plant} AND item_id IN ({ids}) ORDER BY id")
        snap["item"] += L.q(f"SELECT CAST(id AS CHAR) id, material_code, last_transaction_date, update_time FROM item WHERE {T} AND id IN ({ids}) ORDER BY id")
        defs = L.q("SELECT CAST(id AS CHAR) id, material_code, material_costing_method, item_batch_management, batch_number_genaration, stock_control, "
                   "CAST(based_uom AS CHAR) based_uom, CAST(purchase_unit_price AS CHAR) purchase_unit_price, item_category, item_group_id "
                   f"FROM item WHERE {T} AND id IN ({ids})")
        conv = L.q("SELECT CAST(Item_id AS CHAR) item_id, CAST(alt_uom_id AS CHAR) alt_uom_id, CAST(base_uom_id AS CHAR) base_uom_id, CAST(alt_qty AS CHAR) alt_qty, "
                   f"CAST(base_qty AS CHAR) base_qty FROM item_mji552rc_sub WHERE {T} AND is_deleted = 0 AND Item_id IN ({ids}) ORDER BY id")
        by = {}
        for c in conv:
            by.setdefault(c["item_id"], []).append({k: c[k] for k in ("alt_uom_id", "base_uom_id", "alt_qty", "base_qty")})
        for d in defs:
            d["table_uom_conversion"] = by.get(d["id"], [])
        snap["itemdef"] += defs
        snap["lock"] += L.q("SELECT id, lock_key, balance_type, owner_operation_id, free_token, lock_version, claimed_at, last_released_at, last_owner_operation_id "
                            f"FROM inventory_balance_lock WHERE {T} AND organization_id = '{org}' AND is_deleted = 0 "
                            f"AND SUBSTRING_INDEX(SUBSTRING_INDEX(lock_key, '|', 2), '|', -1) IN ({','.join(chr(39) + m + chr(39) for m in part)}) ORDER BY id")
    no = (snap["ida"][0].get("stock_movement_no") if snap["ida"] else "") or ""
    if ida and no and no not in ("issued", "draft"):
        own = L.q(f"SELECT * FROM inventory_movement WHERE {T} AND id > {ida} AND trx_no = (SELECT h.stock_movement_no FROM sm_item_disassembly h WHERE h.{T} "
                  f"AND h.id = {ida}) AND organization_id = '{org}' ORDER BY id")
        seen = {str(r["id"]) for r in snap["mv"]}
        snap["mv"] += [r for r in own if str(r["id"]) not in seen]
        snap["mv"].sort(key=lambda r: int(r["id"]))
        mine = L.q(f"SELECT * FROM batch WHERE {T} AND organization_id = '{org}' AND transaction_no = (SELECT h.stock_movement_no FROM sm_item_disassembly h "
                   f"WHERE h.{T} AND h.id = {ida}) ORDER BY id")
        seen = {str(r["id"]) for r in snap["batch"]}
        snap["batch"] += [r for r in mine if str(r["id"]) not in seen]
    snap["bnc"] = L.q(f"SELECT * FROM batch_number_config WHERE {T} AND organization_id = '{org}' ORDER BY id")
    corr = f"'IDA|{ida}'" if ida else "''"
    job_ids = ",".join(L.digits(j, "--job") for j in jobs if j) or "0"
    keyq = f" OR idempotency_key = '{key}'" if key and all(ch.isalnum() or ch in "|:_.-" for ch in key) else ""
    snap["job"] = L.q("SELECT id, organization_id, plant_id, command, idempotency_key, correlation_id, causation_id, line_count, job_status, progress_percent, "
                      "progress_message, attempt_count, next_attempt_at, lease_owner, lease_expires_at, row_version, error_code, error_message, error_details, "
                      "request_payload, LENGTH(prepared_payload) prepared_len, queued_at, started_at, finished_at, create_time, update_time "
                      f"FROM gd_async_job WHERE {T} AND command = 'COMPLETE_IDA' AND (correlation_id = {corr} OR id IN ({job_ids}){keyq}) ORDER BY id")
    names = ([f"'IDC|{ida}'"] if ida else []) + [f"'{j['id']}'" for j in snap["job"]] + [f"'IDC|{j['id']}|I'" for j in snap["job"]] \
        + [f"'IDC|{j['id']}|R'" for j in snap["job"]]
    snap["step"] = L.q("SELECT id, job_id, step_name, step_status, attempt_count, started_at, finished_at, error_code, error_message, LENGTH(result_ref) ref_len, "
                       f"LEFT(result_ref, 400) ref_head FROM gd_publish_step WHERE {T} AND job_id IN ({','.join(names) or chr(39) + chr(39)}) ORDER BY id")
    ops = [f"IDC|{j['id']}|" for j in snap["job"]]
    if ops:
        seen = {str(r["id"]) for r in snap["lock"]}
        own = L.q("SELECT id, lock_key, balance_type, owner_operation_id, free_token, lock_version, claimed_at, last_released_at, last_owner_operation_id "
                  f"FROM inventory_balance_lock WHERE {T} AND organization_id = '{org}' AND is_deleted = 0 AND ("
                  + " OR ".join(f"owner_operation_id LIKE '{o}%' OR last_owner_operation_id LIKE '{o}%'" for o in ops) + ") ORDER BY id")
        snap["lock"] += [r for r in own if str(r["id"]) not in seen]
    snap["precision"] = L.q("SELECT scope_type, rule_key, CAST(table_id AS CHAR) table_id, field_name, decimal_places, precision_rule, store_raw_value "
                            f"FROM su_code_num_precision WHERE {T} AND status = 1 AND is_deleted = 0 AND ((scope_type = '1' AND rule_key IN ('Inventory Price', "
                            "'Inventory Qty')) OR scope_type = '2')")
    return snap


def main():
    out = L.arg("--out")
    tenant = L.arg("--tenant")
    if not out or not tenant or not (L.arg("--ida") or L.arg("--request")):
        raise SystemExit(__doc__)
    L.guard_out(out)
    base = L.read_json(L.arg("--base")) if L.arg("--base") else None
    jobs = [j for j in (L.arg("--job") or "").split(",") if j]
    snap = snapshot(L.digits(tenant, "--tenant"), L.arg("--ida"), L.arg("--request"), base, jobs)
    L.write_json(out, snap)
    held = [r for r in snap["lock"] if str(r["free_token"]) != "1"]
    print(f"{snap['meta']['taken_at']} -> {out}: " + ", ".join(f"{k} {len(v)}" for k, v in snap.items() if isinstance(v, list))
          + f"; materials {len(snap['meta']['materials'])}; window from movement id {snap['meta']['window_from'] or '(none: a before-snapshot)'}"
          + (f"; HELD LOCKS {len(held)} {[(r['lock_key'], r['owner_operation_id']) for r in held][:4]}" if held else "; no lock held"))


if __name__ == "__main__":
    main()
