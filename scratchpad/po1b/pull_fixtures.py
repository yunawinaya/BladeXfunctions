"""Read-only dev fixtures for the Phase 1b PO form harness. Customer data goes to the session scratchpad (argv[1]),
never into the repo.

  python3 pull_fixtures.py <out_dir>

- po_<id>.json      a real PO as the form loads it: header row + table_po (children nested under their parent by
                    parent_id, as the tree table holds them)
- items.json        Item id -> { header columns the handlers read, table_uom_conversion[], table_sup_item_bind[] } for
                    every item of those POs, of the bundles below, and 2,000 live items of tenant 711077 (the 2k tenant)
- bundles.json      item_bundle id -> { header, table_ib[] }: tenant 000000's small bundles + 711077's ~480-line ones
- suppliers.json    supplier_head rows of the POs' tenants (currency, payment term, price tag) + currency rows
- acc.json          accounting_integration rows of the POs' organizations
"""
import json
import os
import re
import sys
from decimal import Decimal

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "grv2"))
from dbq import q  # noqa: E402

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
BIG = 2 ** 53
DEC = re.compile(r"^-?\d+\.\d+$|^-?\d+(\.\d+)?[eE][-+]?\d+$")
# 50 lines (496474); 10 lines with tax + discount (000000); bundles, parent + children (000000); 2,000 lines (711077)
POS = ["PO/20261009/001", "PO/20260709/021", "PO/20260922/032", "PO/20261015/007"]
ID_COLS = {"id", "item_id", "quantity_uom", "item_category_id", "tariff_id", "project_id", "parent_id", "item_bundle_id",
           "tax_preference", "purchase_order_id", "supplier_id", "plant_id", "payment_term_id", "shipping_preference_id",
           "organization_id", "po_plant", "po_supplier_id", "po_payment_terms", "po_shipping_preference", "price_tag_id",
           "create_user", "update_user", "create_dept", "preq_id", "preq_line_id", "linked_so_id", "based_uom",
           "item_category", "mat_purchase_tax_id", "alt_uom_id", "base_uom_id", "Item_id", "uom_id", "currency_id",
           "supplier_payment_term_id", "billing_state_id", "billing_country_id", "shipping_state_id",
           "shipping_country_id", "billing_address_state", "billing_address_country", "shipping_address_state",
           "shipping_address_country", "purchase_order_no_type", "sub_tenant_id"}
TEXT_COLS = {"line_index", "purchase_order_no", "material_code", "ib_no", "tax_percent", "purchase_tax_percent"}


def norm(k, v):
    """Client-API shapes: ids as strings, decimals as numbers."""
    if isinstance(v, bool) or v is None:
        return v
    if k in ID_COLS and isinstance(v, (int, Decimal)):
        return str(v)
    if isinstance(v, int):
        return str(v) if abs(v) > BIG else v
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, str) and DEC.match(v) and k not in ID_COLS and k not in TEXT_COLS:
        return float(v)
    return v


def rows(sql):
    return [{k: norm(k, v) for k, v in r.items()} for r in q("--dev", sql)]


def dump(name, obj):
    with open(os.path.join(OUT, name), "w") as f:
        json.dump(obj, f, ensure_ascii=False, default=str)
    print("wrote", name)


def nest(lines):
    by_id = {ln["id"]: ln for ln in lines}
    top = []
    for ln in lines:
        parent = by_id.get(ln.get("parent_id")) if ln.get("parent_id") else None
        if parent is not None:
            parent.setdefault("children", []).append(ln)
        else:
            top.append(ln)
    return top


item_ids, tenants, orgs = set(), set(), set()
for no in POS:
    hdr = rows(f"SELECT * FROM purchase_order WHERE purchase_order_no='{no}' AND is_deleted=0 ORDER BY id DESC LIMIT 1")[0]
    lines = rows(f"SELECT * FROM purchase_order_2ukyuanr_sub WHERE purchase_order_id={hdr['id']} AND is_deleted=0 "
                 "ORDER BY CAST(line_index AS UNSIGNED), id")
    item_ids.update(ln["item_id"] for ln in lines if ln.get("item_id"))
    tenants.add(hdr["tenant_id"])
    orgs.add(hdr["organization_id"])
    hdr["table_po"] = nest(lines)
    dump(f"po_{hdr['id']}.json", hdr)

