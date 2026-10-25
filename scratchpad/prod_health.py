#!/usr/bin/env python3
"""
Read-only health check of the live system (prod by default), for after any prod paste and once a morning.
Written after the LSH incident of 2026-10-24: a guard pasted straight onto prod rewrote 11,000 gd_publish_step rows,
crashed Packing saves half-way and left stock locks held. Each section below would have shown it within minutes.

  PASTES      workflow versions published in the window, with who published them (information: read it after a
              paste; a re-enabled older version keeps its old create_time and does not show)
  MASS-WRITE  100+ rows of gd_publish_step / 50+ of gd_async_job written in the same second with the same values:
              the signature of an update that reached rows it should not have
  JOBS        background jobs open and untouched for 15+ minutes, and jobs that went to REQUIRES_REVIEW
  OUTBOX      GD outbox events READY / CLAIMED for 15+ minutes, and events held BLOCKED
  LOCKS       stock locks (not GATE markers) held for 30+ minutes; leases are at most 30 minutes, nothing expires them
  CRASHES     workflow runs that crashed (status Fail) in the last hour
  GD-STOCK    open deliveries (not from a Picking Plan) whose line allocations have no matching open reservation:
              any on a handling unit, and any changed in the last 3 days; lines changed in the last 10 minutes are
              skipped (a save in flight)
  BALANCE     Reserved stock whose balance row disagrees with the sum of its movements, for every item / batch / bin with
              a Reserved move in the window: a lost write (a classic and a V2 writer on one balance row, GD-2610-1245
              10-24); the next completion of that stock is refused. Reserved only: opening stock has no movements
  NUMBERS     shared Picking headers whose delivery list still names a cancelled GD by its old number: two GD Cancel V2
              jobs on one header can overwrite each other's rename (X5 writes the whole text; BA 10-25, race_x5.js).
              Display text only; repair with REPLACE on that header

Usage:
    python3 scratchpad/prod_health.py [--dev] [--tenant <tenant_id>] [--hours <window, default 24>]

Exit code 1 if any section needs a look (CHECK), 0 if all are OK. Needs .dbtools/db (read-only).
"""

import json
import subprocess
import sys
import time

DB = ".dbtools/db"
NOW = "DATE_ADD(UTC_TIMESTAMP(), INTERVAL 8 HOUR)"  # stored datetimes are MYT; prod sessions run in UTC
OVERWRITE_1024 = ("(('PACKING_DONE', 'ABORTED_BEFORE_BUSINESS'), ('PACKING_REVIEW', 'BUSINESS_STARTED'), "
                  "('PACKING_REVIEW', 'CLEANUP_REQUIRES_REVIEW'))")
SNOWFLAKE_EPOCH_MS = 1288834974657
# workflows that move stock, hold reservations or drive the V2 background jobs: a crash in one of them is a CHECK
STOCK_WORKFLOWS = ("GD_", "GOODS_DELIVERY", "PACKING", "PICKING", "REPACKING", "HANDLING_UNIT", "INVENTORY_", "SUBTRACT_INVENTORY",
                   "ADD_INVENTORY", "SO_AUTO_GD", "SO_SAVE", "GR_COMPLETE", "GR_REVERT", "PUTAWAY", "IA_", "IDA_", "LOT_", "SA_V2",
                   "SM_")


def query(env, sql):
    out = subprocess.run([DB, env, "--json", "--limit", "500", sql], capture_output=True, text=True)
    text = out.stdout
    if "[" not in text:
        raise RuntimeError((out.stderr or text).strip().splitlines()[-1] if (out.stderr or text).strip() else "no output")
    return json.loads(text[text.index("["):])


def show(title, rows, check, note=""):
    status = "CHECK" if check and rows else "OK"
    print(f"\n[{status}] {title}" + (f"  ({note})" if note else ""))
    if not rows:
        print("    none")
        return status == "CHECK"
    cols = list(rows[0].keys())
    widths = {c: min(60, max(len(c), *(len(str(r.get(c, ""))) for r in rows))) for c in cols}
    print("    " + "  ".join(c.ljust(widths[c]) for c in cols))
    for r in rows[:40]:
        print("    " + "  ".join(str(r.get(c, ""))[:60].ljust(widths[c]) for c in cols))
    if len(rows) > 40:
        print(f"    ... {len(rows) - 40} more")
    return status == "CHECK"


