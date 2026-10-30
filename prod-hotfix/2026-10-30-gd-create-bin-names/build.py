#!/usr/bin/env python3
"""GD Created V2 prints bin ids in the GD lines' delivery summary (view_stock) for bins past a plant's first 500 by id.
1) GD_BULK_PREPARE.prod_paste.json: prod's enabled version + scratchpad/gdc/gdcreate/patch_prepare_bin_names.py (only
   sql_node_rCfSqwDY's BIN branch changes); asserts it equals the repo file (= dev v23, live-tested 10-30).
2) repair_view_stock.sql: Kenhin's existing summaries, one guarded UPDATE per bin past its plant's first 500 that holds stock;
   Completed / Cancelled GDs only (an open GD's form would see the change and its Complete would go to the classic save).
Read-only on prod.   usage: python3 build.py
"""
import json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
DB = os.path.join(REPO, ".dbtools", "db")
sys.path.insert(0, os.path.join(REPO, "scratchpad", "gdc", "gdcreate"))
from patch_prepare_bin_names import patch, find  # noqa: E402

WF_ID = "2104840044642754561"
TENANT, ORG, PLANT = "528521", "2006752085806436353", "2006975338995011586"


def q(sql):
    out = subprocess.run([DB, "--prod", "--json", sql], capture_output=True, text=True)
    if out.returncode:
        raise SystemExit(out.stderr.strip()[-600:])
    return json.loads(out.stdout[out.stdout.find("["):])


def canon(o):
    return json.dumps(o, sort_keys=True, ensure_ascii=False)


def nodes(o, acc):
    if isinstance(o, dict):
        if isinstance(o.get("id"), str) and "data" in o:
            acc[o["id"]] = canon(o.get("data"))
        for v in o.values():
            nodes(v, acc)
    elif isinstance(o, list):
        for v in o:
            nodes(v, acc)
    return acc


def build_paste():
    r = q(f"SELECT version_number v, script_json s FROM su_code_workflow_history WHERE data_id = {WF_ID} AND status = 'enabled' "
          "ORDER BY version_number DESC LIMIT 1")[0]
    base = json.loads(r["s"])
    paste = patch(json.loads(r["s"]))
    a, b = nodes(base, {}), nodes(paste, {})
    diff = sorted(k for k in set(a) | set(b) if a.get(k) != b.get(k))
    assert diff == ["sql_node_rCfSqwDY"], diff
    repo = json.load(open(os.path.join(REPO, "Goods Delivery", "AsyncV2", "GD_BULK_PREPARE.json"), encoding="utf-8"))
    assert canon(paste) == canon(repo), "the paste is not the repo file (dev v23)"
    json.dump(base, open(os.path.join(HERE, f"GD_BULK_PREPARE.prod_v{r['v']}.base.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    json.dump(paste, open(os.path.join(HERE, "GD_BULK_PREPARE.prod_paste.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"GD_BULK_PREPARE: prod enabled v{r['v']} + the BIN patch -> GD_BULK_PREPARE.prod_paste.json (= repo / dev v23)")


def build_repair():
    bins = q(f"""SELECT CAST(x.id AS CHAR) id, x.bin_location_combine name FROM (
                   SELECT id, bin_location_combine, ROW_NUMBER() OVER (ORDER BY id) rn FROM bin_location
                    WHERE tenant_id = '{TENANT}' AND organization_id = '{ORG}' AND plant_id = {PLANT} AND is_deleted = 0) x
                  WHERE x.rn > 500 AND EXISTS (SELECT 1 FROM item_balance b WHERE b.tenant_id = '{TENANT}' AND b.location_id = x.id
                                                AND b.is_deleted = 0 AND b.unrestricted_qty > 0)
                  ORDER BY x.id""")
    assert all(b["name"] and "'" not in b["name"] for b in bins), bins
    scope = (f"l.tenant_id = '{TENANT}' AND l.is_deleted = 0 AND g.gd_status IN ('Completed', 'Cancelled') "
             "AND l.view_stock REGEXP '[0-9]\\\\. [0-9]{18,20}:'")
    count = ("SELECT REGEXP_SUBSTR(l.view_stock, '[0-9]{18,20}(?=:)') AS bin_id, COUNT(*) AS lines_n\n"
             "  FROM goods_delivery_fwii8mvb_sub l JOIN goods_delivery g ON g.id = l.goods_delivery_id\n"
             f" WHERE {scope}\n GROUP BY bin_id;")
    ups = "\n\n".join(
        f"UPDATE goods_delivery_fwii8mvb_sub l JOIN goods_delivery g ON g.id = l.goods_delivery_id\n"
        f"   SET l.view_stock = REPLACE(l.view_stock, '. {b['id']}:', '. {b['name']}:')\n"
        f" WHERE l.tenant_id = '{TENANT}' AND l.is_deleted = 0 AND g.gd_status IN ('Completed', 'Cancelled')\n"
        f"   AND l.view_stock LIKE '%. {b['id']}:%';" for b in bins)
    sql = f"""-- Kenhin (tenant {TENANT}): GD lines whose delivery summary (view_stock) shows a bin id instead of its name. GD Created V2
-- read only the plant's first 500 bins by id; these {len(bins)} bins come after them and hold stock:
{chr(10).join(f"--   {b['id']} -> {b['name']}" for b in bins)}
-- Completed / Cancelled GDs only; the text is display only (nothing else reads it). update_time is left as it is. Built by build.py.
-- Run AFTER the GD_BULK_PREPARE paste; safe to run again (a repaired summary no longer matches).

-- PART 1: lines to repair, per bin id
{count}

-- PART 2: one UPDATE per bin (rows affected = PART 1's count for that bin)
{ups}

-- PART 3: after-check, expect no rows
{count}
"""
    open(os.path.join(HERE, "repair_view_stock.sql"), "w", encoding="utf-8").write(sql)
    print(f"repair_view_stock.sql: {len(bins)} bins: " + ", ".join(f"{b['id']} -> {b['name']}" for b in bins))


if __name__ == "__main__":
    build_paste()
    build_repair()
