"""For each successful recorded completion in a fixtures file: the rows it wrote that harness (c) compares (the Putaway TO
with gr_no = the GR id and its lines, the in_transit_detail rows with doc_id = the GR id) and the live batches with the
manual numbers of its lines (harness (b) keeps those older than the run). Read-only.

usage: python3 fetch_written.py <--dev|--prod> <fixtures.jsonl> <out.json>
Output holds customer data: write it to the session scratchpad, never into the repo.
"""
import json
import os
import re
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
from dbq import q as _q  # noqa: E402

DIG = re.compile(r"^[0-9]{1,20}$")
TEN = re.compile(r"^[0-9A-Za-z]{1,12}$")


def q(env, sql, tries=4):
    for n in range(tries):
        try:
            return _q(env, sql)
        except RuntimeError:
            if n == tries - 1:
                raise
            time.sleep(5 * (n + 1))


def j(alias, cols):
    return "JSON_OBJECT(" + ", ".join(f"'{c}', {alias}.`{c}`" if k == "raw" else
                                       f"'{c}', CAST({alias}.`{c}` AS CHAR)" if k == "id" else
                                       f"'{c}', DATE_FORMAT({alias}.`{c}`, '%Y-%m-%d %H:%i:%s')" for c, k in cols) + ")"


TO = [("id", "id"), ("to_id", "raw"), ("to_status", "raw"), ("plant_id", "id"), ("to_id_type", "id"), ("movement_type", "raw"), ("ref_doc_type", "raw"),
      ("gr_no", "raw"), ("receiving_no", "raw"), ("supplier_id", "id"), ("assigned_to", "raw"), ("created_by", "raw"), ("created_at", "dt"),
      ("organization_id", "raw"), ("project_id", "id")]
TOL = [("id", "id"), ("transfer_order_putaway_id", "id"), ("parent_id", "id"), ("line_index", "raw"), ("item_code", "id"), ("item_name", "raw"),
       ("item_desc", "raw"), ("batch_no", "id"), ("source_inv_category", "raw"), ("target_inv_category", "raw"), ("received_qty", "raw"),
       ("item_uom", "id"), ("source_bin", "id"), ("qty_to_putaway", "raw"), ("pending_process_qty", "raw"), ("putaway_qty", "raw"),
       ("storage_location", "id"), ("target_location", "id"), ("remark", "raw"), ("qi_no", "raw"), ("line_status", "raw"), ("po_no", "id"),
       ("is_split", "raw"), ("parent_or_child", "raw"), ("parent_index", "raw"), ("unit_price", "raw"), ("total_price", "raw"), ("hu_data", "raw"),
       ("handling_unit_id", "id"), ("gr_line_id", "raw"), ("project_id", "id"), ("item_bundle_id", "id")]
IT = [("id", "id"), ("doc_type", "raw"), ("doc_id", "raw"), ("doc_no", "raw"), ("doc_line_id", "raw"), ("line_no", "raw"), ("parent_id", "raw"),
      ("parent_no", "raw"), ("parent_line_id", "raw"), ("material_id", "id"), ("item_code", "raw"), ("item_name", "raw"), ("item_desc", "raw"),
      ("item_uom", "id"), ("batch_id", "id"), ("handling_unit_id", "raw"), ("plant_id", "id"), ("organization_id", "raw"), ("transit_bin", "id"),
      ("from_plant_id", "id"), ("from_bin", "id"), ("from_category", "raw"), ("to_plant_id", "id"), ("to_bin", "id"), ("to_category", "raw"),
      ("transit_qty", "raw"), ("received_qty", "raw"), ("open_qty", "raw"), ("status", "raw"), ("transit_date", "dt"), ("remark", "raw"),
      ("target_doc_type", "raw"), ("target_doc_id", "raw"), ("target_doc_no", "raw"), ("target_doc_line_id", "raw"), ("source_transit_id", "raw")]
BATCH = [("id", "id"), ("batch_number", "raw"), ("material_id", "id"), ("plant_id", "id"), ("organization_id", "raw"), ("transaction_no", "raw"),
         ("update_time", "raw")]


def main():
    env, fixtures, out = sys.argv[1], sys.argv[2], sys.argv[3]
    res = json.load(open(out)) if os.path.exists(out) else {}
    for line in open(fixtures):
        r = json.loads(line)
        if r["exit"] != "return_node_coSATlEf":
            continue
        gid = r["nodes"]["code_node_UQWzCg37"]["resp"]["data"]["id"]
        if gid in res or not DIG.match(gid) or not TEN.match(r["tenant"]):
            continue
        t = r["tenant"]
        a = r["params"]["allData"]
        org = str(a.get("organization_id") or "")
        plant = str(a.get("plant_id") or "")
        rec = {}
        to = q(env, f"SELECT {j('t', TO)} AS j FROM transfer_order_putaway t WHERE t.tenant_id = '{t}' AND t.gr_no = '{gid}' AND t.is_deleted = 0 ORDER BY t.id")
        rec["to"] = [x["j"] for x in to]
        if to:
            ids = ",".join(json.loads(x["j"])["id"] for x in to)
            rec["toLines"] = [x["j"] for x in q(env, f"SELECT {j('l', TOL)} AS j FROM transfer_order_putaway_jz8m9w3h_sub l WHERE l.transfer_order_putaway_id IN ({ids}) AND l.is_deleted = 0 ORDER BY l.id")]
        else:
            rec["toLines"] = []
        rec["it"] = [x["j"] for x in q(env, f"SELECT {j('i', IT)} AS j FROM in_transit_detail i WHERE i.tenant_id = '{t}' AND i.doc_id = '{gid}' AND i.is_deleted = 0 ORDER BY i.id")]
        nums = sorted({x.get("item_batch_no") for x in (a.get("table_gr") or []) if x.get("item_batch_no") not in (None, "", "-", "Auto-generated batch number")})
        nums = [n for n in nums if re.fullmatch(r"[A-Za-z0-9 _./\-*()#:]{1,80}", n)]
        if nums and DIG.match(plant) and DIG.match(org):
            lst = ",".join("'" + n.replace("'", "") + "'" for n in nums)
            rec["batches"] = [x["j"] for x in q(env, f"SELECT {j('b', BATCH)} AS j FROM batch b WHERE b.tenant_id = '{t}' AND b.is_deleted = 0 AND b.organization_id = '{org}' AND b.plant_id = {plant} AND b.batch_number IN ({lst}) ORDER BY b.id")]
        else:
            rec["batches"] = []
        res[gid] = rec
        json.dump(res, open(out, "w"))
    print(env, len(res), "GRs ->", out)


if __name__ == "__main__":
    main()
