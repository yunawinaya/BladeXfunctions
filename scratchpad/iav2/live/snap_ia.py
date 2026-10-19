"""snap_ia.py --tenant T (--ia ID | --request FILE) [--ia ID] [--base SNAP] [--job ID,..] --out FILE: every row an Item Assembly
completion or revert can touch, read-only (dev), tenant-scoped:
  ia / ial            the IA header + its component lines (SELECT *, deleted lines included: the whole-subform update soft-deletes)
  ib / ibb            item_balance / item_batch_balance of the touched materials (parent + every line's item) at the plant, SELECT *,
                      deleted rows included (a soft delete is a change)
  fifo / wa           fifo_costing_history / wa_costing_method of those materials at the plant (+ organization), SELECT *
  batch               batch rows of those materials (the IA's Batch row, the classic's blank one for a non-batch parent)
  mv                  inventory_movement of those materials at the plant with id > the window start (--base SNAP's max_mv_id; none
                      in a 'before' snapshot) + the IA's own rows (trx_no = its number, id > the IA id: an earlier cycle, a revert)
  item / itemdef      Item last_transaction_date / update_time; costing method, batch flag, stock control, UOM rows (planner input)
  job / step          gd_async_job of IA|<ia> (COMPLETE_IA and REVERT_IA) + --job ids + the request's idempotency key; gd_publish_step
                      of IAC|<ia> (locks), each job (parts, claims, I*/V* steps, I1|I|001) and its engine operations IAC|<job>|I / |R,
                      IAV|<job>
  lock                inventory_balance_lock rows of the materials (ITEM| / BATCH| / COST|), incl. the IAV|<job>|C cost-row owner
  precision           the tenant's Inventory Price / Qty number rules (planner input)
Before an Add exists: --request <classic.json | submit.json> names the materials (and the key); after it: --ia ID. Twins sharing items
are snapshotted SEQUENTIALLY (A before, A after, B before, B after). Output holds dev data: written outside the repo only."""
import json, os, sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ialib as L  # noqa: E402


def materials_of_request(path):
    r = L.read_json(path)
    doc = r.get("allData") or r.get("form") or {}
    mats = {str(doc.get("item_id") or "")} | {str(l.get("item_selection") or "") for l in doc.get("stock_movement") or []}
    return {m for m in mats if m.isdigit()}, str(r.get("idempotency_key") or ""), doc


