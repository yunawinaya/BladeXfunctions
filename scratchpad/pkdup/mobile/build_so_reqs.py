"""build_so_reqs.py: SO_SAVE requests for the mobile Picking V2 Part 9 run on dev 496474 (sudu-mobile-expo-52), written to
the session scratchpad. Reads only. Source: the 1c clone request (SO/20260827/008: Normal Item 5 + Auto Batch Item 5).
  so_2line.json  the clone as it is (P8 swap)
  so_1line.json  line 1 only, Normal Item 5 (P3 P4 P5 P6 P7 P7b)
  so_qqq.json    one line, QQQ "Flywheel with Tin Plate" 20 PCS (P2: the phone picks 2 BAG; 1 BAG = 10 PCS)"""
import copy, json, sys

sys.path.insert(0, "/Users/yunawinaya/Developer/BladeXfunctions/scratchpad/gdc/pkv2tools")
from dbq import q  # noqa: E402

SP = "/private/tmp/claude-501/-Users-yunawinaya-Developer-BladeXfunctions/3731ab84-dcf9-43a7-bf40-fad956296903/scratchpad/"
OUT = SP + "mobile9/"
QQQ, PCS = "2100428777982857284", "2021056571405717507"
src = json.load(open(SP + "pk1c/so_clone_req3.json"))


def totals(d):
    lines = d["table_so"]
    gross = round(sum(float(l["so_gross"]) for l in lines), 2)
    disc = round(sum(float(l["so_discount_amount"] or 0) for l in lines), 2)
    tax = round(sum(float(l["so_tax_amount"] or 0) for l in lines), 2)
    amount = round(sum(float(l["so_amount"]) for l in lines), 2)
    d.update({"so_total_gross": gross, "so_total_discount": disc, "so_total_tax": tax, "so_total": amount, "myr_total_amount": amount})
    return d


two = copy.deepcopy(src)
one = copy.deepcopy(src)
one["allData"]["table_so"] = one["allData"]["table_so"][:1]
totals(one["allData"])
assert two["allData"]["so_total"] == 175.0 and one["allData"]["so_total"] == 75.0, (two["allData"]["so_total"], one["allData"]["so_total"])

item = q("--dev", "SELECT CAST(id AS CHAR) id, material_code, material_name, material_desc, CAST(based_uom AS CHAR) uom, CAST(item_category AS CHAR) cat, "
                  "item_batch_management b, serial_number_management sn FROM item WHERE tenant_id = '496474' AND id = %s AND is_deleted = 0" % QQQ)[0]
assert item["uom"] == PCS and int(item["b"] or 0) == 0 and int(item["sn"] or 0) == 0, item
conv = q("--dev", "SELECT CAST(id AS CHAR) id, alt_qty, CAST(alt_uom_id AS CHAR) alt_uom_id, base_qty, CAST(base_uom_id AS CHAR) base_uom_id, text_b4j8h211, "
                  "sales_default_uom, purchase_default_uom, over_delivery_tolerance, over_receive_tolerance, min_purchase_qty, sales_unit_price, purchase_unit_price "
                  "FROM item_mji552rc_sub WHERE Item_id = %s AND is_deleted = 0 ORDER BY id" % QQQ)
num = lambda v: float(v) if v not in (None, "") else 0
uomtab = [{"sales_default_uom": int(c["sales_default_uom"] or 0), "over_delivery_tolerance": num(c["over_delivery_tolerance"]), "over_receive_tolerance": num(c["over_receive_tolerance"]),
           "min_purchase_qty": num(c["min_purchase_qty"]), "id": c["id"], "sales_unit_price": num(c["sales_unit_price"]), "base_qty": num(c["base_qty"]),
           "purchase_default_uom": int(c["purchase_default_uom"] or 0), "purchase_unit_price": num(c["purchase_unit_price"]), "base_uom_id": c["base_uom_id"],
           "text_b4j8h211": c["text_b4j8h211"] or "=", "alt_qty": num(c["alt_qty"]), "alt_uom_id": c["alt_uom_id"]} for c in conv]
assert any(u["alt_uom_id"] == "2021056571405717505" and u["base_qty"] == 10 for u in uomtab), uomtab
free = q("--dev", "SELECT COALESCE(SUM(unrestricted_qty), 0) f FROM item_balance WHERE tenant_id = '496474' AND material_id = %s AND plant_id = 1942795438353035266 AND is_deleted = 0" % QQQ)[0]["f"]

qq = copy.deepcopy(one)
l = qq["allData"]["table_so"][0]
l.update({"item_id": item["material_code"], "item_name": QQQ, "so_desc": item["material_desc"] or "", "item_category_id": item["cat"], "so_item_uom": PCS,
          "so_quantity": 20.0, "so_item_price": 1.0, "so_gross": 20.0, "so_discount": 0.0, "so_discount_amount": 0.0, "so_amount": 20.0, "so_tax_amount": 0.0,
          "outstanding_quantity": 20.0, "packing_qty": 20.0, "invoice_qty": 0.0, "si_status": "Not Created", "custom_fields": {}, "unrestricted_qty": float(free),
          "base_unrestricted_qty": float(free), "table_uom_conversion": json.dumps(uomtab)})
totals(qq["allData"])
for name, r in (("so_2line.json", two), ("so_1line.json", one), ("so_qqq.json", qq)):
    json.dump(r, open(OUT + name, "w"), ensure_ascii=False, indent=1)
    d = r["allData"]
    print(name, "lines", [(x["item_id"], x["so_quantity"], x["so_item_uom"]) for x in d["table_so"]], "total", d["so_total"], "status", d["so_status"], d["page_status"], "auto_si", d["auto_si"])
