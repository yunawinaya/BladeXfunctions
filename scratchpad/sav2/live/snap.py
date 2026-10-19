"""snap.py --out FILE [--sa ID,..] [--sc ID,..] [--config C]: every row a twin run can touch, read-only (dev), tenant-scoped,
for the SAV2T test items of live/config.json:
  ib / ibb / fifo / wa / batch   item_balance, item_batch_balance, fifo_costing_history, wa_costing_method, batch of the items
                                 at the plant (SELECT *, deleted rows included - a soft delete is a change)
  mv                             inventory_movement of the items (every trx_no: twin deltas = the new ids)
  item / itemdef                 Item last_transaction_date / update_time; costing method, batch flag, UOM conversions (planner input)
  sa / sal                       Stock Adjustments whose lines name a test item (+ --sa ids) and their lines
  sc / scl                       Stock Counts whose lines name a test item (+ --sc ids) and their lines
  job / step                     gd_async_job of those SAs (correlation SA|<id>) or REVIEW keys of those SCs; gd_publish_step of
                                 each job, of SAC|<sa> / SCR|<sc> locks and of the engine operation SAC|<job>
  lock                           inventory_balance_lock rows of the items (ITEM| / BATCH| / COST|)
  precision                      the tenant's Inventory Price / Qty number rules (planner input)
Output holds dev data: write it to the session scratchpad (refused inside the repo)."""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.dont_write_bytecode = True
sys.path.insert(0, HERE)
import twinlib as L  # noqa: E402


def ids_arg(name):
    v = L.arg(name)
    return [L.digits(x, name) for x in v.split(",")] if v else []


