# Read-only prod sweep of Packing leftovers for one tenant. Usage: python3 -I sweep.py [tenant]
import json, os, subprocess, sys
T = sys.argv[1] if len(sys.argv) > 1 else "128671"
DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".dbtools", "db")
def db(sql):
    r = subprocess.run([DB, "--prod", "--json", sql], capture_output=True, text=True)
    if r.returncode: raise SystemExit("DB: " + r.stderr.strip().splitlines()[-1][:300])
    return json.loads(r.stdout)
def show(title, rows, limit=8):
    print(f"[{'OK' if not rows else 'CHECK'}] {title}: {len(rows)}")
    for r in rows[:limit]: print("    ", r)

show("A. COMPLETE_PACKING jobs not COMPLETED", db(f"""
SELECT CAST(id AS CHAR) job, job_status, error_code, LEFT(COALESCE(error_message,''), 90) msg, update_time
  FROM gd_async_job WHERE tenant_id = '{T}' AND command = 'COMPLETE_PACKING' AND is_deleted = 0 AND job_status <> 'COMPLETED'"""))

show("B. Packings held by a background-save lock with no open job", db(f"""
SELECT p.packing_no, p.packing_status, p.packing_lock_session_id, p.packing_lock_expires_at,
       (SELECT j.job_status FROM gd_async_job j WHERE j.id = CAST(SUBSTRING(p.packing_lock_session_id, 8) AS UNSIGNED)) job_status
  FROM packing p WHERE p.tenant_id = '{T}' AND p.is_deleted = 0 AND p.packing_lock_session_id LIKE 'PKGJOB-%'
HAVING job_status IS NULL OR job_status IN ('COMPLETED', 'FAILED', 'CANCELLED')"""))

show("C. Completed Packings with a box row not Completed (since 10-11)", db(f"""
SELECT p.packing_no, h.handling_no, h.hu_status, p.update_time
  FROM packing p JOIN packing_hr4nq20g_sub h ON h.packing_id = p.id AND h.is_deleted = 0
 WHERE p.tenant_id = '{T}' AND p.is_deleted = 0 AND p.packing_status = 'Completed' AND p.create_time >= '2026-10-11'
   AND COALESCE(h.hu_status, '') <> 'Completed'"""))

show("D. Created Packings whose delivery is Completed / Cancelled", db(f"""
SELECT p.packing_no, g.delivery_no, g.gd_status, p.create_time
  FROM packing p JOIN goods_delivery g ON g.id = CAST(REGEXP_SUBSTR(p.gd_id, '[0-9]+') AS UNSIGNED) AND g.tenant_id = p.tenant_id
 WHERE p.tenant_id = '{T}' AND p.is_deleted = 0 AND p.packing_status = 'Created' AND g.gd_status IN ('Completed', 'Cancelled')"""))

# E. over-pack: a box entry above its source line (the 10-14 mobile double-tap pattern), open Packings only
src = db(f"""SELECT CAST(s.id AS CHAR) id, p.packing_no, s.total_quantity q FROM packing p JOIN packing_jz8m9w3h_sub s ON s.packing_id = p.id AND s.is_deleted = 0
 WHERE p.tenant_id = '{T}' AND p.is_deleted = 0 AND p.packing_status = 'Created'""")
hus = db(f"""SELECT p.packing_no, h.handling_no, h.temp_data FROM packing p JOIN packing_hr4nq20g_sub h ON h.packing_id = p.id AND h.is_deleted = 0
 WHERE p.tenant_id = '{T}' AND p.is_deleted = 0 AND p.packing_status = 'Created'""")
need = {r["id"]: (r["packing_no"], float(r["q"] or 0)) for r in src}
packed = {}
for h in hus:
    try: entries = json.loads(h["temp_data"] or "[]")
    except Exception: entries = []
    for e in entries if isinstance(entries, list) else []:
        for x in (e.get("children") or []) if isinstance(e, dict) and e.get("type") == "nested_hu" else [e]:
            if isinstance(x, dict) and x.get("line_item_id"):
                packed[str(x["line_item_id"])] = packed.get(str(x["line_item_id"]), 0) + float(x.get("total_quantity") or 0)
over = [(need[k][0], k, need[k][1], v) for k, v in packed.items() if k in need and v > need[k][1] + 0.001]
show("E. Over-packed source lines in open Packings (packed > line)", over)

# F. totals vs rows (the classic headerCalculation rule), Completed since 10-11
rows = db(f"""SELECT p.packing_no, p.packing_mode, p.total_item_qty, p.total_hu_count,
       (SELECT COALESCE(SUM(h.total_quantity), 0) FROM packing_hr4nq20g_sub h WHERE h.packing_id = p.id AND h.is_deleted = 0) hu_qty,
       (SELECT COUNT(*) FROM packing_hr4nq20g_sub h WHERE h.packing_id = p.id AND h.is_deleted = 0) hu_rows,
       (SELECT COALESCE(SUM(h.hu_quantity), 0) FROM packing_hr4nq20g_sub h WHERE h.packing_id = p.id AND h.is_deleted = 0) hu_quantity
  FROM packing p WHERE p.tenant_id = '{T}' AND p.is_deleted = 0 AND p.packing_status = 'Completed' AND p.create_time >= '2026-10-11'""")
bad = []
for r in rows:
    want_count = float(r["hu_quantity"] or 0) if r["packing_mode"] == "Basic" else float(r["hu_rows"] or 0)
    if abs(float(r["total_item_qty"] or 0) - float(r["hu_qty"] or 0)) > 0.001 or abs(float(r["total_hu_count"] or 0) - want_count) > 0.001:
        bad.append((r["packing_no"], r["packing_mode"], "qty", r["total_item_qty"], "rows", r["hu_qty"], "count", r["total_hu_count"], "want", want_count))
show(f"F. Completed Packings whose totals disagree with their box rows (of {len(rows)})", bad)

show("G. Reservations on a box whose delivery is closed or gone", db(f"""
SELECT CAST(r.id AS CHAR) rid, r.doc_no, r.status, r.open_qty, g.delivery_no, COALESCE(g.gd_status, 'MISSING') gd_status
  FROM on_reserved_gd r LEFT JOIN goods_delivery g ON g.id = CAST(r.target_gd_id AS UNSIGNED) AND g.is_deleted = 0
 WHERE r.tenant_id = '{T}' AND r.is_deleted = 0 AND COALESCE(r.handling_unit_id, '') <> '' AND r.status = 'Allocated' AND r.open_qty > 0
   AND (g.id IS NULL OR g.gd_status IN ('Completed', 'Cancelled'))"""))

show("H. Box stock in boxes of Cancelled Packings", db(f"""
SELECT u.handling_no, u.hu_status, p.packing_no, SUM(i.quantity) qty
  FROM handling_unit u JOIN packing p ON p.id = CAST(u.packing_id AS UNSIGNED) AND p.packing_status = 'Cancelled'
  JOIN handling_unit_atu7sreg_sub i ON i.handling_unit_id = u.id AND i.is_deleted = 0 AND i.quantity > 0
 WHERE u.tenant_id = '{T}' AND u.is_deleted = 0 GROUP BY u.handling_no, u.hu_status, p.packing_no"""))
