"""live_so_variants.py <live_dir>: SO_SAVE requests for Picking 1d's alternate-UOM twins and two-batch run on DEV 496474, built
from the clone requests already in <live_dir> (git-ignored: tenant data). Reads files only.
  so_alt.json   QQQ (base PCS) one line of 2 BAG at 10 / BAG (1 BAG = 10 PCS): the GD line is in BAG, base_qty in PCS
  so_ab30.json  Auto Batch Item one line of 30: more than batch ...679873 has free, so the allocation spans two batches
  so_nq.json    Normal Item 5 + QQQ 5 PCS (mobile Force Complete V2 device-pass staging, 10-21: no Auto Batch Item, whose free
                L1 batch is used up)
  so_nt.json    Normal Item 5 + TES009 5 BAG (its base unit): QQQ's 1,000+ reservation rows (the 2,000-line test) make the
                classic convert refuse it ("reached the fetch limit (1000)"); TES009's line is QQQ's with the item swapped
                (item fields and unit conversions read from the DB)"""
import copy
import json
import sys

BAG = "2021056571405717505"


def totals(d):
    lines = d["table_so"]
    gross = round(sum(float(l["so_gross"]) for l in lines), 2)
    disc = round(sum(float(l["so_discount_amount"] or 0) for l in lines), 2)
    tax = round(sum(float(l["so_tax_amount"] or 0) for l in lines), 2)
    amount = round(sum(float(l["so_amount"]) for l in lines), 2)
    d.update({"so_total_gross": gross, "so_total_discount": disc, "so_total_tax": tax, "so_total": amount, "myr_total_amount": amount})


def one_line(src, k, qty, price, uom=None):
    r = copy.deepcopy(src)
    l = r["allData"]["table_so"][k]
    l.update({"so_quantity": float(qty), "so_item_price": float(price), "so_gross": round(qty * price, 2), "so_amount": round(qty * price, 2),
              "packing_qty": float(qty), "outstanding_quantity": float(qty)})
    if uom:
        l["so_item_uom"] = uom
    r["allData"]["table_so"] = [l]
    r["allData"]["sales_order_title"] = "Sales Order"
    r["allData"]["auto_si"] = 0
    totals(r["allData"])
    return r


def swap_item(line, item_id):
    """the template SO line for another item, sold in its base unit at the template's quantity and price (read-only DB)"""
    sys.path.insert(0, "/Users/yunawinaya/Developer/BladeXfunctions/scratchpad/gdc/pkv2tools")
    from dbq import q
    assert item_id.isdigit()
    it = q("--dev", "SELECT material_code, material_desc, CAST(based_uom AS CHAR) uom, CAST(item_category AS CHAR) cat, item_batch_management b, "
                    "serial_number_management sn FROM item WHERE tenant_id = '496474' AND id = %s AND is_deleted = 0" % item_id)[0]
    assert int(it["b"] or 0) == 0 and int(it["sn"] or 0) == 0, it
    conv = q("--dev", "SELECT CAST(id AS CHAR) id, alt_qty, CAST(alt_uom_id AS CHAR) alt_uom_id, base_qty, CAST(base_uom_id AS CHAR) base_uom_id, text_b4j8h211, "
                      "sales_default_uom, purchase_default_uom, over_delivery_tolerance, over_receive_tolerance, min_purchase_qty, sales_unit_price, "
                      "purchase_unit_price FROM item_mji552rc_sub WHERE Item_id = %s AND is_deleted = 0 ORDER BY id" % item_id)
    num = lambda v: float(v) if v not in (None, "") else 0
    uomtab = [{"sales_default_uom": int(c["sales_default_uom"] or 0), "over_delivery_tolerance": num(c["over_delivery_tolerance"]),
               "over_receive_tolerance": num(c["over_receive_tolerance"]), "min_purchase_qty": num(c["min_purchase_qty"]), "id": c["id"],
               "sales_unit_price": num(c["sales_unit_price"]), "base_qty": num(c["base_qty"]), "purchase_default_uom": int(c["purchase_default_uom"] or 0),
               "purchase_unit_price": num(c["purchase_unit_price"]), "base_uom_id": c["base_uom_id"], "text_b4j8h211": c["text_b4j8h211"] or "=",
               "alt_qty": num(c["alt_qty"]), "alt_uom_id": c["alt_uom_id"]} for c in conv]
    free = q("--dev", "SELECT COALESCE(SUM(unrestricted_qty), 0) f FROM item_balance WHERE tenant_id = '496474' AND material_id = %s "
                      "AND plant_id = 1942795438353035266 AND is_deleted = 0" % item_id)[0]["f"]
    l = copy.deepcopy(line)
    l.update({"item_id": it["material_code"], "item_name": item_id, "so_desc": it["material_desc"] or "", "item_category_id": it["cat"],
              "so_item_uom": it["uom"], "unrestricted_qty": float(free), "base_unrestricted_qty": float(free), "custom_fields": {},
              "table_uom_conversion": json.dumps(uomtab)})
    return l


def main():
    live = sys.argv[1].rstrip("/") + "/"
    qqq = json.load(open(live + "so_qqq2.json"))
    two = json.load(open(live + "so_2line.json"))
    assert two["allData"]["table_so"][1]["item_id"] == "Auto Batch Item", two["allData"]["table_so"][1]["item_id"]
    conv = json.loads(qqq["allData"]["table_so"][0]["table_uom_conversion"])
    assert any(c["alt_uom_id"] == BAG and float(c["base_qty"]) == 10 for c in conv), conv
    nq = copy.deepcopy(two)
    q5 = one_line(qqq, 0, 5, float(qqq["allData"]["table_so"][0]["so_item_price"]))["allData"]["table_so"][0]
    nq["allData"]["table_so"] = [nq["allData"]["table_so"][0], q5]
    nq["allData"]["sales_order_title"] = "Sales Order"
    nq["allData"]["auto_si"] = 0
    totals(nq["allData"])
    nt = copy.deepcopy(nq)
    nt["allData"]["table_so"][1] = swap_item(nt["allData"]["table_so"][1], "2100428843929899042")
    totals(nt["allData"])
    for name, r in (("so_alt.json", one_line(qqq, 0, 2, 10, BAG)), ("so_ab30.json", one_line(two, 1, 30, float(two["allData"]["table_so"][1]["so_item_price"]))),
                    ("so_nq.json", nq), ("so_nt.json", nt)):
        json.dump(r, open(live + name, "w"))
        d = r["allData"]
        print(name, [(x["item_id"], x["so_quantity"], x["so_item_uom"], x["so_amount"]) for x in d["table_so"]], "total", d["so_total"])


if __name__ == "__main__":
    main()