def main():
    args = sys.argv[1:]
    env, tenant, hours = "--prod", None, 24
    while args:
        a = args.pop(0)
        if a == "--dev":
            env = "--dev"
        elif a == "--tenant":
            tenant = args.pop(0)
        elif a == "--hours":
            hours = int(args.pop(0))
        else:
            print(__doc__)
            return 2
    if tenant is not None and not tenant.isdigit():
        print("--tenant takes digits only")
        return 2

    def t(alias):
        return f" AND {alias}.tenant_id = '{tenant}'" if tenant else ""

    since = f"{NOW} - INTERVAL {hours} HOUR"
    hour_ago_id = (int((time.time() - 3600) * 1000) - SNOWFLAKE_EPOCH_MS) << 22
    print(f"Health check {env[2:]}{' tenant ' + tenant if tenant else ''}, window {hours} h")
    checks = 0

    checks += show("PASTES: workflow versions published", query(env, f"""
        SELECT w.name, h.version_number AS v, h.status, h.create_time, IFNULL(u.account, h.create_user) AS by_user
          FROM su_code_workflow_history h
          JOIN su_code_workflow w ON w.id = h.data_id
          LEFT JOIN blade_user u ON u.id = h.create_user
         WHERE h.create_time > {since} AND h.status IN ('enabled', 'history')
         ORDER BY h.create_time DESC"""), check=False, note="information: confirm each one was meant")

    checks += show("MASS-WRITE: gd_publish_step rows written in one second with one status", query(env, f"""
        SELECT p.tenant_id, p.step_status, IFNULL(p.error_code, '') AS error_code,
               DATE_FORMAT(p.update_time, '%Y-%m-%d %H:%i:%s') AS written_at, COUNT(*) AS step_rows
          FROM gd_publish_step p
         WHERE p.is_deleted = 0 AND p.update_time > {since}{t('p')}
         GROUP BY 1, 2, 3, 4 HAVING COUNT(*) >= 100 ORDER BY step_rows DESC"""), check=True)
    checks += show("MASS-WRITE: gd_async_job rows written in one second with one status", query(env, f"""
        SELECT j.tenant_id, j.job_status, IFNULL(j.error_code, '') AS error_code,
               DATE_FORMAT(j.update_time, '%Y-%m-%d %H:%i:%s') AS written_at, COUNT(*) AS job_rows
          FROM gd_async_job j
         WHERE j.is_deleted = 0 AND j.update_time > {since}{t('j')}
         GROUP BY 1, 2, 3, 4 HAVING COUNT(*) >= 50 ORDER BY job_rows DESC"""), check=True)
    show("MASS-WRITE: rows still carrying the 2026-10-24 overwrite", query(env, f"""
        SELECT p.tenant_id, COUNT(*) AS step_rows FROM gd_publish_step p
         WHERE p.is_deleted = 0 AND (p.step_status, p.error_code) IN {OVERWRITE_1024}{t('p')}
         GROUP BY 1"""), check=False, note="history only, expected 11,009 at LSH 128671; it must not grow")

    checks += show("JOBS: open and untouched for 15+ minutes", query(env, f"""
        SELECT j.tenant_id, j.command, j.job_status, COUNT(*) AS jobs, MIN(j.update_time) AS oldest_update,
               MIN(j.gd_no) AS sample_gd
          FROM gd_async_job j
         WHERE j.is_deleted = 0 AND j.job_status NOT IN ('COMPLETED', 'FAILED', 'CANCELLED')
           AND j.update_time < {NOW} - INTERVAL 15 MINUTE{t('j')}
         GROUP BY 1, 2, 3 ORDER BY oldest_update"""), check=True)
    checks += show("JOBS: went to REQUIRES_REVIEW in the window", query(env, f"""
        SELECT j.tenant_id, j.command, IFNULL(j.error_code, '') AS error_code, COUNT(*) AS jobs, MAX(j.update_time) AS latest,
               MIN(j.gd_no) AS sample_gd, LEFT(MAX(IFNULL(j.error_message, '')), 60) AS sample_message
          FROM gd_async_job j
         WHERE j.is_deleted = 0 AND j.job_status = 'REQUIRES_REVIEW' AND j.update_time > {since}{t('j')}
         GROUP BY 1, 2, 3 ORDER BY latest DESC"""), check=True)
    show("JOBS: FAILED in the window (mostly business refusals)", query(env, f"""
        SELECT j.tenant_id, j.command, IFNULL(j.error_code, '') AS error_code, COUNT(*) AS jobs, MAX(j.update_time) AS latest
          FROM gd_async_job j
         WHERE j.is_deleted = 0 AND j.job_status = 'FAILED' AND j.update_time > {since}{t('j')}
         GROUP BY 1, 2, 3 ORDER BY jobs DESC"""), check=False, note="information")

    checks += show("OUTBOX: events waiting 15+ minutes or held BLOCKED", query(env, f"""
        SELECT o.tenant_id, o.dispatch_status, COUNT(*) AS events, MIN(o.update_time) AS oldest, MIN(o.aggregate_no) AS sample,
               LEFT(MAX(IFNULL(o.last_error_message, '')), 60) AS sample_note
          FROM gd_outbox o
         WHERE o.is_deleted = 0{t('o')}
           AND ((o.dispatch_status IN ('READY', 'CLAIMED') AND o.update_time < {NOW} - INTERVAL 15 MINUTE
                 AND o.create_time > {NOW} - INTERVAL 7 DAY)
                OR o.dispatch_status = 'BLOCKED')
         GROUP BY 1, 2"""), check=True)

    checks += show("LOCKS: stock locks held 30+ minutes", query(env, f"""
        SELECT b.tenant_id, b.balance_type, SUBSTRING_INDEX(b.owner_operation_id, '|', 1) AS owner_kind, COUNT(*) AS locks,
               MIN(b.claimed_at) AS oldest_claim, MIN(b.owner_operation_id) AS sample_owner
          FROM inventory_balance_lock b
         WHERE b.is_deleted = 0 AND b.free_token = 0 AND b.balance_type <> 'GATE'
           AND b.claimed_at < NOW() - INTERVAL 30 MINUTE{t('b')}
         GROUP BY 1, 2, 3"""), check=True)

    crashes = query(env, f"""
        SELECT i.workflow_name, i.tenant_id, COUNT(*) AS crashes, MAX(i.create_time) AS latest,
               LEFT(MAX(IFNULL(i.error_msg, '')), 70) AS sample_error
          FROM su_code_workflow_inst i
         WHERE i.id > {hour_ago_id} AND i.status = 'Fail'{t('i')}
           AND NOT (i.workflow_name = 'ACC_POLL' AND i.error_msg LIKE '%No Content%')
         GROUP BY 1, 2 ORDER BY crashes DESC""")
    stock = [r for r in crashes if str(r["workflow_name"]).startswith(STOCK_WORKFLOWS)]
    checks += show("CRASHES: stock and background-job workflows, last hour", stock, check=True)
    show("CRASHES: other workflows, last hour (many are validations thrown as errors)",
         [r for r in crashes if r not in stock], check=False, note="information; ACC_POLL 'No Content' left out")

    checks += show("GD-STOCK: open deliveries whose allocations have no matching reservation", query(env, f"""
        SELECT g.tenant_id, g.delivery_no, g.gd_status, COUNT(*) AS allocations, SUM(r.id IS NULL) AS unmatched,
               SUM(IFNULL(a.hu, '') <> '') AS on_handling_unit, MAX(l.update_time) AS lines_changed
          FROM goods_delivery g
          JOIN goods_delivery_fwii8mvb_sub l ON l.goods_delivery_id = g.id AND l.is_deleted = 0
          JOIN JSON_TABLE(IF(JSON_VALID(l.temp_qty_data), l.temp_qty_data, '[]'), '$[*]' COLUMNS (
                 loc VARCHAR(32) PATH '$.location_id', hu VARCHAR(32) PATH '$.handling_unit_id', del VARCHAR(8) PATH '$.is_deleted')) a
            ON IFNULL(a.del, '0') <> '1'
          LEFT JOIN on_reserved_gd r
            ON r.tenant_id = g.tenant_id AND r.is_deleted = 0 AND r.status NOT IN ('Cancelled', 'Delivered')
           AND r.target_gd_id = CAST(g.id AS CHAR) COLLATE utf8mb4_general_ci
           AND r.doc_line_id = CAST(l.id AS CHAR) COLLATE utf8mb4_general_ci
           AND CAST(r.bin_location AS CHAR) = a.loc AND IFNULL(r.handling_unit_id, '') = IFNULL(a.hu, '') COLLATE utf8mb4_general_ci
         WHERE g.is_deleted = 0 AND g.gd_status IN ('Created', 'Processing') AND IFNULL(g.is_select_picking, 0) = 0{t('g')}
         GROUP BY 1, 2, 3
        HAVING unmatched > 0 AND lines_changed < {NOW} - INTERVAL 10 MINUTE
           AND (on_handling_unit > 0 OR lines_changed > {NOW} - INTERVAL 3 DAY)
         ORDER BY lines_changed DESC"""), check=True)

    window_id = (int((time.time() - hours * 3600) * 1000) - SNOWFLAKE_EPOCH_MS) << 22
    checks += show("BALANCE: Reserved stock that disagrees with its movements", query(env, f"""
        SELECT k.tenant_id, CAST(k.item_id AS CHAR) AS item_id, IFNULL(CAST(k.batch_id AS CHAR), '') AS batch_id,
               CAST(k.bin_id AS CHAR) AS bin_id, k.by_movements,
               IFNULL(IF(k.batch_id IS NULL, ib.reserved_qty, bb.reserved_qty), 0) AS in_balance
          FROM (SELECT m.tenant_id, m.item_id, NULLIF(m.batch_number_id, 0) AS batch_id, m.bin_location_id AS bin_id,
                       SUM(IF(m.movement = 'IN', m.base_qty, -m.base_qty)) AS by_movements
                  FROM inventory_movement m
                  JOIN (SELECT DISTINCT w.tenant_id, w.item_id, IFNULL(w.batch_number_id, 0) AS batch_id, w.bin_location_id
                          FROM inventory_movement w
                         WHERE w.id > {window_id} AND w.is_deleted = 0 AND w.inventory_category = 'Reserved'{t('w')}) w
                    ON w.tenant_id = m.tenant_id AND w.item_id = m.item_id AND w.bin_location_id = m.bin_location_id
                   AND w.batch_id = IFNULL(m.batch_number_id, 0)
                 WHERE m.is_deleted = 0 AND m.inventory_category = 'Reserved'
                 GROUP BY 1, 2, 3, 4) k
          LEFT JOIN item_batch_balance bb ON k.batch_id IS NOT NULL AND bb.tenant_id = k.tenant_id AND bb.is_deleted = 0
               AND bb.material_id = k.item_id AND bb.batch_id = k.batch_id AND bb.location_id = k.bin_id
          LEFT JOIN item_balance ib ON k.batch_id IS NULL AND ib.tenant_id = k.tenant_id AND ib.is_deleted = 0
               AND ib.material_id = k.item_id AND ib.location_id = k.bin_id
         WHERE ABS(k.by_movements - IFNULL(IF(k.batch_id IS NULL, ib.reserved_qty, bb.reserved_qty), 0)) > 0.0001"""),
         check=True, note=f"items with a Reserved move in the last {hours} h; a mismatch means a lost stock write")

    checks += show("NUMBERS: shared Picking delivery lists still naming a cancelled GD by its old number", query(env, f"""
        SELECT t.tenant_id, t.to_id, t.to_status, TRIM(x.tok) AS stale_token, g.delivery_no AS gd_now
          FROM transfer_order t
          JOIN JSON_TABLE(CONCAT('["', REPLACE(REPLACE(REPLACE(IFNULL(t.delivery_no, ''), '"', ''), ', ', ','), ',', '","'), '"]'),
                          '$[*]' COLUMNS (tok VARCHAR(128) PATH '$')) x
          JOIN goods_delivery g ON g.tenant_id = t.tenant_id AND g.is_deleted = 0 AND g.gd_status = 'Cancelled'
           AND g.delivery_no COLLATE utf8mb4_general_ci = CONCAT(TRIM(x.tok), '-Cancelled') COLLATE utf8mb4_general_ci
         WHERE t.is_deleted = 0 AND t.delivery_no LIKE '%,%'{t('t')}"""),
         check=True, note="a lost rename from two concurrent cancels; display text only")

    print("\n" + ("Needs a look: " + str(checks) + " section(s) marked CHECK" if checks else "All OK"))
    return 1 if checks else 0


if __name__ == "__main__":
    sys.exit(main())