def snapshot(cfg, extra_sa=(), extra_sc=()):
    t, plant, org = L.digits(cfg["tenant_id"], "tenant"), L.digits(cfg["plant_id"], "plant"), L.digits(cfg["organization_id"], "org")
    mats = ",".join(L.material_ids(cfg))
    T = f"tenant_id = '{t}'"
    snap = {"meta": {"tenant": t, "plant": plant, "org": org, "materials": {k: i["id"] for k, i in L.items_of(cfg).items()},
                     "bins": {k: v for k, v in cfg["bins"].items() if not k.startswith("_")}, "batch_id": cfg["items"]["fifob"].get("batch_id"),
                     "taken_at": L.q("SELECT DATE_FORMAT(NOW(3), '%Y-%m-%d %H:%i:%s.%f') t")[0]["t"]}}
    W = f"{T} AND plant_id = {plant} AND material_id IN ({mats})"
    snap["ib"] = L.q(f"SELECT * FROM item_balance WHERE {W} ORDER BY id")
    snap["ibb"] = L.q(f"SELECT * FROM item_batch_balance WHERE {W} ORDER BY id")
    snap["fifo"] = L.q(f"SELECT * FROM fifo_costing_history WHERE {W} ORDER BY id")
    snap["wa"] = L.q(f"SELECT * FROM wa_costing_method WHERE {T} AND plant_id = '{plant}' AND material_id IN ({mats}) ORDER BY id")
    snap["batch"] = L.q(f"SELECT * FROM batch WHERE {T} AND material_id IN ({mats}) ORDER BY id")
    snap["mv"] = L.q(f"SELECT * FROM inventory_movement WHERE {T} AND item_id IN ({mats}) ORDER BY id")
    snap["item"] = L.q(f"SELECT id, material_code, last_transaction_date, update_time FROM item WHERE {T} AND id IN ({mats}) ORDER BY id")
    snap["itemdef"] = L.q("SELECT CAST(id AS CHAR) id, material_code, material_costing_method, item_batch_management, stock_control, CAST(based_uom AS CHAR) based_uom, "
                          f"CAST(purchase_unit_price AS CHAR) purchase_unit_price FROM item WHERE {T} AND id IN ({mats})")
    conv = L.q("SELECT CAST(item_id AS CHAR) item_id, CAST(alt_uom_id AS CHAR) alt_uom_id, CAST(base_uom_id AS CHAR) base_uom_id, CAST(alt_qty AS CHAR) alt_qty, "
               f"CAST(base_qty AS CHAR) base_qty FROM item_mji552rc_sub WHERE {T} AND is_deleted = 0 AND item_id IN ({mats}) ORDER BY id")
    for it in snap["itemdef"]:
        it["table_uom_conversion"] = [{k: c[k] for k in ("alt_uom_id", "base_uom_id", "alt_qty", "base_qty")} for c in conv if c["item_id"] == it["id"]]
    # documents: every SA / SC whose lines name a test item (dedicated items: all of them are ours) + the ones asked for
    sa_ids = sorted({str(r["i"]) for r in L.q(f"SELECT DISTINCT stock_adjustment_id i FROM stock_adjustment_1dknywqh_sub WHERE {T} AND material_id IN "
                                                f"({','.join(chr(39) + m + chr(39) for m in mats.split(','))})")} | set(extra_sa), key=int)
    sc_ids = sorted({str(r["i"]) for r in L.q(f"SELECT DISTINCT stock_count_id i FROM stock_count_h4c9e1cl_sub WHERE {T} AND material_id IN ({mats})")}
                    | set(extra_sc), key=int)
    SA = ",".join(sa_ids) or "0"
    SC = ",".join(sc_ids) or "0"
    snap["sa"] = L.q(f"SELECT * FROM stock_adjustment WHERE {T} AND id IN ({SA}) ORDER BY id")
    snap["sal"] = L.q(f"SELECT * FROM stock_adjustment_1dknywqh_sub WHERE {T} AND stock_adjustment_id IN ({SA}) ORDER BY stock_adjustment_id, id")
    snap["sc"] = L.q(f"SELECT * FROM stock_count WHERE {T} AND id IN ({SC}) ORDER BY id")
    snap["scl"] = L.q(f"SELECT * FROM stock_count_h4c9e1cl_sub WHERE {T} AND stock_count_id IN ({SC}) ORDER BY stock_count_id, id")
    corr = ",".join("'SA|" + i + "'" for i in sa_ids) or "''"
    scr = " OR ".join(f"idempotency_key LIKE 'SCR:{org}:{i}:%'" for i in sc_ids) or "1 = 0"
    snap["job"] = L.q("SELECT id, organization_id, plant_id, command, idempotency_key, correlation_id, causation_id, line_count, job_status, progress_percent, "
                      "progress_message, attempt_count, next_attempt_at, lease_owner, lease_expires_at, row_version, error_code, error_message, error_details, "
                      "request_payload, LENGTH(prepared_payload) prepared_len, queued_at, started_at, finished_at, create_time, update_time "
                      f"FROM gd_async_job WHERE {T} AND command = 'COMPLETE_SA' AND (correlation_id IN ({corr}) OR {scr}) ORDER BY id")
    jobs = [str(j["id"]) for j in snap["job"]]
    names = ["'SAC|" + i + "'" for i in sa_ids] + ["'SCR|" + i + "'" for i in sc_ids] + ["'" + j + "'" for j in jobs] + ["'SAC|" + j + "'" for j in jobs]
    snap["step"] = L.q("SELECT id, job_id, step_name, step_status, attempt_count, started_at, finished_at, error_code, error_message, LENGTH(result_ref) ref_len, "
                       f"LEFT(result_ref, 300) ref_head FROM gd_publish_step WHERE {T} AND job_id IN ({','.join(names) or chr(39) + chr(39)}) ORDER BY id")
    like = " OR ".join(f"lock_key LIKE '%|{m}|%' OR lock_key LIKE '%|{m}'" for m in mats.split(","))
    snap["lock"] = L.q(f"SELECT id, lock_key, balance_type, owner_operation_id, free_token, lock_version, claimed_at, last_released_at, last_owner_operation_id "
                       f"FROM inventory_balance_lock WHERE {T} AND organization_id = '{org}' AND is_deleted = 0 AND ({like}) ORDER BY id")
    snap["precision"] = L.q("SELECT scope_type, rule_key, CAST(table_id AS CHAR) table_id, field_name, decimal_places, precision_rule, store_raw_value "
                            f"FROM su_code_num_precision WHERE {T} AND status = 1 AND is_deleted = 0 AND ((scope_type = '1' AND rule_key IN ('Inventory Price', "
                            "'Inventory Qty')) OR scope_type = '2')")
    return snap


def main():
    out = L.arg("--out")
    if not out:
        raise SystemExit(__doc__)
    if os.path.abspath(out).startswith(L.REPO + os.sep):
        raise SystemExit("refusing: --out is inside the repo (the snapshot holds dev data)")
    cfg = L.load_config()
    snap = snapshot(cfg, ids_arg("--sa"), ids_arg("--sc"))
    with open(out, "w") as fh:
        json.dump(L.big_str(snap), fh, default=str, ensure_ascii=False)
    held = [r for r in snap["lock"] if str(r["free_token"]) != "1"]
    print(f"{snap['meta']['taken_at']} -> {out}: " + ", ".join(f"{k} {len(v)}" for k, v in snap.items() if isinstance(v, list))
          + (f"; HELD LOCKS {[(r['lock_key'], r['owner_operation_id']) for r in held]}" if held else "; no lock held"))


if __name__ == "__main__":
    main()