def snapshot(tenant, ia=None, request=None, base=None, jobs=()):
    tc = L.tenant_cfg(L.load_config(), tenant)
    T = f"tenant_id = '{L.digits(tenant, 'tenant')}'"
    plant, org = L.digits(tc["plant"], "plant"), L.digits(tc["org"], "org")
    snap = {"meta": {"tenant": tenant, "plant": plant, "org": org, "ia_id": ia or "", "taken_at": L.db_now(),
                     "max_mv_id": str(L.q(f"SELECT CAST(COALESCE(MAX(id), 0) AS CHAR) m FROM inventory_movement WHERE {T}")[0]["m"]),
                     "window_from": str((base or {}).get("meta", {}).get("max_mv_id") or "")}}
    mats, key = set(), ""
    if request:
        mats, key, _ = materials_of_request(request)
    snap["ia"], snap["ial"] = [], []
    if ia:
        L.digits(ia, "--ia")
        snap["ia"] = L.q(f"SELECT * FROM sm_item_assembly WHERE {T} AND id = {ia}")
        snap["ial"] = L.q(f"SELECT * FROM sm_item_assembly_tlm8ve69_sub WHERE {T} AND sm_item_assembly_id = {ia} ORDER BY id")
        mats |= {str(r["item_selection"]) for r in snap["ial"] if str(r.get("item_selection") or "").isdigit() and not r.get("is_deleted")}
        if snap["ia"] and str(snap["ia"][0].get("item_id") or "").isdigit():
            mats.add(str(snap["ia"][0]["item_id"]))
    if base:
        mats |= set(base.get("meta", {}).get("materials") or [])
    if not mats:
        raise SystemExit("no material to snapshot (give --ia or --request)")
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
                   "CAST(based_uom AS CHAR) based_uom, CAST(purchase_unit_price AS CHAR) purchase_unit_price, CAST(assembly_cost AS CHAR) assembly_cost "
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
    no = (snap["ia"][0].get("stock_movement_no") if snap["ia"] else "") or ""
    if ia and no and no not in ("issued", "draft"):
        own = L.q(f"SELECT * FROM inventory_movement WHERE {T} AND id > {ia} AND trx_no = (SELECT h.stock_movement_no FROM sm_item_assembly h WHERE h.{T} "
                  f"AND h.id = {ia}) AND organization_id = '{org}' ORDER BY id")
        seen = {r["id"] for r in snap["mv"]}
        snap["mv"] += [r for r in own if r["id"] not in seen]
        snap["mv"].sort(key=lambda r: int(r["id"]))
    corr = f"'IA|{ia}'" if ia else "''"
    job_ids = ",".join(L.digits(j, "--job") for j in jobs if j) or "0"
    keyq = f" OR idempotency_key = '{key}'" if key and all(ch.isalnum() or ch in "|:_.-" for ch in key) else ""
    snap["job"] = L.q("SELECT id, organization_id, plant_id, command, idempotency_key, correlation_id, causation_id, line_count, job_status, progress_percent, "
                      "progress_message, attempt_count, next_attempt_at, lease_owner, lease_expires_at, row_version, error_code, error_message, error_details, "
                      "request_payload, LENGTH(prepared_payload) prepared_len, queued_at, started_at, finished_at, create_time, update_time "
                      f"FROM gd_async_job WHERE {T} AND command IN ('COMPLETE_IA', 'REVERT_IA') AND (correlation_id = {corr} OR id IN ({job_ids}){keyq}) ORDER BY id")
    names = ([f"'IAC|{ia}'"] if ia else []) + [f"'{j['id']}'" for j in snap["job"]] + [f"'IAC|{j['id']}|I'" for j in snap["job"]] \
        + [f"'IAC|{j['id']}|R'" for j in snap["job"]] + [f"'IAV|{j['id']}'" for j in snap["job"]]
    snap["step"] = L.q("SELECT id, job_id, step_name, step_status, attempt_count, started_at, finished_at, error_code, error_message, LENGTH(result_ref) ref_len, "
                       f"LEFT(result_ref, 400) ref_head FROM gd_publish_step WHERE {T} AND job_id IN ({','.join(names) or chr(39) + chr(39)}) ORDER BY id")
    snap["precision"] = L.q("SELECT scope_type, rule_key, CAST(table_id AS CHAR) table_id, field_name, decimal_places, precision_rule, store_raw_value "
                            f"FROM su_code_num_precision WHERE {T} AND status = 1 AND is_deleted = 0 AND ((scope_type = '1' AND rule_key IN ('Inventory Price', "
                            "'Inventory Qty')) OR scope_type = '2')")
    return snap


def main():
    out = L.arg("--out")
    tenant = L.arg("--tenant")
    if not out or not tenant or not (L.arg("--ia") or L.arg("--request")):
        raise SystemExit(__doc__)
    L.guard_out(out)
    base = L.read_json(L.arg("--base")) if L.arg("--base") else None
    jobs = [j for j in (L.arg("--job") or "").split(",") if j]
    snap = snapshot(L.digits(tenant, "--tenant"), L.arg("--ia"), L.arg("--request"), base, jobs)
    L.write_json(out, snap)
    held = [r for r in snap["lock"] if str(r["free_token"]) != "1"]
    print(f"{snap['meta']['taken_at']} -> {out}: " + ", ".join(f"{k} {len(v)}" for k, v in snap.items() if isinstance(v, list))
          + f"; materials {len(snap['meta']['materials'])}; window from movement id {snap['meta']['window_from'] or '(none: a before-snapshot)'}"
          + (f"; HELD LOCKS {len(held)} {[(r['lock_key'], r['owner_operation_id']) for r in held][:4]}" if held else "; no lock held"))


if __name__ == "__main__":
    main()