# 000000's bundles, then 711077's six largest (~480 lines each) and six small ones
picked = [str(r["id"]) for r in q("--dev", "SELECT id FROM item_bundle WHERE is_deleted=0 AND tenant_id='000000'")]
sizes = q("--dev", "SELECT b.id, COUNT(s.id) n FROM item_bundle b JOIN item_bundle_zssx3xlf_sub s ON s.item_bundle_id=b.id "
                   "AND s.is_deleted=0 WHERE b.is_deleted=0 AND b.tenant_id='711077' GROUP BY b.id ORDER BY b.id")
picked += [str(r["id"]) for r in sizes if r["n"] >= 400][:6] + [str(r["id"]) for r in sizes if 2 <= r["n"] <= 8][:6]
blist = ",".join(picked)
bundle_rows = rows(f"SELECT * FROM item_bundle WHERE id IN ({blist}) ORDER BY id")
bundle_lines = rows(f"SELECT * FROM item_bundle_zssx3xlf_sub WHERE is_deleted=0 AND item_bundle_id IN ({blist}) "
                    "ORDER BY item_bundle_id, id")
bundles = {b["id"]: dict(b, table_ib=[]) for b in bundle_rows}
for ln in bundle_lines:
    if ln["item_bundle_id"] in bundles:
        bundles[ln["item_bundle_id"]]["table_ib"].append(ln)
        if ln.get("item_id"):
            item_ids.add(ln["item_id"])
dump("bundles.json", bundles)

big = [str(r["id"]) for r in q("--dev", "SELECT id FROM item WHERE is_deleted=0 AND tenant_id='711077' ORDER BY id LIMIT 2000")]
item_ids.update(big)

ITEM_COLS = ("id,material_code,material_name,material_desc,based_uom,item_category,further_description,"
             "mat_purchase_tax_id,purchase_tax_percent,purchase_unit_price,organization_id,is_deleted,is_active,tenant_id")
UOM_COLS = ("Item_id,alt_qty,alt_uom_id,base_qty,base_uom_id,purchase_default_uom,min_purchase_qty,max_purchase_qty,"
            "purchase_unit_price,purchase_min_price,purchase_max_price,mat_purchase_tax_id,purchase_tax_percent,"
            "over_receive_tolerance")
BIND_COLS = "Item_id,supplier_id,supplier_name,sup_item_alias,item_description"
items = {}
ids = sorted(item_ids)
for i in range(0, len(ids), 1000):
    chunk = ",".join(ids[i:i + 1000])
    for it in rows(f"SELECT {ITEM_COLS} FROM item WHERE id IN ({chunk})"):
        it["table_uom_conversion"], it["table_sup_item_bind"] = [], []
        items[it["id"]] = it
    for u in rows(f"SELECT {UOM_COLS} FROM item_mji552rc_sub WHERE is_deleted=0 AND Item_id IN ({chunk}) ORDER BY Item_id, id"):
        items[u.pop("Item_id")]["table_uom_conversion"].append(u)
    for b in rows(f"SELECT {BIND_COLS} FROM item_eimnda1q_sub WHERE is_deleted=0 AND Item_id IN ({chunk}) ORDER BY Item_id, id"):
        items[b.pop("Item_id")]["table_sup_item_bind"].append(b)
items = {k: v for k, v in items.items() if k in item_ids}
dump("items.json", {"items": items, "big_ids": big})

tlist = ",".join("'%s'" % t for t in sorted(tenants))
dump("suppliers.json", {
    "suppliers": rows(f"SELECT id, supplier_code, supplier_com_name, currency_id, supplier_payment_term_id, price_tag_id, "
                      f"organization_id, tenant_id FROM supplier_head WHERE is_deleted=0 AND tenant_id IN ({tlist}) ORDER BY id LIMIT 400"),
    "currency": rows(f"SELECT id, currency_code, currency_buying_rate, organization_id, tenant_id FROM currency "
                     f"WHERE is_deleted=0 AND tenant_id IN ({tlist})"),
})
olist = ",".join(sorted(orgs))
dump("acc.json", rows(f"SELECT id, organization_id, acc_integration_type FROM accounting_integration "
                      f"WHERE is_deleted=0 AND organization_id IN ({olist})"))
