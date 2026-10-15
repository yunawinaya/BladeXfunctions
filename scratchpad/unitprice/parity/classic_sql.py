"""The classic GET_ITEM_UNIT_PRICE (v52) per-item SQL texts, rendered the way the platform renders placeholders
(raw text substitution; an unresolvable / null value renders as the literal null)."""
import json, os

FX = "/private/tmp/claude-501/-Users-yunawinaya-Developer-BladeXfunctions/3184bace-c1a2-43fd-9910-40a12d531785/scratchpad/unitprice_fx"
_doc = json.load(open(os.path.join(FX, "classic_dev_v52.json")))


def _find(n, nid):
    if isinstance(n, dict):
        if n.get("id") == nid:
            return n
        for v in n.values():
            f = _find(v, nid)
            if f:
                return f
    elif isinstance(n, list):
        for v in n:
            f = _find(v, nid)
            if f:
                return f
    return None


HIST = _find(_doc["nodes"], "sql_node_AFi9JgU7")["data"]["script"]["code"]
TAG = _find(_doc["nodes"], "sql_node_IS2go2ob")["data"]["script"]["code"]
ITEMS = _find(_doc["nodes"], "sql_node_ItemUomPrices")["data"]["script"]["code"]
SOURCE = {"Last Quotation Price": "SQT", "Last Sales Order Price": "SO", "Last Sales Invoice Price": "SI",
          "Last Purchase Requisition Price": "PREQ", "Last Purchase Order Price": "PO", "Last Purchase Invoice Price": "PI"}


def render(v):
    """a loop-item / node value as the platform substitutes it into SQL text"""
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, float):
        return repr(v) if not v.is_integer() else "%.1f" % v
    return str(v)


def hist_sql(source, item_id, uom_id, plant_safe, party_safe):
    s = HIST.replace("{{node:code_node_CyHkGZto.data.source}}", source)
    s = s.replace("{{node:loop_K5yRwowj.item_id}}", render(item_id)).replace("{{node:loop_K5yRwowj.uom_id}}", render(uom_id))
    s = s.replace("{{node:code_node_kaS0Zdzg.data.plantIdSafe}}", plant_safe).replace("{{node:code_node_kaS0Zdzg.data.suppCustIdSafe}}", party_safe)
    assert "{{" not in s
    return s.rstrip().rstrip(";")


def tag_sql(item_id, uom_id, quantity, tag_id, party_safe, fetch_from):
    s = TAG.replace("{{node:code_node_aw4JItTz.data.price_tag_id}}", render(tag_id))
    s = s.replace("{{node:code_node_kaS0Zdzg.data.suppCustIdSafe}}", party_safe)
    s = s.replace("{{node:loop_K5yRwowj.item_id}}", render(item_id)).replace("{{node:loop_K5yRwowj.uom_id}}", render(uom_id))
    s = s.replace("{{node:loop_K5yRwowj.quantity}}", render(quantity)).replace("{{node:code_node_T4JW4d6p.data.fetch_data_from}}", fetch_from)
    assert "{{" not in s
    # its leading "-- Supplier prices" comment line only (the read-only helper refuses a statement that starts with a comment)
    return s.rstrip().rstrip(";").split("\n", 1)[1] if s.startswith("--") else s.rstrip().rstrip(";")


def items_sql(csv):
    return ITEMS.replace("{{node:code_node_kaS0Zdzg.data.item_id_csv}}", csv)
