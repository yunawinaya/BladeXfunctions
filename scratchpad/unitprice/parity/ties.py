"""History ties: groups (source, item, UOM, party, plant) whose latest create_time has 2+ live lines with different prices; per group
the classic's own pick (its exact per-line SQL) vs the bulk's rule (lowest id). usage: python3 ties.py --dev|--prod"""
import sys
sys.path.insert(0, "../../grv2")
from dbq import q
import classic_sql as C

ENV = sys.argv[1]
SRC = {
    "SO": ("sales_order_axszx8cj_sub x", "x.item_name", "x.so_item_uom", "x.customer_id", "x.so_item_price", "x.line_status NOT IN ('Cancelled','Draft')", ""),
    "SQT": ("quotation_rdywe1rx_sub x", "x.material_id", "x.sqt_order_uom_id", "x.customer_id", "x.unit_price", "q.sqt_status NOT IN ('Cancelled','Draft')",
            "JOIN quotation q ON x.quotation_id = q.id"),
    "PREQ": ("purchase_requisition_9wptilyh_sub x", "x.pr_line_material_id", "x.pr_line_uom_id", "x.supplier_id", "x.pr_line_unit_price",
             "x.line_status NOT IN ('Cancelled','Draft')", ""),
    "PO": ("purchase_order_2ukyuanr_sub x", "x.item_id", "x.quantity_uom", "x.supplier_id", "x.unit_price", "x.line_status NOT IN ('Cancelled','Draft')", ""),
    "SI": ("sales_invoice_zt0c3x55_sub x", "x.material_id", "x.invoice_qty_uom_id", "x.customer_id", "x.unit_price", "hd.si_status NOT IN ('Cancelled','Draft')",
           "JOIN sales_invoice hd ON x.sales_invoice_id = hd.id"),
    "PI": ("purchase_invoice_xpuy7o4q_sub x", "x.material_id", "x.quantity_uom", "x.supplier_id", "x.order_unit_price", "hd.pi_status NOT IN ('Cancelled','Draft')",
           "JOIN purchase_invoice hd ON x.purchase_invoice_id = hd.id"),
}
tot = {"groups": 0, "classic=lowest": 0, "classic=other": 0}
for src, (t, it, uom, party, price, status, join) in SRC.items():
    sql = f"""WITH s AS (SELECT CAST({it} AS CHAR) it, CAST({uom} AS CHAR) u, CAST({party} AS CHAR) pa, CAST(x.plant_id AS CHAR) pl, x.create_time t, {price} pr, x.id
                FROM {t} {join} WHERE x.is_deleted = 0 AND {status}),
     m AS (SELECT it, u, pa, pl, MAX(t) mt FROM s GROUP BY it, u, pa, pl)
SELECT m.it, m.u, m.pa, m.pl, CAST(MIN(s.id) AS CHAR) lowest, COUNT(*) n, COUNT(DISTINCT s.pr) dp
  FROM m JOIN s ON s.it = m.it AND s.u = m.u AND s.pa = m.pa AND s.pl = m.pl AND s.t = m.mt
 GROUP BY m.it, m.u, m.pa, m.pl HAVING COUNT(*) > 1 AND COUNT(DISTINCT s.pr) > 1"""
    groups = q(ENV, sql)
    picks = []
    for g in groups:
        row = q(ENV, C.hist_sql(src, g["it"], g["u"], g["pl"], g["pa"]))
        pick = str(row[0]["id"]) if row else None
        picks.append(pick == g["lowest"])
    tot["groups"] += len(groups)
    tot["classic=lowest"] += sum(picks)
    tot["classic=other"] += len(picks) - sum(picks)
    print("%-5s tie groups with different prices: %d   classic picked the lowest id: %d" % (src, len(groups), sum(picks)))
print(ENV, tot)
